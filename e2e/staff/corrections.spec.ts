// Correcting and withdrawing what residents saw, in a browser (S05.02; O-15), against the production build with the identity fake and the translation fake
// (`CVH_FAKE_TRANSLATOR=sample`, playwright.staff.config.ts: no model is called, nothing leaves this machine, no text is sent). A Coordinator's acknowledgement is approved by
// a second person; the Hub home lists the running alert with "Correct an entry" and "Withdraw an entry"; the correction page lists what can be corrected, shows the chosen
// entry's own words to change and asks for the phase before it makes the draft; the correction is submitted (fifteen frozen translations), the second person is shown the entry
// it replaces and that it goes to everyone who got the original, and approves it: the acknowledgement becomes superseded, the correction is approved, `feed_version` goes up once and
// both changes are audited. A withdrawal of the only entry closes the alert withdrawn, in the same approval; the alert is then not on the Hub home and offers neither. A Director and
// an Ambassador who ask for the pages directly are refused.
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import postgres from "postgres";
import { memoryIdentityProvider } from "../../src/modules/identity/adapters/memoryIdentityProvider";
import { memoryTotpSecret, totpCode } from "../../src/modules/identity/adapters/memoryTotp";
import { pepperPassword } from "../../src/modules/identity/application/passwordPepper";
import { sharedPreview } from "./alert-flow";

const ownerUrl = process.env.STAFF_TEST_DATABASE_URL;
const fakeFile = process.env.CVH_FAKE_IDENTITY_FILE;
const pepper = process.env.STAFF_PASSWORD_PEPPER;

let sql: postgres.Sql;
/** This run's building: a number of 9 digits no register uses. */
const RSN = String(800_000_000 + Math.floor(Math.random() * 99_999_999));
const ADDRESS = "98 Correction Test Dr";
const LABELS = ["G", "1", "2", "3", "4"];
const PHONE = { width: 390, height: 844 };

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

/** A second person in a browser of their own (two sign-ins never share cookies), on a phone. */
async function secondPerson(browser: Browser, baseURL: string | undefined, role: Role) {
  const context = await browser.newContext({ baseURL, viewport: PHONE });
  const page = await context.newPage();
  const person = await signIn(page, role);
  return { context, page, person };
}

/** The author logs a disruption for the test building and submits its acknowledgement: one pending entry, fifteen frozen translations. */
async function submitAnAcknowledgement(page: Page) {
  await page.goto("/staff/alerts/log");
  await page.getByLabel("Elevator", { exact: true }).check();
  await page.getByRole("radio", { name: /^Buildings/ }).check();
  await page.getByTestId(`building-${RSN}`).getByRole("checkbox").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/staff\/alerts\/ack\?alert=[0-9a-f-]+&entry=[0-9a-f-]+$/);
  const url = new URL(page.url());
  const ref = { alertId: url.searchParams.get("alert") as string, entryId: url.searchParams.get("entry") as string };
  await page.getByTestId("submit-button").click();
  await expect(page.getByTestId("pending-panel")).toBeVisible({ timeout: 60_000 });
  return ref;
}

const approvalUrl = (ref: { alertId: string; entryId: string }) => `/staff/alerts/approve?alert=${ref.alertId}&entry=${ref.entryId}`;

/** The second person approves the entry on their phone. */
async function approve(phone: Page, ref: { alertId: string; entryId: string }) {
  await phone.goto(approvalUrl(ref));
  await phone.getByTestId("approve-button").click();
  await expect(phone.getByTestId("locked-note")).toContainText("approved and is published", { timeout: 30_000 });
}

const entryRow = async (entryId: string) => (await sql`select * from alert_entry where id = ${entryId}`)[0];
const entriesOf = async (alertId: string) => await sql`select id, kind, status, phase, valid_until_mode, audience, types, version from alert_entry where alert_id = ${alertId} order by created_at, id`;
const feedVersion = async () => Number((await sql`select version from feed_version`)[0].version);
const auditOf = async (entryId: string) => await sql`select action, outcome, actor_staff_id, meta from audit_event where subject_id = ${entryId} order by id`;
const translationCount = async (entryId: string) => (await sql`select count(*)::int as n from alert_entry_translation where entry_id = ${entryId}`)[0].n as number;

/** The thread's own item on a Hub home, among the running alerts of every test that shares the database. */
const runningItem = (page: Page, alertId: string) => page.getByTestId("running-item").filter({ has: page.locator(`a[href*="alert=${alertId}"]`) });


test("a Coordinator corrects an acknowledgement and a second Coordinator approves it: the acknowledgement stays readable underneath, superseded", async ({ page, browser, baseURL, request }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const author = await signIn(page, "coordinator");
  const ack = await submitAnAcknowledgement(page);
  const second = await secondPerson(browser, baseURL, "coordinator");
  try {
    const phone = second.page;
    await approve(phone, ack);
    const acknowledgement = await entryRow(ack.entryId);
    expect(acknowledgement.status).toBe("approved");

    // The shared link (S05.08), straight after the approval: the alert as residents read it, with the facts and the words in its preview.
    const slug = (await sql`select slug from alert where id = ${ack.alertId}`)[0].slug as string;
    const shared = await sharedPreview(request, slug);
    expect(shared.status).toBe(200);
    expect(shared.cookies).toEqual([]);
    expect(shared.title).toBe("Elevator");
    expect(shared.description).toContain(`Verified by the Hub \u00b7 ${ADDRESS} \u00b7 Posted today at`);
    expect(shared.description).toContain(acknowledgement.original_text);

    // The Hub home lists the running alert with the two new next steps.
    await page.goto("/staff");
    const item = runningItem(page, ack.alertId);
    await expect(item).toHaveCount(1);
    await expect(item.getByRole("link", { name: "Correct an entry" })).toHaveAttribute("href", `/staff/alerts/correct?alert=${ack.alertId}`);
    await expect(item.getByRole("link", { name: "Withdraw an entry" })).toHaveAttribute("href", `/staff/alerts/withdraw?alert=${ack.alertId}`);
    await item.getByRole("link", { name: "Correct an entry" }).click();

    // O-15: the entries that can be corrected, and nothing made yet.
    await expect(page.getByRole("heading", { level: 1, name: "Correct an alert" })).toBeVisible();
    await expect(page.getByTestId("target")).toHaveCount(1);
    await expect(page.getByTestId("target")).toContainText("Acknowledgement, ");
    await expect(page.getByTestId("composer-text")).toHaveCount(0);
    await expect(page.getByTestId("save-draft")).toHaveCount(0);
    expect(await entriesOf(ack.alertId)).toHaveLength(1);
    await page.getByTestId("target-choose").click();
    await expect(page).toHaveURL(new RegExp(`/staff/alerts/correct\\?alert=${ack.alertId}&target=${ack.entryId}$`));

    // The chosen entry's own words, to change; the phase is required; who it is for is carried over.
    await expect(page.getByTestId("replaces-text")).toHaveText(acknowledgement.original_text);
    await expect(page.getByTestId("composer-text")).toHaveValue(acknowledgement.original_text);
    await expect(page.getByTestId("types-summary")).toHaveText("Elevator");
    await expect(page.getByTestId("audience-sentence")).toContainText(ADDRESS);
    const radios = page.locator('input[name="phase"]');
    for (const index of [0, 1]) await expect(radios.nth(index)).toHaveAttribute("required", "");
    await page.getByTestId("composer-text").fill("The elevator at 98 Correction Test Dr is out of service on floors 1 to 4, not floor 1 only.");
    await page.getByTestId("save-draft").click();
    await expect(page).toHaveURL(/\/staff\/alerts\/correct\?alert=[0-9a-f-]+&entry=[0-9a-f-]+&saved=1$/);
    const entryId = new URL(page.url()).searchParams.get("entry") as string;
    const ref = { alertId: ack.alertId, entryId };

    // The draft: a correction naming the acknowledgement, the author its editor; the acknowledgement is untouched.
    const draft = await entryRow(entryId);
    expect(draft).toMatchObject({ kind: "correction", status: "draft", supersedes_id: ack.entryId, withdrawal_reason: null, author_id: author.id });
    expect(draft.audience).toEqual(acknowledgement.audience);
    expect(draft.editor_ids).toEqual([author.id]);
    expect(await entryRow(ack.entryId)).toEqual(acknowledgement);
    expect(await auditOf(entryId)).toMatchObject([{ action: "entry.created", outcome: "ok", actor_staff_id: author.id, meta: { entry_id: entryId, kind: "correction", types: ["elevator"] } }]);
    await expect(page.getByTestId("replaces-text")).toHaveText(acknowledgement.original_text);

    // Submit: translated into every language and frozen as version 1, pending; the entry it corrects is still approved.
    await page.getByTestId("submit-button").click();
    await expect(page.getByTestId("pending-panel")).toBeVisible({ timeout: 60_000 });
    const pending = await entryRow(entryId);
    expect(pending).toMatchObject({ status: "pending_approval", version: 1 });
    expect(await translationCount(entryId)).toBe(15);
    expect((await entryRow(ack.entryId)).status).toBe("approved");

    // The person who wrote it cannot approve it; the other Coordinator is shown the entry it replaces and who it goes to, and approves.
    await page.goto(approvalUrl(ref));
    await expect(page.locator('p[role="alert"]')).toContainText("Only a Coordinator or an Admin who did not write or change this alert can approve it.");
    await phone.goto(approvalUrl(ref));
    await expect(phone.getByRole("heading", { level: 1, name: "Approve a correction" })).toBeVisible();
    await expect(phone.getByTestId("replaces-text")).toHaveText(acknowledgement.original_text);
    await expect(phone.getByTestId("replaces-reach")).toContainText("everyone who got the original");
    await expect(phone.getByTestId("replaces-closes")).toHaveCount(0);
    await expect(phone.getByTestId("english-body")).toContainText("not floor 1 only");
    const feedBefore = await feedVersion();
    await phone.getByTestId("approve-button").click();
    await expect(phone.getByTestId("locked-note")).toContainText("approved and is published", { timeout: 30_000 });

    // One transaction: the correction approved, the entry it corrects superseded, the feed version up once, both audited.
    expect(await entryRow(entryId)).toMatchObject({ status: "approved", approved_by: second.person.id, approved_version: 1 });
    const replaced = await entryRow(ack.entryId);
    expect(replaced.status).toBe("superseded");
    // Every other column of the corrected entry is what it was: its wording is still readable.
    expect({ ...replaced, status: "approved", updated_at: acknowledgement.updated_at }).toEqual(acknowledgement);
    expect(await feedVersion()).toBe(feedBefore + 1);
    expect((await auditOf(ack.entryId)).map((row) => [row.action, row.outcome]).at(-1)).toEqual(["entry.superseded", "ok"]);
    expect((await auditOf(ack.entryId)).at(-1)?.meta).toEqual({ entry_id: ack.entryId, by: entryId, by_kind: "correction" });
    expect((await auditOf(entryId)).map((row) => [row.action, row.outcome])).toEqual([["entry.created", "ok"], ["entry.submitted", "ok"], ["entry.approved", "ok"]]);
    expect((await sql`select status from alert where id = ${ack.alertId}`)[0].status).toBe("open");

    // The shared link again, straight after the correction: it previews the correction, never the wording it replaced.
    const corrected = await sharedPreview(request, slug);
    expect(corrected.status).toBe(200);
    expect(corrected.description).toContain("Correction: The elevator at 98 Correction Test Dr is out of service on floors 1 to 4, not floor 1 only.");
    expect(corrected.description).toContain("Updated today at");
    expect(corrected.description).not.toContain(acknowledgement.original_text);

    // The entry it replaced is no longer offered; the correction is.
    await page.goto(`/staff/alerts/correct?alert=${ack.alertId}`);
    await expect(page.getByTestId("target")).toHaveCount(1);
    await expect(page.getByTestId("target")).toContainText("Correction, ");
  } finally {
    await second.context.close();
  }
});

test("a Coordinator withdraws the only entry and a second Coordinator approves it: the alert closes withdrawn in the same approval, and nothing more can be added to it", async ({ page, browser, baseURL, request }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, "coordinator");
  const ack = await submitAnAcknowledgement(page);
  const second = await secondPerson(browser, baseURL, "coordinator");
  try {
    const phone = second.page;
    await approve(phone, ack);

    await page.goto(`/staff/alerts/withdraw?alert=${ack.alertId}&target=${ack.entryId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Withdraw an alert" })).toBeVisible();
    // The reason is required, from the catalog; "Other" needs the Hub's words; nothing is made until it is saved.
    const reasons = page.locator('input[name="reason"]');
    await expect(reasons).toHaveCount(4);
    for (const index of [0, 1, 2, 3]) await expect(reasons.nth(index)).toHaveAttribute("required", "");
    await expect(page.locator('input[name="valid-mode"]')).toHaveCount(0);
    expect(await entriesOf(ack.alertId)).toHaveLength(1);
    await page.getByRole("radio", { name: "Other (write the reason)" }).check();
    await page.getByTestId("save-draft").click();
    await expect(page.getByRole("alert").first()).toContainText("Write the text of the alert.");
    expect(await entriesOf(ack.alertId)).toHaveLength(1);
    await page.getByRole("radio", { name: "Duplicate of another alert" }).check();
    await page.getByTestId("save-draft").click();
    await expect(page).toHaveURL(/\/staff\/alerts\/withdraw\?alert=[0-9a-f-]+&entry=[0-9a-f-]+&saved=1$/);
    const entryId = new URL(page.url()).searchParams.get("entry") as string;
    const ref = { alertId: ack.alertId, entryId };
    const draft = await entryRow(entryId);
    expect(draft).toMatchObject({ kind: "withdrawal", status: "draft", supersedes_id: ack.entryId, withdrawal_reason: "duplicate", original_text: "This alert repeated another alert. It has been withdrawn." });

    await page.getByTestId("submit-button").click();
    await expect(page.getByTestId("pending-panel")).toBeVisible({ timeout: 60_000 });
    expect(await translationCount(entryId)).toBe(15);

    await phone.goto(approvalUrl(ref));
    await expect(phone.getByRole("heading", { level: 1, name: "Approve a withdrawal" })).toBeVisible();
    await expect(phone.getByTestId("replaces-reason")).toHaveText("Reason: Duplicate of another alert");
    await expect(phone.getByTestId("replaces-closes")).toContainText("closes the alert as withdrawn");
    const feedBefore = await feedVersion();
    await phone.getByTestId("approve-button").click();
    await expect(phone.getByTestId("locked-note")).toContainText("approved and is published", { timeout: 30_000 });

    expect(await entryRow(entryId)).toMatchObject({ status: "approved" });
    expect((await entryRow(ack.entryId)).status).toBe("superseded");
    expect((await sql`select status, closed_reason from alert where id = ${ack.alertId}`)[0]).toEqual({ status: "closed", closed_reason: "withdrawn" });
    expect(await feedVersion()).toBe(feedBefore + 1);
    expect((await sql`select meta from audit_event where action = 'alert.closed' and subject_id = ${ack.alertId}`)[0].meta).toEqual({ closed_as: "withdrawn", discarded: 0, kept_entry_id: entryId });

    // The shared link (S05.08), straight after the withdrawal closed the alert: it says it was withdrawn with the reason, never the wording that was withdrawn.
    const withdrawn = await sharedPreview(request, (await sql`select slug from alert where id = ${ack.alertId}`)[0].slug as string);
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.title).toBe("Elevator: Withdrawn");
    expect(withdrawn.description).toContain("This alert repeated another alert. It has been withdrawn.");
    expect(withdrawn.description).not.toContain((await entryRow(ack.entryId)).original_text);

    // Closed: not on the Hub home, and its pages offer no form.
    await page.goto("/staff");
    await expect(runningItem(page, ack.alertId)).toHaveCount(0);
    await page.goto(`/staff/alerts/correct?alert=${ack.alertId}`);
    await expect(page.getByTestId("replace-closed")).toContainText("This alert is already closed.");
    await page.goto(`/staff/alerts/update?alert=${ack.alertId}`);
    await expect(page.getByTestId("update-closed")).toContainText("This alert is already closed.");
  } finally {
    await second.context.close();
  }
});

test("a Director and an Ambassador who ask for the correction and withdrawal pages directly are refused, and a Coordinator is let in", async ({ page }) => {
  for (const role of ["director", "ambassador"] as const) {
    await page.context().clearCookies();
    await signIn(page, role);
    for (const path of ["correct", "withdraw"]) {
      await page.goto(`/staff/alerts/${path}?alert=${randomUUID()}`);
      await expect(page.locator('p[role="alert"]')).toContainText("Only a Coordinator or an Admin can write an alert.");
      await expect(page.getByTestId("composer-text")).toHaveCount(0);
    }
  }
  await page.context().clearCookies();
  await signIn(page, "coordinator");
  await page.goto(`/staff/alerts/correct?alert=${randomUUID()}`);
  await expect(page.getByTestId("replace-missing")).toBeVisible();
});
