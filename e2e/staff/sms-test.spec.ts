// The Test text page in a browser (S01.15), against the production build with the identity fake
// (playwright.staff.config.ts). This server is not production (Twilio's variables and SMS_TEST_ALLOWLIST are refused
// outside it, by design), so the page is the preview: no form, no button, no number, and nothing can reach Twilio.
// The ready, sent, refused and provider-error states are pictured in e2e/hub/sms-test.spec.ts and the send itself is
// tested against a fake provider in src/modules/messaging and test/db. Nothing real is contacted.
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

type Role = "ambassador" | "admin";

async function signInToTheHub(page: Page, role: Role) {
  const username = `${role.slice(0, 3)}${randomBytes(3).toString("hex")}`;
  const password = `${username} own password`;
  const fake = memoryIdentityProvider({ file: fakeFile });
  const authUserId = fake.plant(`${username}@staff.cvh.invalid`, { password: pepperPassword(pepper as string, password), createdAt: new Date() });
  const enrolled = role === "admin";
  if (enrolled) fake.enrol(authUserId);
  await sql`
    insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password, factor_enrolled_at)
    values (${randomUUID()}, ${authUserId}, ${username}, 'Ann', 'Okafor', 'someone@example.org', ${role}, false, ${enrolled ? new Date() : null})`;
  await page.goto("/staff/sign-in");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  if (enrolled) {
    await page.getByLabel("6-digit code").fill(totpCode(memoryTotpSecret(authUserId)));
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await expect(page).toHaveURL(/\/staff$/);
}

test("an Admin finds Test text under Administration with a phone icon of its own, and the page is the preview with no form and no number", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInToTheHub(page, "admin");

  const side = page.getByTestId("hub-side");
  const link = side.getByRole("link", { name: "Test text" });
  await expect(link.locator(".hub-ico--phone")).toHaveCount(1);
  await expect(side.getByRole("link", { name: "Providers" }).locator(".hub-ico--inbox")).toHaveCount(1);
  await link.click();

  await expect(page).toHaveURL(/\/staff\/sms-test$/);
  await expect(page.getByRole("heading", { level: 1, name: "Test text" })).toBeVisible();
  await expect(link).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Texts are only sent from production")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send test text" })).toHaveCount(0);
  await expect(page.locator("main select, main form")).toHaveCount(0);
  expect(await page.content()).not.toMatch(/\+\d{8,}/);
});

test("an Ambassador has no Test text in the menu and is told only an Admin can send a test text, with no form", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInToTheHub(page, "ambassador");

  await expect(page.getByTestId("hub-side").getByRole("link", { name: "Test text" })).toHaveCount(0);
  await page.goto("/staff/sms-test");

  await expect(page.getByText("Only an Admin can send a test text.")).toBeVisible();
  await expect(page.locator("main form")).toHaveCount(0);
});
