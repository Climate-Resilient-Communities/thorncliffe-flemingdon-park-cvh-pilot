import { defineConfig } from "@playwright/test";

// Screenshot baselines of the Hub shell (S01.09): the layout fixture (e2e/layout/fixtures.tsx) rendered with the app's
// compiled stylesheet and loaded with page.setContent, so no server runs and nothing is added to the app. The
// behaviour tests of the shell are in e2e/layout (npm run test:layout); these only compare pictures.
// PLAYWRIGHT_CHROMIUM_EXECUTABLE points at a local Chromium when the one Playwright expects is not installed.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: "./e2e/hub",
  // One baseline per language, width and state, stored beside the spec and committed.
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      // Baselines are made and compared only inside the pinned image (scripts/hub-docker.sh): the same Chromium on the
      // same Ubuntu, so text is rasterised identically. Outside it the comparison is skipped (helpers.ts).
      // The tolerances are the resident suite's: 0.2 of colour distance per pixel, and at most 100 pixels that differ.
      threshold: 0.2,
      maxDiffPixels: 100,
    },
  },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    browserName: "chromium",
    launchOptions: executablePath ? { executablePath } : undefined,
  },
});
