// scripts/create-first-admin without a database: its arguments and its production-only guard.
// The runs that create an Admin are in test/db/identity.db.test.ts.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { productionEnvironment, runCreateFirstAdmin } from "../scripts/identity/create-first-admin";

const ROOT = path.join(__dirname, "..");
const ARGS = ["--username", "jdoe", "--first-name", "Jane", "--last-name", "Doe", "--email", "jane.doe@example.org"];

const PRODUCTION = {
  VERCEL_ENV: "production",
  SMS_MODE: "live",
  PUBLIC_BASE_URL: "https://project-6qcs4.vercel.app",
  DATABASE_URL: "postgres://cvh_app_login.ref:secret@aws-0-ca-central-1.pooler.supabase.com:6543/postgres",
  SUPABASE_SECRET_KEY: "sb_secret_test_only",
  NEXT_PUBLIC_SUPABASE_URL: "https://example-project.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only",
};

async function run(argv: string[], env: Record<string, string>) {
  const lines: string[] = [];
  const connect = vi.fn();
  const code = await runCreateFirstAdmin(argv, { env, out: (l) => lines.push(l), error: (l) => lines.push(l), connect });
  return { code, output: lines.join("\n"), connect };
}

describe("create-first-admin", () => {
  it("accepts production's environment", () => {
    expect(productionEnvironment(PRODUCTION)).toMatchObject({ ok: true, env: { environment: "production" } });
  });

  it.each([
    ["development", { ...PRODUCTION, VERCEL_ENV: "", SMS_MODE: "log", PUBLIC_BASE_URL: "http://localhost:3000" }, /runs only in production/],
    ["preview", { ...PRODUCTION, VERCEL_ENV: "preview", SMS_MODE: "log", PUBLIC_BASE_URL: "https://cvh-git-x.vercel.app" }, /runs only in production/],
    ["production without the secret key", { ...PRODUCTION, SUPABASE_SECRET_KEY: "" }, /SUPABASE_SECRET_KEY: required in production/],
    ["production with a secret key in a browser variable", { ...PRODUCTION, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_leaked" }, /NEXT_PUBLIC_ variables are sent to browsers/],
  ])("refuses to run in %s, before connecting to anything", async (_, env, problem) => {
    const { code, output, connect } = await run(ARGS, env as Record<string, string>);

    expect(code).toBe(1);
    expect(output).toMatch(problem);
    expect(output).not.toContain("sb_secret");
    expect(connect).not.toHaveBeenCalled();
  });

  it("says in the usage text that the database state is the real guard and how an orphaned login recovers", async () => {
    const { output } = await run(["--username", "jdoe"], PRODUCTION);

    expect(output).toMatch(/real guard is the database/);
    expect(output).toMatch(/no Admin|an Admin exists or the bootstrap row exists/);
    expect(output).toMatch(/advisory lock/);
    expect(output).toMatch(/left behind in Supabase Auth[\s\S]*removed automatically/);
  });

  it("requires every detail and refuses unknown options", async () => {
    expect(await run(["--username", "jdoe"], PRODUCTION)).toMatchObject({ code: 2, output: expect.stringMatching(/^Missing --first-name, --last-name, --email/) });
    expect(await run([...ARGS, "--role", "coordinator"], PRODUCTION)).toMatchObject({ code: 2, output: expect.stringMatching(/Unknown option '--role'/) });
  });

  it("runs through its launcher, which bundles the script", () => {
    const result = spawnSync(process.execPath, [path.join(ROOT, "scripts", "create-first-admin"), ...ARGS], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, NODE_ENV: "test", SMS_MODE: "log", PUBLIC_BASE_URL: "http://localhost:3000" },
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/create-first-admin runs only in production/);
  });
});
