import { expect, test, type Page } from "@playwright/test";
import type { Audience } from "../../src/contracts/audience";
import { groupsScreen, lockedScreen, missingScreen, placeScreen, savedNotice } from "../../src/app/staff/alerts/audience/view";
import type { BuildingFloorPlan } from "../../src/modules/places";
import { REAL_TEXTS, expectShellDoesNotOverflow, hubBrand } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { expectBaseline } from "./helpers";

// S04.04: the audience pages inside the Hub shell, at 390 and 1280 px: the place picker (O-03) with a whole neighbourhood and with
// buildings (whole and chosen floors), the group picker (O-04), a refused form, and a draft that is not there or already
// submitted. The views are built by the app's own view functions from sample buildings, the screen is the app's own
// AudienceBody with actions that do nothing. The behaviour is asserted in src/app/staff/alerts/audience/*.test.ts and
// test/db/alertAudience.db.test.ts; the boundaries of the layout are in e2e/layout/audience.spec.ts; these pictures show
// what it looks like. The staff screens are English in the pilot, so there is no ur picture.
const brand = hubBrand();

const floorId = (rsn: string, index: number) => `01900000-0000-7000-8000-${rsn.padStart(8, "0")}${String(index).padStart(4, "0")}`;

const plan = (rsn: string, address: string, labels: string[], change: Partial<BuildingFloorPlan> = {}): BuildingFloorPlan => ({
  rsn,
  address,
  neighbourhoodId: "TP",
  neighbourhoodName: "Thorncliffe Park",
  floors: labels.map((label, index) => ({ id: floorId(rsn, index), label, sortOrder: index })),
  ...change,
});

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => String(from + index));

const PLANS: BuildingFloorPlan[] = [
  plan("4154146", "4 Milepost Pl", ["G", ...range(1, 6)]),
  plan("4154159", "85-95 Thorncliffe Park Dr", ["G", ...range(1, 12)]),
  plan("4154169", "26 Thorncliffe Park Dr", range(1, 8)),
  plan("4154763", "5 Dufresne Crt", ["G", ...range(1, 4)], { neighbourhoodId: "FP", neighbourhoodName: "Flemingdon Park" }),
  plan("4244530", "35 St Dennis Dr", [], { neighbourhoodId: "FP", neighbourhoodName: "Flemingdon Park" }),
];

const REF = { alertId: "01900000-0000-7000-8000-00000000a1e7", entryId: "01900000-0000-7000-8000-00000000e177" };

const NEIGHBOURHOOD: Audience = { scope: "neighbourhood", neighbourhood_ids: ["TP"], groups: [], types: ["power"] };
/** Floors 4 to 6 of 85-95 Thorncliffe Park Dr (a range, stored as the floors themselves), and the whole of 4 Milepost Pl; two groups. */
const BUILDINGS: Audience = {
  scope: "buildings",
  buildings: [
    { rsn: "4154146", floors: null },
    { rsn: "4154159", floors: [4, 5, 6].map((index) => floorId("4154159", index)).sort() },
  ],
  groups: ["families", "seniors"],
  types: ["power"],
};

async function open(page: Page, width: number, props: Omit<Parameters<typeof mount<"AudienceFixture">>[2], "texts" | "brand">, height = 1100) {
  await page.setViewportSize({ width, height });
  await mount(page, "AudienceFixture", { texts: REAL_TEXTS, brand, ...props });
}

for (const width of [390, 1280]) {
  test(`the place picker with a whole neighbourhood at ${width}px`, async ({ page }) => {
    await open(page, width, { screen: placeScreen(PLANS, NEIGHBOURHOOD, REF) }, width === 390 ? 2500 : 1300);
    await expect(page.getByTestId("audience-sentence")).toHaveText("Everyone living in Thorncliffe Park.");
    await expectBaseline(page, `audience-place-neighbourhood-${width}.png`);
  });

  test(`the place picker with buildings, whole and chosen floors, and groups at ${width}px`, async ({ page }) => {
    const screen = placeScreen(PLANS, BUILDINGS, REF, { notice: savedNotice({ done: "place" }) });
    await open(page, width, { screen }, width === 390 ? 3600 : 1600);
    await expect(page.getByTestId("audience-sentence")).toHaveText("Residents of 4 Milepost Pl (all floors) and 85-95 Thorncliffe Park Dr (floors 4, 5, 6).");
    await expectBaseline(page, `audience-place-buildings-${width}.png`);
  });

  test(`the group picker at ${width}px`, async ({ page }) => {
    await open(page, width, { screen: groupsScreen(PLANS, BUILDINGS, REF, { notice: savedNotice({ done: "groups" }) }) }, width === 390 ? 1900 : 1100);
    await expect(page.getByTestId("audience-web-note")).toHaveText("Groups narrow who is texted. Everyone who opens the web app can still see the alert.");
    await expectBaseline(page, `audience-groups-${width}.png`);
  });
}

test("the place picker after a refusal at 390px", async ({ page }) => {
  await open(
    page,
    390,
    { screen: placeScreen(PLANS, BUILDINGS, REF), initial: { place: { status: "refused", message: "A range goes from a higher floor to a lower one. Put the lower floor first." } } },
    4600,
  );
  await expect(page.locator("p.hub-error")).toHaveText("A range goes from a higher floor to a lower one. Put the lower floor first.");
  await expectBaseline(page, "audience-place-refused-390.png");
});

test("the group picker after a refusal at 390px", async ({ page }) => {
  await open(
    page,
    390,
    { screen: groupsScreen(PLANS, NEIGHBOURHOOD, REF), initial: { groups: { status: "refused", message: "One of those groups does not exist. Reload the page." } } },
    1900,
  );
  await expectBaseline(page, "audience-groups-refused-390.png");
});

test("a draft that is not there, and one already submitted, at 390px", async ({ page }) => {
  await open(page, 390, { screen: missingScreen() }, 700);
  await expect(page.getByTestId("screen")).toContainText("That alert draft was not found.");
  await expectBaseline(page, "audience-missing-390.png");

  await open(page, 390, { screen: lockedScreen(PLANS, BUILDINGS) }, 1100);
  await expect(page.getByTestId("screen").locator("form, button")).toHaveCount(0);
  await expectBaseline(page, "audience-locked-390.png");
});

test("fits the phone without scrolling sideways, with every building of the register listed", async ({ page }) => {
  const forty3 = Array.from({ length: 43 }, (_, index) => plan(String(4154000 + index), `${index + 1} Test Dr`, ["G", ...range(1, 4 + (index % 9))], index % 2 ? { neighbourhoodId: "FP", neighbourhoodName: "Flemingdon Park" } : {}));
  await open(page, 390, { screen: placeScreen(forty3, NEIGHBOURHOOD, REF) }, 900);
  await expect(page.locator("li[data-testid^='building-']")).toHaveCount(43);
  await expectShellDoesNotOverflow(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
