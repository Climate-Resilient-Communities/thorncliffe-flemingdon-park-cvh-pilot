// Authenticator recovery in a browser (S01.11), against the production build with the identity
// fake (playwright.staff.config.ts): an Admin resets a Coordinator's authenticator, the
// Coordinator's other session ends and their next sign-in goes to enrolment; an Admin cannot reset
// their own, and a Coordinator is not offered the action. Accounts are written straight into the
// disposable database and the fake's state file; codes are RFC 6238 from the fake's secrets.
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import postgres from "postgres";
import { memoryIdentityProvider } from "../../src/modules/identity/adapters/memoryIdentityProvider";
import { memoryTotpSecret, totpCode } from "../../src/modules/identity/adapters/memoryTotp";
import { pepperPassword } from "../../src/modules/identity/application/passwordPepper";

const ownerUrl = process.env.STAFF_TEST_DATABASE_URL;
const fakeFile = process.env.CVH_FAKE_IDENTITY_FILE;
const pepper = process.env.STAFF_PASSWORD_PEPPER;

let sql: postgres.Sql;

test.beforeAll(async () => {
  if (!ownerUrl || !fakeFile || !pepper) {
    throw new Error("STAFF_TEST_DATABASE_URL, CVH_FAKE_IDENTITY_FILE and STAFF_PASSWORD_PEPPER are required (playwright.staff.config.ts)");
  }
  sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  await sql`delete from sign_in_failure`;
  await sql`delete from sign_in_lock`;
});

test.afterAll(async () => {
  await sql?.end({ timeout: 5 });
});

/** A new Admin or Coordinator on its own password, with an authenticator enrolled through the app. */
async function newAccount(role: "admin" | "coordinator") {
  const username = `${role.slice(0, 3)}${randomBytes(3).toString("hex")}`;
  const password = `${username} own password`;
  const fake = memoryIdentityProvider({ file: fakeFile });
  const authUserId = fake.plant(`${username}@staff.cvh.invalid`, { password: pepperPassword(pepper as string, password), createdAt: new Date() });
  fake.enrol(authUserId);
  const id = randomUUID();
  await sql`
    insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password, factor_enrolled_at)
    values (${id}, ${authUserId}, ${username}, 'Ann', 'Okafor', 'someone@example.org', ${role}, false, now())`;
  return { id, username, password, authUserId };
}

/** An Admin, with bootstrap completed (the database holds one bootstrap row for every test). */
async function adminAfterBootstrap() {
  const first = await newAccount("admin");
  const [state] = await sql`select completed_at from staff_bootstrap`;
  if (!state) {
    const second = await newAccount("admin");
    await sql`insert into staff_bootstrap (first_admin_id, second_admin_id, completed_at) values (${first.id}, ${second.id}, now())`;
  } else if (state.completed_at === null) {
    throw new Error("another test left bootstrap in progress");
  }
  return first;
}

/** Signs in and enters the authenticator code: an aal2 session at the Hub. */
async function signInWithCode(page: Page, account: { username: string; password: string; authUserId: string }) {
  await page.goto("/staff/sign-in");
  await page.getByLabel("Username").fill(account.username);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/staff\/sign-in\/code$/);
  await page.getByLabel("6-digit code").fill(totpCode(memoryTotpSecret(account.authUserId)));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/staff$/);
}

async function newPage(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

test("an Admin resets a Coordinator's authenticator: their other session ends and their next sign-in goes to enrolment", async ({ browser }) => {
  const admin = await adminAfterBootstrap();
  const coordinator = await newAccount("coordinator");
  const phone = await newPage(browser);
  await signInWithCode(phone.page, coordinator);
  expect((await phone.page.request.get("/api/staff/me")).status()).toBe(200);

  const desk = await newPage(browser);
  await signInWithCode(desk.page, admin);
  await desk.page.goto("/staff/people");
  const reset = desk.page.getByRole("region", { name: "Reset an authenticator" });
  await reset.getByLabel("Their username").fill(coordinator.username);
  await reset.getByRole("button", { name: "Reset authenticator" }).click();
  await expect(reset.getByText(`Authenticator reset for ${coordinator.username}.`)).toBeVisible();
  await expect(reset.getByText("They were signed out on every device.")).toBeVisible();

  // The Coordinator's other session is over.
  const me = await phone.page.request.get("/api/staff/me");
  expect(me.status()).toBe(401);
  expect(await me.json()).toEqual({ error: "unauthenticated" });
  await phone.page.goto("/staff");
  await expect(phone.page).toHaveURL(/\/staff\/sign-in$/);

  const [account] = await sql`select factor_enrolled_at from staff_account where id = ${coordinator.id}`;
  expect(account.factor_enrolled_at).toBeNull();
  const audits = await sql`select actor_staff_id, action, meta from audit_event where subject_id = ${coordinator.id} and action in ('factor.reset', 'session.revoked') order by id`;
  expect(audits).toEqual([
    { actor_staff_id: admin.id, action: "session.revoked", meta: { cause: "factor_reset", sessions: 1 } },
    { actor_staff_id: admin.id, action: "factor.reset", meta: { recovery: "lost_device" } },
  ]);

  // The old authenticator is gone: the next sign-in is held at enrolment, not asked for a code.
  await phone.page.getByLabel("Username").fill(coordinator.username);
  await phone.page.getByLabel("Password", { exact: true }).fill(coordinator.password);
  await phone.page.getByRole("button", { name: "Sign in" }).click();
  await expect(phone.page).toHaveURL(/\/staff\/setup\/authenticator$/);
  await expect(phone.page.getByRole("heading", { name: "Set up your authenticator" })).toBeVisible();
  await phone.context.close();
  await desk.context.close();
});

test("an Admin cannot reset their own authenticator, and a Coordinator is not offered the action", async ({ browser }) => {
  const admin = await adminAfterBootstrap();
  const desk = await newPage(browser);
  await signInWithCode(desk.page, admin);
  await desk.page.goto("/staff/people");
  const reset = desk.page.getByRole("region", { name: "Reset an authenticator" });
  await reset.getByLabel("Their username").fill(admin.username);
  await reset.getByRole("button", { name: "Reset authenticator" }).click();
  await expect(desk.page.locator("#reset-authenticator-error")).toHaveText("You cannot reset your own authenticator. Ask another Admin.");
  const [account] = await sql`select factor_enrolled_at from staff_account where id = ${admin.id}`;
  expect(account.factor_enrolled_at).not.toBeNull();
  expect((await desk.page.request.get("/api/staff/me")).status()).toBe(200);
  await desk.context.close();

  const coordinator = await newAccount("coordinator");
  const other = await newPage(browser);
  await signInWithCode(other.page, coordinator);
  await other.page.goto("/staff/people");
  await expect(other.page.getByRole("region", { name: "Reset an authenticator" })).toHaveCount(0);
  await other.context.close();
});
