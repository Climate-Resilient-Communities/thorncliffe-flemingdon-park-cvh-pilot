import { afterEach, describe, expect, it, vi } from "vitest";
import { EnvError, failClosedEnvironment, getEnv, parseEnv, resetEnvCache } from "./env";
import { PRODUCTION_HOST } from "./hosts";

const PROD_URL = `https://${PRODUCTION_HOST}`;
const PREVIEW_URL = "https://cvh-pilot-git-feature-x.vercel.app";
const SECRET = "SuperSecretPw123";

const supabase = {
  DATABASE_URL: "postgres://cvh_app_login.abcdefghijklmnopqrst:pw@aws-0-ca-central-1.pooler.supabase.com:6543/postgres",
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
    expect(parseEnv({ ...production, PUBLIC_BASE_URL: `https://${PRODUCTION_HOST.toUpperCase()}/` }).publicBaseUrl).toBe(
      PROD_URL,
    );
  });

  it.each([
    ["preview", preview],
    ["development", { ...local, VERCEL_ENV: "development" }],
  ])("%s rejects the production host written with a trailing dot", (_name, base) => {
    expect(problemsOf({ ...base, PUBLIC_BASE_URL: `${PROD_URL}.` }).join("\n")).toMatch(/must not use the production host/);
  });

  it("in production rejects a look-alike (IDN) host", () => {
    const lookalike = `https://${PRODUCTION_HOST.replace("p", "\u0440")}`; // Cyrillic er
    expect(problemsOf({ ...production, PUBLIC_BASE_URL: lookalike }).join("\n")).toMatch(/in production the host must be/);
  });

  it.each([
    ["production", production, `${PROD_URL}:8443`],
    ["preview", preview, `${PREVIEW_URL}:8443`],
    ["development", local, "https://dev.example.org:8443"],
  ])("%s rejects an explicit port (%s)", (_name, base, url) => {
    expect(problemsOf({ ...base, PUBLIC_BASE_URL: url }).join("\n")).toMatch(/PUBLIC_BASE_URL: must not include a port/);
  });

  it.each([`${PROD_URL}/alerts`, `${PROD_URL}/?x=1`, `${PROD_URL}/#top`])(
    "rejects a path, query or fragment (%s)",
    (url) => {
      expect(problemsOf({ ...production, PUBLIC_BASE_URL: url }).join("\n")).toMatch(
        /PUBLIC_BASE_URL: must be an origin only/,
      );
    },
  );

  it("accepts a trailing slash and returns the origin", () => {
    expect(parseEnv({ ...production, PUBLIC_BASE_URL: `${PROD_URL}/` }).publicBaseUrl).toBe(PROD_URL);
  });

  it("rejects credentials", () => {
    expect(problemsOf({ ...preview, PUBLIC_BASE_URL: `https://user:${SECRET}@cvh.vercel.app` })).toEqual([
      "PUBLIC_BASE_URL: must not contain credentials",
    ]);
  });

  it.each([
    `http://user:${SECRET}@cvh.vercel.app`,
    `postgres://postgres:${SECRET}@db.x.supabase.co:5432/postgres`,
    `sb_secret_${SECRET}`,
    `https://cvh.vercel.app/?token=${SECRET}`,
    `${SECRET}:${SECRET}`,
  ])("never prints the value in its messages (%s)", (value) => {
    const problems = problemsOf({ ...preview, PUBLIC_BASE_URL: value });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join("\n")).not.toContain(SECRET);
  });
});

describe("PUBLIC_BASE_URL in preview from VERCEL_URL", () => {
  const derived = { ...preview, PUBLIC_BASE_URL: undefined, VERCEL_URL: "cvh-pilot-abc123-team.vercel.app" };

  it("derives https://${VERCEL_URL} when PUBLIC_BASE_URL is unset", () => {
    expect(parseEnv(derived).publicBaseUrl).toBe("https://cvh-pilot-abc123-team.vercel.app");
    expect(parseEnv({ ...derived, PUBLIC_BASE_URL: " " }).publicBaseUrl).toBe("https://cvh-pilot-abc123-team.vercel.app");
  });

  it("prefers an explicit PUBLIC_BASE_URL", () => {
    expect(parseEnv({ ...derived, PUBLIC_BASE_URL: PREVIEW_URL }).publicBaseUrl).toBe(PREVIEW_URL);
  });

  it("rejects a preview with neither PUBLIC_BASE_URL nor VERCEL_URL", () => {
    expect(problemsOf({ ...derived, VERCEL_URL: undefined })).toEqual([
      expect.stringMatching(/PUBLIC_BASE_URL: required/),
    ]);
    expect(problemsOf({ ...derived, VERCEL_URL: "" })).toEqual([expect.stringMatching(/PUBLIC_BASE_URL: required/)]);
  });

  it.each([PRODUCTION_HOST, `${PRODUCTION_HOST.toUpperCase()}`, `${PRODUCTION_HOST}.`])(
    "rejects a VERCEL_URL on the production host (%s)",
    (host) => {
      expect(problemsOf({ ...derived, VERCEL_URL: host }).join("\n")).toMatch(/must not use the production host/);
    },
  );

  it("rejects a VERCEL_URL that does not make an https origin", () => {
    expect(problemsOf({ ...derived, VERCEL_URL: "http://cvh.vercel.app" }).join("\n")).toMatch(/PUBLIC_BASE_URL/);
    expect(problemsOf({ ...derived, VERCEL_URL: "cvh.vercel.app/path" }).join("\n")).toMatch(/origin only/);
  });

  it.each([
    ["production", { ...production, VERCEL_URL: PRODUCTION_HOST }],
    ["development (Vercel)", { ...local, VERCEL_ENV: "development", VERCEL_URL: "cvh-dev.vercel.app" }],
    ["local", { ...local, VERCEL_URL: "cvh-dev.vercel.app" }],
  ])("is not used in %s", (_name, base) => {
    expect(problemsOf({ ...base, PUBLIC_BASE_URL: undefined })).toEqual([
      expect.stringMatching(/PUBLIC_BASE_URL: required/),
    ]);
  });
});

describe("CVH_FAKE_IDENTITY_FILE", () => {
  it("is allowed only in local development, off Vercel", () => {
    expect(parseEnv({ ...local, CVH_FAKE_IDENTITY_FILE: "/tmp/fake.json" }).fakeIdentityFile).toBe("/tmp/fake.json");
    for (const base of [production, preview, { ...local, VERCEL_ENV: "development" }, { ...local, VERCEL: "1", VERCEL_ENV: "development" }]) {
      expect(problemsOf({ ...base, CVH_FAKE_IDENTITY_FILE: "/tmp/fake.json" })).toContain(
        "CVH_FAKE_IDENTITY_FILE: the identity fake is only allowed in local development, never on Vercel",
      );
    }
  });
});

describe("STAFF_PASSWORD_PEPPER", () => {
  const PEPPER = "3f9c2a7be14d58f06a1c9e3b7d2f4a8c5e6b1d0f9a2c4e7b8d3f6a1c0e5b9d2f";

  it("is not required at start-up: production starts without it, and says why staff passwords are not configured", () => {
    const env = parseEnv(production);
    expect(env.staffPasswordPepper).toBeUndefined();
    expect(env.staffPasswordPepperProblem).toBe("STAFF_PASSWORD_PEPPER: not set");
  });

  it("is used when it holds at least 32 random bytes, as hex or base64", () => {
    const env = parseEnv({ ...production, STAFF_PASSWORD_PEPPER: PEPPER });
    expect(env.staffPasswordPepper).toBe(PEPPER);
    expect(env.staffPasswordPepperProblem).toBeUndefined();
    const base64 = Buffer.from(PEPPER, "hex").toString("base64");
    expect(parseEnv({ ...production, STAFF_PASSWORD_PEPPER: base64 }).staffPasswordPepper).toBe(base64);
  });

  it.each([
    ["too short", PEPPER.slice(0, 62)],
    ["a repeated pattern", "ab".repeat(40)],
    ["not hex or base64", `${PEPPER} !`],
  ])("is not used when it is %s, without failing start-up or showing the value", (_name, value) => {
    const env = parseEnv({ ...production, STAFF_PASSWORD_PEPPER: value });
    expect(env.staffPasswordPepper).toBeUndefined();
    expect(env.staffPasswordPepperProblem).toMatch(/^STAFF_PASSWORD_PEPPER: must be/);
    expect(env.staffPasswordPepperProblem).not.toContain(value.slice(0, 12));
  });

  it("fails start-up when it is in a browser variable, and never shows it", () => {
    for (const leak of [{ NEXT_PUBLIC_STAFF_PASSWORD_PEPPER: PEPPER }, { STAFF_PASSWORD_PEPPER: PEPPER, NEXT_PUBLIC_ANYTHING: PEPPER }]) {
      const problems = problemsOf({ ...production, ...leak });
      expect(problems.join("\n")).toMatch(/NEXT_PUBLIC_[A-Z_]+: holds the staff password pepper; NEXT_PUBLIC_ variables are sent to browsers/);
      expect(problems.join("\n")).not.toContain(PEPPER.slice(0, 12));
    }
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

  it("covers every TWILIO_ variable, such as API keys", () => {
    const problems = problemsOf({ ...preview, TWILIO_API_KEY: "SK123", TWILIO_API_SECRET: SECRET });
    expect(problems).toEqual([
      "TWILIO_API_KEY, TWILIO_API_SECRET: Twilio credentials are only allowed in production",
    ]);
  });

  it("never prints the credential values", () => {
    const problems = problemsOf({ ...preview, TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: SECRET });
    expect(problems.join("\n")).not.toContain(SECRET);
  });

  it("are optional in production", () => {
    expect(parseEnv(production).twilio).toBeUndefined();
  });
});

describe("secrets in browser variables", () => {
  const jwt = (role: string) =>
    ["e30", Buffer.from(JSON.stringify({ role })).toString("base64url"), "sig"].join(".");

  it.each([
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", `sb_secret_${SECRET}`],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", jwt("service_role")],
    ["NEXT_PUBLIC_ANYTHING", `sb_secret_${SECRET}`],
  ])("rejects a Supabase secret key in %s", (name, value) => {
    for (const base of [production, preview, local]) {
      const problems = problemsOf({ ...base, [name]: value });
      expect(problems).toContain(`${name}: holds a Supabase secret key; NEXT_PUBLIC_ variables are sent to browsers`);
      expect(problems.join("\n")).not.toContain(SECRET);
    }
  });

  it("accepts a publishable or legacy anon key", () => {
    expect(() => parseEnv({ ...production, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc" })).not.toThrow();
    expect(() => parseEnv({ ...production, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt("anon") })).not.toThrow();
  });
});

describe("DATABASE_URL role and port", () => {
  const url = (user: string, port = "6543", password = "pw") => `postgres://${user}:${password}@aws-0-ca-central-1.pooler.supabase.com:${port}/postgres`;

  it.each(["cvh_app_login", "cvh_app_login.abcdefghijklmnopqrst"])("accepts %s on the transaction pooler in production and preview", (user) => {
    expect(() => parseEnv({ ...production, DATABASE_URL: url(user) })).not.toThrow();
    expect(() => parseEnv({ ...preview, DATABASE_URL: url(user) })).not.toThrow();
  });

  it.each([
    ["the owner role", "postgres"],
    ["the owner role with a project ref", "postgres.abcdefghijklmnopqrst"],
    ["a look-alike role", "cvh_app_login_admin"],
    ["a role with another suffix", "cvh_app_loginx.ref"],
    ["an empty user name", ""],
  ])("rejects %s in production and preview without showing the URL or password", (_name, user) => {
    for (const base of [production, preview]) {
      const problems = problemsOf({ ...base, DATABASE_URL: url(user, "6543", SECRET) });

      expect(problems).toEqual([expect.stringMatching(/^DATABASE_URL: must connect as the app's role cvh_app_login/)]);
      expect(problems.join("\n")).not.toContain(SECRET);
      expect(problems.join("\n")).not.toContain("pooler.supabase.com");
      if (user !== "") expect(problems.join("\n")).not.toContain(user);
    }
  });

  it.each(["5432", "5433", ""])("rejects port %j, which is not the transaction pooler", (port) => {
    const value = port === "" ? "postgres://cvh_app_login.ref:pw@db.example/postgres" : url("cvh_app_login.ref", port);

    expect(problemsOf({ ...production, DATABASE_URL: value })).toEqual([
      "DATABASE_URL: must use the transaction pooler, port 6543",
    ]);
  });

  it("reports both the role and the port, and a value that is not a URL, without echoing them", () => {
    expect(problemsOf({ ...production, DATABASE_URL: url("postgres", "5432", SECRET) })).toHaveLength(2);
    const problems = problemsOf({ ...preview, DATABASE_URL: `not a url ${SECRET}` });

    expect(problems).toEqual(["DATABASE_URL: not a valid postgres:// URL"]);
  });

  it("does not check the connection in local development", () => {
    expect(() => parseEnv({ ...local, DATABASE_URL: "postgres://postgres:postgres@localhost:5432/postgres" })).not.toThrow();
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
    expect(problemsOf({ ...production, VERCEL_ENV: "Production" })[0]).toMatch(/VERCEL_ENV/);
  });

  it("rejects a Vercel runtime (VERCEL=1) without VERCEL_ENV instead of treating it as local", () => {
    expect(problemsOf({ ...preview, VERCEL_ENV: undefined, VERCEL: "1" })).toEqual([
      expect.stringMatching(/VERCEL_ENV: missing on Vercel/),
    ]);
  });

  it("rejects SMS_MODE with different casing or surrounding whitespace, without echoing odd values", () => {
    for (const mode of ["LIVE", " live", "live\n"]) {
      expect(problemsOf({ ...production, SMS_MODE: mode })[0]).toMatch(/^SMS_MODE: must be "live" in production/);
    }
    expect(problemsOf({ ...preview, SMS_MODE: SECRET })[0]).not.toContain(SECRET);
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

  it("never logs secret values", () => {
    for (const [k, v] of Object.entries({
      ...preview,
      PUBLIC_BASE_URL: `postgres://postgres:${SECRET}@db.x.supabase.co/postgres`,
      TWILIO_AUTH_TOKEN: SECRET,
    }))
      vi.stubEnv(k, v);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => getEnv()).toThrow(EnvError);
    expect(log.mock.calls.flat().join("\n")).not.toContain(SECRET);
  });

  it("returns the validated environment once", () => {
    for (const [k, v] of Object.entries(preview)) vi.stubEnv(k, v);
    for (const k of Object.keys(twilio)) vi.stubEnv(k, "");
    expect(getEnv()).toBe(getEnv());
  });
});

describe("failClosedEnvironment (what the terms page uses to decide whether a draft may be shown)", () => {
  it("is development when VERCEL is unset", () => {
    expect(failClosedEnvironment({})).toBe("development");
    expect(failClosedEnvironment({ VERCEL: "", VERCEL_ENV: "" })).toBe("development");
  });

  it("is production when VERCEL is set and VERCEL_ENV is missing or empty", () => {
    expect(failClosedEnvironment({ VERCEL: "1" })).toBe("production");
    expect(failClosedEnvironment({ VERCEL: "1", VERCEL_ENV: "" })).toBe("production");
  });

  it("is production for an unknown VERCEL_ENV, whether or not VERCEL is set", () => {
    expect(failClosedEnvironment({ VERCEL: "1", VERCEL_ENV: "staging" })).toBe("production");
    expect(failClosedEnvironment({ VERCEL_ENV: "Preview" })).toBe("production");
  });

  it("follows a known VERCEL_ENV", () => {
    expect(failClosedEnvironment({ VERCEL: "1", VERCEL_ENV: "preview" })).toBe("preview");
    expect(failClosedEnvironment({ VERCEL: "1", VERCEL_ENV: "production" })).toBe("production");
    expect(failClosedEnvironment({ VERCEL: "1", VERCEL_ENV: "development" })).toBe("development");
  });

  it("detects the environment as parseEnv does when Vercel's variables are sound, and is stricter when they are not", () => {
    expect(failClosedEnvironment(preview)).toBe(parseEnv(preview).environment);
    expect(failClosedEnvironment(production)).toBe(parseEnv(production).environment);
    expect(failClosedEnvironment(local)).toBe(parseEnv(local).environment);
    // parseEnv refuses to boot and treats the unknown as preview; this treats it as production.
    expect(problemsOf({ ...preview, VERCEL_ENV: "staging" })[0]).toContain("VERCEL_ENV");
    expect(failClosedEnvironment({ ...preview, VERCEL_ENV: "staging" })).toBe("production");
  });

  it("does not throw on a source that parseEnv would refuse", () => {
    expect(() => failClosedEnvironment({ VERCEL: "1", SMS_MODE: "bogus", PUBLIC_BASE_URL: "nonsense" })).not.toThrow();
  });
});

describe("the first-text spike's variables (S01.15)", () => {
  // Obviously fake numbers (the 555-01xx range), never real ones.
  const FROM = "+18885550100";
  const ALLOWED = "+14165550101";
  const OTHER = "+14165550102";

  it("reads the from-number with the Twilio credentials and the allowlist, in production", () => {
    const env = parseEnv({ ...production, ...twilio, TWILIO_FROM_NUMBER: ` ${FROM} `, SMS_TEST_ALLOWLIST: ` ${ALLOWED}, ${OTHER} ,${ALLOWED},, ` });
    expect(env.twilio).toMatchObject({ accountSid: "AC123", fromNumber: FROM });
    expect(env.smsTestAllowlist).toEqual([ALLOWED, OTHER]);
  });

  it("has no approved number when the allowlist is unset or blank", () => {
    expect(parseEnv(production).smsTestAllowlist).toEqual([]);
    expect(parseEnv({ ...production, SMS_TEST_ALLOWLIST: "  " }).smsTestAllowlist).toEqual([]);
    expect(parseEnv(preview).smsTestAllowlist).toEqual([]);
  });

  it("fails start-up when an allowlist entry is not an E.164 number, without printing any entry", () => {
    for (const bad of [`${ALLOWED},4165550101`, "+0123456789", "not a number", `${ALLOWED};${OTHER}`, "+1 416 555 0101"]) {
      const problems = problemsOf({ ...production, SMS_TEST_ALLOWLIST: bad });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/^SMS_TEST_ALLOWLIST: every entry must be an E\.164 number/);
      expect(problems.join("\n")).not.toContain("5550101");
    }
  });

  it("fails start-up when the allowlist is set outside production, and when the from-number is malformed", () => {
    for (const base of [preview, local, { ...local, VERCEL_ENV: "development" }]) {
      expect(problemsOf({ ...base, SMS_TEST_ALLOWLIST: ALLOWED }).join("\n")).toMatch(/SMS_TEST_ALLOWLIST: only allowed in production/);
    }
    const problems = problemsOf({ ...production, ...twilio, TWILIO_FROM_NUMBER: "8885550100" });
    expect(problems).toEqual(["TWILIO_FROM_NUMBER: must be an E.164 number such as +18885550100 (the value is not shown)"]);
    expect(problemsOf({ ...preview, TWILIO_FROM_NUMBER: FROM }).join("\n")).toMatch(/TWILIO_FROM_NUMBER: Twilio credentials are only allowed in production/);
  });
});
