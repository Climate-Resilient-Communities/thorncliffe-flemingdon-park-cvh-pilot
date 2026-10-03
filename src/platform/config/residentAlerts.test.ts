// The launch gate of E04 (S04.08): production runs with RESIDENT_ALERTS_ENABLED off, so the feed returns no threads and no
// alert page opens there, until E05's corrections and closing are released. This is the configuration test the story asks
// for ("a test checks the production configuration keeps it off until E05 is released"): it reads the production
// configuration every way the repository can say it (the environment schema's defaults and refusals, the document of
// record, docs/config.md, and the deploy files) and fails if any of them turns the gate on.
//
// WHEN E05 IS RELEASED (its last story): flip RESIDENT_ALERTS_RELEASED in env.ts, set the variable to `true` in
// production's Vercel variables through a production deploy, record it in the launch-readiness checklist, and change the
// expectations marked "E05" below to expect it on. Until then nothing here may.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnvError, RESIDENT_ALERTS_RELEASED, getEnv, parseEnv, resetEnvCache } from "./env";
import { PRODUCTION_HOST } from "./hosts";

const supabase = {
  DATABASE_URL: "postgres://cvh_app_login.abcdefghijklmnopqrst:pw@aws-0-ca-central-1.pooler.supabase.com:6543/postgres",
  SUPABASE_SECRET_KEY: "secret",
  NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable",
};
const production = { VERCEL_ENV: "production", SMS_MODE: "live", PUBLIC_BASE_URL: `https://${PRODUCTION_HOST}`, ...supabase };
const preview = { VERCEL_ENV: "preview", SMS_MODE: "log", PUBLIC_BASE_URL: "https://cvh-pilot-git-feature-x.vercel.app", ...supabase };
const local = { SMS_MODE: "log", PUBLIC_BASE_URL: "http://localhost:3000" };

const problemsOf = (source: Record<string, string | undefined>): string[] => {
  try {
    parseEnv(source);
  } catch (error) {
    expect(error).toBeInstanceOf(EnvError);
    return (error as EnvError).problems;
  }
  throw new Error("expected parseEnv to throw");
};

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("production keeps resident alerts off until E05 is released", () => {
  it("has not released the alerts (E05: this is the expectation to change)", () => {
    expect(RESIDENT_ALERTS_RELEASED).toBe(false);
  });

  it("is off when RESIDENT_ALERTS_ENABLED is not set, or is false", () => {
    expect(parseEnv(production).residentAlertsEnabled).toBe(false);
    expect(parseEnv({ ...production, RESIDENT_ALERTS_ENABLED: "" }).residentAlertsEnabled).toBe(false);
    expect(parseEnv({ ...production, RESIDENT_ALERTS_ENABLED: "false" }).residentAlertsEnabled).toBe(false);
    expect(parseEnv({ ...production, RESIDENT_ALERTS_ENABLED: " FALSE " }).residentAlertsEnabled).toBe(false);
  });

  it.each(["true", "TRUE", " true ", "True"])("refuses to start with RESIDENT_ALERTS_ENABLED=%j (E05: this is the expectation to change)", (value) => {
    const problems = problemsOf({ ...production, RESIDENT_ALERTS_ENABLED: value });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^RESIDENT_ALERTS_ENABLED: must not be "true" in production until E05/);
  });

  it("is off in the environment the app reads at run time, through getEnv, whatever else Vercel sets", () => {
    for (const [name, value] of Object.entries({ ...production, RESIDENT_ALERTS_ENABLED: undefined })) vi.stubEnv(name, value);
    resetEnvCache();

    expect(getEnv().residentAlertsEnabled).toBe(false);
  });

  it("is off in the production setting document of record (docs/config.md), which names the gate and its value", () => {
    const row = read("docs/config.md")
      .split("\n")
      .find((line) => line.startsWith("| `RESIDENT_ALERTS_ENABLED`"));

    expect(row, "docs/config.md lists RESIDENT_ALERTS_ENABLED among production's variables").toBeDefined();
    // E05: change `false` to `true` here in the deploy that releases the alerts, with the launch-readiness entry.
    expect(row).toMatch(/^\| `RESIDENT_ALERTS_ENABLED` \| no \| `false` /);
  });

  it("is not turned on by a deploy file: neither the workflow nor vercel.json nor next.config.ts sets it", () => {
    for (const file of [".github/workflows/ci.yml", "vercel.json", "next.config.ts"]) {
      expect(read(file), file).not.toMatch(/RESIDENT_ALERTS_ENABLED/);
    }
  });
});

describe("everywhere else the alerts are on unless switched off", () => {
  it.each([
    ["a preview", preview],
    ["local development", local],
  ])("%s: on by default, on with true, off with false", (_name, base) => {
    expect(parseEnv(base).residentAlertsEnabled).toBe(true);
    expect(parseEnv({ ...base, RESIDENT_ALERTS_ENABLED: "true" }).residentAlertsEnabled).toBe(true);
    expect(parseEnv({ ...base, RESIDENT_ALERTS_ENABLED: "false" }).residentAlertsEnabled).toBe(false);
  });
});

describe("a value that is neither true nor false", () => {
  it.each([
    ["production", production],
    ["a preview", preview],
    ["local development", local],
  ])("refuses to start in %s (a typo must not switch the gate)", (_name, base) => {
    for (const value of ["yes", "1", "ture", "on", "0"]) {
      expect(problemsOf({ ...base, RESIDENT_ALERTS_ENABLED: value })[0], value).toMatch(/^RESIDENT_ALERTS_ENABLED: must be "true" or "false"/);
    }
  });
});

describe("CVH_FAKE_FEED_FILE", () => {
  it("is read in local development", () => {
    expect(parseEnv({ ...local, CVH_FAKE_FEED_FILE: "/tmp/feed.json" }).fakeFeedFile).toBe("/tmp/feed.json");
  });

  it.each([
    ["production", production],
    ["a preview", preview],
    ["a local run that says it is on Vercel", { ...local, VERCEL: "1", VERCEL_ENV: "development" }],
  ])("is refused in %s: a fake alert never reaches a resident", (_name, base) => {
    expect(problemsOf({ ...base, CVH_FAKE_FEED_FILE: "/tmp/feed.json" })).toContain(
      "CVH_FAKE_FEED_FILE: the feed fake is only allowed in local development, never on Vercel",
    );
  });
});
