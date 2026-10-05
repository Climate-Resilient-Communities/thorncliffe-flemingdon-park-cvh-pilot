import { expect, test, type Page } from "@playwright/test";
import { REAL_TEXTS, hubBrand } from "../helpers/hub-shell";
import { mount } from "../helpers/layout-fixture";
import { sampleView, type MeasuresSample } from "../helpers/measures-sample";
import { expectBaseline } from "./helpers";

// S07.10: the Hub's pilot measures page in the Hub shell, in en: a Director's page (subscribers by measure, how far corrections, withdrawals and finals reached with a drill kept
// apart, cost per alert with the Cohere share), a Coordinator's page without the cost (AD-4), the page before the daily count has run, and the page with nothing texted yet. The
// page's real body renders with the view model the server would build from the same sample. The behaviour is asserted in src/app/staff/measures; these pictures show what it looks like.
const brand = hubBrand();
const HEIGHT = 844;

const STATES: Record<string, MeasuresSample> = {
  director: "director",
  coordinator: "coordinator",
  "not-run": "not-run",
  nothing: "nothing",
};

async function open(page: Page, sample: MeasuresSample, width: number) {
  await page.setViewportSize({ width, height: HEIGHT });
  await mount(page, "MeasuresFixture", { texts: REAL_TEXTS, brand, view: sampleView(sample), role: sample === "coordinator" ? "coordinator" : "director" }, { lang: "en" });
}

for (const [state, sample] of Object.entries(STATES)) {
  for (const width of [390, 1280]) {
    test(`pilot measures ${state} at ${width}px`, async ({ page }) => {
      await open(page, sample, width);

      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pilot measures");
      const root = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
      if (sample === "not-run") await expect(page.getByTestId("measures-subscribers-lead")).toContainText("has not run yet");
      else await expect(page.getByTestId("measure-receiving_active")).toContainText("All:");
      if (sample === "coordinator") await expect(page.getByTestId("measures-cost")).toHaveCount(0);
      else await expect(page.getByTestId("measures-cost")).toBeVisible();
      if (sample === "nothing") await expect(page.getByTestId("measures-reach-empty")).toBeVisible();
      else await expect(page.getByTestId("measures-reach-drills")).toBeVisible();

      await expectBaseline(page, `measures-en-${state}-${width}.png`, { fullPage: true });
    });
  }
}
