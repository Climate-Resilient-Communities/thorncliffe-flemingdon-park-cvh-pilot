// Spend and the monthly cap in a browser (S07.08), against the production build with the identity fake (playwright.staff.config.ts): an Admin at aal2 sees the
// pilot's spend against the CAD 1,000 budget and sets and changes the monthly cap (audited, with the cap and the one it replaced), a refused amount changes
// nothing, a Director sees the same page read-only with no form, the roles that cannot see spend are told so and have no menu item, and a direct post of the
// save by anyone but an Admin is refused and audited. Every figure is fictional. Nothing here sends a text: the server runs with SMS_MODE=log.
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

async function clearState() {
  await sql`update spend_cap set monthly_cents = null, set_by = null, set_at = null where id = 1`;
  await sql`delete from sms_estimate_retirement`;
  await sql`delete from sms_actual`;
  await sql`delete from sms_reconciliation`;
  await sql`delete from spend_event`;
}

test.beforeAll(async () => {
  if (!ownerUrl || !fakeFile || !pepper) {
    throw new Error("STAFF_TEST_DATABASE_URL, CVH_FAKE_IDENTITY_FILE and STAFF_PASSWORD_PEPPER are required (playwright.staff.config.ts)");
  }
  sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  await sql`delete from sign_in_failure`;
  await sql`delete from sign_in_lock`;
});

test.afterAll(async () => {
  await clearState();
  await sql?.end({ timeout: 5 });
});

let auditMark = 0;

test.beforeEach(async () => {
  await clearState();
  [{ max: auditMark }] = await sql`select coalesce(max(id), 0)::int as max from audit_event`;
});

type Role = "ambassador" | "coordinator" | "director" | "admin";

/** A new account on its own password, with an authenticator enrolled when the role has one. */
async function newAccount(role: Role) {
  const username = `${role.slice(0, 3)}${randomBytes(3).toString("hex")}`;
  const password = `${username} own password`;
  const fake = memoryIdentityProvider({ file: fakeFile });
  const authUserId = fake.plant(`${username}@staff.cvh.invalid`, { password: pepperPassword(pepper as string, password), createdAt: new Date() });
  const enrolled = role === "admin" || role === "coordinator";
  if (enrolled) fake.enrol(authUserId);
  const id = randomUUID();
  await sql`
    insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password, factor_enrolled_at)
    values (${id}, ${authUserId}, ${username}, 'Ann', 'Okafor', 'someone@example.org', ${role}, false, ${enrolled ? new Date() : null})`;
  return { id, username, password, authUserId, enrolled };
}

/** Signs in to the Hub, entering the authenticator code when the role has one (aal2). */
async function signInToTheHub(page: Page, role: Role) {
  const account = await newAccount(role);
  await page.goto("/staff/sign-in");
  await page.getByLabel("Username").fill(account.username);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  if (account.enrolled) {
    await page.getByLabel("6-digit code").fill(totpCode(memoryTotpSecret(account.authUserId)));
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await expect(page).toHaveURL(/\/staff$/);
  return account;
}

async function expectNoHorizontalScroll(page: Page) {
  const root = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(root.scrollWidth, "document scrollWidth <= clientWidth").toBeLessThanOrEqual(root.clientWidth);
}

const audits = () => sql`select action, actor_staff_id, subject_type, subject_id, outcome, meta from audit_event where id > ${auditMark} and action like 'spend.%' order by id`;
const denials = (actor: string) => sql`select meta from audit_event where id > ${auditMark} and action = 'permission.denied' and actor_staff_id = ${actor} order by id`;
const cap = async () => (await sql`select monthly_cents, set_by from spend_cap where id = 1`)[0] as { monthly_cents: number | null; set_by: string | null };

test("an Admin sees spend against the budget, sets and changes the monthly cap, and each change is audited with the cap and the one it replaced", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const admin = await signInToTheHub(page, "admin");
  // A little spend this month: 40 texts counted at their estimate (the month has not been reconciled), and Cohere calls whose price is not known.
  await sql`
    insert into spend_event (kind, purpose, model, delivery_id, lang, is_drill, segments, cost_estimate_cents)
    select 'sms', 'transactional', 'twilio', gen_random_uuid(), 'en', false, 1, 2 from generate_series(1, 40)`;
  await sql`insert into spend_event (kind, purpose, model, calls, tokens, tokens_estimated) values ('embed', 'search', 'embed-v4.0', 3, 1200000, true)`;

  const side = page.getByTestId("hub-side");
  await side.getByRole("link", { name: "Spend" }).click();
  await expect(page).toHaveURL(/\/staff\/spend$/);
  await expect(page.getByRole("heading", { level: 1, name: "Spend" })).toBeVisible();
  await expect(page.locator("main")).toHaveCount(1);
  await expect(side.getByRole("link", { name: "Spend" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("budget-line")).toContainText("Budget: CAD 1,000.00. Counted so far: CAD 0.80.");
  await expect(page.getByTestId("sms-month").locator("[data-testid^='line-pending-']")).toContainText("Pending reconciliation");
  await expect(page.getByTestId("cohere-month")).toContainText("Price unknown: 3 calls, 1,200,000 tokens");
  await expect(page.getByTestId("budget-incomplete")).toBeVisible();
  await expect(page.getByTestId("cap-state")).toContainText("No cap is set.");

  // An amount that is not one is refused by the server, and nothing changes.
  await page.getByLabel("Monthly cap (CAD)").fill("lots");
  await page.getByRole("button", { name: "Save cap" }).click();
  await expect(page.getByTestId("cap-error")).toHaveText("That is not an amount. Use dollars, for example 250 or 250.50.");
  expect((await cap()).monthly_cents).toBeNull();

  await page.getByLabel("Monthly cap (CAD)").fill("250.50");
  await page.getByRole("button", { name: "Save cap" }).click();
  await expect(page.getByTestId("cap-answer")).toContainText("The monthly cap is now CAD 250.50.");
  await expect(page.getByTestId("cap-state")).toContainText("The monthly cap is CAD 250.50.");
  expect(await cap()).toEqual({ monthly_cents: 25_050, set_by: admin.id });

  await page.getByLabel("Monthly cap (CAD)").fill("300");
  await page.getByRole("button", { name: "Save cap" }).click();
  await expect(page.getByTestId("cap-answer")).toContainText("The monthly cap changed from CAD 250.50 to CAD 300.00.");
  expect((await cap()).monthly_cents).toBe(30_000);

  expect((await audits()).map((a) => [a.action, a.actor_staff_id, a.subject_type, a.subject_id, a.outcome, a.meta])).toEqual([
    ["spend.cap_set", admin.id, "spend_cap", "1", "refused", { reason: "validation" }],
    ["spend.cap_set", admin.id, "spend_cap", "1", "ok", { cap_cents: 25_050 }],
    ["spend.cap_set", admin.id, "spend_cap", "1", "ok", { cap_cents: 30_000, previous_cents: 25_050 }],
  ]);
});

test("a phone shows the spend and the cap form without a sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInToTheHub(page, "admin");
  await page.goto("/staff/spend");
  await expect(page.getByTestId("budget")).toBeVisible();
  await expectNoHorizontalScroll(page);
  const save = page.getByRole("button", { name: "Save cap" });
  expect((await save.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "Spend" })).toBeVisible();
});

test("a Director sees spend read-only with no form, and the roles that cannot see spend are told so and have no menu item; a direct post of the save by any of them is refused and audited", async ({
  page,
  browser,
  baseURL,
}) => {
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signInToTheHub(adminPage, "admin");
  await adminPage.goto("/staff/spend");
  await adminPage.getByLabel("Monthly cap (CAD)").fill("250");
  await adminPage.getByRole("button", { name: "Save cap" }).click();
  await expect(adminPage.getByTestId("cap-state")).toContainText("The monthly cap is CAD 250.00.");

  // The Admin's page carries the save action's id in its form.
  const unescape = (text: string) => text.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const html = await (await adminPage.request.get("/staff/spend")).text();
  const form = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(([text]) => text).find((text) => text.includes('name="cap"'));
  if (!form) throw new Error("no cap form on the Admin's page");
  const fields = [...form.matchAll(/<input\b[^>]*>/g)].flatMap(([tag]) => {
    const name = /\bname="([^"]*)"/.exec(tag)?.[1];
    return name === undefined ? [] : [[unescape(name), unescape(/\bvalue="([^"]*)"/.exec(tag)?.[1] ?? "")] as [string, string]];
  });
  expect(fields.some(([name]) => name.startsWith("$ACTION"))).toBe(true);
  const post = async (who: Page) => {
    const body = new FormData();
    for (const [name, value] of fields.filter(([name]) => name !== "cap")) body.append(name, value);
    body.append("cap", "1");
    expect((await who.request.post("/staff/spend", { multipart: body, headers: { origin: baseURL as string } })).status()).toBe(200);
  };

  // A Director sees the figures and the cap, the menu item, and no form.
  await page.setViewportSize({ width: 390, height: 844 });
  const director = await signInToTheHub(page, "director");
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "Spend" }).click();
  await expect(page).toHaveURL(/\/staff\/spend$/);
  await expect(page.getByTestId("budget-line")).toContainText("Budget: CAD 1,000.00.");
  await expect(page.getByTestId("cap-state")).toContainText("The monthly cap is CAD 250.00.");
  await expect(page.getByTestId("cap-read-only")).toHaveText("Only an Admin can change the cap.");
  await expect(page.getByRole("button", { name: "Save cap" })).toHaveCount(0);
  await expect(page.getByLabel("Monthly cap (CAD)")).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await post(page);
  expect((await cap()).monthly_cents).toBe(25_000);

  // A Coordinator is told only an Admin or a Director can see spend, has no menu item, and is refused too.
  const coordinatorContext = await browser.newContext();
  const coordinatorPage = await coordinatorContext.newPage();
  await coordinatorPage.setViewportSize({ width: 390, height: 844 });
  const coordinator = await signInToTheHub(coordinatorPage, "coordinator");
  await coordinatorPage.getByRole("button", { name: "Menu" }).click();
  await expect(coordinatorPage.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "Spend" })).toHaveCount(0);
  await coordinatorPage.keyboard.press("Escape");
  await coordinatorPage.goto("/staff/spend");
  await expect(coordinatorPage.getByText("Only an Admin or a Director can see spend.")).toBeVisible();
  await expect(coordinatorPage.getByRole("button", { name: "Save cap" })).toHaveCount(0);
  await post(coordinatorPage);
  expect((await cap()).monthly_cents).toBe(25_000);
  await adminContext.close();
  await coordinatorContext.close();

  for (const who of [director, coordinator]) {
    expect((await denials(who.id)).map((denied) => denied.meta)).toEqual([{ status: 403, route: "/staff/spend", permission: "spend.cap", reason: "forbidden" }]);
  }
  expect((await audits()).filter((a) => a.outcome === "ok")).toHaveLength(1);
});
