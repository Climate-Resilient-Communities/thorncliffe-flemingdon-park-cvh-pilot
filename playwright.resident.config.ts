import path from "node:path";
import { defineConfig } from "@playwright/test";
import { ALERTS_PORT, ALERTS_URL, FEED_FIXTURE } from "./e2e/resident/alerts-server";
import { PUBLIC_ORIGINS } from "./e2e/resident/public-origin";
import { FALLBACK_KEYS, FALLBACK_PORT, FALLBACK_URL } from "./e2e/resident/fallback-server";

// Page tests of the resident surface (/[lang]/…) against the production build: run `npm run build` first.
// PLAYWRIGHT_CHROMIUM_EXECUTABLE points at a local Chromium when the one Playwright expects is not installed.
// E2E_PORT lets a second checkout on the same machine run beside the first; CI uses 3000. A second server on E2E_PORT + 500
// (E2E_ALERTS_PORT) shows the alerts of fixtures/feed.json for the tests of the alert pages (S04.08).
const port = process.env.E2E_PORT ?? "3000";
const localUrl = `http://localhost:${port}`;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
// The server refuses to start without a safe environment (S01.02); a local run is development.
// CVH_FAKE_BUILDINGS_FILE: the building page (S02.08) and the contacts on the numbers page (S02.10) read these sample
// buildings instead of the database. CVH_FAKE_GUIDES_FILE: the guides and numbers pages (S02.10) read these sample rows.
// PUBLIC_BASE_URL is a fixed origin for each server (e2e/resident/public-origin.ts), not the address it listens on: the links the pages build (the share link)
// must not depend on the port, and each server still has an origin of its own, which the feed's cache key needs (src/app/feedCache.ts).
const serverEnv = (publicOrigin: string) => ({
  SMS_MODE: "log",
  PUBLIC_BASE_URL: publicOrigin,
  CVH_FAKE_BUILDINGS_FILE: path.join(__dirname, "e2e", "resident", "fixtures", "buildings.json"),
  CVH_FAKE_GUIDES_FILE: path.join(__dirname, "e2e", "resident", "fixtures", "guides.json"),
});
const welcomed = { name: "cvh.choices", value: JSON.stringify({ v: 1, welcomed: true }) };

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
  // Four workers, not the default of half the cores: the tests wait on the pages and the servers more than they compute, and the longest file
  // (accessibility.spec.ts, parallel by test) now spreads over all of them. The three servers are read-only for every test, so any worker may share them.
  workers: 4,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: localUrl,
    // Every test starts as a returning resident who has been through the first-run steps (S02.03), so a page that
    // sends a first visit to R-01 does not redirect them. A test of the first visit starts empty:
    // test.use({ storageState: { cookies: [], origins: [] } }).
    storageState: { cookies: [], origins: [localUrl, FALLBACK_URL].map((origin) => ({ origin, localStorage: [welcomed] })) },
    browserName: "chromium",
    // The service worker (S02.12) answers a page's requests itself, and page.route cannot see what it answers, so every
    // test runs without it except the offline tests, which allow it (offline.spec.ts: test.use({ serviceWorkers: "allow" })).
    serviceWorkers: "block",
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  webServer: [
    {
      command: `npm run start -- --port ${port}`,
      url: localUrl,
      env: serverEnv(PUBLIC_ORIGINS.main),
      reuseExistingServer: !process.env.CI,
    },
    {
      // The server of the alert tests (S04.08, e2e/resident/alerts-server.ts): the same, with the threads of fixtures/feed.json in the feed and on the
      // alert pages (CVH_FAKE_FEED_FILE), so the pages that show alerts are tested with alerts and every other page with none.
      command: `npm run start -- --port ${ALERTS_PORT}`,
      url: ALERTS_URL,
      env: { ...serverEnv(PUBLIC_ORIGINS.alerts), CVH_FAKE_FEED_FILE: FEED_FIXTURE },
      reuseExistingServer: !process.env.CI,
    },
    // The same build again, with a few catalog keys shown as English fallback in every language but English
    // (e2e/resident/fallback-server.ts): fallback.spec.ts measures the fallback there whatever has been translated.
    {
      command: `npm run start -- --port ${FALLBACK_PORT}`,
      url: FALLBACK_URL,
      env: { ...serverEnv(PUBLIC_ORIGINS.fallback), CVH_FAKE_UNTRANSLATED_KEYS: FALLBACK_KEYS.join(",") },
      reuseExistingServer: !process.env.CI,
    },
  ],
});
