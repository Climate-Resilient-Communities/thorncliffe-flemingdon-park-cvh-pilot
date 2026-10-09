import { expect, test, type Page } from "@playwright/test";
import { approvalScreen, countChangedView, type ApprovalScreen } from "../../src/app/staff/alerts/approval/view";
import { incidentsView } from "../../src/app/staff/alerts/incidents/view";
import { englishText } from "../../src/i18n/text";
import type { RunningThread } from "../../src/modules/alerting";
import { APPROVER, OTHER_ALERT, OTHER_ENTRY, PLANS, reviewOf, type ReviewOptions } from "../../test/helpers/approvalReview";
import { REAL_TEXTS, hubBrand } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { expectBaseline } from "./helpers";

// S04.07: the approval view of an alert (O-05) and of an ambassador's post (O-07) inside the Hub shell, at 390 and 1280 px: an alert before texting is
// open (the web as the only channel, a count of 0, "Text sign-up is not open yet"), one with texting open and languages that fell back and a possible
// duplicate, an ambassador's post, the return form and the discard confirmation, a count that changed with the new number to confirm, an entry that
// is no longer waiting, and the Hub home's list of what waits for a person with the note an approver sent back. The views are built by the app's own
// view functions; the screens are the app's own ApprovalBody and IncidentsList with actions that do nothing. The behaviour is asserted in
// src/app/staff/alerts/approval/*.test.ts, test/db/alertApproval.db.test.ts and e2e/staff/approval.spec.ts; the boundaries of the layout are in
// e2e/layout/approval.spec.ts; these pictures show what it looks like. The staff screens are English in the pilot.
const brand = hubBrand();

const OPEN: ReviewOptions["recipients"] = { open: true, total: 12, byLanguage: { en: 5, ur: 4, fr: 3 } };

const screenOf = (options: ReviewOptions = {}): ApprovalScreen => approvalScreen({ review: reviewOf(options), plans: PLANS, pricePerSegmentCents: 1.5, viewerId: APPROVER });

/** The viewport is as tall as the page, so the picture shows all of it, with the sticky actions at its end. */
async function fitToPage(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width, height });
}

async function openApproval(page: Page, width: number, props: Omit<Parameters<typeof mount<"ApprovalFixture">>[2], "texts" | "brand">) {
  await page.setViewportSize({ width, height: 800 });
  await mount(page, "ApprovalFixture", { texts: REAL_TEXTS, brand, ...props });
  await fitToPage(page, width);
}

for (const width of [390, 1280]) {
  test(`the approval view of an alert before texting is open, at ${width}px`, async ({ page }) => {
    await openApproval(page, width, { screen: screenOf() });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Approve an alert");
    await expect(page.getByTestId("sms-not-open")).toHaveText("Text sign-up is not open yet.");
    await expect(page.getByTestId("recipient-count")).toHaveText("0");
    await expectBaseline(page, `approval-before-texting-${width}.png`);
  });

  test(`the approval view of an alert with texting open, languages that fell back and a possible duplicate, at ${width}px`, async ({ page }) => {
    await openApproval(page, width, {
      screen: screenOf({ recipients: OPEN, fallback: ["ur", "ps"], duplicate: { alertId: OTHER_ALERT, entryId: OTHER_ENTRY }, thread: { isDrill: false } }),
    });
    await expect(page.getByTestId("fallback-summary")).toContainText("2 of 15 languages could not be translated");
    await expect(page.getByTestId("duplicate-link")).toBeVisible();
    await expect(page.getByTestId("estimated-cost")).toHaveText("$0.57 CAD");
    await expectBaseline(page, `approval-texting-fallback-${width}.png`);
  });

  test(`the review of an ambassador's post, at ${width}px`, async ({ page }) => {
    await openApproval(page, width, { screen: screenOf({ authorRole: "ambassador" }) });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Review an ambassador post");
    await expect(page.getByTestId("ambassador-note")).toBeVisible();
    await expectBaseline(page, `approval-ambassador-${width}.png`);
  });
}

test("every language opened, at 390px", async ({ page }) => {
  await openApproval(page, 390, { screen: screenOf({ recipients: OPEN, fallback: ["ur"] }) });
  await page.getByTestId("language-ur").locator("summary").click();
  await page.getByTestId("language-fr").locator("summary").click();
  await expect(page.getByTestId("web-ur")).toBeVisible();
  await expect(page.getByTestId("sms-fr")).toBeVisible();
  await fitToPage(page, 390);
  await expectBaseline(page, "approval-languages-open-390.png");
});

test("Return to author with a note, and Discard, at 390px", async ({ page }) => {
  await openApproval(page, 390, { screen: screenOf(), initial: { mode: "return" } });
  await expect(page.getByTestId("return-note")).toBeVisible();
  await expect(page.getByTestId("send-back-button")).toBeVisible();
  await expectBaseline(page, "approval-return-390.png");

  await openApproval(page, 390, { screen: screenOf(), initial: { mode: "return", returnToAuthor: { status: "refused", message: "Write a note for the author." } } });
  await expect(page.locator("p.hub-error")).toHaveText("Write a note for the author.");
  await expectBaseline(page, "approval-return-refused-390.png");

  await openApproval(page, 390, { screen: screenOf(), initial: { mode: "discard" } });
  await expect(page.getByTestId("discard-confirm-button")).toBeVisible();
  await expectBaseline(page, "approval-discard-390.png");
});

test("a refusal, and a count that changed with the new number to confirm, at 390px", async ({ page }) => {
  await openApproval(page, 390, { screen: screenOf(), initial: { approve: { status: "refused", message: "This alert changed. Review it again." } } });
  await expect(page.locator("p.hub-error")).toHaveText("This alert changed. Review it again.");
  await expectBaseline(page, "approval-refused-390.png");

  const review = reviewOf({ recipients: OPEN });
  const view = countChangedView({ review, snapshot: { total: 14, byLanguage: { en: 5, ur: 4, fr: 5 } }, reviewed: OPEN, pricePerSegmentCents: 1.5 });
  await openApproval(page, 390, { screen: screenOf({ recipients: OPEN }), initial: { approve: { status: "count_changed", view } } });
  await expect(page.getByTestId("count-changed")).toContainText("The number of people who will get this text changed from 12 to 14");
  await expect(page.getByTestId("count-cost")).toHaveText("Estimated cost now: $0.69 CAD (an estimate)");
  // Approve waits for the confirmation. The page is static here (no hydration), so ticking is not exercised in this picture: the markup (a required
  // checkbox bound to the approve form) is asserted in ApprovalBody.test.tsx, the answer with the new number in approveFromForm.test.ts and the use case's
  // refusal in test/db/alertApproval.db.test.ts. A real browser cannot reach a changed count before E07 opens text sign-up.
  await expect(page.getByTestId("approve-button")).toBeDisabled();
  await expect(page.getByTestId("confirm-count")).not.toBeChecked();
  await expectBaseline(page, "approval-count-changed-390.png");
});

test("an entry that is no longer waiting, at 390px", async ({ page }) => {
  await openApproval(page, 390, { screen: screenOf({ entry: { status: "approved" } }) });
  await expect(page.getByTestId("locked-note")).toContainText("approved and is published");
  await expect(page.locator(".layout-screen__actions")).toHaveCount(0);
  await expectBaseline(page, "approval-locked-390.png");

  await openApproval(page, 390, { screen: screenOf({ entry: { status: "draft", contentHash: null, submittedAt: null, returnedFor: "return", returnedNote: "Say which floors." } }) });
  await expect(page.getByTestId("locked")).toContainText("The note sent: Say which floors.");
  await expectBaseline(page, "approval-returned-390.png");
});

/** `pauseNoticeForApprover()`'s sentence while all texts are paused (S06.06): the catalog's `staff.texts.paused.approver`. */
const PAUSED = "Texts are paused; this will send when resumed";
const pausedScreen = (options: ReviewOptions = {}): ApprovalScreen =>
  approvalScreen({ review: reviewOf(options), plans: PLANS, pricePerSegmentCents: 1.5, viewerId: APPROVER, pauseNotice: PAUSED });

test("while all texts are paused, on the approval view and on the confirmation of an approval, at 390px", async ({ page }) => {
  await openApproval(page, 390, { screen: pausedScreen({ recipients: OPEN }) });
  await expect(page.getByTestId("pause-notice")).toHaveText(PAUSED);
  await expect(page.getByTestId("approve-button")).toBeEnabled();
  await expectBaseline(page, "approval-paused-390.png");

  await openApproval(page, 390, { screen: pausedScreen({ entry: { status: "approved" } }) });
  await expect(page.getByTestId("locked-note")).toContainText("approved and is published");
  await expect(page.getByTestId("pause-notice")).toHaveText(PAUSED);
  await expectBaseline(page, "approval-paused-confirmed-390.png");
});

test("fits the phone without scrolling sideways in every state", async ({ page }) => {
  const states: Array<[ApprovalScreen, Parameters<typeof mount<"ApprovalFixture">>[2]["initial"]?]> = [
    [screenOf()],
    [pausedScreen()],
    [pausedScreen({ entry: { status: "approved" } })],
    [screenOf({ recipients: OPEN, fallback: ["ur"], duplicate: { alertId: OTHER_ALERT, entryId: OTHER_ENTRY } })],
    [screenOf({ authorRole: "ambassador" })],
    [screenOf(), { mode: "return" }],
    [screenOf({ entry: { status: "approved" } })],
  ];
  for (const [screen, initial] of states) {
    await openApproval(page, 390, { screen, initial });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), screen.title).toBe(true);
  }
});

/** When the Hub home is read in the pictures: the waits it shows are counted to it, so the pictures do not change with the clock. */
const NOW = new Date("2026-10-04T14:12:00.000Z");
const IN_MILEPOST = { scope: "buildings" as const, buildings: [{ rsn: "4154146", floors: null }], groups: [], types: ["elevator"] };
const RUNNING: RunningThread[] = [
  { alertId: OTHER_ALERT, slug: "abcd2345", isDrill: false, reportedAt: new Date("2026-10-04T13:30:00.000Z"), types: ["elevator"], phase: "in_progress", validUntil: new Date("2026-10-05T14:00:00.000Z"), publishedAt: new Date("2026-10-04T14:40:00.000Z"), coveringKind: "update", ackOnly: false, entries: 2, audience: IN_MILEPOST },
  { alertId: "01900000-0000-7000-8000-00000000a1e9", slug: "wxyz2345", isDrill: false, reportedAt: new Date("2026-10-04T13:50:00.000Z"), types: ["water", "power"], phase: "problem", validUntil: new Date("2026-10-05T15:20:00.000Z"), publishedAt: new Date("2026-10-04T15:20:00.000Z"), coveringKind: "ack", ackOnly: true, entries: 1 },
  { alertId: "01900000-0000-7000-8000-00000000a1ea", slug: "drll2345", isDrill: true, reportedAt: new Date("2026-10-04T13:00:00.000Z"), types: ["fire"], phase: "problem", validUntil: new Date("2026-10-05T15:20:00.000Z"), publishedAt: new Date("2026-10-04T13:10:00.000Z"), coveringKind: "ack", ackOnly: true, entries: 1 },
];
const HOME = {
  waiting: [
    { alertId: OTHER_ALERT, entryId: OTHER_ENTRY, kind: "ack" as const, status: "pending_approval" as const, types: ["elevator"], isDrill: false, version: 1, submittedAt: new Date("2026-10-04T14:00:00.000Z"), returnedNote: null, audience: IN_MILEPOST },
    { alertId: OTHER_ALERT, entryId: "01900000-0000-7000-8000-00000000e179", kind: "update" as const, status: "pending_approval" as const, types: ["power", "water"], isDrill: true, version: 2, submittedAt: new Date("2026-10-04T14:05:00.000Z"), returnedNote: null, followUp: true },
    { alertId: "01900000-0000-7000-8000-00000000a1e9", entryId: "01900000-0000-7000-8000-00000000e17b", kind: "update" as const, status: "pending_approval" as const, types: ["water", "power"], isDrill: false, version: 1, submittedAt: new Date("2026-10-04T13:20:00.000Z"), returnedNote: null, followUp: true },
  ],
  mine: [
    { alertId: OTHER_ALERT, entryId: "01900000-0000-7000-8000-00000000e17a", kind: "ack" as const, status: "draft" as const, types: ["water"], isDrill: false, version: 1, submittedAt: null, returnedNote: "Say which floors, and when the water will be back." },
  ],
};

for (const width of [390, 1280]) {
  test(`the Hub home lists what waits for a person with how long, the open threads, the note an approver sent back and the drills apart, at ${width}px`, async ({ page }) => {
    const view = incidentsView(HOME, "coordinator", undefined, RUNNING, NOW, [], PLANS);
    await page.setViewportSize({ width, height: 800 });
    await mount(page, "IncidentsFixture", { texts: REAL_TEXTS, brand, view });
    await fitToPage(page, width);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Right now");
    // The longest wait first; the drill waiting for approval is in the queue too, titled as a drill (UAT F-6); a card names its place (UAT note 4).
    await expect(page.getByTestId("incidents-waiting").getByTestId("waited")).toHaveText(["Waiting 52 minutes", "Waiting 12 minutes", "Waiting 7 minutes"]);
    await expect(page.getByTestId("incidents-waiting").locator('[data-drill="true"]')).toContainText("Drill · Power, Water · Update");
    await expect(page.getByTestId("incidents-waiting").getByTestId("item-place")).toHaveText(["4 Milepost Pl"]);
    await expect(page.getByTestId("returned-note")).toContainText("Note from the approver: Say which floors");
    await expect(page.getByTestId("incidents-drills")).toBeVisible();
    await expectBaseline(page, `incidents-${width}.png`);
  });
}

test("the Hub home of a Director is read-only: the open threads and no link to act on one, at 390px", async ({ page }) => {
  const view = incidentsView({ waiting: [], mine: [] }, "director", undefined, RUNNING, NOW, [], PLANS);
  await page.setViewportSize({ width: 390, height: 800 });
  await mount(page, "IncidentsFixture", { texts: REAL_TEXTS, brand, view });
  await fitToPage(page, 390);
  await expect(page.getByTestId("read-only")).toBeVisible();
  await expect(page.getByTestId("running-item")).toHaveCount(2);
  await expect(page.locator('.layout-screen__body a[href^="/staff/alerts/"]')).toHaveCount(0);
  await expectBaseline(page, "incidents-director-390.png");
});

test("the Hub home with nothing open, at 390px", async ({ page }) => {
  const view = incidentsView({ waiting: [], mine: [] }, "admin", undefined, [], NOW);
  await page.setViewportSize({ width: 390, height: 800 });
  await mount(page, "IncidentsFixture", { texts: REAL_TEXTS, brand, view });
  await fitToPage(page, 390);
  await expect(page.getByTestId("incidents-waiting")).toHaveCount(0);
  await expect(page.getByTestId("incidents-running")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Between disruptions" })).toBeVisible();
  await expectBaseline(page, "incidents-empty-390.png");
});

for (const width of [390, 1280]) {
  test(`the published confirmation: what went where, with languages that fell back, at ${width}px`, async ({ page }) => {
    await openApproval(page, width, { screen: screenOf({ entry: { status: "approved" }, fallback: ["ur", "ps"] }) });
    await expect(page.getByTestId("published-title")).toHaveText("The acknowledgement is out");
    await expect(page.getByTestId("where-web")).toContainText("in 14 languages, each in their own words");
    await expect(page.getByTestId("where-fallback")).toContainText("Residents reading in Urdu and Pashto see the English text");
    await expect(page.getByTestId("where-texts")).toContainText("go out once texting is live");
    await expectBaseline(page, `published-${width}.png`);
  });
}

test("the published confirmation of a drill, at 390px", async ({ page }) => {
  await openApproval(page, 390, { screen: screenOf({ entry: { status: "approved" }, thread: { isDrill: true } }) });
  await expect(page.getByTestId("published-title")).toHaveText("Practice publish: nothing was sent to residents");
  await expectBaseline(page, "published-drill-390.png");
});

// S07.08: when this alert's texts would take the month's text spending past the monthly cap, the approver is told before approving, by how much, and that
// they can still approve (the sentence is the catalog's, built by the app's own capNoticeFor).
const CAP_NOTICE =
  "With this alert, text spending this month would be about $312.40 CAD, which is $12.40 over the monthly cap of $300.00 CAD. You can still approve it: the texts are sent, the overrun is recorded and the on-call Admins are told.";
for (const width of [390, 1280]) {
  test(`the approval view of an alert that would pass the monthly spending cap, at ${width}px`, async ({ page }) => {
    const screen = approvalScreen({ review: reviewOf({ recipients: OPEN }), plans: PLANS, pricePerSegmentCents: 1.5, viewerId: APPROVER, capNotice: CAP_NOTICE });
    await openApproval(page, width, { screen });
    await expect(page.getByTestId("cap-notice")).toHaveText(CAP_NOTICE);
    // It informs and takes nothing away: Approve is still on the page, after the notice.
    await expect(page.getByTestId("approve-button")).toBeVisible();
    await expectBaseline(page, `approval-cap-notice-${width}.png`);
  });
}

// S08.08: approving a heat or power alert (this one is elevator and power) starts or adds to a check-in round; with nobody on duty for check-ins, the
// approver is told that its escalations would go to every on-call number (the catalog's sentence, which the app's own onDutyNoticeFor gives).
const ON_DUTY_NOTICE = englishText("staff.approve.noOnDuty");
for (const width of [390, 1280]) {
  test(`the approval view of a power alert while nobody is on duty for check-ins, at ${width}px`, async ({ page }) => {
    const screen = approvalScreen({ review: reviewOf({ recipients: OPEN }), plans: PLANS, pricePerSegmentCents: 1.5, viewerId: APPROVER, onDutyNotice: ON_DUTY_NOTICE });
    await openApproval(page, width, { screen });
    await expect(page.getByTestId("on-duty-notice")).toHaveText(ON_DUTY_NOTICE);
    await expect(page.getByTestId("approve-button")).toBeVisible();
    await expectBaseline(page, `approval-no-on-duty-${width}.png`);
  });
}
