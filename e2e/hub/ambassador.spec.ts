import { test, type Page } from "@playwright/test";
import { ambassadorHomeView, type AmbassadorHomeData } from "../../src/app/staff/ambassador/view";
import { REAL_TEXTS, hubBrand } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { expectBaseline } from "./helpers";

// S08.01: the Ambassador's home (A-01) inside the Hub shell at 390 px, the width it is made for, and at 1280 px: with two buildings, open alerts, their own posts
// in every kind of state and an open round; with nothing active, nothing posted and no round; and with no assignment. The view is the app's own
// (src/app/staff/ambassador/view.ts) and the screen its own AmbassadorHomeBody. The behaviour is asserted in src/app/staff/ambassador/ambassadorHome.test.tsx,
// test/db/ambassadorHome.db.test.ts and e2e/layout/ambassador.spec.ts; these pictures show what it looks like. The staff screens are English in the pilot.
const brand = hubBrand();
const ALERT = "01900000-0000-7000-8000-00000000a1e7";

const FULL: AmbassadorHomeData = {
  buildings: [
    { rsn: "4154146", address: "4 Milepost Pl", floorLabels: ["G", "1", "2", "3", "4", "5"] },
    { rsn: "4154159", address: "85-95 Thorncliffe Park Dr", floorLabels: null },
  ],
  alerts: [
    {
      alertId: ALERT,
      slug: "abcd2345",
      types: ["power", "elevator"],
      headline: "Power is out in 4 Milepost Pl. Crews are on site. The elevators are down too.",
      verified: false,
      publishedAt: new Date("2026-10-04T14:00:00.000Z"),
      validUntil: new Date("2026-10-05T14:00:00.000Z"),
      buildings: ["4154146"],
    },
    {
      alertId: "01900000-0000-7000-8000-00000000a1e8",
      slug: "wxyz2345",
      types: ["heat"],
      headline: "Heat warning for Thorncliffe Park. Cooling spaces are open until 9 pm.",
      verified: true,
      publishedAt: new Date("2026-10-04T12:30:00.000Z"),
      validUntil: new Date("2026-10-05T01:00:00.000Z"),
      buildings: ["4154146", "4154159"],
    },
  ],
  posts: (["live", "waiting", "returned", "verified", "declined", "withdrawn"] as const).map((state, index) => ({
    entryId: `01900000-0000-7000-8000-00000000e17${index}`,
    alertId: ALERT,
    types: ["water"],
    text: "No water on floors 3 to 5 since this morning.",
    state,
    note: state === "returned" ? "Which floors is it on? Say the building too." : null,
    postedAt: new Date(Date.UTC(2026, 9, 4, 15 - index, 0, 0)),
    buildings: ["4154146"],
  })),
  round: { requests: 12 },
};

const open = (page: Page, data: AmbassadorHomeData, width: number) =>
  page.setViewportSize({ width, height: 844 }).then(() => mount(page, "AmbassadorHomeFixture", { texts: REAL_TEXTS, brand, view: ambassadorHomeView(data) }));

for (const width of [390, 1280]) {
  test(`A-01 with alerts, posts and an open round at ${width}px`, async ({ page }) => {
    await open(page, FULL, width);
    await expectBaseline(page, `ambassador-home-${width}.png`, { fullPage: true });
  });
}

test("A-01 with nothing active, nothing posted and no round at 390px", async ({ page }) => {
  await open(page, { ...FULL, alerts: [], posts: [], round: null }, 390);
  await expectBaseline(page, "ambassador-home-empty-390.png", { fullPage: true });
});

test("A-01 with no assignment at 390px", async ({ page }) => {
  await open(page, { buildings: [], alerts: [], posts: [], round: null }, 390);
  await expectBaseline(page, "ambassador-home-unassigned-390.png", { fullPage: true });
});
