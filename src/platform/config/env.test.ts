import { afterEach, describe, expect, it, vi } from "vitest";
import { EnvError, getEnv, parseEnv, resetEnvCache } from "./env";
import { PRODUCTION_HOST } from "./hosts";

const PROD_URL = `https://${PRODUCTION_HOST}`;
const PREVIEW_URL = "https://cvh-pilot-git-feature-x.vercel.app";

const supabase = {
  DATABASE_URL: "postgres://pooler.example/db",
  SUPABASE_SECRET_KEY: "secret",
  NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable",
};
const twilio = { TWILIO_ACCOUNT_SID: "AC123", TWILIO_AUTH_TOKEN: "token" };

const production = { VERCEL_ENV: "production", SMS_MODE: "live", PUBLIC_BASE_URL: PROD_URL, ...supabase };
const preview = { VERCEL_ENV: "preview", SMS_MODE: "log", PUBLIC_BASE_URL: PREVIEW_URL, ...supabase };
const local = { SMS_MODE: "log", PUBLIC_BASE_URL: "http://localhost:3000" };

function problemsOf(source: Record<string, string | undefined>): string[] {
  try {
    parseEnv(source);
  } catch (error) {
    expect(error).toBeInstanceOf(EnvError);
    return (error as EnvError).problems;
  }
  throw new Error("expected parseEnv to throw");
}

describe("valid environments", () => {
  it("accepts production, preview and local development", () => {
    expect(parseEnv({ ...production, ...twilio })).toMatchObject({
      environment: "production",
      smsMode: "live",
      publicBaseUrl: PROD_URL,
      twilio: { accountSid: "AC123" },
    });
    expect(parseEnv(preview)).toMatchObject({ environment: "preview", smsMode: "log" });
    expect(parseEnv(local)).toMatchObject({ environment: "development", publicBaseUrl: "http://localhost:3000" });
    expect(parseEnv({ ...local, VERCEL_ENV: "development" }).environment).toBe("development");
  });
});

describe("SMS_MODE", () => {
  it.each([
    ["production", production, "log"],
    ["production", production, "off"],
    ["production", production, undefined],
    ["production", production, ""],
    ["preview", preview, "live"],
    ["preview", preview, "off"],
    ["preview", preview, undefined],
    ["development", local, "live"],
    ["development", local, undefined],
  ])("%s rejects SMS_MODE=%s", (_name, base, mode) => {
    const problems = problemsOf({ ...base, SMS_MODE: mode });
    expect(problems.some((p) => p.startsWith("SMS_MODE:"))).toBe(true);
  });

  it("names the rule that failed", () => {
    expect(problemsOf({ ...preview, SMS_MODE: "live" })[0]).toMatch(/SMS_MODE: must be "log" in preview, not "live"/);
    expect(problemsOf({ ...production, SMS_MODE: "log" })[0]).toMatch(/SMS_MODE: must be "live" in production/);
  });
});

describe("PUBLIC_BASE_URL", () => {
  it.each([
    ["production", production],
    ["preview", preview],
    ["development", local],
  ])("%s rejects a missing or empty value", (_name, base) => {
    for (const value of [undefined, ""]) {
      expect(problemsOf({ ...base, PUBLIC_BASE_URL: value })).toEqual([expect.stringMatching(/PUBLIC_BASE_URL: required/)]);
    }
  });

  it("rejects a value that is not a URL", () => {
    expect(problemsOf({ ...preview, PUBLIC_BASE_URL: "not a url" })[0]).toMatch(/PUBLIC_BASE_URL: not a valid/);
  });

  it.each([
    ["production", production, `http://${PRODUCTION_HOST}`],
    ["preview", preview, "http://cvh-pilot-git-feature-x.vercel.app"],
    ["development", local, "http://example.com"],
    ["development", local, "http://127.0.0.1:3000"],
  ])("%s rejects non-https %s", (_name, base, url) => {
    expect(problemsOf({ ...base, PUBLIC_BASE_URL: url }).join("\n")).toMatch(/PUBLIC_BASE_URL: must use https/);
  });

  it("allows http://localhost only in local development", () => {
    expect(parseEnv({ ...local, PUBLIC_BASE_URL: "http://localhost" }).environment).toBe("development");
    expect(problemsOf({ ...preview, PUBLIC_BASE_URL: "http://localhost:3000" }).join("\n")).toMatch(/must use https/);
    expect(problemsOf({ ...production, PUBLIC_BASE_URL: "http://localhost:3000" }).join("\n")).toMatch(/must use https/);
  });

  it("in production requires the production host", () => {
    expect(problemsOf({ ...production, PUBLIC_BASE_URL: PREVIEW_URL })[0]).toMatch(
      /in production the host must be .*hosts\.ts/,
    );
    expect(problemsOf({ ...production, PUBLIC_BASE_URL: `https://evil.${PRODUCTION_HOST}` })[0]).toMatch(
      /in production the host must be/,
    );
  });

  it.each([
    ["preview", preview],
    ["development", { ...local, VERCEL_ENV: "development" }],
  ])("%s rejects the production host", (_name, base) => {
    expect(problemsOf({ ...base, PUBLIC_BASE_URL: PROD_URL })[0]).toMatch(/must not use the production host/);
  });

  it("compares the host case-insensitively", () => {
    expect(problemsOf({ ...preview, PUBLIC_BASE_URL: PROD_URL.toUpperCase() })[0]).toMatch(/production host/);
  });
});

describe("Twilio credentials", () => {
  it.each([
    ["preview", preview],
    ["development (Vercel)", { ...local, VERCEL_ENV: "development" }],
    ["local", local],
  ])("fail start-up in %s", (_name, base) => {
    for (const creds of [twilio, { TWILIO_AUTH_TOKEN: "token" }, { TWILIO_MESSAGING_SERVICE_SID: "MG1" }]) {
      expect(problemsOf({ ...base, ...creds }).join("\n")).toMatch(
        /Twilio credentials are only allowed in production/,
      );
    }
  });

  it("are allowed in production", () => {
    expect(() => parseEnv({ ...production, ...twilio })).not.toThrow();
  });

  it("treats empty strings as absent", () => {
    expect(() => parseEnv({ ...preview, TWILIO_ACCOUNT_SID: "", TWILIO_AUTH_TOKEN: " " })).not.toThrow();
  });
});

describe("other rules", () => {
  it("reports every failed rule at once", () => {
    const problems = problemsOf({ VERCEL_ENV: "preview", SMS_MODE: "live", PUBLIC_BASE_URL: PROD_URL, ...twilio });
    expect(problems.length).toBeGreaterThanOrEqual(4);
  });

  it("requires the Supabase settings in production and preview only", () => {
    expect(problemsOf({ ...production, DATABASE_URL: undefined })).toEqual(["DATABASE_URL: required in production"]);
    expect(problemsOf({ ...preview, NEXT_PUBLIC_SUPABASE_URL: "" })).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL: required in preview",
    ]);
    expect(() => parseEnv(local)).not.toThrow();
  });

  it("rejects an unknown VERCEL_ENV", () => {
    expect(problemsOf({ ...preview, VERCEL_ENV: "staging" })[0]).toMatch(/VERCEL_ENV/);
  });
});

describe("getEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetEnvCache();
  });

  it("logs the failed rule and throws on an unsafe process environment", () => {
    for (const [k, v] of Object.entries({ ...preview, SMS_MODE: "live" })) vi.stubEnv(k, v);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => getEnv()).toThrow(/SMS_MODE/);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("SMS_MODE"));
  });

  it("returns the validated environment once", () => {
    for (const [k, v] of Object.entries(preview)) vi.stubEnv(k, v);
    for (const k of Object.keys(twilio)) vi.stubEnv(k, "");
    expect(getEnv()).toBe(getEnv());
  });
});
