#!/usr/bin/env node
// Starts the production build for the staff end-to-end tests (playwright.staff.config.ts): migrates
// the disposable database given as STAFF_TEST_DATABASE_URL (as its owner), gives the app's role
// cvh_app_login a fresh random password, then runs `next start` connected as cvh_app_login with
// the identity fake (CVH_FAKE_IDENTITY_FILE) instead of Supabase Auth and the translation fake (CVH_FAKE_TRANSLATOR=sample)
// instead of the model. Nothing here reaches a real
// Supabase project, and the environment check refuses the fake anywhere but local runs.
//
// Never point STAFF_TEST_DATABASE_URL at a real database: the tests write accounts into it.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { migrate } from "../db/migrate.mjs";

const ownerUrl = process.env.STAFF_TEST_DATABASE_URL;
const port = process.env.E2E_STAFF_PORT ?? "3107";
const fakeFile = process.env.CVH_FAKE_IDENTITY_FILE;
if (!ownerUrl || !fakeFile || !process.env.STAFF_PASSWORD_PEPPER) {
  console.error("staff-server: STAFF_TEST_DATABASE_URL (a disposable database, as its owner), CVH_FAKE_IDENTITY_FILE and STAFF_PASSWORD_PEPPER are required");
  process.exit(2);
}

const sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
const password = randomBytes(18).toString("hex");
try {
  await migrate({ sql });
  await sql.unsafe(`alter role cvh_app_login password '${password}'`);
} finally {
  await sql.end({ timeout: 5 });
}

const appUrl = new URL(ownerUrl);
appUrl.username = "cvh_app_login";
appUrl.password = password;

const server = spawn("npx", ["next", "start", "--port", port], {
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: appUrl.href,
    CVH_FAKE_IDENTITY_FILE: fakeFile,
    SMS_MODE: "log",
    // A press of Submit translates with the sample fake (S04.05): no model is called and nothing leaves this machine.
    CVH_FAKE_TRANSLATOR: "sample",
    PUBLIC_BASE_URL: `http://localhost:${port}`,
  },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
server.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
