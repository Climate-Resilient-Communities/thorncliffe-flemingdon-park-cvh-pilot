// The Hub's neighbourhood list for the directory (S02.06): data/catalogue/provider-neighbourhoods.json, the script that
// derives its first version from the providers' locations, and the facts that let it ship with the app and no migration:
// the catalogue hash covers it and the publish function carries it.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { catalogueHash, parseProviderNeighbourhoods } from "@/modules/directory";
import { countsOf, deriveNeighbourhoods, fileText, main, neighbourhoodOfLocation, NORTH_LIMITS, OUTPUT_NAME, type LocatedProvider } from "../scripts/catalogue/derive-neighbourhoods";

const ROOT = path.join(__dirname, "..");
const CATALOGUE = path.join(ROOT, "data", "catalogue");
const temp: string[] = [];
afterAll(() => {
  for (const dir of temp) rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cvh-nbhd-"));
  temp.push(dir);
  return dir;
};

const catalogueProviders = (): { id: string; address: { postal: string | null }; location: { lat: number } }[] =>
  JSON.parse(readFileSync(path.join(CATALOGUE, "providers.json"), "utf8")).providers;
const located = (): LocatedProvider[] => catalogueProviders().map((p) => ({ id: p.id, postal: p.address.postal, lat: p.location.lat }));

describe("the derivation", () => {
  it.each([
    ["M4H 1C3", 43.706, "TP"],
    ["m4h1c3", 43.706, "TP"],
    ["M4H 1C3", 43.9, "TP"],
    ["M3C 1B4", 43.711, "FP"],
    ["M3C 2J7", 43.721159, "FP"],
    ["M3C 1K1", 43.725161, null],
    ["M3C 1K1", NORTH_LIMITS.M3C, null],
    ["M4C 2L3", 43.7, null],
    [null, 43.7, null],
    ["", 43.7, null],
  ])("puts postal code %s at latitude %s in %s", (postal, lat, expected) => {
    expect(neighbourhoodOfLocation(postal, lat)).toBe(expected);
  });

  it("gives a provider with a location in each neighbourhood both, in the order TP, FP, and counts every kind", () => {
    const derived = deriveNeighbourhoods([
      { id: "M002", postal: "M3C 1B4", lat: 43.71 },
      { id: "M002", postal: "M4H 1C3", lat: 43.706 },
      { id: "M001", postal: "M4H 1C3", lat: 43.706 },
      { id: "M003", postal: "M3C 1B4", lat: 43.71 },
      { id: "M004", postal: "M3C 1K1", lat: 43.73 },
      { id: "M005", postal: null, lat: 43.7 },
    ]);

    expect(derived).toEqual({ M001: ["TP"], M002: ["TP", "FP"], M003: ["FP"], M004: [], M005: [] });
    expect(Object.keys(derived)).toEqual(["M001", "M002", "M003", "M004", "M005"]);
    expect(countsOf(derived)).toEqual({ providers: 5, TP: 1, FP: 1, both: 1, none: 2 });
  });
});

describe("data/catalogue/provider-neighbourhoods.json", () => {
  const raw = readFileSync(path.join(CATALOGUE, OUTPUT_NAME), "utf8");

  it("is in shape, names every provider of the catalogue and no other, and says the Hub must review it", () => {
    const parsed = parseProviderNeighbourhoods(JSON.parse(raw));

    expect(Object.keys(parsed.byProvider).sort()).toEqual(catalogueProviders().map((p) => p.id).sort());
    expect(parsed.reviewed).toBe(false);
    expect(JSON.parse(raw).note).toMatch(/Hub must review/);
  });

  it("is what the script derives from the providers' locations, until the Hub has reviewed it", () => {
    const { reviewed } = parseProviderNeighbourhoods(JSON.parse(raw));
    if (reviewed) return;

    expect(raw).toBe(fileText(deriveNeighbourhoods(located())));
  });

  it("puts Don Mills / Wynford (M3C north of 43.722) in neither neighbourhood and the rest of M3C and M4H in Flemingdon Park and Thorncliffe Park", () => {
    const { byProvider } = parseProviderNeighbourhoods(JSON.parse(raw));
    const byArea = (area: string, side: (lat: number) => boolean) => catalogueProviders().filter((p) => (p.address.postal ?? "").replace(/\s/g, "").toUpperCase().startsWith(area) && side(p.location.lat));

    expect(byArea("M3C", (lat) => lat >= 43.722).length).toBeGreaterThan(0);
    for (const p of byArea("M3C", (lat) => lat >= 43.722)) expect(byProvider[p.id], p.id).toEqual([]);
    for (const p of byArea("M3C", (lat) => lat < 43.722)) expect(byProvider[p.id], p.id).toEqual(["FP"]);
    for (const p of byArea("M4H", () => true)) expect(byProvider[p.id], p.id).toEqual(["TP"]);
  });

  it("is covered by the catalogue hash: changing only this file changes the hash a release records", async () => {
    const dir = tempDir();
    cpSync(path.join(CATALOGUE, "numbers.json"), path.join(dir, "numbers.json"));
    cpSync(path.join(CATALOGUE, OUTPUT_NAME), path.join(dir, OUTPUT_NAME));
    const before = await catalogueHash(dir);

    writeFileSync(path.join(dir, OUTPUT_NAME), raw.replace('"M001": []', '"M001": ["TP"]'));

    expect(await catalogueHash(dir)).not.toBe(before);
  });

  it("travels with the publish function like the other catalogue files", () => {
    expect(readFileSync(path.join(ROOT, "next.config.ts"), "utf8")).toContain('"./data/catalogue/**/*"');
  });
});

describe("the script", () => {
  const catalogueDir = () => {
    const dir = tempDir();
    cpSync(path.join(CATALOGUE, "providers.json"), path.join(dir, "providers.json"));
    return dir;
  };
  const quiet = () => vi.spyOn(console, "log").mockImplementation(() => {});

  it("writes the file with reviewed false and reports the counts", async () => {
    const dir = catalogueDir();
    const log = quiet();

    expect(await main([ "--dir", dir ], process.env, ROOT)).toBe(0);

    const written = readFileSync(path.join(dir, OUTPUT_NAME), "utf8");
    expect(written).toBe(fileText(deriveNeighbourhoods(located())));
    expect(JSON.parse(written).reviewed).toBe(false);
    const counts = countsOf(deriveNeighbourhoods(located()));
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`Thorncliffe Park only: ${counts.TP}. Flemingdon Park only: ${counts.FP}. Both: ${counts.both}. Neither: ${counts.none}.`));
    log.mockRestore();
  });

  it("does not overwrite a list the Hub has reviewed, unless it is forced, and then sets reviewed back to false", async () => {
    const dir = catalogueDir();
    const log = quiet();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const reviewed = JSON.stringify({ ...JSON.parse(readFileSync(path.join(CATALOGUE, OUTPUT_NAME), "utf8")), reviewed: true });
    writeFileSync(path.join(dir, OUTPUT_NAME), reviewed);

    expect(await main(["--dir", dir], process.env, ROOT)).toBe(1);
    expect(readFileSync(path.join(dir, OUTPUT_NAME), "utf8")).toBe(reviewed);

    expect(await main(["--dir", dir, "--force"], process.env, ROOT)).toBe(0);
    expect(JSON.parse(readFileSync(path.join(dir, OUTPUT_NAME), "utf8")).reviewed).toBe(false);
    log.mockRestore();
    error.mockRestore();
  });

  it("fails, writing nothing, when the catalogue cannot be read", async () => {
    const dir = tempDir();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await main(["--dir", dir], process.env, ROOT)).toBe(1);
    expect(() => readFileSync(path.join(dir, OUTPUT_NAME))).toThrow();
    error.mockRestore();
  });
});
