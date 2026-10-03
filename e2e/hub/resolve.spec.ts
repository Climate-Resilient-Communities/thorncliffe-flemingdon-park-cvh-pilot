import { expect, test, type Page } from "@playwright/test";
import { approvalScreen } from "../../src/app/staff/alerts/approval/view";
import { composerScreen, startScreen, type ComposerScreen } from "../../src/app/staff/alerts/composer/view";
import { incidentsView } from "../../src/app/staff/alerts/incidents/view";
import type { ClosedThread, EntryState, RunningThread, ThreadEntrySummary, ThreadSummary, UpdateStart } from "../../src/modules/alerting";
import { APPROVER, PLANS as REVIEW_PLANS, floorId, reviewOf } from "../../test/helpers/approvalReview";
import type { BuildingFloorPlan } from "../../src/modules/places";
import { REAL_TEXTS, hubBrand } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { expectBaseline } from "./helpers";

// S05.03: "Mark resolved" (O-16) and its approval inside the Hub shell, at 390 and 1280 px: the start of the final message (the running alert above the form, what happens
// when you resolve, who it is for carried over), a final's draft, the approval of a final (it closes the alert; it goes to everyone who got any entry), the confirmation of
// an approved final, and the Hub home with what closed lately. The views are built by the app's own view functions; the screens are the app's own ComposerBody,
// ApprovalBody and IncidentsList with actions that do nothing. The behaviour is asserted in src/app/staff/alerts/**/*.test.ts, test/db/alertClose.db.test.ts and
// e2e/staff/resolve.spec.ts; the boundaries of the layout are in e2e/layout/resolve.spec.ts and incidents.spec.ts; these pictures show what it looks like. The staff
// screens are English in the pilot.
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
const FINAL_TEXT = "The elevator at 4 Milepost Pl is back in service on all floors. If it stops again, call the Hub.";

const ENTRIES = [published(FIRST, "update", 40, UPDATE_TEXT, { phase: "in_progress" }), published(ACK, "ack", 5, ACK_TEXT)];
const THREAD: ThreadSummary = {
  thread: { id: ALERT, slug: "abcd2345", isDrill: false, reportedAt: new Date("2026-10-04T13:30:00.000Z"), status: "open" },
  entries: ENTRIES,
  covering: ENTRIES[0],
  validUntil: ENTRIES[0].validUntil,
  ackOnly: false,
};

/** What a final starts from: the entry that covers the thread (alerting's `updateStart`, which a browser test does not import: it pulls in the server). */
const startOf = (thread: ThreadSummary): UpdateStart => ({ audience: thread.covering!.audience, types: thread.covering!.types, validUntilMode: thread.covering!.validUntilMode, validUntil: thread.covering!.validUntil });

const resolveStart = (): ComposerScreen => startScreen({ mode: "resolve", alertId: ALERT, entryId: NEW_ENTRY, thread: THREAD, start: startOf(THREAD), plans: PLANS });

function draftState(): EntryState {
  return {
    thread: THREAD.thread,
    entry: {
      id: DRAFT,
      alertId: ALERT,
      kind: "final",
      status: "draft",
      authorId: "01900000-0000-7000-8000-0000000000c1",
      editorIds: [],
      content: { text: FINAL_TEXT, types: TYPES, audience: AUDIENCE, phase: "in_progress", validUntil: new Date("2026-10-05T16:00:00.000Z"), validUntilMode: "resolved" },
      version: 0,
      contentHash: null,
      submittedAt: null,
      returnedFor: null,
      returnedNote: null,
      approvedBy: null,
      approvedAt: null,
      webPublishedAt: null,
      possibleDuplicateOf: null,
      supersedesId: null,
      withdrawalReason: null,
    } as EntryState["entry"],
    attempt: null,
    translations: [],
    priorKinds: ["ack", "update"],
  };
}
const SMS = { body: `Thorncliffe Flemingdon Hub: ${FINAL_TEXT}\nhttps://cvh.example/a/abcd2345\nFor an emergency, call 911.`, encoding: "gsm7" as const, segments: 2 };
const resolveDraft = (): ComposerScreen => composerScreen({ mode: "resolve", state: draftState(), plans: PLANS, preview: { sms: SMS, nineOneOneFirst: false }, saved: true, now: NOW, thread: THREAD });

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

async function openApproval(page: Page, width: number, options: Parameters<typeof reviewOf>[0]) {
  await page.setViewportSize({ width, height: 800 });
  await mount(page, "ApprovalFixture", { texts: REAL_TEXTS, brand, screen: approvalScreen({ review: reviewOf(options), plans: [...REVIEW_PLANS, PLANS[2]], pricePerSegmentCents: 1.5, viewerId: APPROVER }) });
  await fitToPage(page, width);
}

for (const width of [390, 1280]) {
  test(`Mark resolved, the start of the final message, at ${width}px`, async ({ page }) => {
    await openComposer(page, width, resolveStart());
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mark resolved");
    await expect(page.locator('input[name="phase"]')).toHaveCount(0);
    await expect(page.locator('input[name="valid-mode"]')).toHaveCount(0);
    await expect(page.getByTestId("after-resolve").locator("li")).toHaveCount(3);
    await expectBaseline(page, `resolve-start-${width}.png`);
  });

  test(`a final's draft, at ${width}px`, async ({ page }) => {
    await openComposer(page, width, resolveDraft());
    await expect(page.getByTestId("composer-text")).toHaveValue(FINAL_TEXT);
    await expect(page.getByTestId("submit-button")).toBeVisible();
    await expectBaseline(page, `resolve-draft-${width}.png`);
  });

  test(`the approval of a final, which closes the alert, at ${width}px`, async ({ page }) => {
    await openApproval(page, width, { entry: { kind: "final", content: { ...reviewOf().entry.content, text: FINAL_TEXT } }, closesThread: true });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Approve a final message");
    await expect(page.getByTestId("closing-reach")).toContainText("everyone who got any entry of this alert, on the channels they got it on");
    await expect(page.getByTestId("closing-closes")).toContainText("closes the alert as resolved");
    await expectBaseline(page, `resolve-approval-${width}.png`);
  });

  test(`the confirmation of an approved final, at ${width}px`, async ({ page }) => {
    await openApproval(page, width, { entry: { kind: "final", status: "approved", content: { ...reviewOf().entry.content, text: FINAL_TEXT } }, thread: { status: "closed" } });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("The alert is resolved");
    await expectBaseline(page, `resolve-published-${width}.png`);
  });
}

const RUNNING: RunningThread[] = [
  { alertId: "01900000-0000-7000-8000-00000000a1e9", slug: "wxyz2345", isDrill: false, reportedAt: new Date("2026-10-04T13:50:00.000Z"), types: ["water", "power"], phase: "problem", validUntil: new Date("2026-10-05T15:20:00.000Z"), publishedAt: new Date("2026-10-04T15:20:00.000Z"), coveringKind: "ack", ackOnly: true, entries: 1 },
];
const CLOSED: ClosedThread[] = [
  { alertId: ALERT, slug: "abcd2345", isDrill: false, types: ["elevator"], reason: "resolved", closedAt: new Date("2026-10-04T15:30:00.000Z"), closingText: FINAL_TEXT },
  { alertId: "01900000-0000-7000-8000-00000000a1f1", slug: "efgh2345", isDrill: false, types: ["power"], reason: "expired", closedAt: new Date("2026-10-04T09:00:00.000Z"), closingText: null },
  { alertId: "01900000-0000-7000-8000-00000000a1f2", slug: "jkmn2345", isDrill: false, types: ["flood"], reason: "withdrawn", closedAt: new Date("2026-10-03T12:00:00.000Z"), closingText: "This alert had wrong information. It has been withdrawn." },
];

for (const width of [390, 1280]) {
  test(`the Hub home with what closed lately, at ${width}px`, async ({ page }) => {
    const view = incidentsView({ waiting: [], mine: [] }, "coordinator", undefined, RUNNING, new Date("2026-10-04T16:00:00.000Z"), CLOSED);
    await page.setViewportSize({ width, height: 800 });
    await mount(page, "IncidentsFixture", { texts: REAL_TEXTS, brand, view });
    await fitToPage(page, width);
    await expect(page.getByTestId("closed-item")).toHaveCount(3);
    await expect(page.getByTestId("incidents-closed").locator("a[href]")).toHaveCount(0);
    await expect(page.getByTestId("incidents-running").getByRole("link", { name: "Mark resolved" })).toHaveCount(1);
    await expectBaseline(page, `incidents-closed-${width}.png`);
  });
}
