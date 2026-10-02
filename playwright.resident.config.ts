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
      // Text anti-aliasing differs a little between machines; a moved box or a changed script is far above this.
      maxDiffPixelRatio: 0.02,
    },
  },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: localUrl,
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
