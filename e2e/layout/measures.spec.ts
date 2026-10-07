import { expect, test, type Page } from "@playwright/test";
import type { Text } from "../../src/app/staff/measures/view";
import { checkHubShellBoundaries, expectNoHorizontalOverflow, hubPage, type HubLanguage } from "../helpers/hub-layout-boundaries";
import { REAL_TEXTS, hubBrand, longestTexts } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { sampleView, shellTextsFor, type MeasuresSample } from "../helpers/measures-sample";
import { longestLabels } from "../helpers/strings";

// S07.10: the Hub's pilot measures page (subscribers, how far corrections reached, cost per alert), at viewports of 699 and 700 px (the shell's breakpoint) and at content
// widths of 799 and 800 px (viewports of 1087 and 1088 px with the side navigation), in `en` and `ur` with the longest translated labels of the language in every place the page
// shows text, for a Director (cost of each alert included), a Coordinator (no cost: AD-4), and before the daily count has run or anything is texted. Nothing overflows horizontally,
// and the page is read-only: it has no control of its own (its one link is the export's procedure, S09.05). The checks are the shared boundary helpers of S01.16, run on the app's own body inside the real Hub shell.
const brand = hubBrand();

/** Every text of the page replaced by one of the language's longest labels (its longest sentences, words and one unbreakable token). */
function longestText(lang: string): Text {
  const { sentences, words, unbreakable } = longestLabels(lang);
  const pool = [...sentences, ...words, unbreakable, ...sentences.map((sentence) => `${sentence} ${sentence}`)];
  return (key) => pool[[...key].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 9973, 7) % pool.length];
}

type Words = "longest" | "real";
const SAMPLES: [string, MeasuresSample][] = [
  ["a Director's page with the cost of each alert", "director"],
  ["a Coordinator's page, without cost", "coordinator"],
  ["the page before the daily count has run", "not-run"],
  ["the page with nothing texted yet", "nothing"],
];

const open = (page: Page, sample: MeasuresSample, lang: HubLanguage, words: Words = "longest") => {
  const role = sample === "coordinator" ? "coordinator" : "director";
  return mount(
    page,
    "MeasuresFixture",
    {
      texts: shellTextsFor(words === "longest" ? longestTexts(lang) : REAL_TEXTS, role, { realWords: words === "real" }),
      brand,
      view: words === "longest" ? sampleView(sample, longestText(lang)) : sampleView(sample),
      role,
    },
    { lang },
  );
};

for (const [name, sample] of SAMPLES) {
  test.describe(name, () => {
    test("keeps the shell's breakpoint at viewports of 699 and 700 px, in en and ur with the longest labels, with no horizontal overflow", async ({ page }) => {
      await checkHubShellBoundaries(page, { open: (lang) => open(page, sample, lang) });
    });

    test("has no horizontal overflow at content widths of 799 and 800 px (viewports of 1087 and 1088 px), and the page has no control of its own", async ({ page }) => {
      for (const lang of ["en", "ur"] as const) {
        for (const width of [1087, 1088]) {
          await page.setViewportSize({ width, height: 900 });
          await open(page, sample, lang);
          await expectNoHorizontalOverflow(page, hubPage(page));
          // The export help disclosure is read-only; no data-changing control belongs on this page.
          await expect(page.locator("main a[href]:not([data-testid=procedure-link]), main button, main input, main select, main textarea")).toHaveCount(0);
          await expect(page.locator("main [data-testid=procedure-link]")).toHaveAttribute("data-procedure", "export-measures");
        }
      }
    });
  });
}

test.describe("who sees the cost of an alert (AD-4)", () => {
  test("a Director's page has the cost section, with drills apart, and a Coordinator's has none", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, "director", "en", "real");
    await expect(page.getByTestId("measures-cost")).toBeVisible();
    await expect(page.getByTestId("measures-cost-real")).toBeVisible();
    await expect(page.getByTestId("measures-cost-drills")).toBeVisible();
    await expect(page.getByTestId("measures-cohere")).toBeVisible();
    await open(page, "coordinator", "en", "real");
    await expect(page.getByTestId("measures-subscribers")).toBeVisible();
    await expect(page.getByTestId("measures-reach")).toBeVisible();
    await expect(page.getByTestId("measures-cost")).toHaveCount(0);
    await expect(page.getByText("Cost per alert")).toHaveCount(0);
  });

  test("a count the rule hides reads 'Fewer than 5' and never a number", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await open(page, "director", "en", "real");
    await expect(page.getByTestId("measure-receiving_active")).toContainText("Fewer than 5");
    await expect(page.getByTestId("measures-reach-real")).toContainText("Confirmed: Fewer than 5");
    await expect(page.getByTestId("measures-reach-drills")).toContainText("Got the original: Fewer than 5");
    await expect(page.getByTestId("measures-cost-real")).toContainText("No amount: it would give away a small number of texts");
    // A figure hidden only to protect another is not "Fewer than 5": it reads "Not shown".
    await expect(page.getByTestId("measure-receiving_active")).toContainText("Not shown");
    await expect(page.getByTestId("measures-cost-real")).toContainText("Number of texts not shown");
  });
});
