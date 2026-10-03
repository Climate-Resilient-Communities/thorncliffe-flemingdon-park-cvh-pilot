import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_QUESTION_FALLBACK, DEFAULT_QUESTION_ROUTE, DEFAULT_SMS_PRICE_PER_SEGMENT_CENTS, DEFAULT_SMS_USD_TO_CAD_RATE, EnvError, failClosedEnvironment, getEnv, parseEnv, resetEnvCache } from "./env";
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

describe("CVH_FAKE_BUILDINGS_FILE", () => {
  it("is allowed only in local development, off Vercel", () => {
    expect(parseEnv({ ...local, CVH_FAKE_BUILDINGS_FILE: "/tmp/buildings.json" }).fakeBuildingsFile).toBe("/tmp/buildings.json");
    for (const base of [production, preview, { ...local, VERCEL_ENV: "development" }, { ...local, VERCEL: "1", VERCEL_ENV: "development" }]) {
      expect(problemsOf({ ...base, CVH_FAKE_BUILDINGS_FILE: "/tmp/buildings.json" })).toContain(
        "CVH_FAKE_BUILDINGS_FILE: the buildings fake is only allowed in local development, never on Vercel",
      );
    }
  });
});

describe("CVH_FAKE_GUIDES_FILE", () => {
  it("is allowed only in local development, off Vercel", () => {
    expect(parseEnv({ ...local, CVH_FAKE_GUIDES_FILE: "/tmp/guides.json" }).fakeGuidesFile).toBe("/tmp/guides.json");
    for (const base of [production, preview, { ...local, VERCEL_ENV: "development" }, { ...local, VERCEL: "1", VERCEL_ENV: "development" }]) {
      expect(problemsOf({ ...base, CVH_FAKE_GUIDES_FILE: "/tmp/guides.json" })).toContain(
        "CVH_FAKE_GUIDES_FILE: the guides fake is only allowed in local development, never on Vercel",
      );
    }
  });
});

describe("CVH_FAKE_DIRECTORY_DIR", () => {
  it("is allowed only in local development, off Vercel", () => {
    expect(parseEnv({ ...local, CVH_FAKE_DIRECTORY_DIR: "/tmp/releases" }).fakeDirectoryDir).toBe("/tmp/releases");
    expect(parseEnv(local).fakeDirectoryDir).toBeUndefined();
    for (const base of [production, preview, { ...local, VERCEL_ENV: "development" }, { ...local, VERCEL: "1", VERCEL_ENV: "development" }]) {
      expect(problemsOf({ ...base, CVH_FAKE_DIRECTORY_DIR: "/tmp/releases" })).toContain(
        "CVH_FAKE_DIRECTORY_DIR: the local directory store is only allowed in local development, never on Vercel",
      );
    }
  });

  it("must be an absolute path: a relative one names a different folder for each process", () => {
    for (const relative of ["releases", "./releases", "../releases", "~/releases"]) {
      expect(problemsOf({ ...local, CVH_FAKE_DIRECTORY_DIR: relative }), relative).toContain("CVH_FAKE_DIRECTORY_DIR: must be an absolute path");
    }
    for (const absolute of ["/tmp/releases", "C:\\releases", "C:/releases"]) {
      expect(parseEnv({ ...local, CVH_FAKE_DIRECTORY_DIR: absolute }).fakeDirectoryDir, absolute).toBe(absolute);
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

  it("does not fail start-up when an allowlist entry is not an E.164 number: no number is approved, the rule is named, no entry is shown", () => {
    for (const bad of [`${ALLOWED},4165550101`, "+0123456789", "not a number", `${ALLOWED};${OTHER}`, "+1 416 555 0101"]) {
      const env = parseEnv({ ...production, ...twilio, TWILIO_FROM_NUMBER: FROM, SMS_TEST_ALLOWLIST: bad });
      expect(env.smsTestAllowlist, bad).toEqual([]);
      expect(env.smsTestProblem).toMatch(/^SMS_TEST_ALLOWLIST: every entry must be an E\.164 number/);
      expect(env.smsTestProblem).not.toContain("5550101");
      // The rest of the environment is untouched.
      expect(env.twilio).toMatchObject({ accountSid: "AC123", fromNumber: FROM });
    }
  });

  it("does not fail start-up when TWILIO_FROM_NUMBER is malformed: the from-number is dropped and the rule is named without the value", () => {
    const env = parseEnv({ ...production, ...twilio, TWILIO_FROM_NUMBER: "9995550177", SMS_TEST_ALLOWLIST: ALLOWED });
    expect(env.smsTestProblem).toBe("TWILIO_FROM_NUMBER: must be an E.164 number such as +18885550100 (the value is not shown)");
    expect(env.twilio?.fromNumber).toBeUndefined();
    expect(env.twilio).toMatchObject({ accountSid: "AC123" });
    expect(JSON.stringify(env.smsTestProblem)).not.toContain("9995550177");
  });

  it("has no smsTestProblem when the spike variables are well formed or unset", () => {
    expect(parseEnv({ ...production, ...twilio, TWILIO_FROM_NUMBER: FROM, SMS_TEST_ALLOWLIST: ALLOWED }).smsTestProblem).toBeUndefined();
    expect(parseEnv(production).smsTestProblem).toBeUndefined();
  });

  it("logs the rule, once and without the value, when getEnv reads a malformed spike variable (and still returns the environment)", () => {
    resetEnvCache();
    for (const [k, v] of Object.entries({ ...production, ...twilio, TWILIO_FROM_NUMBER: FROM, SMS_TEST_ALLOWLIST: `${ALLOWED},oops-4165550199` })) vi.stubEnv(k, v);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const env = getEnv();
    getEnv();

    expect(env.smsTestAllowlist).toEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0][0]);
    expect(JSON.parse(line)).toMatchObject({ evt: "env.sms_test_not_configured", rule: expect.stringMatching(/^SMS_TEST_ALLOWLIST: every entry/) });
    expect(line).not.toContain("5550101");
    expect(line).not.toContain("5550199");
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetEnvCache();
  });

  it("still fails start-up when the allowlist is set outside production (a secret-placement rule)", () => {
    for (const base of [preview, local, { ...local, VERCEL_ENV: "development" }]) {
      expect(problemsOf({ ...base, SMS_TEST_ALLOWLIST: ALLOWED }).join("\n")).toMatch(/SMS_TEST_ALLOWLIST: only allowed in production/);
    }
    expect(problemsOf({ ...preview, TWILIO_FROM_NUMBER: FROM }).join("\n")).toMatch(/TWILIO_FROM_NUMBER: Twilio credentials are only allowed in production/);
  });
});

describe("Cohere and the search settings (S03.02)", () => {
  const KEY = "co-SuperSecretKey123";

  it.each([
    ["preview", preview],
    ["development (Vercel)", { ...local, VERCEL_ENV: "development" }],
    ["local", local],
  ])("the Cohere key fails start-up in %s: a real key exists only in production", (_name, base) => {
    expect(problemsOf({ ...base, COHERE_API_KEY: KEY })).toEqual(["COHERE_API_KEY: Cohere credentials are only allowed in production"]);
  });

  it("covers every COHERE_ variable and never prints a value", () => {
    const problems = problemsOf({ ...preview, COHERE_API_KEY: KEY, COHERE_OTHER: KEY });

    expect(problems).toEqual(["COHERE_API_KEY, COHERE_OTHER: Cohere credentials are only allowed in production"]);
    expect(problems.join("\n")).not.toContain(KEY);
  });

  it("fails start-up when the key is set but blank, in every environment: a blank key must not silently switch search off", () => {
    for (const base of [production, preview, local]) {
      for (const blank of ["", " ", "\t"]) {
        expect(problemsOf({ ...base, COHERE_API_KEY: blank })).toEqual(["COHERE_API_KEY: set but blank; unset it or give it the key"]);
      }
    }
  });

  it("leaves the key optional: unset, there is none (the publish job decides what that means), and a key is trimmed", () => {
    expect(parseEnv(production).cohereApiKey).toBeUndefined();
    expect(parseEnv(local).cohereApiKey).toBeUndefined();
    expect(parseEnv({ ...production, COHERE_API_KEY: ` ${KEY} ` }).cohereApiKey).toBe(KEY);
  });

  it("refuses a NEXT_PUBLIC_ variable that names Cohere, or that holds the key, and never shows the key", () => {
    for (const leak of [{ NEXT_PUBLIC_COHERE_API_KEY: "anything" }, { NEXT_PUBLIC_COHERE: "x" }, { COHERE_API_KEY: KEY, NEXT_PUBLIC_ANYTHING: KEY }]) {
      const problems = problemsOf({ ...production, ...leak });
      expect(problems.join("\n")).toMatch(/NEXT_PUBLIC_[A-Z_]+: holds or names the Cohere key; NEXT_PUBLIC_ variables are sent to browsers/);
      expect(problems.join("\n")).not.toContain(KEY);
    }
    expect(() => parseEnv({ ...production, COHERE_API_KEY: KEY, NEXT_PUBLIC_ANYTHING: "something else" })).not.toThrow();
  });

  it("has defaults: embed-v4.0, a provisional threshold, the emergency category and a monthly allowance", () => {
    expect(parseEnv(local).search).toEqual({
      embedModel: "embed-v4.0",
      threshold: 0.3,
      emergencyThreshold: 0.25,
      emergencyCategories: ["Support & Emergency Services"],
      allowance: { callsPerMonth: 500, tokensPerMonth: 2_000_000 },
      questionRoute: {
        ps: "north-small-translate-09-2026",
        prs: "north-small-translate-09-2026",
        ur: "north-small-translate-09-2026",
        romanized_or_mixed: "command-a-translate-08-2025",
        ambiguous_arabic: "command-a-translate-08-2025",
      },
      questionFallback: {
        ps: null,
        prs: "command-a-translate-08-2025",
        ur: "command-a-translate-08-2025",
        romanized_or_mixed: "command-a-translate-08-2025",
        ambiguous_arabic: "command-a-translate-08-2025",
      },
      fallbackMinBudgetMs: 800,
      translateMonthlyCalls: {},
    });
  });

  it("reads the model, threshold, emergency categories and allowance", () => {
    expect(
      parseEnv({
        ...production,
        SEARCH_EMBED_MODEL: " embed-multilingual-v3.0 ",
        SEARCH_THRESHOLD: "0.42",
        SEARCH_EMERGENCY_THRESHOLD: "0.2",
        SEARCH_EMERGENCY_CATEGORIES: " Support & Emergency Services , Crisis Lines,, Crisis Lines",
        EMBED_PUBLISH_ALLOWANCE_CALLS_PER_MONTH: "40",
        EMBED_PUBLISH_ALLOWANCE_TOKENS_PER_MONTH: "100000",
      }).search,
    ).toEqual({
      embedModel: "embed-multilingual-v3.0",
      threshold: 0.42,
      emergencyThreshold: 0.2,
      emergencyCategories: ["Support & Emergency Services", "Crisis Lines"],
      allowance: { callsPerMonth: 40, tokensPerMonth: 100000 },
      questionRoute: DEFAULT_QUESTION_ROUTE,
      questionFallback: DEFAULT_QUESTION_FALLBACK,
      fallbackMinBudgetMs: 800,
      translateMonthlyCalls: {},
    });
  });

  it("defaults the fallback per kind of question (owner decision 45): Dari and Urdu to Command A Translate, Pashto off, and the kinds routed to Command A have it only if their route changes", () => {
    const fallback = parseEnv(production).search.questionFallback;
    expect(fallback).toEqual({ ps: null, prs: "command-a-translate-08-2025", ur: "command-a-translate-08-2025", romanized_or_mixed: "command-a-translate-08-2025", ambiguous_arabic: "command-a-translate-08-2025" });
    // Never the routed model itself: where the route already is the fallback there is nothing to retry with (the translator skips it).
    for (const kind of ["romanized_or_mixed", "ambiguous_arabic"] as const) expect(DEFAULT_QUESTION_ROUTE[kind]).toBe(fallback[kind]);
    for (const kind of ["prs", "ur"] as const) expect(DEFAULT_QUESTION_ROUTE[kind]).not.toBe(fallback[kind]);
  });

  it("reads SEARCH_QUESTION_FALLBACK like the route: a kind left out keeps its default, kind=off turns the retry off for it, kind=model changes it, off alone for all", () => {
    expect(parseEnv({ ...production, SEARCH_QUESTION_FALLBACK: " ps = command-a-translate-08-2025 , ur=off" }).search.questionFallback).toEqual({
      ps: "command-a-translate-08-2025",
      prs: "command-a-translate-08-2025",
      ur: null,
      romanized_or_mixed: "command-a-translate-08-2025",
      ambiguous_arabic: "command-a-translate-08-2025",
    });
    expect(parseEnv({ ...production, SEARCH_QUESTION_FALLBACK: "prs=command-r-translate-01-2027" }).search.questionFallback.prs).toBe("command-r-translate-01-2027");
    expect(parseEnv({ ...production, SEARCH_QUESTION_FALLBACK: "off" }).search.questionFallback).toEqual({ ps: null, prs: null, ur: null, romanized_or_mixed: null, ambiguous_arabic: null });
    // The route is its own setting: changing one leaves the other alone.
    expect(parseEnv({ ...production, SEARCH_QUESTION_FALLBACK: "off" }).search.questionRoute).toEqual(DEFAULT_QUESTION_ROUTE);
    expect(parseEnv({ ...production, SEARCH_QUESTION_ROUTE: "off" }).search.questionFallback).toEqual(DEFAULT_QUESTION_FALLBACK);
  });

  it("no longer reads the single-model SEARCH_QUESTION_FALLBACK_MODEL (nothing was deployed with it)", () => {
    expect(parseEnv({ ...production, SEARCH_QUESTION_FALLBACK_MODEL: "off" }).search.questionFallback).toEqual(DEFAULT_QUESTION_FALLBACK);
  });

  it("reads SEARCH_FALLBACK_MIN_BUDGET_MS: 800 by default, a whole number of milliseconds from 0 to 2200", () => {
    expect(parseEnv(production).search.fallbackMinBudgetMs).toBe(800);
    for (const [text, ms] of [["0", 0], [" 300 ", 300], ["2200", 2200]] as const) {
      expect(parseEnv({ ...production, SEARCH_FALLBACK_MIN_BUDGET_MS: text }).search.fallbackMinBudgetMs, text).toBe(ms);
    }
    for (const bad of ["2201", "-1", "0.5", "1e3", "fast", "10000"]) {
      expect(problemsOf({ ...production, SEARCH_FALLBACK_MIN_BUDGET_MS: bad }).join("\n"), bad).toMatch(/SEARCH_FALLBACK_MIN_BUDGET_MS: must be a whole number of milliseconds from 0 to 2200/);
    }
  });

  it("reads SEARCH_TRANSLATE_MONTHLY_CALLS: no limit by default, and model=limit pairs", () => {
    expect(parseEnv(production).search.translateMonthlyCalls).toEqual({});
    expect(parseEnv({ ...production, SEARCH_TRANSLATE_MONTHLY_CALLS: "north-small-translate-09-2026=1000" }).search.translateMonthlyCalls).toEqual({ "north-small-translate-09-2026": 1000 });
    expect(parseEnv({ ...production, SEARCH_TRANSLATE_MONTHLY_CALLS: " north-small-translate-09-2026 = 1000 , command-a-translate-08-2025=250, " }).search.translateMonthlyCalls).toEqual({
      "north-small-translate-09-2026": 1000,
      "command-a-translate-08-2025": 250,
    });
  });

  it("reads search_question_route: a kind left out keeps its default, kind=off switches the leg off for it, off alone for all", () => {
    expect(parseEnv({ ...production, SEARCH_QUESTION_ROUTE: " ps = command-a-translate-08-2025 , ambiguous_arabic=off" }).search.questionRoute).toEqual({
      ps: "command-a-translate-08-2025",
      prs: "north-small-translate-09-2026",
      ur: "north-small-translate-09-2026",
      romanized_or_mixed: "command-a-translate-08-2025",
      ambiguous_arabic: null,
    });
    expect(parseEnv({ ...production, SEARCH_QUESTION_ROUTE: "off" }).search.questionRoute).toEqual({ ps: null, prs: null, ur: null, romanized_or_mixed: null, ambiguous_arabic: null });
  });

  it("routes native-script Urdu to the translated-question leg by default (owner decision 40), and lets config change or switch it off", () => {
    expect(parseEnv(production).search.questionRoute.ur).toBe("north-small-translate-09-2026");
    expect(parseEnv({ ...production, SEARCH_QUESTION_ROUTE: "ur=command-a-translate-08-2025" }).search.questionRoute.ur).toBe("command-a-translate-08-2025");
    expect(parseEnv({ ...production, SEARCH_QUESTION_ROUTE: "ur=off" }).search.questionRoute.ur).toBeNull();
  });

  it("reads the emergency-only threshold (owner decision 41): 0 to 1, and no greater than SEARCH_THRESHOLD", () => {
    expect(parseEnv({ ...production, SEARCH_EMERGENCY_THRESHOLD: " 0.3 " }).search.emergencyThreshold).toBe(0.3); // equal to the default threshold
    expect(parseEnv({ ...production, SEARCH_EMERGENCY_THRESHOLD: "0" }).search.emergencyThreshold).toBe(0);
    expect(parseEnv({ ...production, SEARCH_THRESHOLD: "0.5", SEARCH_EMERGENCY_THRESHOLD: "0.4" }).search.emergencyThreshold).toBe(0.4);
    // A lower SEARCH_THRESHOLD alone leaves the default 0.25 above it.
    expect(problemsOf({ ...production, SEARCH_THRESHOLD: "0.2" }).join("\n")).toMatch(/SEARCH_EMERGENCY_THRESHOLD: must be no greater than SEARCH_THRESHOLD/);
    expect(parseEnv({ ...production, SEARCH_THRESHOLD: "0.2", SEARCH_EMERGENCY_THRESHOLD: "0.1" }).search.emergencyThreshold).toBe(0.1);
  });

  it.each([
    ["SEARCH_EMBED_MODEL", "embed v4", /SEARCH_EMBED_MODEL: must be a model id/],
    ["SEARCH_THRESHOLD", "1.5", /SEARCH_THRESHOLD: must be a number from 0 to 1/],
    ["SEARCH_THRESHOLD", "high", /SEARCH_THRESHOLD: must be a number from 0 to 1/],
    ["SEARCH_THRESHOLD", "-0.2", /SEARCH_THRESHOLD: must be a number from 0 to 1/],
    ["SEARCH_EMERGENCY_THRESHOLD", "1.5", /SEARCH_EMERGENCY_THRESHOLD: must be a number from 0 to 1/],
    ["SEARCH_EMERGENCY_THRESHOLD", "low", /SEARCH_EMERGENCY_THRESHOLD: must be a number from 0 to 1/],
    ["SEARCH_EMERGENCY_THRESHOLD", "-0.1", /SEARCH_EMERGENCY_THRESHOLD: must be a number from 0 to 1/],
    ["SEARCH_EMERGENCY_THRESHOLD", "0.31", /SEARCH_EMERGENCY_THRESHOLD: must be no greater than SEARCH_THRESHOLD/],
    ["SEARCH_EMERGENCY_CATEGORIES", " , ", /SEARCH_EMERGENCY_CATEGORIES: must list at least one category name/],
    ["EMBED_PUBLISH_ALLOWANCE_CALLS_PER_MONTH", "0", /EMBED_PUBLISH_ALLOWANCE_CALLS_PER_MONTH: must be a whole number of at least 1/],
    ["SEARCH_QUESTION_ROUTE", "xx=north-small-translate-09-2026", /SEARCH_QUESTION_ROUTE: must be `off`, or comma-separated kind=model pairs/],
    ["SEARCH_QUESTION_ROUTE", "ps=north small", /SEARCH_QUESTION_ROUTE: must be/],
    ["SEARCH_QUESTION_ROUTE", "ps=a,ps=b", /SEARCH_QUESTION_ROUTE: must be/],
    ["SEARCH_QUESTION_ROUTE", "north-small-translate-09-2026", /SEARCH_QUESTION_ROUTE: must be/],
    ["SEARCH_QUESTION_ROUTE", " , ", /SEARCH_QUESTION_ROUTE: must be/],
    ["SEARCH_QUESTION_FALLBACK", "xx=command-a-translate-08-2025", /SEARCH_QUESTION_FALLBACK: must be `off`, or comma-separated kind=model pairs/],
    ["SEARCH_QUESTION_FALLBACK", "ps=command a", /SEARCH_QUESTION_FALLBACK: must be/],
    ["SEARCH_QUESTION_FALLBACK", "ps=a,ps=b", /SEARCH_QUESTION_FALLBACK: must be/],
    ["SEARCH_QUESTION_FALLBACK", "command-a-translate-08-2025", /SEARCH_QUESTION_FALLBACK: must be/],
    ["SEARCH_QUESTION_FALLBACK", " , ", /SEARCH_QUESTION_FALLBACK: must be/],
    ["SEARCH_TRANSLATE_MONTHLY_CALLS", "north-small-translate-09-2026", /SEARCH_TRANSLATE_MONTHLY_CALLS: must be comma-separated model=limit pairs/],
    ["SEARCH_TRANSLATE_MONTHLY_CALLS", "north-small-translate-09-2026=0", /SEARCH_TRANSLATE_MONTHLY_CALLS: must be/],
    ["SEARCH_TRANSLATE_MONTHLY_CALLS", "north-small-translate-09-2026=lots", /SEARCH_TRANSLATE_MONTHLY_CALLS: must be/],
    ["SEARCH_TRANSLATE_MONTHLY_CALLS", "north-small-translate-09-2026=-5", /SEARCH_TRANSLATE_MONTHLY_CALLS: must be/],
    ["SEARCH_TRANSLATE_MONTHLY_CALLS", "north-small-translate-09-2026=1.5", /SEARCH_TRANSLATE_MONTHLY_CALLS: must be/],
    ["SEARCH_TRANSLATE_MONTHLY_CALLS", "north small=10", /SEARCH_TRANSLATE_MONTHLY_CALLS: must be/],
    ["SEARCH_TRANSLATE_MONTHLY_CALLS", "a=1,a=2", /SEARCH_TRANSLATE_MONTHLY_CALLS: must be/],
    ["SEARCH_TRANSLATE_MONTHLY_CALLS", " , ", /SEARCH_TRANSLATE_MONTHLY_CALLS: must be/],
    ["SEARCH_TRANSLATE_MONTHLY_CALLS", "a=1;b=2", /SEARCH_TRANSLATE_MONTHLY_CALLS: must be/],
    ["EMBED_PUBLISH_ALLOWANCE_TOKENS_PER_MONTH", "lots", /EMBED_PUBLISH_ALLOWANCE_TOKENS_PER_MONTH: must be a whole number of at least 1/],
  ])("refuses a bad %s (%s) and names the variable", (name, value, message) => {
    expect(problemsOf({ ...production, [name]: value }).join("\n")).toMatch(message);
  });
});

describe("SMS_PRICE_PER_SEGMENT_CENTS (S04.06)", () => {
  it("defaults to 1.5 cents CAD per segment in every environment, and docs/config.md documents it", () => {
    for (const base of [production, preview, local]) expect(parseEnv(base).smsPricePerSegmentCents).toBe(DEFAULT_SMS_PRICE_PER_SEGMENT_CENTS);
    expect(DEFAULT_SMS_PRICE_PER_SEGMENT_CENTS).toBe(1.5);
    expect(readFileSync("docs/config.md", "utf8")).toMatch(/`SMS_PRICE_PER_SEGMENT_CENTS`[^\n]*default `1\.5`/);
  });

  it.each([
    ["1.5", 1.5],
    [" 2 ", 2],
    ["0.001", 0.001],
    ["1.234", 1.234],
    ["100", 100],
    ["100.000", 100],
  ])("reads %j as %s cents", (value, price) => {
    expect(parseEnv({ ...production, SMS_PRICE_PER_SEGMENT_CENTS: value }).smsPricePerSegmentCents).toBe(price);
  });

  it("treats a blank value as unset", () => {
    expect(parseEnv({ ...production, SMS_PRICE_PER_SEGMENT_CENTS: "  " }).smsPricePerSegmentCents).toBe(DEFAULT_SMS_PRICE_PER_SEGMENT_CENTS);
  });

  it.each(["0", "0.000", "-1", "1.2345", "100.001", "101", "1e2", "free", "1,5", "$1.5", "NaN", "Infinity", ".5", "1."])("refuses %j and names the variable", (value) => {
    expect(problemsOf({ ...production, SMS_PRICE_PER_SEGMENT_CENTS: value })).toEqual([
      expect.stringMatching(/^SMS_PRICE_PER_SEGMENT_CENTS: must be a positive number of cents with at most three decimals/),
    ]);
  });
});

describe("SMS_USD_TO_CAD_RATE (S06.08)", () => {
  it("defaults to 1.4 Canadian dollars per US dollar in every environment, and docs/config.md documents it", () => {
    for (const base of [production, preview, local]) expect(parseEnv(base).smsUsdToCadRate).toBe(DEFAULT_SMS_USD_TO_CAD_RATE);
    expect(DEFAULT_SMS_USD_TO_CAD_RATE).toBe(1.4);
    expect(readFileSync("docs/config.md", "utf8")).toMatch(/`SMS_USD_TO_CAD_RATE`[^\n]*default `1\.4`/);
  });

  it.each([
    ["1.4", 1.4],
    [" 1.3721 ", 1.3721],
    ["1", 1],
    ["0.5", 0.5],
    ["5", 5],
    ["5.0000", 5],
  ])("reads %j as %s, in any environment (it is no credential)", (value, rate) => {
    for (const base of [production, preview, local]) expect(parseEnv({ ...base, SMS_USD_TO_CAD_RATE: value }).smsUsdToCadRate).toBe(rate);
  });

  it("treats a blank value as unset", () => {
    expect(parseEnv({ ...production, SMS_USD_TO_CAD_RATE: "  " }).smsUsdToCadRate).toBe(DEFAULT_SMS_USD_TO_CAD_RATE);
  });

  it.each(["0", "0.4999", "5.0001", "6", "-1.4", "1.23456", "1e0", "cad", "1,4", "$1.4", "NaN", "Infinity", ".5", "1.", "100"])("refuses %j and names the variable", (value) => {
    expect(problemsOf({ ...production, SMS_USD_TO_CAD_RATE: value })).toEqual([expect.stringMatching(/^SMS_USD_TO_CAD_RATE: must be a positive number with at most four decimals, between 0\.5 and 5/)]);
  });
});
