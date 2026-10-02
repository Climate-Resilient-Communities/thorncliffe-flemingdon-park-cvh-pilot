// Authenticators in a browser (S01.10), against the production build with the identity fake
// (playwright.staff.config.ts): an Admin's first sign-in through both setup gates, an enrolled
// Coordinator's one code per sign-in, an Ambassador without one, and privileged actions called
// directly from an aal1 session. Codes are computed here with RFC 6238 from the fake's
// deterministic secret, or from the key the enrolment page shows.
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
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

type Role = "ambassador" | "coordinator" | "director" | "admin";

/**
 * A new account, written as S01.05 and S01.07 leave it: on its starting password (`starting`), or
 * on its own password, with an authenticator enrolled through the app when `enrolled`.
 */
async function newAccount(role: Role, options: { starting?: boolean; enrolled?: boolean } = {}) {
  const firstName = "Ann";
  const lastName = "Okafor";
  const username = `${role.slice(0, 3)}${randomBytes(3).toString("hex")}`;
  const password = options.starting ? "rvh-ann-okafor" : `${username} own password`;
  const fake = memoryIdentityProvider({ file: fakeFile });
  const authUserId = fake.plant(`${username}@staff.cvh.invalid`, { password: pepperPassword(pepper as string, password), createdAt: new Date() });
  if (options.enrolled) fake.enrol(authUserId);
  const id = randomUUID();
  await sql`
    insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password, starting_password_issued_at, factor_enrolled_at)
    values (${id}, ${authUserId}, ${username}, ${firstName}, ${lastName}, 'someone@example.org', ${role}, ${options.starting === true},
            ${options.starting ? new Date() : null}, ${options.enrolled ? new Date() : null})`;
  return { id, username, password, authUserId };
}

async function signIn(page: Page, username: string, password: string) {
  await page.goto("/staff/sign-in");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** A code that is not the right one now. */
const wrong = (code: string) => String((Number(code) + 500_000) % 1_000_000).padStart(6, "0");

const post = (page: Page, path: string, data: unknown = {}) => page.request.post(path, { data, headers: { "content-type": "application/json" } });

test("an Admin's first sign-in: starting password, own password, authenticator, then the Hub", async ({ page }) => {
  const admin = await newAccount("admin", { starting: true });
  await signIn(page, admin.username, admin.password);
  await expect(page).toHaveURL(/\/staff\/setup\/password$/);
  await page.getByLabel("New password", { exact: true }).fill("a long new password");
  await page.getByLabel("Type the new password again").fill("a long new password");
  await page.getByRole("button", { name: "Save my password" }).click();

  // Gate 2: only the enrolment page and its calls, me and sign-out.
  await expect(page).toHaveURL(/\/staff\/setup\/authenticator$/);
  await expect(page.getByRole("heading", { name: "Set up your authenticator" })).toBeVisible();
  for (const path of ["/staff", "/staff/people", "/staff/setup/password", "/staff/sign-in/code"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/staff\/setup\/authenticator$/);
  }
  const refused = await post(page, "/api/staff/password", { password: "x", confirm: "x" });
  expect(refused.status()).toBe(403);
  expect(await refused.json()).toEqual({ error: "setup_incomplete" });
  expect(await (await page.request.get("/api/staff/me")).json()).toMatchObject({ gate: "enrol_authenticator", aal: "aal1", next: "/staff/setup/authenticator" });

  await page.getByRole("button", { name: "Show my setup code" }).click();
  const key = (await page.getByTestId("authenticator-key").innerText()).replace(/^Key: /, "").replace(/\s+/g, "");
  expect(key).toBe(memoryTotpSecret(admin.authUserId));

  await page.getByLabel("The 6-digit code the app shows").fill(wrong(totpCode(key)));
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.locator(`p[role="alert"]`)).toHaveText(/That code is not right/);

  await page.getByLabel("The 6-digit code the app shows").fill(totpCode(key));
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page).toHaveURL(/\/staff$/);
  await expect(page.getByText("Signed in as Ann Okafor, Admin")).toBeVisible();
  expect(await (await page.request.get("/api/staff/me")).json()).toMatchObject({ gate: "hub", aal: "aal2" });

  const [account] = await sql`select factor_enrolled_at from staff_account where id = ${admin.id}`;
  expect(account.factor_enrolled_at).not.toBeNull();
  const audits = await sql`select action, meta from audit_event where subject_id = ${admin.id} and action in ('factor.enrolled', 'auth.signed_in') order by id`;
  expect(audits.map((row) => [row.action, row.meta.aal ?? null])).toEqual([
    ["auth.signed_in", "aal1"],
    ["factor.enrolled", null],
    ["auth.signed_in", "aal2"],
  ]);
});

test("an enrolled Coordinator enters one code after the password and is not asked again", async ({ page }) => {
  const coordinator = await newAccount("coordinator", { enrolled: true });
  await signIn(page, coordinator.username, coordinator.password);
  await expect(page).toHaveURL(/\/staff\/sign-in\/code$/);
  await expect(page.getByRole("heading", { name: "Enter your authenticator code" })).toBeVisible();

  // Until the code, the Hub is out of reach.
  await page.goto("/staff");
  await expect(page).toHaveURL(/\/staff\/sign-in\/code$/);
  expect(await (await page.request.get("/api/staff/me")).json()).toMatchObject({ gate: "authenticator_code", aal: "aal1" });
  expect((await post(page, "/api/staff/factor/enrol")).status()).toBe(403);

  await page.getByLabel("6-digit code").fill(totpCode(memoryTotpSecret(coordinator.authUserId)));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/staff$/);
  await expect(page.getByText("Signed in as Ann Okafor, Coordinator")).toBeVisible();

  for (const path of ["/staff", "/staff/people", "/staff/sign-in/code"]) {
    await page.goto(path);
    await expect(page, path).not.toHaveURL(/\/staff\/sign-in/);
  }
  expect(await (await page.request.get("/api/staff/me")).json()).toMatchObject({ gate: "hub", aal: "aal2" });
});

test("an Ambassador signs in with no code", async ({ page }) => {
  const ambassador = await newAccount("ambassador");
  await signIn(page, ambassador.username, ambassador.password);
  await expect(page).toHaveURL(/\/staff$/);
  expect(await (await page.request.get("/api/staff/me")).json()).toMatchObject({ gate: "hub", aal: "aal1" });
  await page.goto("/staff/setup/authenticator");
  await expect(page).toHaveURL(/\/staff$/);
});

const unescapeHtml = (text: string) =>
  text.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/**
 * The fields of a server-action form as the server renders it (progressive enhancement: React adds
 * hidden `$ACTION…` fields naming the action). Posting them as a form, with no JavaScript, calls the
 * action itself, which anyone can do without the screen. `headingId` is the form's section heading.
 */
function actionFields(html: string, headingId: string): [string, string][] {
  const section = html.slice(html.indexOf(`id="${headingId}"`));
  const form = section.slice(section.indexOf("<form"), section.indexOf("</form>"));
  return [...form.matchAll(/<input\b[^>]*>/g)].flatMap(([tag]) => {
    const name = /\bname="([^"]*)"/.exec(tag)?.[1];
    const value = /\bvalue="([^"]*)"/.exec(tag)?.[1] ?? "";
    return name === undefined ? [] : [[unescapeHtml(name), unescapeHtml(value)] as [string, string]];
  });
}

test("privileged account actions called directly by a Director (aal1) are refused by the role policy and change nothing", async ({ page, browser, baseURL }) => {
  // An Admin at aal2 opens the people page, whose forms carry the actions' ids.
  const admin = await newAccount("admin", { enrolled: true });
  await signIn(page, admin.username, admin.password);
  await page.getByLabel("6-digit code").fill(totpCode(memoryTotpSecret(admin.authUserId)));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/staff$/);
  const html = await (await page.request.get("/staff/people")).text();
  const target = await newAccount("ambassador");
  const fields = actionFields(html, "reset-password-title").map(([name, value]): [string, string] => [name, name === "username" ? target.username : value]);
  expect(fields.some(([name]) => name.startsWith("$ACTION"))).toBe(true);
  expect(fields.some(([name]) => name === "username")).toBe(true);

  // A Director (Hub, aal1) posts the same action with no screen at all.
  const director = await newAccount("director");
  const context = await browser.newContext();
  const directorPage = await context.newPage();
  await signIn(directorPage, director.username, director.password);
  await expect(directorPage).toHaveURL(/\/staff$/);
  const form = new FormData();
  for (const [name, value] of fields) form.append(name, value);
  const response = await directorPage.request.post("/staff/people", { multipart: form, headers: { origin: baseURL as string } });
  expect(response.status()).toBe(200);
  // S01.12: the role policy refuses a Director before the authenticator level is looked at (S01.10).
  expect(await response.text()).toContain("Only an Admin can reset a password.");

  const [denied] = await sql`select actor_staff_id, meta from audit_event where action = 'permission.denied' and actor_staff_id = ${director.id}`;
  expect(denied.meta).toEqual({ status: 403, route: "/staff/people", permission: "accounts.manage", reason: "forbidden" });
  const [untouched] = await sql`select status, must_change_password from staff_account where id = ${target.id}`;
  expect(untouched).toEqual({ status: "active", must_change_password: false });
  expect(await sql`select 1 from audit_event where action = 'password.reset' and subject_id = ${target.id}`).toHaveLength(0);
  await context.close();
});
