// Closing an alert with a final word, in a browser (S05.03; O-16 "Mark resolved"), against the production build with the identity fake and the translation fake
// (`CVH_FAKE_TRANSLATOR=sample`, playwright.staff.config.ts: no model is called, nothing leaves this machine, no text is sent). A Coordinator's acknowledgement is approved by a
// second person; the Hub home lists the running alert with "Mark resolved"; the page asks only for the final entry and makes the draft when it is saved; the final is submitted
// (fifteen frozen translations), the second person is told approving it closes the alert and that it goes to everyone who got any entry of it, and approves: in one transaction the
// final is approved, the thread is closed `resolved` with the final recorded as the entry that closed it, `feed_version` goes up once and both changes are audited. The Hub home then
// lists the alert as recently closed and not as running, the alert's pages offer no form, and a resident opens the closed alert at its address with how it closed and the
// final message on top, though it is no longer in the live feed.
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { ArchiveV1, FeedV1 } from "../../src/contracts/feed";
import { approve, newBuilding, newCoordinator, personOnAPhone, sharedPreview, signIn, submitAnAcknowledgement, type EntryRef } from "./alert-flow";
import { identityFake, openDatabase, pepperedPassword } from "./helpers";

let sql: postgres.Sql;

test.beforeAll(() => {
  sql = openDatabase();
});

test.afterAll(async () => {
  await sql?.end({ timeout: 5 });
});

const FINAL = "The elevator at 97 Resolve Test Dr is back in service on all floors. If it stops again, call the Hub.";

const approvalUrl = (ref: EntryRef) => `/staff/alerts/approve?alert=${ref.alertId}&entry=${ref.entryId}`;
const entryRow = async (entryId: string) => (await sql`select * from alert_entry where id = ${entryId}`)[0];
const threadRow = async (alertId: string) => (await sql`select * from alert where id = ${alertId}`)[0];
const feedVersion = async () => Number((await sql`select version from feed_version`)[0].version);
const auditOf = async (subjectId: string) => await sql`select action, outcome, actor_staff_id, meta from audit_event where subject_id = ${subjectId} order by id`;
const translationCount = async (entryId: string) => (await sql`select count(*)::int as n from alert_entry_translation where entry_id = ${entryId}`)[0].n as number;

/** The thread's own item on a Hub home, among the running alerts of every test that shares the database. */
const runningItem = (page: Page, alertId: string) => page.getByTestId("running-item").filter({ has: page.locator(`a[href*="alert=${alertId}"]`) });

test("a Coordinator marks an alert resolved and a second Coordinator approves the final: the alert closes in the same approval, and is listed as closed, not running", async ({ page, browser, baseURL, request }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const rsn = await newBuilding(sql, "97 Resolve Test Dr");
  const author = await newCoordinator(sql);
  const approver = await newCoordinator(sql);
  await signIn(page, author);
  const ack = await submitAnAcknowledgement(page, rsn);
  const second = await personOnAPhone(browser, baseURL, approver);
  try {
    const phone = second.page;
    await approve(phone, ack);
    const slug = (await threadRow(ack.alertId)).slug as string;
    // The shared link (S05.08) while the alert runs: the live alert, with its place and time in the preview.
    const running = await sharedPreview(request, slug);
    expect(running.status).toBe(200);
    expect(running.title).toBe("Elevator");
    expect(running.description).toContain("Verified by the Hub \u00b7 97 Resolve Test Dr \u00b7 Posted today at");
    // An update that waits for approval when the alert is resolved: it goes with the close, never read by residents.
    await page.goto(`/staff/alerts/update?alert=${ack.alertId}`);
    await page.getByRole("radio", { name: "Work is under way" }).check();
    await page.getByTestId("composer-text").fill("A technician is on site.");
    await page.getByTestId("save-draft").click();
    await expect(page).toHaveURL(/\/staff\/alerts\/promote\?alert=[0-9a-f-]+&entry=[0-9a-f-]+&saved=1$/);
    const waitingUpdate = new URL(page.url()).searchParams.get("entry") as string;
    await page.getByTestId("submit-button").click();
    await expect(page.getByTestId("pending-panel")).toBeVisible({ timeout: 60_000 });

    // The Hub home lists the running alert with "Mark resolved".
    await page.goto("/staff");
    const item = runningItem(page, ack.alertId);
    await expect(item).toHaveCount(1);
    await expect(item.getByRole("link", { name: "Mark resolved" })).toHaveAttribute("href", `/staff/alerts/resolve?alert=${ack.alertId}`);
    await item.getByRole("link", { name: "Mark resolved" }).click();

    // O-16: only the final entry is asked for; nothing is made until it is saved; what happens when the alert is resolved is said first.
    await expect(page.getByRole("heading", { level: 1, name: "Mark resolved" })).toBeVisible();
    await expect(page.locator("label", { hasText: "Final entry" })).toBeVisible();
    await expect(page.locator('input[name="phase"]')).toHaveCount(0);
    await expect(page.locator('input[name="valid-mode"]')).toHaveCount(0);
    await expect(page.getByTestId("after-resolve").locator("li")).toHaveCount(3);
    await expect(page.getByTestId("types-summary")).toHaveText("Elevator");
    await expect(page.getByTestId("audience-sentence")).toContainText("97 Resolve Test Dr");
    expect((await sql`select count(*)::int as n from alert_entry where alert_id = ${ack.alertId} and kind = 'final'`)[0].n).toBe(0);
    await page.getByTestId("composer-text").fill(FINAL);
    await page.getByTestId("save-draft").click();
    await expect(page).toHaveURL(/\/staff\/alerts\/resolve\?alert=[0-9a-f-]+&entry=[0-9a-f-]+&saved=1$/);
    const entryId = new URL(page.url()).searchParams.get("entry") as string;
    const final: EntryRef = { alertId: ack.alertId, entryId };

    // The draft: a final with no target, the thread's audience and types carried over, "until resolved"; nothing is closed yet.
    const draft = await entryRow(entryId);
    expect(draft).toMatchObject({ kind: "final", status: "draft", supersedes_id: null, withdrawal_reason: null, valid_until_mode: "resolved", original_text: FINAL });
    expect(draft.audience).toEqual((await entryRow(ack.entryId)).audience);
    expect(await threadRow(ack.alertId)).toMatchObject({ status: "open", closing_entry_id: null });
    expect(await auditOf(entryId)).toMatchObject([{ action: "entry.created", outcome: "ok", meta: { entry_id: entryId, kind: "final", types: ["elevator"] } }]);

    // Submit: translated into every language and frozen as version 1, pending; still open.
    await page.getByTestId("submit-button").click();
    await expect(page.getByTestId("pending-panel")).toBeVisible({ timeout: 60_000 });
    expect(await entryRow(entryId)).toMatchObject({ status: "pending_approval", version: 1 });
    expect(await translationCount(entryId)).toBe(15);
    expect((await threadRow(ack.alertId)).status).toBe("open");

    // The author cannot approve it; the other Coordinator is told what approving does, and approves.
    await page.goto(approvalUrl(final));
    await expect(page.locator('p[role="alert"]')).toContainText("Only a Coordinator or an Admin who did not write or change this alert can approve it.");
    await phone.goto(approvalUrl(final));
    await expect(phone.getByRole("heading", { level: 1, name: "Approve a final message" })).toBeVisible();
    await expect(phone.getByTestId("closing-reach")).toContainText("everyone who got any entry of this alert, on the channels they got it on");
    await expect(phone.getByTestId("closing-closes")).toContainText("closes the alert as resolved");
    await expect(phone.getByTestId("english-body")).toHaveText(FINAL);
    const feedBefore = await feedVersion();
    await phone.getByTestId("approve-button").click();
    await expect(phone.getByTestId("locked-note")).toContainText("approved and is published", { timeout: 30_000 });
    await expect(phone.getByRole("heading", { level: 1, name: "The alert is resolved" })).toBeVisible();

    // One transaction: the final approved, the thread closed resolved with the final recorded as the entry that closed it, the feed version up once, the waiting update discarded.
    const approved = await entryRow(entryId);
    expect(approved).toMatchObject({ status: "approved", approved_by: approver.id, approved_version: 1 });
    const closed = await threadRow(ack.alertId);
    expect(closed).toMatchObject({ status: "closed", closed_reason: "resolved", closing_entry_id: entryId });
    expect(closed.closed_at.getTime()).toBe(approved.approved_at.getTime());
    expect(await feedVersion()).toBe(feedBefore + 1);
    expect((await entryRow(ack.entryId)).status).toBe("approved");
    expect((await entryRow(waitingUpdate)).status).toBe("discarded");
    expect((await auditOf(entryId)).map((row) => [row.action, row.outcome])).toEqual([["entry.created", "ok"], ["entry.submitted", "ok"], ["entry.approved", "ok"]]);
    expect((await sql`select meta from audit_event where action = 'alert.closed' and subject_id = ${ack.alertId}`)[0].meta).toEqual({ closed_as: "resolved", discarded: 1, kept_entry_id: entryId });

    // The Hub home: not running, and listed as closed with how it closed and the final message; no link to change it.
    await page.goto("/staff");
    await expect(runningItem(page, ack.alertId)).toHaveCount(0);
    const closedItem = page.getByTestId("closed-item").filter({ hasText: FINAL });
    await expect(closedItem).toHaveCount(1);
    await expect(closedItem).toContainText("Resolved ");
    await expect(closedItem.locator("a[href]")).toHaveCount(0);

    // Closed: no form on any of the alert's pages, and the final cannot be resolved again.
    for (const [path, id] of [["update", "update-closed"], ["promote", "update-closed"], ["correct", "replace-closed"], ["withdraw", "replace-closed"], ["resolve", "resolve-closed"]] as const) {
      await page.goto(`/staff/alerts/${path}?alert=${ack.alertId}`);
      await expect(page.getByTestId(id), path).toContainText("This alert is already closed.");
      await expect(page.locator("main form"), path).toHaveCount(0);
    }
    // The approval page of the final is a record now: it offers no Approve.
    await phone.goto(approvalUrl(final));
    await expect(phone.getByTestId("approve-button")).toHaveCount(0);

    // A resident: not in the live feed, but the closed alert opens at its address, resolved, with the final message on top and the acknowledgement below it.
    const feed = FeedV1.parse(await (await request.get("/api/feed?lang=en")).json());
    expect(feed.threads.map((thread) => thread.slug)).not.toContain(slug);
    // The same read that dropped it from the live list has it first in the archive (S05.07): the approval expired the feed's tag, which the archive is cached under too.
    const archive = ArchiveV1.parse(await (await request.get("/api/feed/archive?lang=en")).json());
    expect(archive.threads[0]).toMatchObject({ slug, state: "closed", close_reason: "resolved" });
    expect(archive.threads[0].entries.at(-1)).toMatchObject({ kind: "final" });
    await page.goto(`/en/alerts/${slug}`);
    await expect(page.getByTestId("alert-closed")).toHaveAttribute("data-reason", "resolved");
    await expect(page.getByTestId("alert-closed-title")).toContainText("Resolved ");
    await expect(page.getByTestId("alert-text")).toHaveText(FINAL);
    await expect(page.getByTestId("alert-thread").locator("li")).toHaveCount(2);
    await expect(page.getByTestId("alert-valid")).toHaveCount(0);

    // The shared link, straight after the close: it says resolved with the time, and the final message is its words.
    const resolved = await sharedPreview(request, slug);
    expect(resolved.status).toBe(200);
    expect(resolved.title).toMatch(/^Elevator: Resolved today at /);
    expect(resolved.description).toBe(`Verified by the Hub \u00b7 97 Resolve Test Dr \u2014 ${FINAL}`);
  } finally {
    await second.context.close();
  }
});

test("only one of two finals closes the alert: the first approval closes it, the other final is discarded with the close and cannot be approved", async ({ page, browser, baseURL }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const rsn = await newBuilding(sql, "96 Resolve Twice Dr");
  const author = await newCoordinator(sql);
  const approver = await newCoordinator(sql);
  await signIn(page, author);
  const ack = await submitAnAcknowledgement(page, rsn);
  const second = await personOnAPhone(browser, baseURL, approver);
  try {
    await approve(second.page, ack);
    const start = async () => {
      await page.goto(`/staff/alerts/resolve?alert=${ack.alertId}`);
      await page.getByTestId("composer-text").fill(FINAL);
      await page.getByTestId("save-draft").click();
      await expect(page).toHaveURL(/\/staff\/alerts\/resolve\?alert=[0-9a-f-]+&entry=[0-9a-f-]+&saved=1$/);
      const entryId = new URL(page.url()).searchParams.get("entry") as string;
      await page.getByTestId("submit-button").click();
      await expect(page.getByTestId("pending-panel")).toBeVisible({ timeout: 60_000 });
      return { alertId: ack.alertId, entryId };
    };
    const first = await start();
    const twin = await start();

    // The approver has both open; the first approval closes the alert, the second is refused and the other final is discarded with the close.
    await second.page.goto(approvalUrl(twin));
    await expect(second.page.getByTestId("approve-button")).toBeVisible();
    await approve(second.page, first);
    expect((await threadRow(ack.alertId)).closing_entry_id).toBe(first.entryId);
    expect((await entryRow(twin.entryId)).status).toBe("discarded");
    await second.page.goto(approvalUrl(twin));
    await expect(second.page.getByTestId("approve-button")).toHaveCount(0);
    expect((await sql`select count(*)::int as n from alert_entry where alert_id = ${ack.alertId} and kind = 'final' and status = 'approved'`)[0].n).toBe(1);

    // Only one close was made, and the page that starts a final now says the alert is closed.
    await page.goto(`/staff/alerts/resolve?alert=${ack.alertId}`);
    await expect(page.getByTestId("resolve-closed")).toContainText("This alert is already closed.");
    expect((await sql`select count(*)::int as n from audit_event where subject_id = ${ack.alertId} and action = 'alert.closed' and outcome = 'ok'`)[0].n).toBe(1);
  } finally {
    await second.context.close();
  }
});

/** A Director or an Ambassador (no authenticator: neither needs one to reach the Hub), signed in on this page. */
async function signInPlain(page: Page, role: "director" | "ambassador") {
  const username = `${role.slice(0, 3)}${randomBytes(3).toString("hex")}`;
  const password = `${username} own password`;
  const authUserId = identityFake().plant(`${username}@staff.cvh.invalid`, { password: pepperedPassword(password), createdAt: new Date() });
  await sql`
    insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password)
    values (${randomUUID()}, ${authUserId}, ${username}, 'Dana', 'Okafor', 'someone@example.org', ${role}, false)`;
  await page.goto("/staff/sign-in");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/staff$/);
}

test("a Director and an Ambassador who ask for the Mark resolved page directly are refused, and a Coordinator is let in", async ({ page }) => {
  for (const role of ["director", "ambassador"] as const) {
    await page.context().clearCookies();
    await signInPlain(page, role);
    await page.goto(`/staff/alerts/resolve?alert=${randomUUID()}`);
    await expect(page.locator('p[role="alert"]')).toContainText("Only a Coordinator or an Admin can write an alert.");
    await expect(page.getByTestId("composer-text")).toHaveCount(0);
  }
  await page.context().clearCookies();
  await signIn(page, await newCoordinator(sql));
  await page.goto(`/staff/alerts/resolve?alert=${randomUUID()}`);
  await expect(page.getByTestId("resolve-missing")).toBeVisible();
});
