// The buildings seed's command line (scripts/seed/buildings.ts, S01.13) without a database: --dry-run
// reads the files and prints the report; exit 0 for a loadable register, 1 with every failing row.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../scripts/seed/buildings-seed";

const ROOT = path.join(__dirname, "..");
const NO_ENV = {} as NodeJS.ProcessEnv;

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...args) => void out.push(args.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...args) => void err.push(args.join(" ")));
  return { out, err };
}

afterEach(() => vi.restoreAllMocks());

describe("npm run seed:buildings -- --dry-run", () => {
  it("reads the committed register and merge file, says it would load the 43 buildings and warns about 85-95 Thorncliffe Park Dr", async () => {
    const { out, err } = capture();

    expect(await main(["--dry-run"], NO_ENV, ROOT)).toBe(0);

    expect(out[0]).toBe("Register: 103 rows; 43 in the pilot's postal areas (M4H 32, M3C 11); 60 elsewhere, not loaded.");
    expect(out).toContain("Would load: 43 buildings.");
    expect(out.join("\n")).toContain("2 registrations share this address (rsn 4154159, 4237447)");
    expect(err).toEqual([]);
  });

  describe("with files of its own", () => {
    const dirs: string[] = [];
    afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
    const files = (register: unknown, merge?: string) => {
      const dir = mkdtempSync(path.join(tmpdir(), "cvh-buildings-"));
      dirs.push(dir);
      writeFileSync(path.join(dir, "register.geojson"), JSON.stringify(register));
      writeFileSync(path.join(dir, "merge.csv"), merge ?? "rsn,primary_rsn\n");
      return ["--dry-run", "--file", path.join(dir, "register.geojson"), "--merge", path.join(dir, "merge.csv")];
    };
    const feature = (props: Record<string, unknown>) => ({ type: "Feature", properties: { PCODE: "M4H", SITE_ADDRESS: "1 A ST", LONGITUDE: -79.34, LATITUDE: 43.7, ...props }, geometry: { type: "Point", coordinates: [props.LONGITUDE ?? -79.34, props.LATITUDE ?? 43.7] } });

    it("exits 1 and lists every failing row, in the register and in the merge file", async () => {
      const { out, err } = capture();
      const argv = files({ type: "FeatureCollection", features: [feature({ RSN: 1 }), feature({ RSN: null }), feature({ RSN: 3, LATITUDE: 10 }), feature({ RSN: 1 })] }, "rsn,primary_rsn\n3,3\n");

      expect(await main(argv, NO_ENV, ROOT)).toBe(1);

      expect(out.join("\n")).not.toContain("Would load");
      expect(err[0]).toBe("Failures (5): nothing was imported.");
      const failures = err.filter((line) => line.startsWith("  - "));
      expect(failures).toHaveLength(5);
      expect(failures.join("\n")).toContain("register row 2 (1 A St): missing rsn (RSN)");
      expect(failures.join("\n")).toContain("register row 3 (rsn 3, 1 A St): coordinates 10, -79.34");
      expect(failures.join("\n")).toContain("register row 1 (rsn 1, 1 A St): rsn 1 appears 2 times");
      expect(failures.join("\n")).toContain("building-merge.csv line 2 (rsn 3): a registration cannot be mapped to itself");
    });

    it("exits 0 with a warning for a register that lists a different number of buildings than expected", async () => {
      const { out } = capture();
      expect(await main(files({ type: "FeatureCollection", features: [feature({ RSN: 1 })] }), NO_ENV, ROOT)).toBe(0);
      expect(out.join("\n")).toContain("M4H (Thorncliffe Park) has 1 rows in the register; 32 were expected");
    });

    it("treats a missing merge file as an empty one, and refuses a file that is not GeoJSON", async () => {
      capture();
      const argv = files({ type: "FeatureCollection", features: [] });
      expect(await main([...argv.slice(0, 3), "--merge", "/nonexistent/merge.csv"], NO_ENV, ROOT)).toBe(0);
      await expect(main(files({ type: "Feature" }), NO_ENV, ROOT)).rejects.toThrow("is not a GeoJSON FeatureCollection");
    });
  });

  it("refuses to run for real without a database URL", async () => {
    const { err } = capture();
    expect(await main([], NO_ENV, ROOT)).toBe(1);
    expect(err).toEqual(["SEED_DATABASE_URL is not set (use the same session-mode connection as the migrations)"]);
  });
});
