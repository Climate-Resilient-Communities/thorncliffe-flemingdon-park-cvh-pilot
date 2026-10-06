import { test, type Page } from "@playwright/test";
import type { RoundState } from "../../src/app/staff/ambassador/round/roundModel";
import { roundScreen } from "../../src/app/staff/ambassador/round/view";
import type { StaffRole } from "../../src/contracts/staffRoles";
import { COUNTS_ONLY, REF_A, REF_C, ROUND } from "../helpers/ambassador-round";
import { REAL_TEXTS, hubBrand } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { expectBaseline } from "./helpers";

// S08.07: "My round" (A-04) inside the Hub shell at 390 px, the width it is made for, and at 1280 px: an Ambassador's round with requests on the floors they
// cover (a call and a text, unmarked and marked) and a floor they see as counts only; marks waiting without signal ("Keep this page open until marks are
// sent"); what late marks are told ("The Hub has been told", "This round has ended" with the Hub's number); the round cleared after 10 minutes in the
// background ("Reload your round with signal"); no round open; and the counts a Coordinator or a Director sees. The screen is the app's own (RoundPage.tsx,
// view.ts) drawn in each state once: nothing is read or sent. The behaviour is asserted in roundModel.test.ts, roundPage.test.tsx,
// test/db/roundPage.db.test.ts and e2e/staff/ambassador-round.spec.ts; these pictures show what it looks like. The staff screens are English in the pilot.
const brand = hubBrand();

const open = (page: Page, initial: Partial<RoundState>, width = 390, role: StaffRole = "ambassador") =>
  page.setViewportSize({ width, height: 844 }).then(() => mount(page, "AmbassadorRoundFixture", { texts: REAL_TEXTS, brand, screen: roundScreen(role), initial }));

for (const width of [390, 1280]) {
  test(`A-04 an Ambassador's round at ${width}px`, async ({ page }) => {
    await open(page, { phase: "ready", round: ROUND }, width);
    await expectBaseline(page, `ambassador-round-${width}.png`, { fullPage: true });
  });
}

test("A-04 marks waiting without signal at 390px", async ({ page }) => {
  await open(page, {
    phase: "ready",
    round: ROUND,
    online: false,
    waiting: [
      { id: "0f0e0d0c-0b0a-4908-8706-000000000001", roundRef: REF_A, status: "not_reached" },
      { id: "0f0e0d0c-0b0a-4908-8706-000000000002", roundRef: REF_C, status: "done" },
    ],
  });
  await expectBaseline(page, "ambassador-round-offline-390.png", { fullPage: true });
});

test("A-04 what late marks are told at 390px", async ({ page }) => {
  await open(page, { phase: "ready", round: ROUND, notes: { [REF_A]: "hub_told", [REF_C]: "round_ended" } });
  await expectBaseline(page, "ambassador-round-late-390.png", { fullPage: true });
});

test("A-04 cleared after 10 minutes in the background at 390px", async ({ page }) => {
  await open(page, { phase: "cleared" });
  await expectBaseline(page, "ambassador-round-cleared-390.png", { fullPage: true });
});

test("A-04 no round right now at 390px", async ({ page }) => {
  await open(page, { phase: "ready", round: { rounds: [] } });
  await expectBaseline(page, "ambassador-round-none-390.png", { fullPage: true });
});

test("A-04 counts only, as a Coordinator sees them, at 390px", async ({ page }) => {
  await open(page, { phase: "ready", round: COUNTS_ONLY }, 390, "coordinator");
  await expectBaseline(page, "ambassador-round-counts-390.png", { fullPage: true });
});
