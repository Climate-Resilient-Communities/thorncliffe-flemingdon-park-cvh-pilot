// "Log a disruption", the acknowledgement composer and Submit in a browser (S04.05), against the production build with the identity fake
// and the translation fake (`CVH_FAKE_TRANSLATOR=sample`, playwright.staff.config.ts: no model is called, nothing leaves this machine):
// a Coordinator logs a disruption for a building, gets the acknowledgement composer with a suggested text, submits it for approval and
// finds fifteen frozen translations, pulls it back and changes it; and the lost outcome: the browser's connection drops after the server
// has the request, the screen says it is checking, fetches the entry's state and shows the pending entry, with exactly one version and
// one attempt for the key, and a second press of Submit is not available (the entry is no longer a draft); a request that never arrives is
// waited for an attempt's whole life and the next press sends the same key; a submit that fails with its response lost shows the draft and
// the reason, and the next press makes a new key.
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
/** This run's building: a number of 9 digits no register uses. */
const RSN = String(600_000_000 + Math.floor(Math.random() * 99_999_999));
const ADDRESS = "77 Alert Test Dr";
const LABELS = ["G", "1", "2", "3", "4"];

test.beforeAll(async () => {
  if (!ownerUrl || !fakeFile || !pepper) {
    throw new Error("STAFF_TEST_DATABASE_URL, CVH_FAKE_IDENTITY_FILE and STAFF_PASSWORD_PEPPER are required (playwright.staff.config.ts)");
  }
  sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  await sql`delete from sign_in_failure`;
  await sql`delete from sign_in_lock`;
  await sql`insert into neighbourhood (id, name, fsa) values ('TP', 'Thorncliffe Park', 'M4H'), ('FP', 'Flemingdon Park', 'M3C') on conflict do nothing`;
  await sql`insert into building (rsn, neighbourhood_id, address, latitude, longitude, storeys, facts_updated_at)
            values (${RSN}, 'TP', ${ADDRESS}, 43.7, -79.34, 4, '2026-10-01T12:00:00Z')`;
  for (const [index, label] of LABELS.entries()) {
    await sql`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${randomUUID()}, ${RSN}, ${label}, ${index}, true)`;
  }
});

test.afterAll(async () => {
  await sql?.end({ timeout: 5 });
});

type Role = "ambassador" | "coordinator" | "director" | "admin";
const NEEDS_CODE: readonly Role[] = ["admin", "coordinator"];

async function newAccount(role: Role) {
  const username = `${role.slice(0, 3)}${randomBytes(3).toString("hex")}`;
  const password = `${username} own password`;
  const fake = memoryIdentityProvider({ file: fakeFile });
  const authUserId = fake.plant(`${username}@staff.cvh.invalid`, { password: pepperPassword(pepper as string, password), createdAt: new Date() });
  if (NEEDS_CODE.includes(role)) fake.enrol(authUserId);
  const id = randomUUID();
  await sql`
    insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password, factor_enrolled_at)
    values (${id}, ${authUserId}, ${username}, 'Dana', 'Okafor', 'someone@example.org', ${role}, false, ${NEEDS_CODE.includes(role) ? new Date() : null})`;
  return { id, username, password, authUserId };
}

async function signIn(page: Page, role: Role) {
  const person = await newAccount(role);
  await page.goto("/staff/sign-in");
  await page.getByLabel("Username").fill(person.username);
  await page.getByLabel("Password", { exact: true }).fill(person.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  if (NEEDS_CODE.includes(role)) {
    await expect(page).toHaveURL(/\/staff\/sign-in\/code$/);
    await page.getByLabel("6-digit code").fill(totpCode(memoryTotpSecret(person.authUserId)));
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await expect(page).toHaveURL(/\/staff$/);
  return person;
}

/** Logs a disruption for the test building (a whole building) and lands on the acknowledgement composer. */
async function logTheDisruption(page: Page) {
  await page.goto("/staff/alerts/log");
  await expect(page.getByRole("heading", { level: 1, name: "Log a disruption" })).toBeVisible();
  await page.getByLabel("Elevator", { exact: true }).check();
  await page.getByRole("radio", { name: /^Buildings/ }).check();
  await page.getByTestId(`building-${RSN}`).getByRole("checkbox").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/staff\/alerts\/ack\?alert=[0-9a-f-]+&entry=[0-9a-f-]+$/);
  const url = new URL(page.url());
  return { alertId: url.searchParams.get("alert") as string, entryId: url.searchParams.get("entry") as string };
}

const entryRow = async (entryId: string) => (await sql`select status, version, content_hash, possible_duplicate_of from alert_entry where id = ${entryId}`)[0];
const attemptRows = async (entryId: string) => await sql`select key, kind, state, outcome, result_version from alert_submit_attempt where entry_id = ${entryId} order by started_at`;
const translationCount = async (entryId: string) => (await sql`select count(*)::int as n from alert_entry_translation where entry_id = ${entryId}`)[0].n as number;

test("an Ambassador and a Director are refused the pages, with the reason", async ({ page }) => {
  for (const role of ["ambassador", "director"] as const) {
    await signIn(page, role);
    for (const path of ["/staff/alerts/log", "/staff/alerts/compose", "/staff/alerts/ack"]) {
      await page.goto(path);
      await expect(page.locator('p[role="alert"]')).toContainText("Only a Coordinator or an Admin can");
      await expect(page.locator("main form")).toHaveCount(0);
    }
    const response = await page.request.post("/api/staff/alerts/entries/submit", { data: { v: 1, alert_id: randomUUID(), entry_id: randomUUID(), key: randomUUID() } });
    expect(response.status()).toBe(403);
    await page.context().clearCookies();
  }
});

test("a Coordinator finds the two items in the menu, logs a disruption, submits the acknowledgement and pulls it back", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, "coordinator");
  const side = page.getByTestId("hub-side");
  await expect(side.getByRole("link", { name: "Log a disruption" })).toHaveAttribute("href", "/staff/alerts/log");
  await expect(side.getByRole("link", { name: "Compose an alert" })).toHaveAttribute("href", "/staff/alerts/compose");

  await side.getByRole("link", { name: "Log a disruption" }).click();
  await expect(page).toHaveURL(/\/staff\/alerts\/log$/);
  await expect(side.getByRole("link", { name: "Log a disruption" })).toHaveAttribute("aria-current", "page");

  // Nothing chosen: refused with the reason, nothing made.
  const before = (await sql`select count(*)::int as n from alert`)[0].n as number;
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("#log-error")).toHaveText("Choose at least one type of disruption.");
  expect((await sql`select count(*)::int as n from alert`)[0].n).toBe(before);

  const { alertId, entryId } = await logTheDisruption(page);
  expect((await sql`select count(*)::int as n from alert`)[0].n).toBe(before + 1);
  expect(await entryRow(entryId)).toMatchObject({ status: "draft", version: 0 });
  const thread = (await sql`select slug, is_drill from alert where id = ${alertId}`)[0];
  expect(thread.slug).toMatch(/^[a-z2-9]{8}$/);
  expect(thread.is_drill).toBe(false);

  // The acknowledgement composer: the suggested text for the type and the place, the first report, the fifteen languages waiting.
  await expect(page.getByRole("heading", { level: 1, name: "Acknowledge the disruption" })).toBeVisible();
  await expect(page.getByTestId("composer-text")).toHaveValue(new RegExp(ADDRESS));
  await expect(page.getByTestId("first-report")).toContainText("First report:");
  await expect(page.getByTestId("audience-sentence")).toContainText(ADDRESS);
  await expect(page.locator("[data-testid^='language-']")).toHaveCount(15);
  await expect(page.getByTestId("sms-preview")).toContainText(ADDRESS);

  // Save, then edit and submit: the draft is saved first, every language is translated, the entry is pending and the page shows it.
  await page.getByTestId("composer-text").fill("The elevator at 77 Alert Test Dr is out of service. We are finding out more. More information to come.");
  await page.getByTestId("save-draft").click();
  await expect(page.getByRole("status")).toHaveText("The draft is saved.");
  await page.getByTestId("submit-button").click();
  await expect(page.getByTestId("pending-panel")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Submitted for approval" })).toBeVisible();
  await expect(page.getByTestId("composer-text")).toHaveCount(0);

  const pending = await entryRow(entryId);
  expect(pending).toMatchObject({ status: "pending_approval", version: 1 });
  expect(pending.content_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(await translationCount(entryId)).toBe(15);
  const attempts = await attemptRows(entryId);
  expect(attempts).toHaveLength(1);
  expect(attempts[0]).toMatchObject({ kind: "submit", state: "committed", result_version: 1 });
  await expect(page.locator("[data-testid^='language-']")).toHaveCount(15);

  // Pull it back to edit: a draft again, with its text, and it needs a new submit.
  await page.getByTestId("pull-back").click();
  await expect(page.getByTestId("composer-text")).toHaveValue(/is out of service/);
  expect(await entryRow(entryId)).toMatchObject({ status: "draft" });
  expect(await translationCount(entryId)).toBe(0);
});

test("when the browser loses the answer to Submit, it checks the entry's state and shows the one pending version", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await signIn(page, "coordinator");
  const { entryId } = await logTheDisruption(page);

  // The request reaches the server, which finishes the work; the response never reaches the page.
  let reached = 0;
  await page.route("**/api/staff/alerts/entries/submit", async (route) => {
    reached += 1;
    await route.fetch();
    await route.abort("connectionreset");
  });
  await page.getByTestId("submit-button").click();

  // The screen does not say it failed: it says it lost the connection and is checking, then shows what the server stored.
  await expect(page.getByTestId("pending-panel")).toBeVisible({ timeout: 60_000 });
  expect(reached).toBe(1);
  await expect(page.getByRole("heading", { name: "Submitted for approval" })).toBeVisible();

  // Exactly one pending version and one attempt for the key, whatever the browser saw.
  const rows = await sql`select version, status from alert_entry where alert_id = (select alert_id from alert_entry where id = ${entryId})`;
  expect(rows).toEqual([{ version: 1, status: "pending_approval" }]);
  const attempts = await attemptRows(entryId);
  expect(attempts).toHaveLength(1);
  expect(attempts[0]).toMatchObject({ state: "committed", result_version: 1 });
  expect(await translationCount(entryId)).toBe(15);

  // The composer for this entry has no Submit: a second press is not possible, and the state endpoint says the same.
  await expect(page.getByTestId("submit-button")).toHaveCount(0);
  const state = await page.request.get(`/api/staff/alerts/entries/state?alert=${new URL(page.url()).searchParams.get("alert")}&entry=${entryId}`);
  expect(state.status()).toBe(200);
  const body = await state.json();
  expect(body).toMatchObject({ v: 1, entry: { status: "pending_approval", version: 1 }, attempt: { state: "committed", result_version: 1 } });
  expect(body.translations).toHaveLength(15);
});

test("when the request never reaches the server, the screen waits out an attempt's whole life, says it could not confirm, and the next press sends the same key", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await signIn(page, "coordinator");
  const { entryId } = await logTheDisruption(page);
  // Time is the page's own from here: it is moved forward below, instead of waiting a minute and a half.
  await page.clock.install();

  const keys: string[] = [];
  await page.route("**/api/staff/alerts/entries/submit", async (route) => {
    keys.push(JSON.parse(route.request().postData() ?? "{}").key as string);
    if (keys.length === 1) await route.abort("connectionrefused");
    else await route.continue();
  });
  await page.getByTestId("submit-button").click();

  // The answer was not seen, so the screen does not say it knows: it says it is checking, and goes by the entry's state.
  await expect(page.getByTestId("lost-note")).toBeVisible({ timeout: 30_000 });
  expect(await attemptRows(entryId)).toHaveLength(0);
  // Only after the whole life an attempt can have (90 s) without a sign of the key does it say it could not confirm the request.
  await page.clock.fastForward(95_000);
  await expect(page.locator("#composer-error")).toContainText("could not confirm that the request reached the server", { timeout: 30_000 });
  expect(await attemptRows(entryId)).toHaveLength(0);
  expect(await entryRow(entryId)).toMatchObject({ status: "draft", version: 0 });

  // The next press sends the SAME key (the outcome of the first was never confirmed) and goes through, once.
  await page.getByTestId("submit-button").click();
  await expect(page.getByTestId("pending-panel")).toBeVisible({ timeout: 60_000 });
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  const attempts = await attemptRows(entryId);
  expect(attempts).toHaveLength(1);
  expect(attempts[0]).toMatchObject({ key: keys[0], state: "committed", result_version: 1 });
});

test("when a submit fails and the browser loses the answer, it shows the draft with the reason, nothing pending, and the next press makes a new key", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await signIn(page, "coordinator");
  const { entryId } = await logTheDisruption(page);

  // The routes the translation reads are made invalid for this one press: its rows of French disagree about the check they hold.
  await sql`alter table translation_route disable trigger translation_route_shape`;
  await sql`update translation_route set script = 'greek' where lang = 'fr' and position = 1`;
  await sql`alter table translation_route enable trigger translation_route_shape`;
  const keys: string[] = [];
  try {
    await page.route("**/api/staff/alerts/entries/submit", async (route) => {
      keys.push(JSON.parse(route.request().postData() ?? "{}").key as string);
      // The server has the request and ends the attempt as failed; the response never reaches the page.
      await route.fetch();
      await route.abort("connectionreset");
    });
    await page.getByTestId("submit-button").click();

    // The screen checks the state, finds the attempt failed, loads the draft again and says why.
    await expect(page.locator("#composer-failure")).toContainText("translation settings are not valid", { timeout: 60_000 });
    expect(keys).toHaveLength(1);
    expect(await entryRow(entryId)).toMatchObject({ status: "draft", version: 0, content_hash: null });
    expect(await translationCount(entryId)).toBe(0);
    expect(await attemptRows(entryId)).toMatchObject([{ key: keys[0], state: "failed", outcome: "ROUTES_INVALID" }]);
  } finally {
    await sql`update translation_route set script = 'latin' where lang = 'fr' and position = 1`;
  }

  // The failure was confirmed (the state said so), so the next press makes a new key, and with the routes fixed it goes through, once.
  await page.unroute("**/api/staff/alerts/entries/submit");
  await page.route("**/api/staff/alerts/entries/submit", async (route) => {
    keys.push(JSON.parse(route.request().postData() ?? "{}").key as string);
    await route.continue();
  });
  await page.getByTestId("submit-button").click();
  await expect(page.getByTestId("pending-panel")).toBeVisible({ timeout: 60_000 });
  expect(keys).toHaveLength(2);
  expect(keys[1]).not.toBe(keys[0]);
  const rows = await sql`select version, status from alert_entry where alert_id = (select alert_id from alert_entry where id = ${entryId})`;
  expect(rows).toEqual([{ version: 1, status: "pending_approval" }]);
  expect((await attemptRows(entryId)).map((attempt) => [attempt.state, attempt.outcome])).toEqual([["failed", "ROUTES_INVALID"], ["committed", null]]);
});

test("an Admin writes an alert from the alert composer's first step, and the audience pages lead back to it", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, "admin");
  await page.getByTestId("hub-side").getByRole("link", { name: "Compose an alert" }).click();
  await expect(page).toHaveURL(/\/staff\/alerts\/compose$/);
  await expect(page.getByRole("heading", { level: 1, name: "Compose an alert" })).toBeVisible();

  await page.getByLabel("Elevator", { exact: true }).check();
  await page.getByRole("radio", { name: /^Buildings/ }).check();
  await page.getByTestId(`building-${RSN}`).getByRole("checkbox").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/staff\/alerts\/compose\?alert=[0-9a-f-]+&entry=[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { level: 1, name: "Write an alert" })).toBeVisible();
  // The full composer has the types and where things stand as choices.
  await expect(page.getByLabel("Elevator", { exact: true })).toBeChecked();
  await expect(page.getByRole("group", { name: /where things stand/i })).toBeVisible();

  // Change the place: the audience page has the way back to this composer, and saving keeps it.
  await page.getByRole("link", { name: "Change the groups" }).click();
  await expect(page).toHaveURL(/\/staff\/alerts\/audience\/groups\?.*from=compose/);
  await page.getByTestId("audience-back").click();
  await expect(page).toHaveURL(/\/staff\/alerts\/compose\?alert=[0-9a-f-]+&entry=[0-9a-f-]+$/);
});
