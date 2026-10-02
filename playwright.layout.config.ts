import { defineConfig } from "@playwright/test";

// Layout tests for the primitives in src/ui/layout: rendered to static HTML and loaded with
// page.setContent, so no server runs and nothing is added to the app. PLAYWRIGHT_CHROMIUM_EXECUTABLE
// points at a local Chromium when the one Playwright expects is not installed.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: "./e2e/layout",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    browserName: "chromium",
    launchOptions: executablePath ? { executablePath } : undefined,
  },
});
