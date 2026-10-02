import { test, type Page } from "@playwright/test";
import { buildingView, listView, savedNotice } from "../../src/app/staff/buildings/view";
import type { BuildingDetail, BuildingSummary } from "../../src/modules/places";
import { REAL_TEXTS, hubBrand } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { expectBaseline } from "./helpers";

// S01.13: the Admin's buildings screen inside the Hub shell, at 390 and 1280 px: the list, a building's floors with the
// notice after a saved change, and the forms after a refusal (a label that is too long, a floor with ambassadors, a
// label already used). The views are built by the app's own view functions from sample buildings, the screen is the app's
// own BuildingsBody with actions that do nothing. The behaviour is asserted in e2e/staff/buildings.spec.ts and in
// src/app/staff/buildings/BuildingsBody.test.tsx; these pictures show what it looks like. The staff screens are English
// in the pilot (their page is <html lang="en">), so there is no ur picture of this screen.
const brand = hubBrand();

const summary = (change: Partial<BuildingSummary>): BuildingSummary => ({
  rsn: "4154146",
  address: "4 Milepost Pl",
  neighbourhoodId: "TP",
  neighbourhoodName: "Thorncliffe Park",
  storeys: 6,
  floorCount: 6,
  confirmedAt: null,
  notInRegisterSince: null,
  ...change,
});

const LIST: BuildingSummary[] = [
  summary({}),
  summary({ rsn: "4154159", address: "85-95 Thorncliffe Park Dr", storeys: 43, floorCount: 42, confirmedAt: new Date("2026-10-06T15:00:00Z") }),
  summary({ rsn: "4154169", address: "26 Thorncliffe Park Dr", notInRegisterSince: new Date("2027-01-04T15:00:00Z") }),
  summary({ rsn: "4154763", address: "5 Dufresne Crt", neighbourhoodId: "FP", neighbourhoodName: "Flemingdon Park", storeys: 28, floorCount: 28 }),
  summary({ rsn: "4244530", address: "35 St Dennis Dr", neighbourhoodId: "FP", neighbourhoodName: "Flemingdon Park", storeys: null, floorCount: 0 }),
];

const FLOOR_IDS = Array.from({ length: 8 }, (_, index) => `01900000-0000-7000-8000-00000000010${index}`);
const DETAIL: BuildingDetail = {
  ...summary({ storeys: 7, floorCount: 8 }),
  facts: { elevators: 2, emergencyPower: true, coolingRoom: false, airConditioning: null, barrierFreeEntrance: true, updatedAt: new Date("2026-10-05T12:00:00Z") },
  floors: ["G", "1", "2", "3", "4", "5", "6", "7"].map((label, index) => ({ id: FLOOR_IDS[index], label, confirmed: false })),
};

async function open(page: Page, width: number, props: Omit<Parameters<typeof mount<"BuildingsFixture">>[2], "texts" | "brand">, height = 1100) {
  await page.setViewportSize({ width, height });
  await mount(page, "BuildingsFixture", { texts: REAL_TEXTS, brand, ...props });
}

for (const width of [390, 1280]) {
  test(`buildings list at ${width}px`, async ({ page }) => {
    await open(page, width, { screen: listView(LIST) });
    await expectBaseline(page, `buildings-list-${width}.png`);
  });

  test(`a building's floors at ${width}px, after a saved change`, async ({ page }) => {
    await open(page, width, { screen: buildingView(DETAIL, savedNotice({ done: "renamed", from: "3", to: "3A" })) }, width === 390 ? 1900 : 1500);
    await expectBaseline(page, `buildings-floors-${width}.png`);
  });
}

test("a building after refusals at 390px: a label too long, a floor with ambassadors, a label already used", async ({ page }) => {
  await open(
    page,
    390,
    {
      screen: buildingView(DETAIL),
      initial: {
        rename: { [FLOOR_IDS[2]]: { status: "refused", message: "A label can have at most 8 characters.", label: "Second floor" } },
        remove: {
          [FLOOR_IDS[4]]: {
            status: "refused",
            message: "Reassign or remove the ambassadors on this floor first",
            detail: "Ambassadors on this floor: Nia Mensah, Omar Farouk",
          },
        },
        add: {
          status: "refused",
          message: "This building already has a floor with that label. Labels count as the same when they differ only by capital letters or spaces.",
          label: "g",
          place: "bottom",
        },
      },
    },
    2300,
  );
  await expectBaseline(page, "buildings-refused-390.png");
});

test("a confirmed building at 1280px", async ({ page }) => {
  await open(page, 1280, { screen: buildingView({ ...DETAIL, confirmedAt: new Date("2026-10-06T15:00:00Z"), floors: DETAIL.floors.map((floor) => ({ ...floor, confirmed: true })) }) }, 1400);
  await expectBaseline(page, "buildings-confirmed-1280.png");
});
