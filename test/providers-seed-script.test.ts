// The provider catalogue seed script's command line (S02.04): its dry run on the real files and on
// a catalogue that fails its schema. The database side is test/db/providers.db.test.ts.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

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
