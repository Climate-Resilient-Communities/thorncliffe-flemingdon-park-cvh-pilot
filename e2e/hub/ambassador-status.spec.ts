import { test, type Page } from "@playwright/test";
import type { FollowInitial } from "../../src/app/staff/ambassador/status/FollowForms";
import { resolveScreen, type ResolveScreen, type StatusScreen } from "../../src/app/staff/ambassador/status/view";
import { ALERT, COUNTS, screenOf } from "../helpers/ambassador-status";
import { REAL_TEXTS, hubBrand } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { expectBaseline } from "./helpers";

// S08.04: where an ambassador's post stands (A-03) inside the Hub shell at 390 px, the width it is made for, and at 1280 px: live and not yet verified with the
// forms to correct, withdraw and resolve; waiting for the Hub; approved with the progress of its texts; returned with the Hub's note; withdrawn and corrected with
// what residents read instead; a correction waiting for the Hub; a correction form open with its problems shown; a request held without signal; and the request
// sent. And "Mark resolved" for an alert about their building. The views are the app's own (src/app/staff/ambassador/status/view.ts) and the screens its own
// StatusBody and ResolveBody. The behaviour is asserted in status.test.tsx, followRequest.test.ts, test/db/ambassadorFollow.db.test.ts and
// e2e/staff/ambassador-follow.spec.ts; these pictures show what it looks like. The staff screens are English in the pilot.
const brand = hubBrand();
const CAN = { replace: true, resolve: true } as const;

const openStatus = (page: Page, screen: StatusScreen, width: number, followInitial?: FollowInitial) =>
  page.setViewportSize({ width, height: 844 }).then(() => mount(page, "AmbassadorStatusFixture", { texts: REAL_TEXTS, brand, screen, followInitial }));
const openResolve = (page: Page, screen: ResolveScreen, width: number, followInitial?: FollowInitial) =>
  page.setViewportSize({ width, height: 844 }).then(() => mount(page, "AmbassadorResolveFixture", { texts: REAL_TEXTS, brand, screen, followInitial }));

for (const width of [390, 1280]) {
  test(`A-03 a live post, not yet verified, with what the person can do about it at ${width}px`, async ({ page }) => {
    await openStatus(page, screenOf("live", { can: CAN }), width);
    await expectBaseline(page, `ambassador-status-live-${width}.png`, { fullPage: true });
  });
}

test("A-03 a post waiting for the Hub at 390px", async ({ page }) => {
  await openStatus(page, screenOf("waiting", { types: ["fire"] }), 390);
  await expectBaseline(page, "ambassador-status-waiting-390.png", { fullPage: true });
});

test("A-03 an approved post with the progress of its texts at 390px", async ({ page }) => {
  await openStatus(page, screenOf("approved", { approvedAt: new Date("2026-10-04T19:00:00.000Z") }, { counts: COUNTS }), 390);
  await expectBaseline(page, "ambassador-status-approved-390.png", { fullPage: true });
});

test("A-03 a post returned to the person with the Hub's note at 390px", async ({ page }) => {
  await openStatus(page, screenOf("returned", { note: "Which floors is it on? Say the building too." }), 390);
  await expectBaseline(page, "ambassador-status-returned-390.png", { fullPage: true });
});

test("A-03 a withdrawn post, with the notice residents read in its place, at 390px", async ({ page }) => {
  const replacedWith = { entryId: ALERT, kind: "withdrawal" as const, text: "This alert named the wrong place. It has been withdrawn.", at: new Date("2026-10-04T19:10:00.000Z") };
  await openStatus(page, screenOf("withdrawn", { replacedWith, threadOpen: false }), 390);
  await expectBaseline(page, "ambassador-status-withdrawn-390.png", { fullPage: true });
});

test("A-03 a corrected post, with the correction residents read, at 390px", async ({ page }) => {
  const replacedWith = { entryId: ALERT, kind: "correction" as const, text: "No water on floors 3 and 4. The elevator is working again.", at: new Date("2026-10-04T19:10:00.000Z") };
  await openStatus(page, screenOf("corrected", { replacedWith }), 390);
  await expectBaseline(page, "ambassador-status-corrected-390.png", { fullPage: true });
});

test("A-03 a live post with a correction waiting for the Hub at 390px", async ({ page }) => {
  const waitingReplacement = { entryId: ALERT, kind: "correction" as const, text: "No water on floors 3 and 4.", at: new Date("2026-10-04T19:10:00.000Z") };
  await openStatus(page, screenOf("live", { waitingReplacement, can: { replace: false, resolve: true } }), 390);
  await expectBaseline(page, "ambassador-status-waiting-correction-390.png", { fullPage: true });
});

test("A-03 the correction form open, with its problems shown, at 390px", async ({ page }) => {
  await openStatus(page, screenOf("live", { can: CAN }), 390, { open: "correct", text: "", problems: ["text", "valid"] });
  await expectBaseline(page, "ambassador-status-correct-390.png", { fullPage: true });
});

test("A-03 the withdrawal form open, with its reason missing, at 390px", async ({ page }) => {
  await openStatus(page, screenOf("live", { can: CAN }), 390, { open: "withdraw", problems: ["reason"] });
  await expectBaseline(page, "ambassador-status-withdraw-390.png", { fullPage: true });
});

test("A-03 a request held in the page without signal at 390px", async ({ page }) => {
  await openStatus(page, screenOf("live", { can: CAN }), 390, { open: "resolve", text: "The water is back on every floor.", state: { kind: "unsent" }, action: "resolve" });
  await expectBaseline(page, "ambassador-status-unsent-390.png", { fullPage: true });
});

test("A-03 the request sent to the Hub at 390px", async ({ page }) => {
  await openStatus(page, screenOf("live", { can: CAN }), 390, { state: { kind: "done", live: true }, action: "correct" });
  await expectBaseline(page, "ambassador-status-sent-390.png", { fullPage: true });
});

for (const width of [390, 1280]) {
  test(`Mark resolved for an alert about their building at ${width}px`, async ({ page }) => {
    await openResolve(page, resolveScreen({ alertId: ALERT, headline: "Power is out in 4 Milepost Pl. Crews are on site.", waitingFinal: false, entryId: "01900000-0000-7000-8000-00000000c003" }), width);
    await expectBaseline(page, `ambassador-resolve-${width}.png`, { fullPage: true });
  });
}

test("Mark resolved with a final message already waiting for the Hub at 390px", async ({ page }) => {
  await openResolve(page, resolveScreen({ alertId: ALERT, headline: "Power is out in 4 Milepost Pl.", waitingFinal: true, entryId: "01900000-0000-7000-8000-00000000c003" }), 390);
  await expectBaseline(page, "ambassador-resolve-waiting-390.png", { fullPage: true });
});
