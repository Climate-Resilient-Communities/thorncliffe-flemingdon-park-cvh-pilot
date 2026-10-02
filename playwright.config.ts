import { defineConfig } from "@playwright/test";

const deployedUrl = process.env.SMOKE_BASE_URL;
const localUrl = "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: { baseURL: deployedUrl ?? localUrl },
  // Without SMOKE_BASE_URL, check the local production build (run `npm run build` first).
  webServer: deployedUrl
    ? undefined
    : {
        command: "npm run start",
        url: localUrl,
        reuseExistingServer: !process.env.CI,
      },
});
