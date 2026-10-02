import { defineConfig } from "@playwright/test";

// Page tests of the resident surface (/[lang]/…) against the production build: run `npm run build` first.
// PLAYWRIGHT_CHROMIUM_EXECUTABLE points at a local Chromium when the one Playwright expects is not installed.
// E2E_PORT lets a second checkout on the same machine run beside the first; CI uses 3000.
const port = process.env.E2E_PORT ?? "3000";
const localUrl = `http://localhost:${port}`;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: "./e2e/resident",
  // Baseline screenshots (S02.02): one per language and width, stored beside the specs and committed.
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      // Baselines are made and compared only inside the pinned image (scripts/resident-docker.sh): the same Chromium
      // on the same Ubuntu, so text is rasterised identically. Outside it the comparison is skipped (helpers.ts).
      // `threshold` is the colour distance (0 to 1) at which one pixel counts as different, so the soft edge pixels
      // that anti-aliasing varies by a shade do not; `maxDiffPixels` then allows only 100 pixels that really differ.
      // A text line that moved by a pixel, a changed alignment or a gap is thousands of pixels.
      threshold: 0.2,
      maxDiffPixels: 100,
    },
  },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: localUrl,
    // Every test starts as a returning resident who has been through the first-run steps (S02.03), so a page that
    // sends a first visit to R-01 does not redirect them. A test of the first visit starts empty:
    // test.use({ storageState: { cookies: [], origins: [] } }).
    storageState: { cookies: [], origins: [{ origin: localUrl, localStorage: [{ name: "cvh.choices", value: JSON.stringify({ v: 1, welcomed: true }) }] }] },
    browserName: "chromium",
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  webServer: {
    command: `npm run start -- --port ${port}`,
    url: localUrl,
    // The server refuses to start without a safe environment (S01.02); a local run is development.
    env: { SMS_MODE: "log", PUBLIC_BASE_URL: localUrl },
    reuseExistingServer: !process.env.CI,
  },
});
