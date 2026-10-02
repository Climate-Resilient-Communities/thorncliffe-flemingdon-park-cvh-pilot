import type { Page, Route } from "@playwright/test";

// A small building list for the first-run tests (S02.03). The resident server has no database in these tests, so
// /api/buildings is answered here with the shape of BuildingListSchema. The rsn values are long and distinctive so
// that the network test can look for them in every request.

export const FLOOR = {
  milepost1: "0198a000-0000-7000-8000-0000000000a1",
  milepost2: "0198a000-0000-7000-8000-0000000000a2",
  milepost3: "0198a000-0000-7000-8000-0000000000a3",
  drG: "0198a000-0000-7000-8000-0000000000b1",
  dr1: "0198a000-0000-7000-8000-0000000000b2",
  overlea1: "0198a000-0000-7000-8000-0000000000c1",
  gone: "0198a000-0000-7000-8000-0000000000ff",
} as const;

export const BUILDINGS = [
  {
    rsn: "700000041",
    address: "4 Milepost Pl",
    neighbourhoodId: "TP",
    neighbourhood: "Thorncliffe Park",
    floors: [
      { id: FLOOR.milepost1, label: "1" },
      { id: FLOOR.milepost2, label: "2" },
      { id: FLOOR.milepost3, label: "3" },
    ],
  },
  {
    rsn: "700000085",
    address: "85 Thorncliffe Park Dr",
    neighbourhoodId: "TP",
    neighbourhood: "Thorncliffe Park",
    floors: [
      { id: FLOOR.drG, label: "G" },
      { id: FLOOR.dr1, label: "1" },
    ],
  },
  { rsn: "700000099", address: "99 Empty Floors Ave", neighbourhoodId: "TP", neighbourhood: "Thorncliffe Park", floors: [] },
  {
    rsn: "700000010",
    address: "10 Overlea Blvd",
    neighbourhoodId: "FP",
    neighbourhood: "Flemingdon Park",
    floors: [{ id: FLOOR.overlea1, label: "1" }],
  },
];

export const BUILDING_LIST = { v: 1, buildings: BUILDINGS };

/** Answers /api/buildings with the list above, or with a failure. */
export async function stubBuildingList(page: Page, answer: "list" | "unavailable" = "list") {
  await page.route("**/api/buildings", (route: Route) =>
    answer === "list"
      ? route.fulfill({ json: BUILDING_LIST, headers: { "Cache-Control": "no-store" } })
      : route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
}

/** Puts `cvh.choices` in the phone before the first page loads, once: later pages keep what the resident did since. */
export async function seedChoices(page: Page, raw: string) {
  await page.addInitScript(
    ([key, value]) => {
      if (sessionStorage.getItem("test-seeded")) return;
      sessionStorage.setItem("test-seeded", "1");
      localStorage.setItem(key, value);
    },
    ["cvh.choices", raw],
  );
}

export const savedChoices = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("cvh.choices") ?? "null"));
