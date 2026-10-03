import { expect, test, type Page } from "@playwright/test";
import { approvalScreen } from "../../src/app/staff/alerts/approval/view";
import { composerScreen, startScreen, type ComposerScreen } from "../../src/app/staff/alerts/composer/view";
import { incidentsView } from "../../src/app/staff/alerts/incidents/view";
import type { EntryState, RunningThread, ThreadEntrySummary, ThreadSummary, UpdateStart } from "../../src/modules/alerting";
import { APPROVER, PLANS as REVIEW_PLANS, floorId, reviewOf } from "../../test/helpers/approvalReview";
import type { BuildingFloorPlan } from "../../src/modules/places";
import { REAL_TEXTS, hubBrand } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { expectBaseline } from "./helpers";

// S05.01: "Promote to full alert" (O-13), "Add an update" (O-14) and their approval inside the Hub shell, at 390 and 1280 px: the start of a promotion (the
// running alert above the form, the audience and types carried over, no phase chosen), an update draft that widens and narrows who it is for ("Now also for"
// and "No longer for" under who it is for), the approval of that update with the same lines above the fold, and the Hub home's running alerts with the
// next step of each. The views are built by the app's own view functions; the screens are the app's own ComposerBody, ApprovalBody and IncidentsList with
// actions that do nothing. The behaviour is asserted in src/app/staff/alerts/**/*.test.ts, test/db/alertUpdate.db.test.ts and e2e/staff/updates.spec.ts;
// the boundaries of the layout are in e2e/layout/update.spec.ts; these pictures show what it looks like. The staff screens are English in the pilot.
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

const THREAD_AUDIENCE = {
  scope: "buildings" as const,
  buildings: [{ rsn: "4154146", floors: [floorId("4154146", 3), floorId("4154146", 4), floorId("4154146", 5)] }, { rsn: "4154159", floors: null }],
  groups: ["seniors" as const],
  types: TYPES,
};
/** A floor added and a building dropped, and a group added: both change lines are on the page. */
const CHANGED_AUDIENCE = {
  scope: "buildings" as const,
  buildings: [{ rsn: "4154146", floors: [floorId("4154146", 3), floorId("4154146", 4), floorId("4154146", 5), floorId("4154146", 6)] }, { rsn: "4154763", floors: null }],
  groups: ["families" as const, "seniors" as const],
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
  audience: THREAD_AUDIENCE,
  types: TYPES,
  text,
  version: 1,
  ...over,
});

const ACK_TEXT = "The elevator at 4 Milepost Pl is not working. We are finding out why. More information to come.";
const UPDATE_TEXT = "Toronto Hydro is on site. The elevator may be back after 11 pm.";

function threadOf(entries: "ack" | "running"): ThreadSummary {
  const list = entries === "ack" ? [published(ACK, "ack", 5, ACK_TEXT)] : [published(FIRST, "update", 40, UPDATE_TEXT, { phase: "in_progress" }), published(ACK, "ack", 5, ACK_TEXT)];
  return {
    thread: { id: ALERT, slug: "abcd2345", isDrill: false, reportedAt: new Date("2026-10-04T13:30:00.000Z"), status: "open" },
    entries: list,
    covering: list[0],
    validUntil: list[0].validUntil,
    ackOnly: entries === "ack",
  };
}

const startOf = (thread: ThreadSummary): UpdateStart => ({ audience: thread.covering!.audience, types: thread.covering!.types, validUntilMode: thread.covering!.validUntilMode, validUntil: thread.covering!.validUntil });

function draftState(audience: typeof THREAD_AUDIENCE | typeof CHANGED_AUDIENCE): EntryState {
  return {
    thread: { id: ALERT, slug: "abcd2345", isDrill: false, reportedAt: new Date("2026-10-04T13:30:00.000Z"), status: "open" },
    entry: {
      id: DRAFT,
      alertId: ALERT,
      kind: "update",
      status: "draft",
      authorId: "01900000-0000-7000-8000-0000000000c1",
      editorIds: [],
      content: { text: UPDATE_TEXT, types: TYPES, audience, phase: "in_progress", validUntil: new Date("2026-10-05T16:00:00.000Z"), validUntilMode: "resolved" },
      version: 0,
      contentHash: null,
      submittedAt: null,
      returnedFor: null,
      returnedNote: null,
      approvedBy: null,
      approvedAt: null,
      webPublishedAt: null,
      possibleDuplicateOf: null,
    } as EntryState["entry"],
    attempt: null,
    translations: [],
    priorKinds: ["ack"],
  };
}

const SMS = { body: `Thorncliffe Flemingdon Hub: ${UPDATE_TEXT}\nhttps://cvh.example/a/abcd2345\nFor an emergency, call 911.`, encoding: "gsm7" as const, segments: 2 };

const promoteStart = (): ComposerScreen => startScreen({ mode: "promote", alertId: ALERT, entryId: NEW_ENTRY, thread: threadOf("ack"), start: startOf(threadOf("ack")), plans: PLANS });
const updateDraft = (): ComposerScreen =>
  composerScreen({ mode: "update", state: draftState(CHANGED_AUDIENCE), plans: PLANS, preview: { sms: SMS, nineOneOneFirst: false }, saved: true, now: NOW, thread: threadOf("running") });

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

for (const width of [390, 1280]) {
  test(`Promote to full alert, the start, at ${width}px`, async ({ page }) => {
    await openComposer(page, width, promoteStart());
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Promote to full alert");
    await expect(page.getByTestId("thread-digest").getByTestId("thread-entry")).toHaveCount(1);
    await expect(page.getByTestId("audience-carried")).toContainText("carried over from the alert");
    await expect(page.locator('input[name="phase"]:checked')).toHaveCount(0);
    await expectBaseline(page, `update-promote-start-${width}.png`);
  });

  test(`an update draft that widens and narrows who it is for, at ${width}px`, async ({ page }) => {
    await openComposer(page, width, updateDraft());
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Add an update");
    await expect(page.getByTestId("thread-digest").getByTestId("thread-entry")).toHaveCount(2);
    await expect(page.getByTestId("audience-also-for")).toContainText("Now also for: ");
    await expect(page.getByTestId("audience-no-longer-for")).toContainText("No longer for: ");
    await expectBaseline(page, `update-draft-${width}.png`);
  });

  test(`the approval of an update that widens and narrows who it is for, at ${width}px`, async ({ page }) => {
    const review = reviewOf({
      entry: { kind: "update", content: { text: UPDATE_TEXT, types: ["elevator", "power"], audience: { scope: "buildings", buildings: [{ rsn: "4154146", floors: [floorId("4154146", 2), floorId("4154146", 3), floorId("4154146", 4)] }, { rsn: "4154159", floors: null }], groups: [], types: ["elevator", "power"] }, phase: "in_progress", validUntil: new Date("2026-10-05T14:00:00.000Z"), validUntilMode: "resolved" } },
      threadAudience: { scope: "buildings", buildings: [{ rsn: "4154146", floors: [floorId("4154146", 2), floorId("4154146", 3)] }, { rsn: "4154763", floors: null }], groups: [], types: ["elevator", "power"] },
    });
    await page.setViewportSize({ width, height: 800 });
    await mount(page, "ApprovalFixture", { texts: REAL_TEXTS, brand, screen: approvalScreen({ review, plans: [...REVIEW_PLANS, PLANS[2]], pricePerSegmentCents: 1.5, viewerId: APPROVER }) });
    await fitToPage(page, width);
    await expect(page.getByTestId("update-note")).toContainText("update to an alert residents are already reading");
    await expect(page.getByTestId("audience-also-for")).toContainText("Now also for: ");
    await expect(page.getByTestId("audience-no-longer-for")).toContainText("No longer for: ");
    await expectBaseline(page, `update-approval-${width}.png`);
  });
}

test("the Hub home's running alerts, each with its next step, at 390px", async ({ page }) => {
  const running: RunningThread[] = [
    { alertId: ALERT, slug: "abcd2345", isDrill: false, reportedAt: new Date("2026-10-04T13:30:00.000Z"), types: ["elevator"], phase: "in_progress", validUntil: new Date("2026-10-05T14:00:00.000Z"), publishedAt: new Date("2026-10-04T14:40:00.000Z"), coveringKind: "update", ackOnly: false, entries: 2 },
    { alertId: "01900000-0000-7000-8000-00000000a1e8", slug: "wxyz2345", isDrill: false, reportedAt: new Date("2026-10-04T15:10:00.000Z"), types: ["water", "power"], phase: "problem", validUntil: new Date("2026-10-05T15:20:00.000Z"), publishedAt: new Date("2026-10-04T15:20:00.000Z"), coveringKind: "ack", ackOnly: true, entries: 1 },
  ];
  const view = incidentsView({ waiting: [], mine: [] }, "coordinator", undefined, running, new Date("2026-10-04T14:12:00.000Z"));
  await page.setViewportSize({ width: 390, height: 800 });
  await mount(page, "IncidentsFixture", { texts: REAL_TEXTS, brand, view });
  await fitToPage(page, 390);
  await expect(page.getByTestId("running-item")).toHaveCount(2);
  await expect(page.getByTestId("incidents-running").getByRole("link", { name: "Promote to full alert" })).toHaveCount(1);
  await expect(page.getByTestId("incidents-running").getByRole("link", { name: "Add an update" })).toHaveCount(1);
  await expectBaseline(page, "update-running-390.png");
});
