import { expect, test } from "@playwright/test";
import { BUILDINGS, FLOOR, seedChoices, stubBuildingList } from "./choices-fixture";
import { expectBaseline, openResident } from "./helpers";

// S02.03: baselines of the four screens in English and Urdu (right-to-left) at a phone and a desktop width, taken in the
// pinned image only (scripts/resident-docker.sh). The tall phone viewport shows the whole screen without scrolling.

const SIZES = [
  { width: 390, height: 1500 },
  { width: 1280, height: 1000 },
] as const;

const SAVED = {
  v: 1,
  welcomed: true,
  groups: ["seniors", "families"],
  buildings: [BUILDINGS[0].rsn, BUILDINGS[3].rsn],
  floors: [FLOOR.milepost2, FLOOR.milepost3, FLOOR.overlea1],
};

for (const lang of ["en", "ur"]) {
  for (const { width, height } of SIZES) {
    test.describe(`${lang} at ${width}px`, () => {
      test.use({ storageState: { cookies: [], origins: [] } });

      test("R-01 choose your language", async ({ page }) => {
        await openResident(page, `/${lang}/welcome`, width, height);
        await expectBaseline(page, `choices-language-${lang}-${width}.png`);
      });

      test("R-26 which groups", async ({ page }) => {
        await seedChoices(page, JSON.stringify({ v: 1, lang, groups: ["seniors", "newcomers"] }));
        await openResident(page, `/${lang}/welcome/groups`, width, height);
        await expect(page.getByTestId("group-seniors").locator("input")).toBeChecked();
        await expectBaseline(page, `choices-groups-${lang}-${width}.png`);
      });

      test("R-35 where I live, with buildings and floors chosen", async ({ page }) => {
        await stubBuildingList(page);
        await seedChoices(page, JSON.stringify({ v: 1, lang, buildings: SAVED.buildings, floors: SAVED.floors }));
        await openResident(page, `/${lang}/welcome/place`, width, height);
        await expect(page.getByTestId(`floor-${FLOOR.milepost2}`)).toBeChecked();
        await expectBaseline(page, `choices-place-${lang}-${width}.png`);
      });

      test("R-34 what I have told the CVH, with a removed building noted", async ({ page }) => {
        await stubBuildingList(page);
        await seedChoices(page, JSON.stringify({ ...SAVED, lang, buildings: [...SAVED.buildings, "999999999"] }));
        await openResident(page, `/${lang}/choices`, width, height);
        await expect(page.getByTestId("removed-note")).toBeVisible();
        await expect(page.getByTestId(`told-floor-${FLOOR.milepost2}`)).toBeVisible();
        await expectBaseline(page, `choices-mine-${lang}-${width}.png`);
      });
    });
  }
}
