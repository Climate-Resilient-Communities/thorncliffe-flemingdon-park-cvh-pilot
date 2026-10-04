// The sending progress of an alert in a browser (S06.09), against the production build with the identity fake (playwright.staff.config.ts) and a disposable database:
// a Coordinator sees per language how many texts are waiting, in flight, delivered, undelivered, failed, unknown and cancelled, on the alert's staff view and on the
// published confirmation, the page reloads itself every 15 seconds while texts go out, the lists of the texts that did not arrive say what each means without a number,
// the sentence about the texts already handed to the provider is shown while texts are paused and not otherwise, and the first-text spike's page and menu item are gone.
// Nothing here sends a text: the rows are written by the test, the server runs with SMS_MODE=log, and no row holds a phone number.
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { memoryIdentityProvider } from "../../src/modules/identity/adapters/memoryIdentityProvider";
import { memoryTotpSecret, totpCode } from "../../src/modules/identity/adapters/memoryTotp";
import { pepperPassword } from "../../src/modules/identity/application/passwordPepper";
import { deliveryFixtures, type SeededEntry } from "../../test/db/deliveryFixtures";

const ownerUrl = process.env.STAFF_TEST_DATABASE_URL;
const fakeFile = process.env.CVH_FAKE_IDENTITY_FILE;
const pepper = process.env.STAFF_PASSWORD_PEPPER;

let sql: postgres.Sql;
let fx: ReturnType<typeof deliveryFixtures>;

async function clearAll() {
  await sql`update messaging_control set paused = false, paused_by = null, paused_at = null, reason = null, handed_off_at_pause = null where id = 1`;
  await fx.cleanup();
}

test.beforeAll(async () => {
  if (!ownerUrl || !fakeFile || !pepper) {
    throw new Error("STAFF_TEST_DATABASE_URL, CVH_FAKE_IDENTITY_FILE and STAFF_PASSWORD_PEPPER are required (playwright.staff.config.ts)");
  }
  sql = postgres(ownerUrl, { max: 2, onnotice: () => {} });
  fx = deliveryFixtures(sql);
  await sql`delete from sign_in_failure`;
  await sql`delete from sign_in_lock`;
});

test.afterAll(async () => {
  await clearAll();
  await sql?.end({ timeout: 5 });
});

test.beforeEach(clearAll);

type Role = "ambassador" | "coordinator" | "director" | "admin";

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

type To = "queued" | "claimed" | "claimed_handed_off" | "submitted" | "delivered" | "undelivered" | "failed" | "unknown" | "cancelled" | "skipped";
interface Spec {
  lang: "en" | "ur";
  to: To;
  code?: number;
}
const spec = (lang: Spec["lang"], to: To, count = 1, code?: number): Spec[] => Array.from({ length: count }, () => ({ lang, to, ...(code === undefined ? {} : { code }) }));
const SID = `SM${"0123456789abcdef".repeat(2)}`;

/** Moves one text to its state by legal transitions, as the sender and the callbacks do. */
async function drive(id: string, to: To, code?: number) {
  await sql.begin(async (tx) => {
    if (to === "queued") return;
    if (to === "cancelled" || to === "skipped") {
      await tx`update delivery set state = ${to} where id = ${id}`;
      return;
    }
    await tx`update delivery set state = 'claimed', claimed_by = 'worker-1', claim_token = ${randomUUID()} where id = ${id}`;
    if (to === "claimed") return;
    if (to !== "failed") await tx`update delivery set handed_off_at = now() where id = ${id}`;
    if (to === "claimed_handed_off") return;
    if (to === "submitted") await tx`update delivery set state = 'submitted', provider_message_id = ${SID} where id = ${id}`;
    else if (to === "delivered") await tx`update delivery set state = 'delivered', provider_message_id = ${SID} where id = ${id}`;
    else if (to === "undelivered") await tx`update delivery set state = 'undelivered', provider_message_id = ${SID}, provider_error_code = ${code ?? null} where id = ${id}`;
    else if (to === "failed") await tx`update delivery set state = 'failed', provider_error_code = ${code ?? null} where id = ${id}`;
    else if (to === "unknown") await tx`update delivery set state = 'unknown' where id = ${id}`;
  });
}

/** An approved entry with one text per spec, each to its own recipient, driven to its state. Rows hold no phone number. */
async function seed(specs: readonly Spec[], options: { isDrill?: boolean } = {}): Promise<{ entry: SeededEntry; ids: string[] }> {
  const entry = await fx.entry("pending_approval", { isDrill: options.isDrill });
  const recipients = specs.map(() => randomUUID());
  if (options.isDrill) for (const recipient of recipients) await fx.rosterMember({ id: recipient });
  const ids: string[] = [];
  await sql.begin(async (tx) => {
    await tx`select set_config('cvh.approval_entry_id', ${entry.entryId}, true)`;
    for (const [index, item] of specs.entries()) {
      const id = randomUUID();
      ids.push(id);
      const frozen = entry.bodies[item.lang];
      await tx`insert into delivery (id, kind, recipient_kind, recipient_id, entry_id, created_by_module, lang, body, segments, cost_estimate_cents, idempotency_key)
               values (${id}, 'alert', ${options.isDrill ? "roster" : "subscriber"}, ${recipients[index]}, ${entry.entryId}, 'alerting', ${item.lang}, ${frozen.body}, ${frozen.segments}, 4, ${`${entry.entryId}:${recipients[index]}:sms`})`;
    }
    await fx.approve(tx, entry);
  });
  for (const [index, item] of specs.entries()) await drive(ids[index], item.to, item.code);
  return { entry, ids };
}

const progressUrl = (entry: SeededEntry) => `/staff/alerts/sending?alert=${entry.alertId}&entry=${entry.entryId}`;
const listUrl = (entry: SeededEntry, state: string) => `/staff/alerts/sending/texts?alert=${entry.alertId}&entry=${entry.entryId}&state=${state}`;
const approveUrl = (entry: SeededEntry) => `/staff/alerts/approve?alert=${entry.alertId}&entry=${entry.entryId}`;
const count = (page: Page, lang: string, id: string) => page.getByTestId(`sending-${lang}`).locator(`[data-count="${id}"]`);

test("a Coordinator sees per language how many texts are waiting, in flight, delivered, undelivered, failed, unknown and cancelled, and no phone number", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { entry } = await seed([
    ...spec("en", "queued", 3),
    ...spec("en", "claimed", 1),
    ...spec("en", "claimed_handed_off", 1),
    ...spec("en", "submitted", 2),
    ...spec("en", "delivered", 5),
    ...spec("ur", "delivered", 2),
    ...spec("ur", "undelivered", 1, 30006),
    ...spec("ur", "failed", 2, 30005),
    ...spec("ur", "unknown", 1),
    ...spec("ur", "cancelled", 2),
  ]);
  await signInToTheHub(page, "coordinator");

  await page.goto(progressUrl(entry));

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Acknowledgement");
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.getByTestId("sending-summary")).toHaveText("20 texts in all");
  for (const [lang, expected] of [
    ["en", { waiting: 4, inFlight: 3, delivered: 5, undelivered: 0, failed: 0, unknown: 0, cancelled: 0 }],
    ["ur", { waiting: 0, inFlight: 0, delivered: 2, undelivered: 1, failed: 2, unknown: 1, cancelled: 2 }],
    ["all", { waiting: 4, inFlight: 3, delivered: 7, undelivered: 1, failed: 2, unknown: 1, cancelled: 2 }],
  ] as const) {
    for (const [id, n] of Object.entries(expected)) await expect(count(page, lang, id), `${lang} ${id}`).toHaveAttribute("data-n", String(n));
  }
  await expect(count(page, "ur", "failed")).toHaveText("Failed: 2");
  await expect(page.getByTestId("sending-handed-off")).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  // Nothing on the screen is a phone number.
  expect(await page.locator("main").innerText()).not.toMatch(/\+\d|\d{3}[ -]\d{3}[ -]\d{4}/);
  expect(JSON.stringify(await sql`select * from delivery where entry_id = ${entry.entryId}`)).not.toMatch(/\+\d{7,}/);
});

test("the page reloads itself every 15 seconds while texts are going out, and stops once none waits or is in flight", async ({ page }) => {
  const { entry, ids } = await seed([...spec("en", "queued", 2), ...spec("en", "submitted", 1)]);
  await signInToTheHub(page, "coordinator");
  await page.clock.install();
  await page.goto(progressUrl(entry));
  await expect(page.getByTestId("sending")).toHaveAttribute("data-live", "true");
  await expect(count(page, "en", "delivered")).toHaveAttribute("data-n", "0");
  await expect(page.getByTestId("sending-refresh")).toHaveText("This page updates every 15 seconds while texts are going out.");

  // The sender and the callbacks work: one text is delivered and one is handed over. The page asks the server again within 15 seconds (the clock is the page's own).
  await expect(page.getByTestId("sending")).toHaveAttribute("data-refresh", "15");
  await drive(ids[0], "claimed_handed_off");
  await sql`update delivery set state = 'delivered', provider_message_id = ${SID} where id = ${ids[2]}`;
  await page.clock.runFor(15_000);
  await expect(count(page, "en", "delivered")).toHaveAttribute("data-n", "1");
  await expect(count(page, "en", "inFlight")).toHaveAttribute("data-n", "1");
  await expect(count(page, "en", "waiting")).toHaveAttribute("data-n", "1");

  // Everything gets an answer: the next reload shows it, and the page then says it no longer updates by itself.
  await drive(ids[1], "delivered");
  await sql`update delivery set state = 'delivered', provider_message_id = ${SID} where id = ${ids[0]}`;
  await page.clock.runFor(15_000);
  await expect(count(page, "en", "delivered")).toHaveAttribute("data-n", "3");
  await expect(page.getByTestId("sending")).toHaveAttribute("data-live", "false");
  await expect(page.getByTestId("sending-refresh")).toContainText("no longer updates by itself");
});

test("the published confirmation shows the same progress, with the way to the alert's staff view", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { entry } = await seed([...spec("en", "queued", 2), ...spec("en", "delivered", 3), ...spec("ur", "failed", 1, 30005)]);
  await signInToTheHub(page, "admin");

  await page.goto(approveUrl(entry));

  await expect(page.getByTestId("published-title")).toBeVisible();
  await expect(page.getByTestId("sending")).toBeVisible();
  await expect(count(page, "en", "waiting")).toHaveAttribute("data-n", "2");
  await expect(count(page, "en", "delivered")).toHaveAttribute("data-n", "3");
  await expect(count(page, "ur", "failed")).toHaveAttribute("data-n", "1");
  await expect(page.getByTestId("sending")).toHaveAttribute("data-live", "true");
  await expectNoHorizontalScroll(page);
  await page.getByTestId("next-sending").click();
  await expect(page).toHaveURL(/\/staff\/alerts\/sending\?alert=/);
  await expect(page.getByTestId("sending")).toBeVisible();
});

test("the lists of the texts that did not arrive say what each means in plain words, with no phone number", async ({ page }) => {
  const { entry } = await seed([
    ...spec("ur", "failed", 1, 30005),
    ...spec("en", "failed", 1, 21610),
    ...spec("en", "failed", 1, 31999),
    ...spec("en", "failed"),
    ...spec("ur", "undelivered", 1, 30006),
    ...spec("ur", "unknown", 2),
    ...spec("en", "delivered", 4),
  ]);
  await signInToTheHub(page, "coordinator");

  await page.goto(progressUrl(entry));
  await expect(page.getByTestId("sending-list-failed")).toHaveText("See the failed texts (4)");
  await expect(page.getByTestId("sending-list-undelivered")).toHaveText("See the undelivered texts (1)");
  await expect(page.getByTestId("sending-list-unknown")).toHaveText("See the texts with an unknown outcome (2)");

  await page.getByTestId("sending-list-failed").click();
  await expect(page).toHaveURL(/state=failed$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Failed texts");
  await expect(page.getByTestId("sending-list-item")).toHaveCount(4);
  const meanings = await page.getByTestId("sending-list-item").evaluateAll((items) => items.map((item) => item.getAttribute("data-meaning")));
  expect(meanings.sort()).toEqual(["no_reason", "not_in_service", "opted_out", "other_code"]);
  await expect(page.getByTestId("sending-list-items")).toContainText("Number not in service");
  await expect(page.getByTestId("sending-list-items")).toContainText("The provider reported error 31999");
  expect(await page.locator("main").innerText()).not.toMatch(/\+\d|\d{3}[ -]\d{3}[ -]\d{4}/);

  await page.goto(listUrl(entry, "unknown"));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Texts with an unknown outcome");
  await expect(page.getByTestId("sending-list-items")).toContainText("Outcome unclear; not re-sent");
  await page.getByTestId("sending-list-back").click();
  await expect(page).toHaveURL(/\/staff\/alerts\/sending\?alert=/);

  // A state that is not one of the three, and an entry that is not there, have no list.
  await page.goto(listUrl(entry, "delivered"));
  await expect(page.locator("main p[role=alert]")).toHaveText("That alert entry was not found.");
  await page.goto(`/staff/alerts/sending/texts?alert=${randomUUID()}&entry=${randomUUID()}&state=failed`);
  await expect(page.locator("main p[role=alert]")).toHaveText("That alert entry was not found.");
});

test("while texts are paused and the entry still has texts waiting it says how many were already handed to the provider; resumed, or with nothing waiting, it does not", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const waiting = await seed([...spec("en", "queued", 3), ...spec("en", "delivered", 4), ...spec("ur", "claimed_handed_off", 1), ...spec("ur", "failed", 1)]);
  const done = await seed([...spec("en", "delivered", 2), ...spec("ur", "failed", 1)]);
  const admin = await signInToTheHub(page, "admin");

  // Not paused: no sentence.
  await page.goto(progressUrl(waiting.entry));
  await expect(page.getByTestId("sending")).toBeVisible();
  await expect(page.getByTestId("sending-handed-off")).toHaveCount(0);

  // Paused: this entry's own count, 5 (4 delivered and 1 in flight), and not the number the pause stored for all entries.
  await sql`update messaging_control set paused = true, paused_by = ${admin.id}, paused_at = now(), reason = 'Wrong alert', handed_off_at_pause = 99 where id = 1`;
  await page.goto(progressUrl(waiting.entry));
  await expect(page.getByTestId("sending-handed-off")).toHaveText("5 texts were already handed to the provider and cannot be recalled");
  await expect(page.getByTestId("texts-paused-banner")).toBeVisible();
  await page.goto(approveUrl(waiting.entry));
  await expect(page.getByTestId("sending-handed-off")).toHaveText("5 texts were already handed to the provider and cannot be recalled");

  // Nothing waiting, although paused: no sentence.
  await page.goto(progressUrl(done.entry));
  await expect(page.getByTestId("sending")).toBeVisible();
  await expect(page.getByTestId("sending-handed-off")).toHaveCount(0);

  // Resumed: no sentence.
  await sql`update messaging_control set paused = false, paused_by = null, paused_at = null, reason = null, handed_off_at_pause = null where id = 1`;
  await page.goto(progressUrl(waiting.entry));
  await expect(page.getByTestId("sending-handed-off")).toHaveCount(0);
});

test("a practice alert points to the Drills page and shows none of its counts", async ({ page }) => {
  const { entry } = await seed([...spec("en", "delivered", 2), ...spec("en", "queued", 1)], { isDrill: true });
  await signInToTheHub(page, "coordinator");

  await page.goto(progressUrl(entry));

  await expect(page.getByTestId("sending-notice")).toContainText("This is a practice alert");
  await expect(page.getByTestId("sending-notice-link")).toHaveAttribute("href", "/staff/drills");
  await expect(page.getByTestId("sending")).toHaveCount(0);
  await page.goto(listUrl(entry, "failed"));
  await expect(page.locator("main p[role=alert]")).toHaveText("That alert entry was not found.");
});

test("the roles that do not write to a running alert are told so, and read no counts", async ({ page, browser }) => {
  const { entry } = await seed(spec("en", "queued", 2));
  await signInToTheHub(page, "ambassador");
  await page.goto(progressUrl(entry));
  await expect(page.locator("main p[role=alert]")).toHaveText("Only an Admin or a Coordinator can see sending progress.");
  await expect(page.getByTestId("sending")).toHaveCount(0);
  await page.goto(listUrl(entry, "failed"));
  await expect(page.locator("main p[role=alert]")).toHaveText("Only an Admin or a Coordinator can see sending progress.");

  const other = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const directorPage = await other.newPage();
  await signInToTheHub(directorPage, "director");
  await directorPage.goto(progressUrl(entry));
  await expect(directorPage.locator("main p[role=alert]")).toHaveText("Only an Admin or a Coordinator can see sending progress.");
  await other.close();
});

test("the first-text spike is gone: no Test text page, no menu item", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInToTheHub(page, "admin");
  await expect(page.getByTestId("hub-side").getByRole("link", { name: "Test text" })).toHaveCount(0);
  const response = await page.goto("/staff/sms-test");
  expect(response?.status()).toBe(404);
});
