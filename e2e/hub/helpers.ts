import { expect, test, type Page } from "@playwright/test";

/**
 * True only inside the pinned Playwright image (scripts/hub-docker.sh sets it). Baseline screenshots are made and
 * compared in that one operating system, because text is rasterised by the OS and differs elsewhere.
 */
export const IN_PINNED_IMAGE = process.env.HUB_PINNED_IMAGE === "1";

/**
 * Compares the page with its committed baseline in the pinned image. Elsewhere only this comparison is skipped,
 * with a note on the test; every other assertion of the test still runs. `fullPage` photographs the whole scrolling page.
 * The comparison is soft (expect.soft): a mismatch still fails the test, and so the Browser job, but the test goes on
 * to its later screenshots, so one CI run writes every -actual and -diff image (docs/config.md, "Screenshot baselines").
 */
export async function expectBaseline(page: Page, name: string, options: { fullPage?: boolean } = {}) {
  if (!IN_PINNED_IMAGE) {
    test.info().annotations.push({
      type: "screenshot skipped",
      description: `${name} is compared only inside the pinned image: npm run test:hub:docker`,
    });
    return;
  }
  await expect.soft(page).toHaveScreenshot(name, options);
}
