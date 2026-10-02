// Session limits and revocation in a browser (S01.08), against the production build with the
// identity fake (playwright.staff.config.ts). Accounts are written straight into the disposable
// database and the fake's state file; an idle session is made by moving its times back.
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

/** A new account that already chose its own password (and, for an Admin, enrolled an authenticator). */
async function newAccount(role: "ambassador" | "admin") {
  const username = `${role.slice(0, 3)}${randomBytes(3).toString("hex")}`;
  const password = `${username} own password`;
  const fake = memoryIdentityProvider({ file: fakeFile });
  const authUserId = fake.plant(`${username}@staff.cvh.invalid`, { password: pepperPassword(pepper as string, password), createdAt: new Date() });
  if (role === "admin") fake.enrol(authUserId);
  const id = randomUUID();
  await sql`
    insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password, factor_enrolled_at)
    values (${id}, ${authUserId}, ${username}, 'Ann', 'Okafor', 'someone@example.org', ${role}, false, ${role === "admin" ? new Date() : null})`;
  return { id, username, password, authUserId };
}

/** Two usable Admins with bootstrap completed (the database holds one bootstrap row for every test). */
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

/** Signs in; an Admin (`authUserId` given) then enters the authenticator code (S01.10). */
async function signIn(page: Page, username: string, password: string, authUserId?: string) {
  await page.goto("/staff/sign-in");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  if (authUserId) {
    await expect(page).toHaveURL(/\/staff\/sign-in\/code$/);
    await page.getByLabel("6-digit code").fill(totpCode(memoryTotpSecret(authUserId)));
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await expect(page).toHaveURL(/\/staff$/);
}

async function newPage(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

test("an Ambassador idle for 30 minutes gets 401 from the API and is sent to sign-in", async ({ browser }) => {
  const ambassador = await newAccount("ambassador");
  const { context, page } = await newPage(browser);
  await signIn(page, ambassador.username, ambassador.password);
  expect((await page.request.get("/api/staff/me")).status()).toBe(200);

  // 31 minutes without a request.
  await sql`update staff_session set created_at = created_at - interval '31 minutes', last_seen_at = last_seen_at - interval '31 minutes'
            where staff_account_id = ${ambassador.id}`;

  const me = await page.request.get("/api/staff/me");
  expect(me.status()).toBe(401);
  expect(await me.json()).toEqual({ error: "unauthenticated" });
  await page.goto("/staff");
  await expect(page).toHaveURL(/\/staff\/sign-in$/);
  // Ended for good, even if the clock were turned back.
  await sql`update staff_session set last_seen_at = now() where staff_account_id = ${ambassador.id}`;
  expect((await page.request.get("/api/staff/me")).status()).toBe(401);
  await context.close();
});

test("an Admin's Reset password shows the new starting password once and signs the person out on their other device", async ({ browser }) => {
  const admin = await adminAfterBootstrap();
  const target = await newAccount("ambassador");
  const phone = await newPage(browser);
  await signIn(phone.page, target.username, target.password);
  expect((await phone.page.request.get("/api/staff/me")).status()).toBe(200);

  const desk = await newPage(browser);
  await signIn(desk.page, admin.username, admin.password, admin.authUserId);
  await desk.page.goto("/staff/people");
  const reset = desk.page.getByRole("region", { name: "Reset a password" });
  await reset.getByLabel("Their username").fill(target.username);
  await reset.getByRole("button", { name: "Reset password" }).click();
  await expect(reset.getByText(`New starting password for ${target.username}: rvh-ann-okafor`)).toBeVisible();

  const me = await phone.page.request.get("/api/staff/me");
  expect(me.status()).toBe(401);
  await phone.page.goto("/staff");
  await expect(phone.page).toHaveURL(/\/staff\/sign-in$/);
  const [audit] = await sql`select meta from audit_event where action = 'session.revoked' and subject_id = ${target.id}`;
  expect(audit.meta).toEqual({ cause: "password_reset", sessions: 1 });

  // The new starting password works, at gate 1.
  await phone.page.getByLabel("Username").fill(target.username);
  await phone.page.getByLabel("Password", { exact: true }).fill("rvh-ann-okafor");
  await phone.page.getByRole("button", { name: "Sign in" }).click();
  await expect(phone.page).toHaveURL(/\/staff\/setup\/password$/);
  await phone.context.close();
  await desk.context.close();
});
