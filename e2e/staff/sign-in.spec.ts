// Staff sign-in and gate 1 of the setup sequence in a browser (S01.07), against the production build
// with the identity fake (playwright.staff.config.ts). Accounts are written straight into the
// disposable database and the fake's state file, as S01.05 would have made them.
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { MEMORY_SESSION_COOKIE, memoryIdentityProvider } from "../../src/modules/identity/adapters/memoryIdentityProvider";
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
  // Every local run is one client to the throttle: start each run without earlier runs' failures.
  await sql`delete from sign_in_failure`;
  await sql`delete from sign_in_lock`;
});

test.afterAll(async () => {
  await sql?.end({ timeout: 5 });
});

/** A new account on its starting password; usernames are unique per run. */
async function newAccount(role: "ambassador" | "coordinator", firstName: string, lastName: string) {
  const username = `${firstName.toLowerCase()}${randomBytes(3).toString("hex")}`;
  const startingPassword = `rvh-${firstName.toLowerCase()}-${lastName.toLowerCase()}`;
  // The fake holds what Supabase Auth would: the peppered starting password.
  const authUserId = memoryIdentityProvider({ file: fakeFile }).plant(`${username}@staff.cvh.invalid`, {
    password: pepperPassword(pepper as string, startingPassword),
    createdAt: new Date(),
  });
  await sql`
    insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password, starting_password_issued_at)
    values (${randomUUID()}, ${authUserId}, ${username}, ${firstName}, ${lastName}, 'someone@example.org', ${role}, true, now())`;
  return { username, startingPassword };
}

async function signIn(page: Page, username: string, password: string) {
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function choosePassword(page: Page, password: string, confirm = password) {
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByLabel("Type the new password again").fill(confirm);
  await page.getByRole("button", { name: "Save my password" }).click();
}

test("an Ambassador signs in with the starting password, is held at Choose your password, replaces it and reaches the Hub", async ({ page, context }) => {
  const { username, startingPassword } = await newAccount("ambassador", "Ann", "Okafor");

  // Without a session every staff page goes to sign-in.
  await page.goto("/staff/people");
  await expect(page).toHaveURL(/\/staff\/sign-in$/);

  await signIn(page, username, "not the password");
  await expect(page.locator(`p[role="alert"]`)).toHaveText("Username or password is incorrect");

  await signIn(page, username, startingPassword);
  await expect(page).toHaveURL(/\/staff\/setup\/password$/);
  await expect(page.getByRole("heading", { name: "Choose your password" })).toBeVisible();

  // The session cookie is out of reach of page scripts.
  const cookies = await context.cookies();
  expect(cookies.length).toBeGreaterThan(0);
  expect(cookies.every((cookie) => cookie.httpOnly && cookie.sameSite === "Lax")).toBe(true);

  // Gate 1: other staff pages come back here; only me, password and sign-out answer.
  for (const path of ["/staff", "/staff/people", "/staff/setup/authenticator"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/staff\/setup\/password$/);
  }
  const me = await page.request.get("/api/staff/me");
  expect(me.status()).toBe(200);
  expect(me.headers()["cache-control"]).toContain("no-store");
  expect(await me.json()).toMatchObject({ username, role: "ambassador", gate: "choose_password", next: "/staff/setup/password" });

  await choosePassword(page, "short");
  await expect(page.locator(`p[role="alert"]`)).toHaveText("Use at least 10 characters.");
  await choosePassword(page, `my ${username} password`);
  await expect(page.locator(`p[role="alert"]`)).toHaveText("Your password cannot contain your username.");
  await choosePassword(page, startingPassword.toUpperCase());
  await expect(page.locator(`p[role="alert"]`)).toHaveText("Choose a password that is not your starting password.");

  await choosePassword(page, "a long new password");
  await expect(page).toHaveURL(/\/staff$/);
  await expect(page.getByText("Signed in as Ann Okafor, Ambassador")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/staff\/sign-in$/);
  expect((await page.request.get("/api/staff/me")).status()).toBe(401);

  // The starting password no longer works; the new one does.
  await signIn(page, username, startingPassword);
  await expect(page.locator(`p[role="alert"]`)).toHaveText("Username or password is incorrect");
  await signIn(page, username, "a long new password");
  await expect(page).toHaveURL(/\/staff$/);
});

test("a Coordinator goes on to authenticator enrolment after choosing a password", async ({ page }) => {
  const { username, startingPassword } = await newAccount("coordinator", "Omar", "Farouk");

  await page.goto("/staff/sign-in");
  await signIn(page, username, startingPassword);
  await expect(page).toHaveURL(/\/staff\/setup\/password$/);
  await choosePassword(page, "a long new password");

  await expect(page).toHaveURL(/\/staff\/setup\/authenticator$/);
  await page.goto("/staff");
  await expect(page).toHaveURL(/\/staff\/setup\/authenticator$/);
});

test("a session opened at the provider directly, outside the app's sign-in, is not let in", async ({ page, context, baseURL }) => {
  const { username, startingPassword } = await newAccount("ambassador", "Ida", "Grant");
  const provider = memoryIdentityProvider({ file: fakeFile });
  // With the typed starting password the provider refuses: it holds the peppered one.
  expect(provider.grant(`${username}@staff.cvh.invalid`, startingPassword)).toBeNull();
  // Even with the provider's password, a session the app did not open is rejected.
  const token = provider.grant(`${username}@staff.cvh.invalid`, pepperPassword(pepper as string, startingPassword));
  expect(token).not.toBeNull();
  await context.addCookies([{ name: MEMORY_SESSION_COOKIE, value: token as string, url: baseURL as string, httpOnly: true, sameSite: "Lax" }]);

  expect((await page.request.get("/api/staff/me")).status()).toBe(401);
  await page.goto("/staff/setup/password");
  await expect(page).toHaveURL(/\/staff\/sign-in$/);

  // The starting password still works once, for its owner, through the app.
  await signIn(page, username, startingPassword);
  await expect(page).toHaveURL(/\/staff\/setup\/password$/);
});

test("staff pages and calls are never stored", async ({ request }) => {
  for (const path of ["/staff/sign-in", "/api/staff/me"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.headers()["cache-control"], path).toContain("no-store");
  }
});
