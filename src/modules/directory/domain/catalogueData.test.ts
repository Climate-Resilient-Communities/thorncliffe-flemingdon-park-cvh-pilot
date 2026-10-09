import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The provider catalogue's own data (data/catalogue/providers.json), checked as residents will read it. Production UAT,
// 2026-10-08: Angela James Arena's postal code read "M3C 357", and the fire station at 1109 Leslie Street (Station 125) was
// named "Fire Station 224", so the map showed Station 224 twice.
const ROOT = path.resolve(__dirname, "../../../..");
const catalogue = JSON.parse(readFileSync(path.join(ROOT, "data", "catalogue", "providers.json"), "utf8")) as {
  providers: { id: string; name: string; address: { street: string | null; postal: string | null } | null }[];
};

// One organisation with two offices, each its own listing.
const SAME_NAME_ELSEWHERE = new Set(["The Neighbourhood Organization (TNO)"]);

describe("the provider catalogue's data", () => {
  it("writes every postal code as a Canadian one (A1A 1A1)", () => {
    const bad = catalogue.providers.filter((p) => p.address?.postal && !/^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] \d[ABCEGHJ-NPRSTV-Z]\d$/.test(p.address.postal));

    expect(bad.map((p) => `${p.id} ${p.address!.postal}`)).toEqual([]);
  });

  it("gives two places the same name only when they are one organisation's offices", () => {
    const byName = new Map<string, string[]>();
    for (const p of catalogue.providers) byName.set(p.name, [...(byName.get(p.name) ?? []), p.id]);
    const shared = [...byName].filter(([name, ids]) => ids.length > 1 && !SAME_NAME_ELSEWHERE.has(name));

    expect(shared).toEqual([]);
  });
});
