// Pausing and resuming texts in a browser (S06.06), against the production build with the identity fake (playwright.staff.config.ts): an
// Admin at aal2 pauses all texts with a reason, every Hub screen then says "Texts are paused" with who paused, when and why (to every role),
// and the Admin resumes; the roles that cannot pause are told so, have no menu item, and a direct post of either action is refused and
// audited. Nothing here sends a text: the test database holds no deliveries and the server runs with SMS_MODE=log.
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

async function clearPause() {
  await sql`update messaging_control set paused = false, paused_by = null, paused_at = null, reason = null, handed_off_at_pause = null where id = 1`;
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
  await clearPause();
  await sql?.end({ timeout: 5 });
});

let auditMark = 0;

test.beforeEach(async () => {
  await clearPause();
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

const control = async () => (await sql`select paused, paused_by, paused_at, reason, handed_off_at_pause from messaging_control where id = 1`)[0];
const audits = () => sql`select action, actor_staff_id, subject_type, subject_id, outcome, meta from audit_event where id > ${auditMark} and action like 'sending.%' order by id`;
const denials = (actor: string) => sql`select meta from audit_event where id > ${auditMark} and action = 'permission.denied' and actor_staff_id = ${actor} order by id`;
const banner = (page: Page) => page.getByTestId("texts-paused-banner");
const pauseButton = (page: Page) => page.getByRole("button", { name: "Pause all texts" });
const resumeButton = (page: Page) => page.getByRole("button", { name: "Resume texts" });

test("an Admin pauses all texts with a reason, every Hub screen says so with who, when and why, and the Admin resumes", async ({ page, browser }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const admin = await signInToTheHub(page, "admin");
  // Nothing is paused yet: no banner on the Hub's home.
  await expect(banner(page)).toHaveCount(0);

  const side = page.getByTestId("hub-side");
  await side.getByRole("link", { name: "Pause texts" }).click();
  await expect(page).toHaveURL(/\/staff\/texts$/);
  await expect(page.getByRole("heading", { level: 1, name: "Pause or resume texts" })).toBeVisible();
  await expect(page.locator("main")).toHaveCount(1);
  await expect(side.getByRole("link", { name: "Pause texts" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("texts-status")).toContainText("Texts are going out as normal.");
  await expect(resumeButton(page)).toHaveCount(0);

  // A reason is required: nothing is sent to the server without one.
  await expect(page.getByLabel("Why are you pausing texts?")).toHaveAttribute("required", "");
  await expect(page.getByLabel("Why are you pausing texts?")).toHaveAttribute("maxlength", "500");
  await page.getByLabel("Why are you pausing texts?").fill("Wrong alert sent to building 12");
  await pauseButton(page).click();

  // The page read the switch again: it says who, when and why, that on-call texts continue, and offers to resume.
  const status = page.getByTestId("texts-status");
  await expect(status).toContainText("Texts are paused");
  await expect(status).toContainText(/Paused by Ann Okafor on [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} [ap]\.m\./);
  await expect(status).toContainText("Why: Wrong alert sent to building 12");
  await expect(page.getByTestId("texts-oncall")).toHaveText("Texts to on-call Admins still go out during a pause, so a problem with sending is still reported.");
  await expect(page.getByTestId("texts-answer")).toContainText("Texts are paused.");
  await expect(page.getByTestId("texts-handed-off")).toHaveCount(0);
  await expect(resumeButton(page)).toBeVisible();
  await expect(pauseButton(page)).toHaveCount(0);
  // And the banner on this very screen, above the content.
  await expect(banner(page)).toBeVisible();
  await expect(banner(page)).toContainText("Texts are paused");
  await expect(banner(page)).toContainText("Why: Wrong alert sent to building 12");

  const row = await control();
  expect(row).toMatchObject({ paused: true, paused_by: admin.id, reason: "Wrong alert sent to building 12", handed_off_at_pause: 0 });
  expect(row.paused_at).toBeInstanceOf(Date);
  expect((await audits()).map((a) => [a.action, a.actor_staff_id, a.subject_type, a.subject_id, a.outcome, a.meta])).toEqual([
    ["sending.paused", admin.id, "messaging_control", "1", "ok", { waiting: 0, handed_off: 0 }],
  ]);

  // Every other Hub screen says it too, to every role: the Admin's own, and an Ambassador's in another browser.
  for (const path of ["/staff", "/staff/buildings", "/staff/coverage"]) {
    await page.goto(path);
    await expect(banner(page), path).toBeVisible();
    await expect(banner(page), path).toContainText("Paused by Ann Okafor");
    await expect(banner(page).getByRole("link", { name: "Resume texts" }), path).toHaveAttribute("href", "/staff/texts");
  }
  const other = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ambassadorPage = await other.newPage();
  await signInToTheHub(ambassadorPage, "ambassador");
  await expect(banner(ambassadorPage)).toBeVisible();
  await expect(banner(ambassadorPage)).toContainText("Texts are paused");
  await expect(banner(ambassadorPage)).toContainText("Paused by Ann Okafor");
  await expect(banner(ambassadorPage)).toContainText("Why: Wrong alert sent to building 12");
  // An Ambassador cannot resume, so the banner offers no link.
  await expect(banner(ambassadorPage).getByRole("link")).toHaveCount(0);
  await expectNoHorizontalScroll(ambassadorPage);

  // The Admin resumes: the banner is gone everywhere, and the switch is clear.
  await page.goto("/staff/texts");
  await resumeButton(page).click();
  await expect(page.getByTestId("texts-answer")).toContainText("Texts resumed. No texts were waiting.");
  await expect(page.getByTestId("texts-status")).toContainText("Texts are going out as normal.");
  await expect(banner(page)).toHaveCount(0);
  await expect(pauseButton(page)).toBeVisible();
  await ambassadorPage.goto("/staff");
  await expect(banner(ambassadorPage)).toHaveCount(0);
  await other.close();
  expect(await control()).toMatchObject({ paused: false, paused_by: null, paused_at: null, reason: null, handed_off_at_pause: null });
  expect((await audits()).map((a) => [a.action, a.actor_staff_id, a.outcome, a.meta])).toEqual([
    ["sending.paused", admin.id, "ok", { waiting: 0, handed_off: 0 }],
    ["sending.resumed", admin.id, "ok", { waiting: 0 }],
  ]);
});

test("a pause says how many texts were already handed to the provider and cannot be recalled, on the page and not as a count of what is gone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const admin = await signInToTheHub(page, "admin");
  // A pause as the use case would have set it, when 3 texts of the alert it was holding had already gone to the provider.
  await sql`update messaging_control set paused = true, paused_by = ${admin.id}, paused_at = now(), reason = 'Provider problem', handed_off_at_pause = 3 where id = 1`;

  await page.goto("/staff/texts");

  await expect(page.getByTestId("texts-handed-off")).toHaveText("3 texts were already handed to the provider and cannot be recalled");
  await expect(page.getByTestId("texts-oncall")).toBeVisible();
  await expect(banner(page)).toContainText("Why: Provider problem");
  await expectNoHorizontalScroll(page);

  await sql`update messaging_control set handed_off_at_pause = 1 where id = 1`;
  await page.reload();
  await expect(page.getByTestId("texts-handed-off")).toHaveText("1 text was already handed to the provider and cannot be recalled");
  await sql`update messaging_control set handed_off_at_pause = 0 where id = 1`;
  await page.reload();
  await expect(page.getByTestId("texts-handed-off")).toHaveCount(0);
});

test("a pause without a reason is refused by the server and nothing changes", async ({ page }) => {
  await signInToTheHub(page, "admin");
  await page.goto("/staff/texts");
  // The browser would stop an empty field; a reason of only spaces gets past it and is refused by the server.
  await page.getByLabel("Why are you pausing texts?").fill("   ");
  await pauseButton(page).click();

  await expect(page.getByTestId("texts-error")).toHaveText("Say why you are pausing texts.");
  await expect(page.getByTestId("texts-error")).toHaveAttribute("role", "alert");
  await expect(banner(page)).toHaveCount(0);
  expect(await control()).toMatchObject({ paused: false });
  expect((await audits()).map((a) => [a.action, a.outcome, a.meta])).toEqual([["sending.paused", "refused", { reason: "validation" }]]);
});

test("the roles that cannot pause are told so, have no menu item, and a direct post of either action is refused and audited", async ({ page, browser, baseURL }) => {
  // The Admin's pages carry both actions' ids in their forms: the pause form while texts run, the resume form while paused.
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const admin = await signInToTheHub(adminPage, "admin");
  const unescape = (text: string) => text.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const fieldsOf = async (marker: string) => {
    const html = await (await adminPage.request.get("/staff/texts")).text();
    const form = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(([text]) => text).find((text) => text.includes(marker));
    if (!form) throw new Error(`no form with ${marker}`);
    return [...form.matchAll(/<input\b[^>]*>/g)].flatMap(([tag]) => {
      const name = /\bname="([^"]*)"/.exec(tag)?.[1];
      return name === undefined ? [] : [[unescape(name), unescape(/\bvalue="([^"]*)"/.exec(tag)?.[1] ?? "")] as [string, string]];
    });
  };
  const pauseFields = await fieldsOf('name="reason"');
  expect(pauseFields.some(([name]) => name.startsWith("$ACTION"))).toBe(true);
  await adminPage.goto("/staff/texts");
  await adminPage.getByLabel("Why are you pausing texts?").fill("Provider problem");
  await pauseButton(adminPage).click();
  await expect(resumeButton(adminPage)).toBeVisible();
  const resumeFields = await fieldsOf("Resume texts");
  expect(resumeFields.some(([name]) => name.startsWith("$ACTION"))).toBe(true);
  const paused = await control();
  expect(paused).toMatchObject({ paused: true, paused_by: admin.id });

  // A Coordinator, who signs in at aal2 as well, is a role the policy refuses: no menu item, the refusal on the page, the banner without a link.
  await page.setViewportSize({ width: 390, height: 844 });
  const coordinator = await signInToTheHub(page, "coordinator");
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "Pause texts" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(banner(page)).toBeVisible();
  await expect(banner(page).getByRole("link")).toHaveCount(0);
  await page.goto("/staff/texts");
  await expect(page.getByText("Only an Admin can pause or resume texts.")).toBeVisible();
  await expect(pauseButton(page)).toHaveCount(0);
  await expect(resumeButton(page)).toHaveCount(0);

  // Direct posts, as the Coordinator: resume the Admin's pause, and (after the Admin resumes) pause texts again.
  const post = async (fields: [string, string][], extra: Record<string, string> = {}) => {
    const body = new FormData();
    for (const [name, value] of fields) body.append(name, value);
    for (const [name, value] of Object.entries(extra)) body.append(name, value);
    const response = await page.request.post("/staff/texts", { multipart: body, headers: { origin: baseURL as string } });
    expect(response.status()).toBe(200);
  };
  await post(resumeFields);
  expect(await control()).toMatchObject({ paused: true, paused_by: admin.id, reason: "Provider problem" });

  await adminPage.goto("/staff/texts");
  await resumeButton(adminPage).click();
  await expect(pauseButton(adminPage)).toBeVisible();
  await post(pauseFields, { reason: "I should not be able to do this" });
  expect(await control()).toMatchObject({ paused: false, reason: null });
  await adminContext.close();

  expect((await denials(coordinator.id)).map((denied) => denied.meta)).toEqual([
    { status: 403, route: "/staff/texts", permission: "sending.pause", reason: "forbidden" },
    { status: 403, route: "/staff/texts", permission: "sending.pause", reason: "forbidden" },
  ]);
  expect((await audits()).map((a) => [a.action, a.actor_staff_id, a.outcome])).toEqual([
    ["sending.paused", admin.id, "ok"],
    ["sending.resumed", admin.id, "ok"],
  ]);
});

test("an Ambassador and a Director see the refusal and no menu item either", async ({ browser }) => {
  for (const role of ["ambassador", "director"] as const) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await signInToTheHub(page, role);
    await expect(page.getByTestId("hub-side").getByRole("link", { name: "Pause texts" })).toHaveCount(0);
    await page.goto("/staff/texts");
    await expect(page.getByText("Only an Admin can pause or resume texts.")).toBeVisible();
    await expect(pauseButton(page)).toHaveCount(0);
    await context.close();
  }
});
