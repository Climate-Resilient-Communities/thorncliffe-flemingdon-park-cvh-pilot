import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

// Staff sign-in end to end (S01.07) against the production build (`npm run build` first), with the
// identity fake instead of Supabase Auth and a disposable database given as STAFF_TEST_DATABASE_URL
// (scripts/e2e/staff-server.mjs). PLAYWRIGHT_CHROMIUM_EXECUTABLE points at a local Chromium when the
// one Playwright expects is not installed; `playwright install` is never needed for a local run.
const port = process.env.E2E_STAFF_PORT ?? "3107";
const localUrl = `http://localhost:${port}`;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

// The fake's state file, shared by the server and the tests (which seed logins into it).
process.env.CVH_FAKE_IDENTITY_FILE ??= path.join(tmpdir(), `cvh-staff-e2e-identity-${port}.json`);
// Where the server keeps the directory release files instead of the private Supabase bucket (S02.05).
process.env.CVH_FAKE_DIRECTORY_DIR ??= path.join(tmpdir(), `cvh-staff-e2e-directory-${port}`);
// The password pepper the server and the tests share: random per run, never a real one.
process.env.STAFF_PASSWORD_PEPPER ??= randomBytes(32).toString("hex");

export default defineConfig({
  testDir: "./e2e/staff",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: localUrl,
    browserName: "chromium",
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  webServer: {
    command: "node scripts/e2e/staff-server.mjs",
    url: `${localUrl}/api/health`,
    env: {
      E2E_STAFF_PORT: port,
      CVH_FAKE_IDENTITY_FILE: process.env.CVH_FAKE_IDENTITY_FILE,
      CVH_FAKE_DIRECTORY_DIR: process.env.CVH_FAKE_DIRECTORY_DIR,
      STAFF_PASSWORD_PEPPER: process.env.STAFF_PASSWORD_PEPPER,
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
