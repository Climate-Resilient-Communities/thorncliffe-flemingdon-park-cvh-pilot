import { expect, test, type Page } from "@playwright/test";
import { approvalScreen } from "../../src/app/staff/alerts/approval/view";
import { composerScreen, replaceStartScreen, type ComposerScreen } from "../../src/app/staff/alerts/composer/view";
import type { EntryState, ThreadEntrySummary, ThreadSummary, UpdateStart } from "../../src/modules/alerting";
import { APPROVER, PLANS as REVIEW_PLANS, floorId, reviewOf } from "../../test/helpers/approvalReview";
import type { BuildingFloorPlan } from "../../src/modules/places";
import { REAL_TEXTS, hubBrand } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { expectBaseline } from "./helpers";

// S05.02: "Correct" and "Withdraw" (O-15) and their approval inside the Hub shell, at 390 and 1280 px: the correction form once an entry is chosen (the entry's own
// words to change, where things stand, who it is for carried over), the withdrawal form (the reason from the catalog), a withdrawal's draft, and the approval of a
// correction and of a withdrawal that closes the alert (the entry that is replaced, what residents will see, who it goes to). The views are built by the app's own view
// functions; the screens are the app's own ComposerBody and ApprovalBody with actions that do nothing. The behaviour is asserted in src/app/staff/alerts/**/*.test.ts,
// test/db/alertCorrection.db.test.ts and e2e/staff/corrections.spec.ts; the boundaries of the layout are in e2e/layout/replace.spec.ts; these pictures show what it
// looks like. The staff screens are English in the pilot.
const brand = hubBrand();

const ALERT = "01900000-0000-7000-8000-00000000a1e7";
const ACK = "01900000-0000-7000-8000-00000000e100";
const FIRST = "01900000-0000-7000-8000-00000000e101";
const DRAFT = "01900000-0000-7000-8000-00000000e177";
const NEW_ENTRY = "01900000-0000-7000-8000-00000000e999";
const NOW = new Date("2026-10-04T16:00:00.000Z");
const TYPES = ["elevator"];

const plan = (rsn: string, address: string, floors: number, neighbourhoodId = "TP", neighbourhoodName = "Thorncliffe Park"): BuildingFloorPlan => ({
  rsn,
  address,
  neighbourhoodId,
  neighbourhoodName,
  floors: ["G", ...Array.from({ length: floors }, (_, index) => String(index + 1))].map((label, index) => ({ id: floorId(rsn, index), label, sortOrder: index })),
});
const PLANS: BuildingFloorPlan[] = [plan("4154146", "4 Milepost Pl", 6), plan("4154159", "85-95 Thorncliffe Park Dr", 12), plan("4154763", "5 Dufresne Crt", 4, "FP", "Flemingdon Park")];

const AUDIENCE = {
  scope: "buildings" as const,
  buildings: [{ rsn: "4154146", floors: [floorId("4154146", 1), floorId("4154146", 2), floorId("4154146", 3), floorId("4154146", 4), floorId("4154146", 5), floorId("4154146", 6)] }],
  groups: ["seniors" as const],
  types: TYPES,
};

const published = (id: string, kind: ThreadEntrySummary["kind"], minutes: number, text: string, over: Partial<ThreadEntrySummary> = {}): ThreadEntrySummary => ({
  id,
  kind,
  status: "approved",
  webPublishedAt: new Date(Date.UTC(2026, 9, 4, 14, minutes, 0)),
  phase: "problem",
  validUntil: new Date("2026-10-05T14:00:00.000Z"),
  validUntilMode: "resolved",
  audience: AUDIENCE,
  types: TYPES,
  text,
  version: 1,
  ...over,
});

const ACK_TEXT = "The elevator at 4 Milepost Pl is not working on floors 1 to 6. We are finding out why. More information to come.";
const UPDATE_TEXT = "Toronto Hydro is on site. The elevator may be back after 11 pm.";

const ENTRIES = [published(FIRST, "update", 40, UPDATE_TEXT, { phase: "in_progress" }), published(ACK, "ack", 5, ACK_TEXT)];
const THREAD: ThreadSummary = {
  thread: { id: ALERT, slug: "abcd2345", isDrill: false, reportedAt: new Date("2026-10-04T13:30:00.000Z"), status: "open" },
  entries: ENTRIES,
  covering: ENTRIES[0],
  validUntil: ENTRIES[0].validUntil,
  ackOnly: false,
};

/** What a correction starts from: the entry that covers the thread (alerting's `updateStart`, which a browser test does not import: it pulls in the server). */
const startOf = (thread: ThreadSummary): UpdateStart => ({ audience: thread.covering!.audience, types: thread.covering!.types, validUntilMode: thread.covering!.validUntilMode, validUntil: thread.covering!.validUntil });

const correctStart = (): ComposerScreen =>
  replaceStartScreen({ mode: "correct", alertId: ALERT, entryId: NEW_ENTRY, thread: THREAD, targets: ENTRIES, target: ENTRIES[1], start: startOf(THREAD), plans: PLANS });
const withdrawStart = (): ComposerScreen =>
  replaceStartScreen({ mode: "withdraw", alertId: ALERT, entryId: NEW_ENTRY, thread: THREAD, targets: ENTRIES, target: ENTRIES[1], start: null, plans: PLANS });

function draftState(kind: "correction" | "withdrawal"): EntryState {
  return {
    thread: THREAD.thread,
    entry: {
      id: DRAFT,
      alertId: ALERT,
      kind,
      status: "draft",
      authorId: "01900000-0000-7000-8000-0000000000c1",
      editorIds: [],
      content: {
        text: kind === "correction" ? "The elevator at 4 Milepost Pl is not working on floors 1 to 6 and the lobby. We are finding out why." : "This alert had wrong information. It has been withdrawn.",
        types: TYPES,
        audience: AUDIENCE,
        phase: "problem",
        validUntil: new Date("2026-10-05T16:00:00.000Z"),
        validUntilMode: "resolved",
      },
      version: 0,
      contentHash: null,
      submittedAt: null,
      returnedFor: null,
      returnedNote: null,
      approvedBy: null,
      approvedAt: null,
      webPublishedAt: null,
      possibleDuplicateOf: null,
      supersedesId: ACK,
      withdrawalReason: kind === "withdrawal" ? "wrong_information" : null,
    } as EntryState["entry"],
    attempt: null,
    translations: [],
    priorKinds: ["ack", "update"],
  };
}
const SMS = { body: "Thorncliffe Flemingdon Hub: This alert had wrong information. It has been withdrawn.\nhttps://cvh.example/a/abcd2345\nFor an emergency, call 911.", encoding: "gsm7" as const, segments: 2 };
const withdrawDraft = (): ComposerScreen =>
  composerScreen({ mode: "withdraw", state: draftState("withdrawal"), plans: PLANS, preview: { sms: SMS, nineOneOneFirst: false }, saved: true, now: NOW, thread: THREAD, target: { kind: "ack", publishedAt: ENTRIES[1].webPublishedAt, text: ACK_TEXT } });

/** The viewport is as tall as the page, so the picture shows all of it, with the sticky actions at its end. */
async function fitToPage(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width, height });
}

async function openComposer(page: Page, width: number, screen: ComposerScreen) {
  await page.setViewportSize({ width, height: 800 });
  await mount(page, "ComposerFixture", { texts: REAL_TEXTS, brand, screen });
  await fitToPage(page, width);
}

const REPLACED = {
  id: ACK,
  kind: "ack" as const,
  status: "approved" as const,
  text: ACK_TEXT,
  phase: "problem" as const,
  publishedAt: ENTRIES[1].webPublishedAt,
  valid: true,
  audience: reviewOf().entry.content.audience,
};

async function openApproval(page: Page, width: number, options: Parameters<typeof reviewOf>[0]) {
  await page.setViewportSize({ width, height: 800 });
  await mount(page, "ApprovalFixture", { texts: REAL_TEXTS, brand, screen: approvalScreen({ review: reviewOf(options), plans: [...REVIEW_PLANS, PLANS[2]], pricePerSegmentCents: 1.5, viewerId: APPROVER }) });
  await fitToPage(page, width);
}

for (const width of [390, 1280]) {
  test(`Correct, the entry chosen, at ${width}px`, async ({ page }) => {
    await openComposer(page, width, correctStart());
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Correct an alert");
    await expect(page.getByTestId("target")).toHaveCount(2);
    await expect(page.getByTestId("replaces-text")).toContainText("not working on floors 1 to 6");
    await expect(page.locator('input[name="phase"]:checked')).toHaveCount(1);
    await expectBaseline(page, `correct-start-${width}.png`);
  });

  test(`Withdraw, the entry chosen and the reason to choose, at ${width}px`, async ({ page }) => {
    await openComposer(page, width, withdrawStart());
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Withdraw an alert");
    await expect(page.locator('input[name="reason"]')).toHaveCount(4);
    await expect(page.locator('input[name="reason"]:checked')).toHaveCount(0);
    await expectBaseline(page, `withdraw-start-${width}.png`);
  });

  test(`a withdrawal's draft, at ${width}px`, async ({ page }) => {
    await openComposer(page, width, withdrawDraft());
    await expect(page.getByTestId("replaces")).toBeVisible();
    await expect(page.locator('input[name="valid-mode"]')).toHaveCount(0);
    await expectBaseline(page, `withdraw-draft-${width}.png`);
  });

  test(`the approval of a correction, at ${width}px`, async ({ page }) => {
    await openApproval(page, width, { entry: { kind: "correction", supersedesId: ACK }, target: REPLACED });
    await expect(page.getByTestId("replaces-reach")).toContainText("everyone who got the original");
    await expectBaseline(page, `correct-approval-${width}.png`);
  });

  test(`the approval of a withdrawal that closes the alert, at ${width}px`, async ({ page }) => {
    await openApproval(page, width, { entry: { kind: "withdrawal", supersedesId: ACK, withdrawalReason: "duplicate" }, target: REPLACED, closesThread: true });
    await expect(page.getByTestId("replaces-reason")).toContainText("Reason: Duplicate of another alert");
    await expect(page.getByTestId("replaces-closes")).toContainText("closes the alert as withdrawn");
    await expectBaseline(page, `withdraw-approval-${width}.png`);
  });
}
