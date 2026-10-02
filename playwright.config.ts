import { defineConfig } from "@playwright/test";

const deployedUrl = process.env.SMOKE_BASE_URL;
const localUrl = "http://localhost:3000";
// Protected Vercel previews accept requests that carry the automation bypass secret.
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: deployedUrl ?? localUrl,
    extraHTTPHeaders: bypassSecret ? { "x-vercel-protection-bypass": bypassSecret } : undefined,
  },
  // Without SMOKE_BASE_URL, check the local production build (run `npm run build` first).
  webServer: deployedUrl
    ? undefined
    : {
        command: "npm run start",
        url: localUrl,
        reuseExistingServer: !process.env.CI,
      },
});
