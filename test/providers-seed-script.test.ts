// The provider catalogue seed script's command line (S02.04): its dry run on the real files and on
// a catalogue that fails its schema. The database side is test/db/providers.db.test.ts.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveSeedTarget } from "../scripts/seed/target";

const ROOT = path.join(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "seed", "providers.mjs");
const temp: string[] = [];

function run(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync("node", [SCRIPT, ...args], { cwd: ROOT, encoding: "utf8", env: { ...process.env, SEED_DATABASE_URL: "", MIGRATE_DATABASE_URL: "", ...env } });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

/** A copy of the catalogue folder with providers.json changed by `change`. */
function catalogueWith(change: (file: { providers: Record<string, unknown>[] }) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), "cvh-providers-"));
  temp.push(dir);
  cpSync(path.join(ROOT, "data", "catalogue", "translations"), path.join(dir, "translations"), { recursive: true });
  const file = JSON.parse(readFileSync(path.join(ROOT, "data", "catalogue", "providers.json"), "utf8"));
  change(file);
  writeFileSync(path.join(dir, "providers.json"), JSON.stringify(file));
  return dir;
}

afterAll(() => {
  for (const dir of temp) rmSync(dir, { recursive: true, force: true });
});

describe("npm run seed:providers -- --dry-run", () => {
  it("reports the real catalogue: 99 providers in 8 categories, no translation loaded yet, exit 0", () => {
    const { code, out } = run(["--dry-run"]);

    expect(code).toBe(0);
    expect(out).toContain("Providers: 99 in 8 categories");
    expect(out).toContain("Non-Profits: 34");
    expect(out).toContain("Translations loaded (reviewed and current): 0");
    expect(out).toContain("machine translation, no review recorded");
  });

  it("loads nothing and lists every failing entry of a catalogue that fails its schema, exit 1", () => {
    const dir = catalogueWith(({ providers }) => {
      delete providers[0].id;
      providers[1].location = { lat: 51.5, lng: -0.12 };
      providers[2].categories = ["Spaceships"];
      providers[4].id = providers[3].id;
    });

    const { code, out, err } = run(["--dry-run", "--dir", dir]);

    expect(code).toBe(1);
    expect(out).toBe("");
    expect(err).toContain("REFUSED, nothing loaded: 6 failing entries");
    expect(err).toContain("providers[0]: id: is missing");
    expect(err).toContain("providers[1] (M002): location.lat: is outside Toronto (43.58 to 43.86)");
    expect(err).toContain("providers[1] (M002): location.lng: is outside Toronto (-79.64 to -79.11)");
    expect(err).toContain('providers[2] (M003): category "Spaceships" is not in labels.categories');
    expect(err).toContain("providers[3] (M004): id M004 is used 2 times (providers[3], providers[4])");
    expect(err).toContain("providers[4] (M004): id M004 is used 2 times (providers[3], providers[4])");
  });

  it("without a database URL the real run refuses before reading anything into a database", () => {
    const { code, err } = run([]);

    expect(code).toBe(1);
    expect(err).toContain("SEED_DATABASE_URL is not set");
  });
});

// Where the seeds write (S02.04 review): SEED_DATABASE_URL only, never the transaction pooler, the
// target printed first, and --yes for any host but this machine. No test here reaches a database.
describe("the seeds' target database", () => {
  /** The process environment with neither seed variable (unset, not empty), then `env`. */
  const cleanEnv = (env: Record<string, string>) => {
    const base = { ...process.env, ...env };
    for (const name of ["SEED_DATABASE_URL", "MIGRATE_DATABASE_URL"]) if (!(name in env)) delete base[name];
    return base;
  };
  const run2 = (script: "providers" | "guides", args: string[], env: Record<string, string>) => {
    const result = spawnSync("node", [path.join(ROOT, "scripts", "seed", `${script}.mjs`), ...args], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 60_000,
      env: cleanEnv(env),
    });
    return { code: result.status, out: result.stdout, err: result.stderr };
  };
  const MIGRATE = "postgres://postgres:secret-pw@127.0.0.1:5432/postgres";

  describe.each(["providers", "guides"] as const)("seed:%s", (script) => {
    it("does not fall back to MIGRATE_DATABASE_URL", () => {
      const { code, out, err } = run2(script, [], { MIGRATE_DATABASE_URL: MIGRATE });

      expect(code).toBe(1);
      expect(err).toContain("SEED_DATABASE_URL is not set");
      expect(out).not.toContain("Seeding host");
    });

    it("refuses the transaction pooler (port 6543)", () => {
      const { code, out, err } = run2(script, ["--yes"], { SEED_DATABASE_URL: "postgres://u:secret-pw@aws-0-ca.pooler.supabase.com:6543/postgres" });

      expect(code).toBe(1);
      expect(err).toContain("SEED_DATABASE_URL points at the transaction pooler (port 6543)");
      expect(out).not.toContain("Seeding host");
    });

    it("refuses a host other than localhost without --yes, before connecting, and does not print the password", () => {
      const { code, out, err } = run2(script, [], { SEED_DATABASE_URL: "postgres://u:secret-pw@db.example.invalid:5432/production" });

      expect(code).toBe(1);
      expect(err).toContain("db.example.invalid:5432, database production, which is not this machine: nothing was written");
      expect(err).toContain("--yes");
      expect(err).not.toMatch(/ENOTFOUND|ECONNREFUSED|getaddrinfo/);
      expect(out + err).not.toContain("secret-pw");
      expect(out).not.toContain("Seeding host");
    });

    it("prints the target host and database before writing; a localhost needs no --yes", () => {
      const { code, out, err } = run2(script, [], { SEED_DATABASE_URL: "postgres://u:secret-pw@127.0.0.1:1/seed_check" });

      expect(out).toContain("Seeding host 127.0.0.1:1, database seed_check");
      expect(err).not.toContain("--yes");
      expect(out + err).not.toContain("secret-pw");
      expect(code).not.toBe(0); // nothing listens on port 1
    });

    it("with --yes seeds a remote host, after printing it", () => {
      const { out, err } = run2(script, ["--yes"], { SEED_DATABASE_URL: "postgres://u:secret-pw@db.example.invalid:5432/production" });

      expect(out).toContain("Seeding host db.example.invalid:5432, database production");
      expect(err).not.toContain("not this machine");
    });

    it("never needs the database for a dry run", () => {
      const { code } = run2(script, ["--dry-run"], {});

      expect(code === 0 || code === 1).toBe(true); // the dry run's own result; no URL asked for
      expect(run2(script, ["--dry-run"], {}).err).not.toContain("SEED_DATABASE_URL");
    });
  });

  describe("resolveSeedTarget", () => {
    const resolve = (url: string | undefined, argv: string[] = []) => resolveSeedTarget(argv, url === undefined ? {} : { SEED_DATABASE_URL: url });

    it.each(["localhost", "127.0.0.1", "[::1]"])("accepts %s without --yes", (host) => {
      expect(resolve(`postgres://u:p@${host}:5432/cvh`)).toMatchObject({ ok: true, database: "cvh" });
    });

    it("names host and database, and keeps the password out of them", () => {
      expect(resolve("postgres://u:pw@db.internal:5432/cvh", ["--yes"])).toEqual({ ok: true, url: "postgres://u:pw@db.internal:5432/cvh", host: "db.internal:5432", database: "cvh" });
    });

    it.each([
      ["no URL", undefined, []],
      ["an empty URL", "", []],
      ["a URL that is not one", "not a url", ["--yes"]],
      ["the transaction pooler, even with --yes", "postgres://u:p@h.pooler.supabase.com:6543/postgres", ["--yes"]],
      ["a remote host without --yes", "postgres://u:p@db.internal:5432/cvh", []],
    ])("refuses %s", (_, url, argv) => {
      expect(resolve(url, argv)).toMatchObject({ ok: false });
    });

    it("never reads MIGRATE_DATABASE_URL", () => {
      expect(resolveSeedTarget([], { MIGRATE_DATABASE_URL: MIGRATE })).toMatchObject({ ok: false });
    });
  });
});
