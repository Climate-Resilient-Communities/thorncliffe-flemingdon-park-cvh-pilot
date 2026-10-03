// Adding an update to a running alert, and promoting an acknowledgement to a full alert, in a browser (S05.01; O-13, O-14), against the production build with the
// identity fake and the translation fake (`CVH_FAKE_TRANSLATOR=sample`, playwright.staff.config.ts: no model is called, nothing leaves this machine, no text is
// sent): a Coordinator's acknowledgement is approved by a second person; the Hub home lists the running alert with "Promote to full alert"; the promotion page
// carries the thread's audience and types over, asks for the phase (required: none is ticked, and the browser will not send the form without one), defaults the
// valid-until to the acknowledgement's choice ("until resolved") and makes the draft only when it is saved; the author widens who it is for with the place picker
// and sees what changes; submits (fifteen frozen translations, one version); the second person is told it is an update and "Now also for: ..." above the fold on
// a phone, and approves it; the acknowledgement is exactly as it was; the Hub home then offers "Add an update". A thread that is closed while an update is being
// written or waits for approval refuses its submit and its approval ("This alert is already closed"), is not on the Hub home, and its update page offers no form.
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
/** This run's building: a number of 9 digits no register uses. */
const RSN = String(800_000_000 + Math.floor(Math.random() * 99_999_999));
const ADDRESS = "99 Update Test Dr";
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

test("a Coordinator promotes an acknowledgement to a full alert, widens who it is for, and a second Coordinator approves the update, which leaves the acknowledgement as it was", async ({ page, browser, baseURL }) => {
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

    // The Hub home lists the running alert for the author, with the one next step: promote it.
    await page.goto("/staff");
    await expect(page.getByTestId("incidents-running")).toBeVisible();
    const item = runningItem(page, ack.alertId);
    await expect(item).toHaveCount(1);
    await expect(item).toContainText("Elevator");
    await expect(item).toContainText("Acknowledgement");
    await expect(item.getByRole("link", { name: "Promote to full alert" })).toHaveAttribute("href", `/staff/alerts/promote?alert=${ack.alertId}`);
    await expect(item.getByRole("link", { name: "Add an update" })).toHaveCount(0);
    await item.getByRole("link", { name: "Promote to full alert" }).click();

    // O-13: nothing is made yet. The running alert, the carried-over audience, the types as words and a valid-until that is the acknowledgement's choice.
    await expect(page).toHaveURL(new RegExp(`/staff/alerts/promote\\?alert=${ack.alertId}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Promote to full alert" })).toBeVisible();
    const before = await entriesOf(ack.alertId);
    expect(before).toHaveLength(1);
    await expect(page.getByTestId("thread-digest").getByTestId("thread-entry")).toHaveCount(1);
    await expect(page.getByTestId("thread-digest")).toContainText("Acknowledgement, ");
    await expect(page.getByTestId("audience-sentence")).toContainText(ADDRESS);
    await expect(page.getByTestId("types-summary")).toHaveText("Elevator");
    await expect(page.getByTestId("audience-carried")).toContainText("carried over from the alert");
    await expect(page.getByRole("radio", { name: /^Until resolved/ })).toBeChecked();
    await expect(page.getByTestId("submit-button")).toHaveCount(0);

    // The phase is required: none is ticked, and the form is not sent without one.
    const radios = page.locator('input[name="phase"]');
    await expect(radios).toHaveCount(2);
    for (const index of [0, 1]) {
      await expect(radios.nth(index)).toHaveAttribute("required", "");
      await expect(radios.nth(index)).not.toBeChecked();
    }
    await page.getByTestId("composer-text").fill("Toronto Hydro is on site. The elevator may be back after 11 pm.");
    await page.getByTestId("save-draft").click();
    await expect(page).toHaveURL(new RegExp(`/staff/alerts/promote\\?alert=${ack.alertId}$`));
    expect(await entriesOf(ack.alertId)).toHaveLength(1);

    // Choose the phase and save: the draft is made, as an update of this thread, with the audience and types carried over, and its composer opens.
    await page.getByRole("radio", { name: "Work is under way" }).check();
    await page.getByTestId("save-draft").click();
    await expect(page).toHaveURL(/\/staff\/alerts\/promote\?alert=[0-9a-f-]+&entry=[0-9a-f-]+&saved=1$/);
    const entryId = new URL(page.url()).searchParams.get("entry") as string;
    const ref = { alertId: ack.alertId, entryId };
    const draft = await entryRow(entryId);
    expect(draft).toMatchObject({ kind: "update", status: "draft", phase: "in_progress", valid_until_mode: "resolved", original_text: "Toronto Hydro is on site. The elevator may be back after 11 pm.", author_id: author.id });
    expect(draft.audience).toEqual(acknowledgement.audience);
    expect(draft.types).toEqual(acknowledgement.types);
    expect(draft.editor_ids).toEqual([author.id]);
    // "Until resolved" renewed: 24 hours from the save, not the acknowledgement's own time.
    const hours = (new Date(draft.valid_until).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.5);
    expect(hours).toBeLessThanOrEqual(24);
    expect(await auditOf(entryId)).toMatchObject([{ action: "entry.created", outcome: "ok", actor_staff_id: author.id, meta: { entry_id: entryId, kind: "update", types: ["elevator"] } }]);
    await expect(page.getByRole("status")).toHaveText("The draft is saved.");
    await expect(page.getByRole("radio", { name: "Work is under way" })).toBeChecked();
    await expect(page.getByTestId("sms-preview")).toContainText("Toronto Hydro is on site");
    await expect(page.getByTestId("submit-button")).toBeVisible();

    // Who it is for stays the thread's until the author changes it; widening it to the whole neighbourhood says what it adds.
    await expect(page.getByTestId("audience-same")).toBeVisible();
    await page.getByRole("link", { name: "Change the place" }).click();
    await expect(page).toHaveURL(/\/staff\/alerts\/audience\?.*from=promote/);
    await page.getByRole("checkbox", { name: /^99 Update Test Dr/ }).uncheck();
    await page.getByRole("radio", { name: /^A whole neighbourhood/ }).check();
    await page.locator('input[name="neighbourhood"][value="TP"]').check();
    await page.getByRole("button", { name: "Save the place" }).click();
    await expect(page).toHaveURL(/\/staff\/alerts\/audience\/groups\?.*from=promote/);
    await page.getByTestId("audience-back").click();
    await expect(page).toHaveURL(new RegExp(`/staff/alerts/promote\\?alert=${ack.alertId}&entry=${entryId}$`));
    await expect(page.getByTestId("audience-also-for")).toHaveText("Now also for: the rest of Thorncliffe Park");
    await expect(page.getByTestId("audience-no-longer-for")).toHaveCount(0);
    expect((await entryRow(entryId)).audience).toEqual({ scope: "neighbourhood", neighbourhood_ids: ["TP"], groups: [], types: ["elevator"] });
    // The acknowledgement keeps its own.
    expect((await entryRow(ack.entryId)).audience).toEqual(acknowledgement.audience);

    // Submit: translated into every language, frozen as version 1, pending, in one attempt.
    await page.getByTestId("submit-button").click();
    await expect(page.getByTestId("pending-panel")).toBeVisible({ timeout: 60_000 });
    const pending = await entryRow(entryId);
    expect(pending).toMatchObject({ status: "pending_approval", version: 1 });
    expect(pending.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await translationCount(entryId)).toBe(15);
    expect(await sql`select state, kind, result_version from alert_submit_attempt where entry_id = ${entryId}`).toEqual([{ state: "committed", kind: "submit", result_version: 1 }]);
    expect((await sql`select count(*)::int as n from alert_entry where alert_id = ${ack.alertId} and kind = 'update'`)[0].n).toBe(1);

    // The person who wrote it cannot approve it; the other Coordinator finds it waiting.
    await page.goto(approvalUrl(ref));
    await expect(page.locator('p[role="alert"]')).toContainText("Only a Coordinator or an Admin who did not write or change this alert can approve it.");
    await phone.goto("/staff");
    const waiting = phone.getByTestId("waiting-item").filter({ has: phone.locator(`a[href="${approvalUrl(ref)}"]`) });
    await expect(waiting).toHaveCount(1);
    await waiting.getByRole("link", { name: "Review" }).click();

    // On a phone, above the fold: that this is an update, who it is for, and what it adds; Approve within reach of a thumb.
    await expect(phone.getByTestId("update-note")).toContainText("update to an alert residents are already reading");
    for (const id of ["update-note", "audience-sentence", "audience-also-for"]) {
      const where = await phone.getByTestId(id).boundingBox();
      expect(where, id).not.toBeNull();
      expect((where?.y ?? Infinity) + (where?.height ?? 0), `${id} is above the fold`).toBeLessThanOrEqual(PHONE.height);
    }
    await expect(phone.getByTestId("audience-also-for")).toHaveText("Now also for: the rest of Thorncliffe Park");
    await expect(phone.getByTestId("english-body")).toContainText("Toronto Hydro is on site");

    const feedBefore = await feedVersion();
    await phone.getByTestId("approve-button").click();
    await expect(phone.getByTestId("locked-note")).toContainText("approved and is published", { timeout: 30_000 });
    const approved = await entryRow(entryId);
    expect(approved).toMatchObject({ status: "approved", approved_by: second.person.id, approved_version: 1, approved_hash: pending.content_hash });
    expect(approved.web_published_at).not.toBeNull();
    expect(await feedVersion()).toBe(feedBefore + 1);
    expect((await auditOf(entryId)).map((row) => [row.action, row.outcome])).toEqual([["entry.created", "ok"], ["entry.submitted", "ok"], ["entry.approved", "ok"]]);

    // It added an entry and replaced nothing: the acknowledgement is exactly as it was, still approved and published.
    expect(await entryRow(ack.entryId)).toEqual(acknowledgement);
    expect((await entriesOf(ack.alertId)).map((row) => [row.kind, row.status])).toEqual([["ack", "approved"], ["update", "approved"]]);

    // The Hub home now offers the next step of a full alert: another update, not a promotion.
    await page.goto("/staff");
    const after = runningItem(page, ack.alertId);
    await expect(after).toHaveCount(1);
    await expect(after).toContainText("Update, Work is under way");
    await expect(after.getByRole("link", { name: "Add an update" })).toHaveAttribute("href", `/staff/alerts/update?alert=${ack.alertId}`);
    await expect(after.getByRole("link", { name: "Promote to full alert" })).toHaveCount(0);

    // "Add an update" shows the running alert, newest entry first, and carries the thread's new audience and the update's valid-until over.
    await after.getByRole("link", { name: "Add an update" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Add an update" })).toBeVisible();
    const entries = page.getByTestId("thread-digest").getByTestId("thread-entry");
    await expect(entries).toHaveCount(2);
    await expect(entries.nth(0)).toContainText("Update, ");
    await expect(entries.nth(0)).toContainText("Toronto Hydro is on site");
    await expect(entries.nth(1)).toContainText("Acknowledgement, ");
    await expect(page.getByTestId("audience-sentence")).toContainText("Everyone living in Thorncliffe Park");
    await expect(page.getByRole("radio", { name: /^Until resolved/ })).toBeChecked();
    // A promote link for a thread that is already a full alert, and the update link for an acknowledgement, send the person to the page that fits.
    await page.goto(`/staff/alerts/promote?alert=${ack.alertId}`);
    await expect(page).toHaveURL(new RegExp(`/staff/alerts/update\\?alert=${ack.alertId}$`));
  } finally {
    await second.context.close();
  }
});

test("a thread closed while an update is written or waits for approval refuses its submit and its approval, offers no 'Add an update', and its update page has no form", async ({ page, browser, baseURL }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, "coordinator");
  const ack = await submitAnAcknowledgement(page);
  const second = await secondPerson(browser, baseURL, "coordinator");
  try {
    const phone = second.page;
    await approve(phone, ack);

    // One update waits for approval, one is being written.
    const startUpdate = async (text: string) => {
      await page.goto(`/staff/alerts/promote?alert=${ack.alertId}`);
      await page.getByTestId("composer-text").fill(text);
      await page.getByRole("radio", { name: "Work is under way" }).check();
      await page.getByTestId("save-draft").click();
      await expect(page).toHaveURL(/\/staff\/alerts\/(promote|update)\?alert=[0-9a-f-]+&entry=[0-9a-f-]+&saved=1$/);
      return { alertId: ack.alertId, entryId: new URL(page.url()).searchParams.get("entry") as string };
    };
    const waiting = await startUpdate("The elevator is being repaired.");
    await page.getByTestId("submit-button").click();
    await expect(page.getByTestId("pending-panel")).toBeVisible({ timeout: 60_000 });
    const writing = await startUpdate("Floors 1 to 4 are back in use.");
    expect(await entryRow(waiting.entryId)).toMatchObject({ status: "pending_approval" });
    expect(await entryRow(writing.entryId)).toMatchObject({ status: "draft" });

    // The approver already has the waiting update open, with its Approve button, when the thread is closed.
    await phone.goto(approvalUrl(waiting));
    await expect(phone.getByTestId("approve-button")).toBeVisible();

    // The thread is closed (S05.03 builds the way to close it; here the database does).
    await sql`update alert set status = 'closed', closed_reason = 'resolved', closed_at = now() where id = ${ack.alertId}`;

    // Pressing Submit on what was being written says so: "This alert is already closed" (the press saves the draft first, and the save is refused), and nothing is frozen.
    // The author still has the draft open, from before the thread closed.
    await page.getByTestId("submit-button").click();
    await expect(page.locator("#composer-error")).toHaveText("This alert is already closed.", { timeout: 30_000 });
    expect(await entryRow(writing.entryId)).toMatchObject({ status: "draft", version: 0, content_hash: null });
    expect(await translationCount(writing.entryId)).toBe(0);
    // Opened again, the draft is locked: it says the alert is closed and offers no form to fill in (S05.01).
    await page.goto(`/staff/alerts/promote?alert=${writing.alertId}&entry=${writing.entryId}`);
    await expect(page.getByTestId("locked-note")).toHaveText("This alert is closed.");
    await expect(page.getByTestId("submit-button")).toHaveCount(0);
    await expect(page.getByTestId("save-draft")).toHaveCount(0);
    // The submit itself, sent straight to the server, is refused with ALERT_CLOSED, the refusal is recorded and no attempt is made.
    const answer = await page.request.post("/api/staff/alerts/entries/submit", { data: { v: 1, alert_id: writing.alertId, entry_id: writing.entryId, key: randomUUID() } });
    expect(answer.status()).toBe(200);
    expect(await answer.json()).toMatchObject({ v: 1, state: "refused", outcome: "ALERT_CLOSED" });
    expect(await sql`select count(*)::int as n from alert_submit_attempt where entry_id = ${writing.entryId}`).toEqual([{ n: 0 }]);
    expect((await auditOf(writing.entryId)).at(-1)).toMatchObject({ action: "entry.submitted", outcome: "refused", actor_staff_id: expect.any(String), meta: { reason: "alert_closed", refusal: "ALERT_CLOSED" } });

    // Approving what waited is refused the same way (the press, made on the page opened before the thread closed), and nothing is published.
    const feedBefore = await feedVersion();
    await phone.getByTestId("approve-button").click();
    await expect(phone.getByTestId("approval-error")).toHaveText("This alert is already closed.", { timeout: 30_000 });
    expect(await entryRow(waiting.entryId)).toMatchObject({ status: "pending_approval", web_published_at: null });
    expect(await feedVersion()).toBe(feedBefore);
    expect((await auditOf(waiting.entryId)).at(-1)).toMatchObject({ action: "entry.approved", outcome: "refused", actor_staff_id: second.person.id, meta: { reason: "alert_closed", refusal: "ALERT_CLOSED" } });

    // Opened again, the approval page says the alert is closed and offers no Approve.
    await phone.goto(approvalUrl(waiting));
    await expect(phone.getByTestId("locked-note")).toHaveText("This alert is closed.");
    await expect(phone.getByTestId("approve-button")).toHaveCount(0);

    // The closed thread offers no "Add an update" and no "Promote": it is not on the Hub home, and its update pages have no form.
    await page.goto("/staff");
    await expect(runningItem(page, ack.alertId)).toHaveCount(0);
    await expect(page.locator(`a[href*="/staff/alerts/update?alert=${ack.alertId}"], a[href*="/staff/alerts/promote?alert=${ack.alertId}"]`)).toHaveCount(0);
    for (const path of ["update", "promote"]) {
      await page.goto(`/staff/alerts/${path}?alert=${ack.alertId}`);
      await expect(page.getByTestId("update-closed")).toHaveText("This alert is already closed. Nothing more can be added to it.");
      await expect(page.locator("main form")).toHaveCount(0);
      await expect(page.getByTestId("save-draft")).toHaveCount(0);
    }
    expect((await sql`select count(*)::int as n from alert_entry where alert_id = ${ack.alertId} and kind = 'update'`)[0].n).toBe(2);
  } finally {
    await second.context.close();
  }
});

test("an Ambassador and a Director are refused the update pages, with the reason, and a Coordinator is told a thread with nothing published has nothing to add to", async ({ page, browser, baseURL }) => {
  await signIn(page, "coordinator");
  const waitingAck = await submitAnAcknowledgement(page);
  // Not approved yet: nothing residents can read, so there is nothing to add an update to.
  await page.goto(`/staff/alerts/promote?alert=${waitingAck.alertId}`);
  await expect(page.getByTestId("update-unpublished")).toContainText("nothing to add an update to");
  await expect(page.locator("main form")).toHaveCount(0);
  await page.goto(`/staff/alerts/promote?alert=${randomUUID()}`);
  await expect(page.locator('p[role="alert"]')).toContainText("That alert draft was not found.");

  for (const role of ["ambassador", "director"] as const) {
    const other = await secondPerson(browser, baseURL, role);
    try {
      for (const path of ["update", "promote"]) {
        await other.page.goto(`/staff/alerts/${path}?alert=${waitingAck.alertId}`);
        await expect(other.page.locator('p[role="alert"]')).toContainText("Only a Coordinator or an Admin can");
        await expect(other.page.locator("main form")).toHaveCount(0);
      }
      // No list of running alerts either: they write none.
      await other.page.goto("/staff");
      await expect(other.page.getByTestId("incidents-running")).toHaveCount(0);
    } finally {
      await other.context.close();
    }
  }
});
