// scripts/recover-admin without a database: its arguments, its production-only guard and what it
// prints. The runs that reset an Admin are in test/db/factorRecovery.db.test.ts.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runRecoverAdmin } from "../scripts/identity/recover-admin";
import type { RecoverAdminError } from "../src/modules/identity";

const ROOT = path.join(__dirname, "..");
const ARGS = ["--username", "jdoe", "--reason", "all_admins_lost_access"];

const PRODUCTION = {
  VERCEL_ENV: "production",
  SMS_MODE: "live",
  PUBLIC_BASE_URL: "https://project-6qcs4.vercel.app",
  DATABASE_URL: "postgres://cvh_app_login.ref:secret@aws-0-ca-central-1.pooler.supabase.com:6543/postgres",
  SUPABASE_SECRET_KEY: "sb_secret_test_only",
  NEXT_PUBLIC_SUPABASE_URL: "https://example-project.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only",
};

async function run(argv: string[], env: Record<string, string>, connect = vi.fn()) {
  const out: string[] = [];
  const error: string[] = [];
  const code = await runRecoverAdmin(argv, { env, out: (l) => out.push(l), error: (l) => error.push(l), connect });
  return { code, out: out.join("\n"), error: error.join("\n"), connect };
}

const connecting = (recoverAdmin: ReturnType<typeof vi.fn>) => vi.fn(() => ({ identity: { recoverAdmin }, close: async () => {} }));

describe("recover-admin", () => {
  it.each([
    ["development", { ...PRODUCTION, VERCEL_ENV: "", SMS_MODE: "log", PUBLIC_BASE_URL: "http://localhost:3000" }, /recover-admin runs only in production/],
    ["preview", { ...PRODUCTION, VERCEL_ENV: "preview", SMS_MODE: "log", PUBLIC_BASE_URL: "https://cvh-git-x.vercel.app" }, /recover-admin runs only in production/],
    ["production without the secret key", { ...PRODUCTION, SUPABASE_SECRET_KEY: "" }, /SUPABASE_SECRET_KEY: required in production/],
    ["production without the database connection", { ...PRODUCTION, DATABASE_URL: "" }, /DATABASE_URL/],
    ["production connected as another database role", { ...PRODUCTION, DATABASE_URL: "postgres://postgres.ref:secret@aws-0-ca-central-1.pooler.supabase.com:6543/postgres" }, /cvh_app_login/],
  ])("refuses to run in %s, before connecting to anything", async (_, env, problem) => {
    const { code, error, connect } = await run(ARGS, env as Record<string, string>);

    expect(code).toBe(1);
    expect(error).toMatch(problem);
    expect(error).not.toContain("sb_secret");
    expect(connect).not.toHaveBeenCalled();
  });

  it("needs a username and a reason from the fixed list, and refuses unknown options", async () => {
    expect(await run(["--username", "jdoe"], PRODUCTION)).toMatchObject({ code: 2, error: expect.stringMatching(/^Missing --reason/) });
    expect(await run(["--reason", "lost_device"], PRODUCTION)).toMatchObject({ code: 2, error: expect.stringMatching(/^Missing --username/) });
    expect(await run(["--username", "jdoe", "--reason", "because I said so"], PRODUCTION)).toMatchObject({
      code: 2,
      error: expect.stringMatching(/^--reason must be one of lost_device, device_broken, all_admins_lost_access/),
    });
    expect(await run([...ARGS, "--role", "coordinator"], PRODUCTION)).toMatchObject({ code: 2, error: expect.stringMatching(/Unknown option '--role'/) });
    expect((await run(["--username", "jdoe"], PRODUCTION)).connect).not.toHaveBeenCalled();
  });

  it("says in the usage text that the database state is the real guard, that another usable Admin means asking them, and what is audited", async () => {
    const { error } = await run(["--username", "jdoe"], PRODUCTION);

    expect(error).toMatch(/real guard is the database/);
    expect(error).toMatch(/NO OTHER usable Admin exists/);
    expect(error).toMatch(/ask them to reset it from the Hub/);
    expect(error).toMatch(/actor `system`/);
    expect(error).toMatch(/this does not change/);
  });

  it("prints the next step after a reset, and the shortfall when there is one", async () => {
    const recoverAdmin = vi.fn(async () => ({ ok: true as const, value: { username: "jdoe", adminShortfall: true, providerCleared: true } }));

    const { code, out, error } = await run(ARGS, PRODUCTION, connecting(recoverAdmin));

    expect(code).toBe(0);
    expect(error).toBe("");
    expect(recoverAdmin).toHaveBeenCalledWith("jdoe", "all_admins_lost_access");
    expect(out).toMatch(/Authenticator reset for jdoe\./);
    expect(out).toMatch(/Audited as factor\.reset, actor system, reason all_admins_lost_access\./);
    expect(out).toMatch(/Next step: jdoe signs in with their own password and is taken to set up a new authenticator/);
    expect(out).toMatch(/fewer than two usable Admins\. Once back in, they should restore a second usable Admin/);
  });

  it("says when the provider did not delete the old factor, without calling the reset a failure", async () => {
    const recoverAdmin = vi.fn(async () => ({ ok: true as const, value: { username: "jdoe", adminShortfall: false, providerCleared: false } }));

    const { code, out } = await run(ARGS, PRODUCTION, connecting(recoverAdmin));

    expect(code).toBe(0);
    expect(out).toMatch(/did not delete the old authenticator/);
    expect(out).not.toMatch(/fewer than two/);
  });

  it.each([
    ["not_found", /^Refused: no account has that username/],
    ["not_admin", /^Refused: that account is not an Admin; an Admin resets Coordinators' authenticators from the Hub/],
    ["not_resettable", /^Refused: that account is suspended or removed/],
    ["other_usable_admin", /^Refused: another usable Admin exists\. Ask an Admin to reset this authenticator from the Hub/],
  ] as [RecoverAdminError, RegExp][])("refuses with a reason and exit 1 on %s", async (reason, message) => {
    const recoverAdmin = vi.fn(async () => ({ ok: false as const, error: reason }));

    const { code, out, error } = await run(ARGS, PRODUCTION, connecting(recoverAdmin));

    expect(code).toBe(1);
    expect(out).toBe("");
    expect(error).toMatch(message);
    expect(error).toMatch(/Nothing was changed/);
  });

  it("closes its connection even when the reset throws", async () => {
    const close = vi.fn(async () => {});
    const connect = vi.fn(() => ({ identity: { recoverAdmin: async () => { throw new Error("database down"); } }, close }));

    await expect(run(ARGS, PRODUCTION, connect)).rejects.toThrow("database down");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("runs through its launcher, which bundles the script", () => {
    const result = spawnSync(process.execPath, [path.join(ROOT, "scripts", "recover-admin"), ...ARGS], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, NODE_ENV: "test", SMS_MODE: "log", PUBLIC_BASE_URL: "http://localhost:3000" },
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/recover-admin runs only in production/);
  });
});
