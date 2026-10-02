import { expect, test, type Page } from "@playwright/test";
import type { Audience } from "../../src/contracts/audience";
import { groupsScreen, placeScreen, type Text } from "../../src/app/staff/alerts/audience/view";
import type { BuildingFloorPlan } from "../../src/modules/places";
import { checkHubShellBoundaries, checkHubTwoColumnBoundaries, expectNoHorizontalOverflow, hubPage, type HubLanguage } from "../helpers/hub-layout-boundaries";
import { REAL_TEXTS, hubBrand, longestTexts } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { longestLabels } from "../helpers/strings";

// S04.04: the audience pages (O-03 the place and O-04 the groups) at content widths of 799 and 800 px (viewports of 1087 and
// 1088 px with the side navigation) and at viewports of 699 and 700 px, in `en` and `ur` with the longest translated labels
// of the language in every place the pages show text. Below 800 px of content width the page is one column, the main content
// first and the aside filling the width; from 800 px it is two columns with the page's approved gap (--gap-columns-hub);
// and nothing overflows horizontally. The checks are the shared boundary helpers of S01.16 (e2e/helpers/hub-layout-boundaries.ts),
// run on the app's own AudienceBody inside the real Hub shell.
const brand = hubBrand();

const floorId = (rsn: string, index: number) => `01900000-0000-7000-8000-${rsn.padStart(8, "0")}${String(index).padStart(4, "0")}`;

/** Buildings with many floors, one whose address is a single unbreakable word (the longest word of the language, repeated). */
function plansFor(lang: string): BuildingFloorPlan[] {
  const plan = (rsn: string, address: string, floors: number, nb: "TP" | "FP"): BuildingFloorPlan => ({
    rsn,
    address,
    neighbourhoodId: nb,
    neighbourhoodName: nb === "TP" ? "Thorncliffe Park" : "Flemingdon Park",
    floors: ["G", ...Array.from({ length: floors }, (_, index) => String(index + 1))].map((label, index) => ({ id: floorId(rsn, index), label, sortOrder: index })),
  });
  return [
    plan("4154146", "4 Milepost Pl", 12, "TP"),
    plan("4154159", longestLabels(lang).unbreakable, 9, "TP"),
    plan("4154169", "26 Thorncliffe Park Dr", 8, "TP"),
    plan("4154763", longestLabels(lang).sentences[0], 4, "FP"),
    plan("4244530", "35 St Dennis Dr", 0, "FP"),
  ];
}

/** The audience the pages show: some floors of two buildings, and two groups, so the aside has every line. */
function audienceFor(plans: BuildingFloorPlan[]): Audience {
  return {
    scope: "buildings",
    buildings: [
      { rsn: "4154146", floors: [floorId("4154146", 3), floorId("4154146", 4), floorId("4154146", 5)] },
      { rsn: "4154159", floors: null },
    ],
    groups: ["families", "seniors"],
    types: ["power"],
  };
}

/** Every text of the pages replaced by one of the language's longest labels (its longest sentences, words and one unbreakable token). */
function longestText(lang: string): Text {
  const { sentences, words, unbreakable } = longestLabels(lang);
  const pool = [...sentences, ...words, unbreakable, ...sentences.map((sentence) => `${sentence} ${sentence}`)];
  return (key) => pool[[...key].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 9973, 7) % pool.length];
}

const REF = { alertId: "01900000-0000-7000-8000-00000000a1e7", entryId: "01900000-0000-7000-8000-00000000e177" };

const PAGES = [
  { name: "O-03 the place", screen: (lang: string) => placeScreen(plansFor(lang), audienceFor(plansFor(lang)), REF, { text: longestText(lang), notice: longestText(lang)("saved.place") }) },
  { name: "O-04 the groups", screen: (lang: string) => groupsScreen(plansFor(lang), audienceFor(plansFor(lang)), REF, { text: longestText(lang), notice: longestText(lang)("saved.groups") }) },
] as const;

type Props = Parameters<typeof mount<"AudienceFixture">>[2];

const open = (page: Page, which: (typeof PAGES)[number], lang: HubLanguage) =>
  mount(page, "AudienceFixture", { texts: longestTexts(lang), brand, screen: which.screen(lang) } satisfies Props, { lang });

for (const which of PAGES) {
  test.describe(which.name, () => {
    test("is one column below 800 px of content width and two from 800 px, in en and ur with the longest labels, with no horizontal overflow", async ({ page }) => {
      await checkHubTwoColumnBoundaries(page, { open: (lang) => open(page, which, lang) });
    });

    test("keeps the shell's breakpoint at viewports of 699 and 700 px, in en and ur, with no horizontal overflow", async ({ page }) => {
      await checkHubShellBoundaries(page, { open: (lang) => open(page, which, lang) });
    });

    test("reads the main content first and the aside after it, in en and ur", async ({ page }) => {
      for (const lang of ["en", "ur"] as const) {
        await page.setViewportSize({ width: 390, height: 844 });
        await open(page, which, lang);
        const grid = hubPage(page).locator(".layout-grid[data-two-column]");
        await expect(grid.locator(":scope > *")).toHaveCount(2);
        await expect(grid.locator(":scope > *").nth(1)).toHaveAttribute("data-testid", "audience-aside");
        await expect(grid.locator(":scope > *").nth(0).locator("form")).toHaveCount(1);
        await expectNoHorizontalOverflow(page, hubPage(page), grid);
      }
    });
  });
}

test("the same pages with the real English words fit the phone and the desktop", async ({ page }) => {
  for (const which of PAGES) {
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await mount(page, "AudienceFixture", { texts: REAL_TEXTS, brand, screen: which.screen("en") });
      await expectNoHorizontalOverflow(page, hubPage(page), hubPage(page).locator(".layout-grid[data-two-column]"));
    }
  }
});
