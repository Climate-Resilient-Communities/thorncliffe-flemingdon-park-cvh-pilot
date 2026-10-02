// The providers screen in a browser (S02.04), against the production build with the identity fake
// (playwright.staff.config.ts): an Admin at aal2 confirms, publishes and unpublishes providers, the
// refusal "Confirm this provider first", a provider that left the catalogue, and the roles that
// cannot use the screen, including a direct post of its actions. Nothing real is contacted.
// With S0204_SHOTS set to a folder, the tests also save labelled screenshots of the screen there.
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { memoryIdentityProvider } from "../../src/modules/identity/adapters/memoryIdentityProvider";
import { memoryTotpSecret, totpCode } from "../../src/modules/identity/adapters/memoryTotp";
import { pepperPassword } from "../../src/modules/identity/application/passwordPepper";

const ownerUrl = process.env.STAFF_TEST_DATABASE_URL;
const fakeFile = process.env.CVH_FAKE_IDENTITY_FILE;
const pepper = process.env.STAFF_PASSWORD_PEPPER;
const shots = process.env.S0204_SHOTS;

/** A date in Toronto, `daysAgo` days back, as the screen counts days (the app asks for Toronto's today). */
function torontoDay(daysAgo: number): string {
  const day = new Date(Date.now() - daysAgo * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(day);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
const YESTERDAY = torontoDay(1);

let sql: postgres.Sql;

// The e2e database is disposable: the catalogue starts empty so the counts on the screen are the test's own.
async function clearCatalogue() {
  await sql`delete from provider_category`;
  await sql`delete from provider_location`;
  await sql`delete from provider`;
  await sql`delete from category`;
}

async function loadProviders() {
  await clearCatalogue();
  await sql`insert into category (id, name, sort_order, labels) values ('e2e-category', 'Community Resilience', 90, ${sql.json({ en: "Community Resilience" })})`;
  const rows: [string, string, boolean, string | null][] = [
    ["M901", "Thorncliffe Neighbourhood Office", true, null],
    ["M902", "Flemingdon Health Centre", true, "2026-09-20"],
    ["M903", "East York Food Bank", true, null],
    ["M904", "Closed Community Kitchen", false, "2026-08-15"],
  ];
  for (const [id, name, inCatalogue, lastConfirmed] of rows) {
    await sql`
      insert into provider (id, name, texts, in_catalogue, last_confirmed)
      values (${id}, ${name}, ${sql.json({ services: { en: `Services of ${name}` } })}, ${inCatalogue}, ${lastConfirmed})`;
    await sql`insert into provider_location (provider_id, street, city, postal, lat, lng) values (${id}, ${`${id.slice(1)} Overlea Blvd`}, 'East York', 'M4H 1C6', 43.7, -79.34)`;
    await sql`insert into provider_category (provider_id, category_id) values (${id}, 'e2e-category')`;
  }
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
  await clearCatalogue();
  await sql?.end({ timeout: 5 });
});

// The audit trail is append-only: each test reads only what was written since it began.
let auditMark = 0;

test.beforeEach(async () => {
  await loadProviders();
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

const row = (page: Page, id: string) => page.getByTestId(`provider-${id}`);
/** The row's status region: always in the page, with text only after a change was made. */
const message = (page: Page, id: string) => page.getByTestId(`provider-${id}-message`);
/** The row's refusal: in the page only while the last change was refused. */
const refusal = (page: Page, id: string) => page.getByTestId(`provider-${id}-error`);

async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
}

async function expectNoHorizontalScroll(page: Page) {
  const root = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(root.scrollWidth, "document scrollWidth <= clientWidth").toBeLessThanOrEqual(root.clientWidth);
}

const providerRow = async (id: string) => (await sql`select published, in_catalogue, last_confirmed::text as last_confirmed, name from provider where id = ${id}`)[0];
const audits = (id: string, action: string) =>
  sql`select outcome, meta from audit_event where id > ${auditMark} and subject_type = 'provider' and subject_id = ${id} and action = ${action} order by id`;

test("an Admin sees Providers under Administration and the loaded catalogue with each provider's state", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInToTheHub(page, "admin");

  const side = page.getByTestId("hub-side");
  await expect(side.getByText("Administration")).toBeVisible();
  await side.getByRole("link", { name: "Providers" }).click();
  await expect(page).toHaveURL(/\/staff\/providers$/);
  await expect(page.getByRole("heading", { level: 1, name: "Providers" })).toBeVisible();
  await expect(page.locator("main")).toHaveCount(1);
  await expect(side.getByRole("link", { name: "Providers" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("provider-summary")).toHaveText("0 of 3 providers published. 2 not confirmed yet.");

  await expect(page.getByTestId("provider-M901-status")).toHaveText("Not published");
  // The date is shown once, in its field: no "Last confirmed" line for a provider in the catalogue.
  await expect(page.getByTestId("provider-M901-confirmed")).toHaveCount(0);
  await expect(page.getByTestId("provider-M902-confirmed")).toHaveCount(0);
  await expect(row(page, "M901").getByLabel("Date last confirmed")).toHaveValue("");
  await expect(page.getByTestId("provider-M901-date-hint")).toHaveText("Not confirmed yet");
  await expect(row(page, "M902").getByLabel("Date last confirmed")).toHaveValue("2026-09-20");
  await expect(page.getByTestId("provider-M902-date-hint")).toHaveText("Today or earlier.");
  // Publish waits for a saved date, and says why.
  await expect(row(page, "M901").getByRole("button", { name: "Publish" })).toBeDisabled();
  await expect(page.getByTestId("provider-M901-publish-hint")).toHaveText("Confirm this provider first");
  await expect(row(page, "M902").getByRole("button", { name: "Publish" })).toBeEnabled();
  await expect(page.getByTestId("provider-M902-publish-hint")).toHaveCount(0);
  // Every row keeps an empty status region for its done messages.
  await expect(message(page, "M901")).toHaveAttribute("role", "status");
  await expect(message(page, "M901")).toHaveText("");
  // A provider that left the catalogue: flagged, its date kept, and nothing to press.
  await expect(page.getByTestId("provider-M904-status")).toHaveText("Not in catalogue");
  await expect(page.getByTestId("provider-M904-confirmed")).toHaveText("Last confirmed 2026-08-15");
  await expect(row(page, "M904").getByRole("button")).toHaveCount(0);

  // No way to edit listing text: the only fields on the page are the provider id and the date.
  expect(await page.locator("textarea").count()).toBe(0);
  expect(await page.locator("input:not([type=hidden]):not([type=date])").count()).toBe(0);
  const names = await page.locator("main input[name]").evaluateAll((inputs) => [...new Set(inputs.map((input) => (input as HTMLInputElement).name))]);
  expect(names.filter((name) => !name.startsWith("$ACTION")).sort()).toEqual(["date", "providerId"]);
  await shot(page, "providers-1280-list");
});

test("publishing a provider with no last-confirmed date is disabled, and refused by the server with 'Confirm this provider first'; after the date it publishes and unpublishes, all audited", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const admin = await signInToTheHub(page, "admin");
  await page.goto("/staff/providers");
  await expectNoHorizontalScroll(page);
  await shot(page, "providers-390-list");

  const m901 = row(page, "M901");
  await expect(m901.getByRole("button", { name: "Publish" })).toBeDisabled();
  // The button is disabled in the browser, so the server's refusal is reached by enabling it.
  await m901.getByRole("button", { name: "Publish" }).evaluate((button) => ((button as HTMLButtonElement).disabled = false));
  await m901.getByRole("button", { name: "Publish" }).click();
  await expect(refusal(page, "M901")).toHaveText("Confirm this provider first");
  await expect(refusal(page, "M901")).toHaveAttribute("role", "alert");
  await expect(refusal(page, "M901")).toHaveClass(/hub-error/);
  await expect(message(page, "M901")).toHaveAttribute("role", "status");
  await expect(message(page, "M901")).toHaveText("");
  expect(await providerRow("M901")).toMatchObject({ published: false, last_confirmed: null });
  expect((await audits("M901", "provider.published")).map((a) => [a.outcome, a.meta])).toEqual([["refused", { reason: "validation" }]]);
  await shot(page, "providers-390-confirm-first-refusal");

  // A date after today cannot be picked (max) and, sent anyway, is refused by the server.
  await m901.getByLabel("Date last confirmed").fill(YESTERDAY);
  await m901.getByRole("button", { name: "Save date" }).click();
  await expect(message(page, "M901")).toHaveText(`Thorncliffe Neighbourhood Office was confirmed on ${YESTERDAY}.`);
  await expect(refusal(page, "M901")).toHaveCount(0);
  await expect(m901.getByLabel("Date last confirmed")).toHaveValue(YESTERDAY);
  await expect(page.getByTestId("provider-M901-date-hint")).toHaveText("Today or earlier.");
  await expect(m901.getByRole("button", { name: "Publish" })).toBeEnabled();
  expect(await providerRow("M901")).toMatchObject({ last_confirmed: YESTERDAY, published: false });
  expect((await audits("M901", "provider.confirmed")).map((a) => a.meta)).toEqual([{ confirmed_on: YESTERDAY, previous: null }]);

  await m901.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByTestId("provider-M901-status")).toHaveText("Published");
  await expect(message(page, "M901")).toHaveText("Thorncliffe Neighbourhood Office is published.");
  await expect(m901.getByRole("button", { name: "Unpublish" })).toBeVisible();
  expect(await providerRow("M901")).toMatchObject({ published: true, last_confirmed: YESTERDAY });
  expect((await audits("M901", "provider.published")).map((a) => [a.outcome, a.meta])).toEqual([
    ["refused", { reason: "validation" }],
    ["ok", { last_confirmed: YESTERDAY }],
  ]);
  await shot(page, "providers-390-published");

  await m901.getByRole("button", { name: "Unpublish" }).click();
  await expect(page.getByTestId("provider-M901-status")).toHaveText("Not published");
  await expect(m901.getByLabel("Date last confirmed")).toHaveValue(YESTERDAY);
  expect(await providerRow("M901")).toMatchObject({ published: false, last_confirmed: YESTERDAY });
  expect((await audits("M901", "provider.unpublished")).map((a) => a.outcome)).toEqual(["ok"]);

  const actor = await sql`select actor_staff_id from audit_event where id > ${auditMark} and subject_id = 'M901' and action = 'provider.confirmed'`;
  expect(actor[0].actor_staff_id).toBe(admin.id);
});

test("the date field stops at today, and a later date sent to the server anyway is refused and changes nothing", async ({ page }) => {
  await signInToTheHub(page, "admin");
  await page.goto("/staff/providers");

  const input = row(page, "M902").getByLabel("Date last confirmed");
  const max = await input.getAttribute("max");
  expect(max).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const later = new Date(`${max}T00:00:00Z`);
  later.setUTCDate(later.getUTCDate() + 1);

  // The browser's own constraint is removed to reach the server's rule.
  await input.evaluate((element, value) => {
    (element as HTMLInputElement).removeAttribute("max");
    (element as HTMLInputElement).value = value;
  }, later.toISOString().slice(0, 10));
  await row(page, "M902").getByRole("button", { name: "Save date" }).click();

  await expect(refusal(page, "M902")).toHaveText("The date cannot be later than today.");
  await expect(refusal(page, "M902")).toHaveAttribute("role", "alert");
  await expect(message(page, "M902")).toHaveText("");
  expect((await providerRow("M902")).last_confirmed).toBe("2026-09-20");
  expect((await audits("M902", "provider.confirmed")).map((a) => [a.outcome, a.meta])).toEqual([["refused", { reason: "validation" }]]);
});

test("a confirmed provider publishes straight away, and the summary counts follow", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInToTheHub(page, "admin");
  await page.goto("/staff/providers");

  await row(page, "M902").getByRole("button", { name: "Publish" }).click();

  await expect(page.getByTestId("provider-M902-status")).toHaveText("Published");
  await expect(page.getByTestId("provider-summary")).toHaveText("1 of 3 providers published. 2 not confirmed yet.");
  await shot(page, "providers-1280-published");
});

test("a Coordinator at aal2 is shown that only an Admin can change providers, has no menu item, and a direct post of an action is refused", async ({ page, browser, baseURL }) => {
  // The Admin's page carries the actions' ids in its forms.
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signInToTheHub(adminPage, "admin");
  const html = await (await adminPage.request.get("/staff/providers")).text();
  const section = html.slice(html.indexOf('data-testid="provider-M902"'));
  const formStart = section.indexOf("<form", section.indexOf("<form") + 5); // the second form of the row: Publish
  const publishForm = section.slice(formStart, section.indexOf("</form>", formStart) + 7);
  const unescape = (text: string) => text.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const fields = [...publishForm.matchAll(/<input\b[^>]*>/g)].flatMap(([tag]) => {
    const name = /\bname="([^"]*)"/.exec(tag)?.[1];
    return name === undefined ? [] : [[unescape(name), unescape(/\bvalue="([^"]*)"/.exec(tag)?.[1] ?? "")] as [string, string]];
  });
  expect(fields.some(([name]) => name.startsWith("$ACTION"))).toBe(true);
  expect(fields.some(([name]) => name === "providerId")).toBe(true);
  await adminContext.close();

  await page.setViewportSize({ width: 390, height: 844 });
  const coordinator = await signInToTheHub(page, "coordinator");
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "Providers" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.goto("/staff/providers");
  await expect(page.getByRole("heading", { level: 1, name: "Providers" })).toBeVisible();
  await expect(page.getByText("Only an Admin can change providers.")).toBeVisible();
  await expect(page.getByTestId("provider-list")).toHaveCount(0);
  await shot(page, "providers-390-coordinator-refusal");

  const form = new FormData();
  for (const [name, value] of fields) form.append(name, name === "providerId" ? "M902" : value);
  const response = await page.request.post("/staff/providers", { multipart: form, headers: { origin: baseURL as string } });
  expect(response.status()).toBe(200);
  expect(await response.text()).not.toContain('data-testid="provider-list"');
  expect(await providerRow("M902")).toMatchObject({ published: false, last_confirmed: "2026-09-20" });
  const denials = await sql`select meta from audit_event where action = 'permission.denied' and actor_staff_id = ${coordinator.id}`;
  expect(denials.map((denied) => denied.meta)).toEqual([{ status: 403, route: "/staff/providers", permission: "provider.manage", reason: "forbidden" }]);
  expect(await audits("M902", "provider.published")).toHaveLength(0);
});

test("an Ambassador and a Director see the refusal and no menu item either", async ({ browser }) => {
  for (const role of ["ambassador", "director"] as const) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await signInToTheHub(page, role);
    await expect(page.getByTestId("hub-side").getByRole("link", { name: "Providers" })).toHaveCount(0);
    await page.goto("/staff/providers");
    await expect(page.getByText("Only an Admin can change providers.")).toBeVisible();
    await expect(page.getByTestId("provider-list")).toHaveCount(0);
    await context.close();
  }
});
