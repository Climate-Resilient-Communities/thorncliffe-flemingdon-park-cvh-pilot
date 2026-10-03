// The job routes' bearer secrets (JOB_SECRET, JOB_SECRET_PREVIOUS) and the shared send pace (SMS_SEGMENTS_PER_SECOND), S06.02.
import { describe, expect, it, vi } from "vitest";
import { EnvError, getEnv, jobSecretProblem, parseEnv, resetEnvCache } from "./env";
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

function problemsOf(source: Record<string, string | undefined>): string[] {
  try {
    parseEnv(source);
  } catch (error) {
    expect(error).toBeInstanceOf(EnvError);
    return (error as EnvError).problems;
  }
  throw new Error("expected parseEnv to throw");
}

describe("JOB_SECRET and JOB_SECRET_PREVIOUS (the job routes' bearer secrets)", () => {
  const SECRET_A = "9d1f6b3a8c2e4075a1b9c0d3e6f2a8b45c7d9e0f1a3b5c7d2e4f6a8b0c1d3e5f";
  const SECRET_B = "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809";

  it("is not required at start-up: with none the site starts and the job routes have no secret to accept (they answer 503)", () => {
    const env = parseEnv(production);
    expect(env.jobSecrets).toEqual([]);
    expect(env.jobSecretProblem).toBeUndefined();
    expect(parseEnv(preview).jobSecrets).toEqual([]);
  });

  it("is accepted when it holds at least 32 random bytes, as hex or base64, and trimmed", () => {
    expect(parseEnv({ ...production, JOB_SECRET: ` ${SECRET_A} ` }).jobSecrets).toEqual([SECRET_A]);
    const base64 = Buffer.from(SECRET_A, "hex").toString("base64");
    expect(parseEnv({ ...production, JOB_SECRET: base64 }).jobSecrets).toEqual([base64]);
  });

  it("accepts the previous secret next to the current one during a rotation, in that order", () => {
    const env = parseEnv({ ...production, JOB_SECRET: SECRET_A, JOB_SECRET_PREVIOUS: SECRET_B });
    expect(env.jobSecrets).toEqual([SECRET_A, SECRET_B]);
    expect(env.jobSecretProblem).toBeUndefined();
  });

  it.each([
    ["too short", "ab12cd34".repeat(4)],
    ["a repeated pattern", "ab".repeat(40)],
    ["not hex or base64", `${SECRET_A} !`],
  ])("does not accept a secret that is %s, without failing start-up or showing the value, so no job runs on a weak secret", (_name, value) => {
    const env = parseEnv({ ...production, JOB_SECRET: value });
    expect(env.jobSecrets).toEqual([]);
    expect(env.jobSecretProblem).toMatch(/^JOB_SECRET: must be/);
    expect(env.jobSecretProblem).not.toContain(value.slice(0, 8));
  });

  it("keeps a usable current secret when the previous one is not usable, and says why", () => {
    const env = parseEnv({ ...production, JOB_SECRET: SECRET_A, JOB_SECRET_PREVIOUS: "short" });
    expect(env.jobSecrets).toEqual([SECRET_A]);
    expect(env.jobSecretProblem).toMatch(/^JOB_SECRET_PREVIOUS: must be/);
  });

  it("ignores a previous secret that stands alone or repeats the current one", () => {
    const alone = parseEnv({ ...production, JOB_SECRET_PREVIOUS: SECRET_B });
    expect(alone.jobSecrets).toEqual([]);
    expect(alone.jobSecretProblem).toMatch(/JOB_SECRET_PREVIOUS: set without a usable JOB_SECRET/);
    const same = parseEnv({ ...production, JOB_SECRET: SECRET_A, JOB_SECRET_PREVIOUS: SECRET_A });
    expect(same.jobSecrets).toEqual([SECRET_A]);
    expect(same.jobSecretProblem).toMatch(/JOB_SECRET_PREVIOUS: must differ from JOB_SECRET/);
  });

  it("treats empty strings as absent", () => {
    expect(parseEnv({ ...production, JOB_SECRET: "", JOB_SECRET_PREVIOUS: " " }).jobSecrets).toEqual([]);
  });

  it("fails start-up when a secret is in a browser variable, and never shows it", () => {
    for (const leak of [{ NEXT_PUBLIC_JOB_SECRET: SECRET_A }, { JOB_SECRET: SECRET_A, NEXT_PUBLIC_ANYTHING: SECRET_A }, { JOB_SECRET: SECRET_A, JOB_SECRET_PREVIOUS: SECRET_B, NEXT_PUBLIC_OLD: SECRET_B }]) {
      const problems = problemsOf({ ...production, ...leak });
      expect(problems.join("\n")).toMatch(/NEXT_PUBLIC_[A-Z_]+: holds or names a job secret; NEXT_PUBLIC_ variables are sent to browsers/);
      expect(problems.join("\n")).not.toContain(SECRET_A.slice(0, 12));
    }
  });

  it("is allowed in a preview or a local run (it is not a Twilio or Cohere credential)", () => {
    expect(parseEnv({ ...preview, JOB_SECRET: SECRET_A }).jobSecrets).toEqual([SECRET_A]);
    expect(parseEnv({ ...local, JOB_SECRET: SECRET_A }).jobSecrets).toEqual([SECRET_A]);
  });

  it("has a rule that names the variable and never the value", () => {
    expect(jobSecretProblem("JOB_SECRET", SECRET_A)).toBeUndefined();
    expect(jobSecretProblem("JOB_SECRET_PREVIOUS", "abc")).toBe("JOB_SECRET_PREVIOUS: must be at least 32 random bytes (for example `openssl rand -hex 32`)");
    expect(jobSecretProblem("JOB_SECRET", "not hex !")).toBe("JOB_SECRET: must be hex or base64 (for example `openssl rand -hex 32`)");
  });

  it("logs the rule, never the value, when getEnv meets a secret it does not accept", () => {
    const saved = { ...process.env };
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, { ...local, JOB_SECRET: "tooshort" });
      resetEnvCache();
      expect(getEnv().jobSecrets).toEqual([]);
      const logged = errors.mock.calls.map((call) => String(call[0])).join("\n");
      expect(logged).toContain("env.job_secret_not_accepted");
      expect(logged).toContain("JOB_SECRET: must be");
      expect(logged).not.toContain("tooshort");
    } finally {
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, saved);
      errors.mockRestore();
      resetEnvCache();
    }
  });
});

describe("SMS_SEGMENTS_PER_SECOND (the shared send pace)", () => {
  it("defaults to 3, Twilio's default toll-free rate, in every environment", () => {
    for (const base of [production, preview, local]) expect(parseEnv(base).smsSegmentsPerSecond).toBe(3);
  });

  it("reads a whole number from 1 to 100, even in a preview (it is not a credential)", () => {
    expect(parseEnv({ ...production, SMS_SEGMENTS_PER_SECOND: "10" }).smsSegmentsPerSecond).toBe(10);
    expect(parseEnv({ ...preview, SMS_SEGMENTS_PER_SECOND: " 1 " }).smsSegmentsPerSecond).toBe(1);
    expect(parseEnv({ ...local, SMS_SEGMENTS_PER_SECOND: "100" }).smsSegmentsPerSecond).toBe(100);
  });

  it.each([["0"], ["101"], ["-3"], ["2.5"], ["fast"], ["1e2"]])("refuses %s and names the variable", (value) => {
    expect(problemsOf({ ...production, SMS_SEGMENTS_PER_SECOND: value }).join("\n")).toMatch(/SMS_SEGMENTS_PER_SECOND: must be a whole number from 1 to 100/);
  });
});
