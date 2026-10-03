import path from "node:path";
import { defineConfig } from "@playwright/test";
import { ALERTS_PORT, ALERTS_URL, FEED_FIXTURE } from "./e2e/resident/alerts-server";

// Page tests of the resident surface (/[lang]/…) against the production build: run `npm run build` first.
// PLAYWRIGHT_CHROMIUM_EXECUTABLE points at a local Chromium when the one Playwright expects is not installed.
// E2E_PORT lets a second checkout on the same machine run beside the first; CI uses 3000. A second server on E2E_PORT + 500
// (E2E_ALERTS_PORT) shows the alerts of fixtures/feed.json for the tests of the alert pages (S04.08).
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
  webServer: [
    {
      command: `npm run start -- --port ${port}`,
      url: localUrl,
      // The server refuses to start without a safe environment (S01.02); a local run is development.
      // CVH_FAKE_BUILDINGS_FILE: the building page (S02.08) and the contacts on the numbers page (S02.10) read these sample
      // buildings instead of the database. CVH_FAKE_GUIDES_FILE: the guides and numbers pages (S02.10) read these sample rows.
      env: {
        SMS_MODE: "log",
        PUBLIC_BASE_URL: localUrl,
        CVH_FAKE_BUILDINGS_FILE: path.join(__dirname, "e2e", "resident", "fixtures", "buildings.json"),
        CVH_FAKE_GUIDES_FILE: path.join(__dirname, "e2e", "resident", "fixtures", "guides.json"),
      },
      reuseExistingServer: !process.env.CI,
    },
    {
      // The second server (S04.08, e2e/resident/alerts-server.ts): the same, with the threads of fixtures/feed.json in the feed and on the
      // alert pages (CVH_FAKE_FEED_FILE), so the pages that show alerts are tested with alerts and every other page with none.
      command: `npm run start -- --port ${ALERTS_PORT}`,
      url: ALERTS_URL,
      env: {
        SMS_MODE: "log",
        PUBLIC_BASE_URL: ALERTS_URL,
        CVH_FAKE_BUILDINGS_FILE: path.join(__dirname, "e2e", "resident", "fixtures", "buildings.json"),
        CVH_FAKE_GUIDES_FILE: path.join(__dirname, "e2e", "resident", "fixtures", "guides.json"),
        CVH_FAKE_FEED_FILE: FEED_FIXTURE,
      },
      reuseExistingServer: !process.env.CI,
    },
  ],
});
