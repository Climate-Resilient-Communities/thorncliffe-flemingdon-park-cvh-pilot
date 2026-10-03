// Approving what was reviewed, on a phone (S04.07; O-05), against the production build with the identity fake and the translation fake
// (`CVH_FAKE_TRANSLATOR=sample`, playwright.staff.config.ts: no model is called, nothing leaves this machine, no text is sent):
// a Coordinator submits an acknowledgement; a second Coordinator finds it waiting on the Hub home, reads it at 390 px (the audience in words, the
// channels, the number of text recipients and that texting is not open yet, the estimated cost, the languages one tap away, Approve within reach of
// a thumb) and approves it, and the entry is published with the feed's version raised and `entry.approved` audited with the version, the hash and
// the count; the person who wrote it is refused the page; an approval pressed on a page that went stale (the author pulled it back) changes
// nothing and is recorded as a refusal; an approver returns an entry with a note the author then reads, and discards another.
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
const RSN = String(700_000_000 + Math.floor(Math.random() * 99_999_999));
const ADDRESS = "88 Approval Test Dr";
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
const entryRow = async (entryId: string) => (await sql`select status, version, content_hash, returned_for, returned_note, approved_by, approved_version, approved_hash, web_published_at, editor_ids from alert_entry where id = ${entryId}`)[0];
const feedVersion = async () => Number((await sql`select version from feed_version`)[0].version);
const auditOf = async (entryId: string) => await sql`select action, outcome, actor_staff_id, meta from audit_event where subject_id = ${entryId} order by id`;

test("a second Coordinator reads what was submitted on a phone, approves it, and it is published with the feed's version raised and the approval audited", async ({ page, browser, baseURL }) => {
  const author = await signIn(page, "coordinator");
  const ref = await submitAnAcknowledgement(page);
  const pending = await entryRow(ref.entryId);
  expect(pending).toMatchObject({ status: "pending_approval", version: 1, approved_by: null, web_published_at: null });
  expect(pending.editor_ids).toEqual([author.id]);

  const second = await secondPerson(browser, baseURL, "coordinator");
  try {
    const phone = second.page;

    // The Hub home lists it for the approver, with a link to review it.
    await expect(phone.getByTestId("incidents-waiting")).toBeVisible();
    const waiting = phone.getByTestId("waiting-item").filter({ has: phone.locator(`a[href="${approvalUrl(ref)}"]`) });
    await expect(waiting).toHaveCount(1);
    await waiting.getByRole("link", { name: "Review" }).click();
    await expect(phone).toHaveURL(new RegExp(`/staff/alerts/approve\\?alert=${ref.alertId}&entry=${ref.entryId}$`));
    await expect(phone.getByRole("heading", { level: 1, name: "Approve an alert" })).toBeVisible();

    // Above the fold at 390 x 844: who it is for in words, where it goes, the text recipients (none: texting is not open yet), the estimated cost.
    const fold = PHONE.height;
    for (const id of ["fact-audience", "fact-channels", "fact-recipients", "fact-cost"]) {
      const box = await phone.getByTestId(id).boundingBox();
      expect(box, id).not.toBeNull();
      expect((box?.y ?? Infinity) + (box?.height ?? 0), `${id} is above the fold`).toBeLessThanOrEqual(fold);
    }
    await expect(phone.getByTestId("audience-sentence")).toContainText(ADDRESS);
    await expect(phone.getByTestId("fact-channels")).toContainText("Web app");
    await expect(phone.getByTestId("fact-channels")).not.toContainText("Text messages");
    await expect(phone.getByTestId("recipient-count")).toHaveText("0");
    await expect(phone.getByTestId("sms-not-open")).toHaveText("Text sign-up is not open yet.");
    await expect(phone.getByTestId("estimated-cost")).toBeVisible();
    await expect(phone.getByTestId("english-body")).toContainText(ADDRESS);

    // Approve is a 44 px target in the lower part of the screen, where a thumb rests.
    const approve = phone.getByTestId("approve-button");
    await expect(approve).toBeVisible();
    const button = await approve.boundingBox();
    expect(button?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect((button?.y ?? 0) + (button?.height ?? 0)).toBeLessThanOrEqual(fold);
    expect(button?.y ?? 0).toBeGreaterThan(fold / 2);

    // The other languages are one tap away: fifteen closed disclosures; opening one shows the web text and the text message as they are sent.
    await expect(phone.locator("[data-testid^='language-']")).toHaveCount(16);
    await expect(phone.getByTestId("web-ur")).toBeHidden();
    await phone.getByTestId("language-ur").locator("summary").click();
    await expect(phone.getByTestId("web-ur")).toBeVisible();
    await expect(phone.getByTestId("sms-ur")).toBeVisible();

    // Approve: the page shows what became of the entry.
    const before = await feedVersion();
    await approve.click();
    await expect(phone.getByTestId("locked-note")).toContainText("approved and is published", { timeout: 30_000 });
    await expect(phone.getByTestId("approve-button")).toHaveCount(0);

    const approved = await entryRow(ref.entryId);
    expect(approved).toMatchObject({ status: "approved", approved_by: second.person.id, approved_version: 1, approved_hash: pending.content_hash });
    expect(approved.web_published_at).not.toBeNull();
    expect(approved.editor_ids).toEqual([author.id]);
    expect(await feedVersion()).toBe(before + 1);
    const audit = await auditOf(ref.entryId);
    expect(audit.at(-1)).toMatchObject({
      action: "entry.approved",
      outcome: "ok",
      actor_staff_id: second.person.id,
      meta: { entry_id: ref.entryId, version: 1, content_hash: pending.content_hash, recipient_count: 0 },
    });

    // A second press of the same approval (a stale tab, a double tap) changes nothing: the entry is not waiting any more.
    const again = await phone.request.get(approvalUrl(ref));
    expect(again.status()).toBe(200);
    expect(again.headers()["cache-control"]).toContain("no-store");
    expect(await feedVersion()).toBe(before + 1);
  } finally {
    await second.context.close();
  }
});

test("the person who wrote the entry is refused the approval page, and so are an Ambassador and a Director, with the reason", async ({ page, browser, baseURL }) => {
  await signIn(page, "coordinator");
  const ref = await submitAnAcknowledgement(page);
  const before = await entryRow(ref.entryId);

  // The author: a second person has to approve it.
  await page.goto(approvalUrl(ref));
  await expect(page.locator('p[role="alert"]')).toHaveText("Only a Coordinator or an Admin who did not write or change this alert can approve it.");
  await expect(page.getByTestId("approve-button")).toHaveCount(0);
  await expect(page.locator("main form")).toHaveCount(0);

  for (const role of ["ambassador", "director"] as const) {
    const other = await secondPerson(browser, baseURL, role);
    try {
      await other.page.goto(approvalUrl(ref));
      await expect(other.page.locator('p[role="alert"]')).toContainText("Only a Coordinator or an Admin who did not write or change this alert can approve it.");
      await expect(other.page.getByTestId("approve-button")).toHaveCount(0);
    } finally {
      await other.context.close();
    }
  }
  expect(await entryRow(ref.entryId)).toEqual(before);
});

test("an approval pressed on a page that went stale changes nothing and is recorded as a refusal", async ({ page, browser, baseURL }) => {
  await signIn(page, "coordinator");
  const ref = await submitAnAcknowledgement(page);
  const second = await secondPerson(browser, baseURL, "coordinator");
  try {
    const phone = second.page;
    await phone.goto(approvalUrl(ref));
    await expect(phone.getByTestId("approve-button")).toBeVisible();

    // Meanwhile the author pulls the entry back to a draft.
    await page.getByTestId("pull-back").click();
    await expect(page.getByTestId("composer-text")).toBeVisible();
    const pulledBack = await entryRow(ref.entryId);
    expect(pulledBack).toMatchObject({ status: "draft", approved_by: null, web_published_at: null });

    // The approver presses Approve on what they were shown: refused, in words, and nothing changed.
    const before = await feedVersion();
    await phone.getByTestId("approve-button").click();
    await expect(phone.locator("p.hub-error").first()).toContainText(/changed|no longer waiting/, { timeout: 30_000 });
    expect(await entryRow(ref.entryId)).toEqual(pulledBack);
    expect(await feedVersion()).toBe(before);

    // The refusal is in the record, with who tried and why, and no approval is.
    const audit = await auditOf(ref.entryId);
    expect(audit.filter((row) => row.action === "entry.approved" && row.outcome === "ok")).toHaveLength(0);
    expect(audit.at(-1)).toMatchObject({ action: "entry.approved", outcome: "refused", actor_staff_id: second.person.id });
    expect(typeof (audit.at(-1)?.meta as { refusal?: string }).refusal).toBe("string");
  } finally {
    await second.context.close();
  }
});

test("an approver returns an entry with a note the author reads, and discards another", async ({ page, browser, baseURL }) => {
  const author = await signIn(page, "coordinator");
  const returned = await submitAnAcknowledgement(page);
  const second = await secondPerson(browser, baseURL, "admin");
  try {
    const phone = second.page;

    // Return to author needs a note.
    await phone.goto(approvalUrl(returned));
    await phone.getByTestId("return-button").click();
    await expect(phone.getByTestId("return-note")).toBeVisible();
    await expect(phone.getByTestId("approve-button")).toHaveCount(0);
    await phone.getByTestId("send-back-button").click();
    // The browser's own required-field check stops an empty note before anything is sent.
    expect(await entryRow(returned.entryId)).toMatchObject({ status: "pending_approval", returned_note: null });
    await phone.getByTestId("return-note").fill("Say which floors, and when the elevator will be back.");
    await expect(phone.getByTestId("return-note-count")).toContainText("53 of 500");
    await phone.getByTestId("send-back-button").click();
    await expect(phone.getByTestId("locked-note")).toContainText("sent back to its author", { timeout: 30_000 });

    const row = await entryRow(returned.entryId);
    expect(row).toMatchObject({ status: "draft", returned_for: "return", returned_note: "Say which floors, and when the elevator will be back.", approved_by: null, web_published_at: null });
    const audit = await auditOf(returned.entryId);
    expect(audit.at(-1)).toMatchObject({ action: "entry.returned", outcome: "ok", actor_staff_id: second.person.id });
    // The record holds that a note was sent, never the note.
    expect(JSON.stringify(audit.at(-1)?.meta)).not.toContain("Say which floors");

    // The author finds the note on the Hub home and in the composer, and the text as it was.
    await page.goto("/staff");
    await expect(page.getByTestId("returned-note")).toContainText("Note from the approver: Say which floors, and when the elevator will be back.");
    await page.goto(`/staff/alerts/ack?alert=${returned.alertId}&entry=${returned.entryId}`);
    await expect(page.getByTestId("returned-note")).toContainText("Say which floors, and when the elevator will be back.");
    await expect(page.getByTestId("composer-text")).toHaveValue(new RegExp(ADDRESS));
    expect(row.editor_ids).toEqual([author.id]);

    // Discard another entry: confirmed, never published, audited.
    const discarded = await submitAnAcknowledgement(page);
    await phone.goto(approvalUrl(discarded));
    await phone.getByTestId("discard-button").click();
    await expect(phone.getByTestId("discard-confirm-button")).toBeVisible();
    await phone.getByTestId("discard-confirm-button").click();
    await expect(phone.getByTestId("locked-note")).toContainText("was discarded", { timeout: 30_000 });
    expect(await entryRow(discarded.entryId)).toMatchObject({ status: "discarded", approved_by: null, web_published_at: null });
    expect((await auditOf(discarded.entryId)).at(-1)).toMatchObject({ action: "entry.discarded", outcome: "ok", actor_staff_id: second.person.id });
  } finally {
    await second.context.close();
  }
});
