// The launch gate of E04 (S04.08), as released by E05: the code lock (RESIDENT_ALERTS_RELEASED) is open, so production
// starts with RESIDENT_ALERTS_ENABLED=true and turns the gate on. The default stays off (unset or "false"), so the switch is
// only the Vercel variable, set by an Admin with a production redeploy and recorded in the launch-readiness checklist.
// No deploy file may set it. A value that is neither true nor false still fails start-up.
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

describe("production, with the alerts released by E05", () => {
  it("has released the alerts (the code lock is open)", () => {
    expect(RESIDENT_ALERTS_RELEASED).toBe(true);
  });

  it("is off by default: RESIDENT_ALERTS_ENABLED unset, empty or false (the owner turns it on in Vercel)", () => {
    expect(parseEnv(production).residentAlertsEnabled).toBe(false);
    expect(parseEnv({ ...production, RESIDENT_ALERTS_ENABLED: "" }).residentAlertsEnabled).toBe(false);
    expect(parseEnv({ ...production, RESIDENT_ALERTS_ENABLED: "false" }).residentAlertsEnabled).toBe(false);
    expect(parseEnv({ ...production, RESIDENT_ALERTS_ENABLED: " FALSE " }).residentAlertsEnabled).toBe(false);
  });

  it.each(["true", "TRUE", " true ", "True"])("starts with RESIDENT_ALERTS_ENABLED=%j and turns the gate on", (value) => {
    expect(parseEnv({ ...production, RESIDENT_ALERTS_ENABLED: value }).residentAlertsEnabled).toBe(true);
  });

  it("reads the setting at run time through getEnv: on with true, off when unset", () => {
    for (const [name, value] of Object.entries({ ...production, RESIDENT_ALERTS_ENABLED: "true" })) vi.stubEnv(name, value);
    resetEnvCache();
    expect(getEnv().residentAlertsEnabled).toBe(true);

    vi.unstubAllEnvs();
    resetEnvCache();
    for (const [name, value] of Object.entries({ ...production, RESIDENT_ALERTS_ENABLED: undefined })) vi.stubEnv(name, value);
    resetEnvCache();
    expect(getEnv().residentAlertsEnabled).toBe(false);
  });

  it("documents the default (off) in docs/config.md, which names the variable as the only switch", () => {
    const row = read("docs/config.md")
      .split("\n")
      .find((line) => line.startsWith("| `RESIDENT_ALERTS_ENABLED`"));

    expect(row, "docs/config.md lists RESIDENT_ALERTS_ENABLED among production's variables").toBeDefined();
    expect(row).toMatch(/^\| `RESIDENT_ALERTS_ENABLED` \| no \| `false` /);
    expect(row).toMatch(/only this Vercel variable/);
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
