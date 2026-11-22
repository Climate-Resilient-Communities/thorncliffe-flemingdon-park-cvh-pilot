import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseProviderRunBy } from "./providerRunBy";

const catalogue = path.join(process.cwd(), "data", "catalogue");
const read = (file: string) => JSON.parse(readFileSync(path.join(catalogue, file), "utf8")) as unknown;

describe("provider-run-by.json (resident testing, session 2, #4 and #11)", () => {
  it("names every provider of the catalogue exactly once, as an established service or a community group", () => {
    const runBy = parseProviderRunBy(read("provider-run-by.json"));
    const ids = (read("providers.json") as { providers: { id: string }[] }).providers.map((p) => p.id).sort();
    expect(Object.keys(runBy.byProvider).sort()).toEqual(ids);
  });

  it("is labelled by its own rule: the groups that call themselves grassroots are community groups, public bodies are established", () => {
    const { byProvider } = parseProviderRunBy(read("provider-run-by.json"));
    const providers = (read("providers.json") as { providers: { id: string; services: { en: string } }[] }).providers;
    for (const p of providers.filter((p) => /^Grassroots community group|resident-led|community-led/i.test(p.services.en))) {
      expect(byProvider[p.id], p.id).toBe("grassroots");
    }
    for (const id of ["M001", "M002", "M023", "M043", "M052", "M060"]) expect(byProvider[id], id).toBe("formal");
  });

  it("is reviewed by the Hub (Helena Yu, 2026-11-21), and says why each ambiguous provider was labelled as it was", () => {
    const raw = read("provider-run-by.json") as { reviewed: boolean; ambiguous: Record<string, string> };
    expect(raw.reviewed).toBe(true);
    expect(Object.keys(raw.ambiguous).length).toBeGreaterThan(0);
  });

  it("refuses a file that is not in shape, naming what is wrong", () => {
    expect(() => parseProviderRunBy({ reviewed: false, note: "n", rule: "r", ambiguous: {}, providers: { M001: "volunteer" } })).toThrow(/provider-run-by.json: providers.M001/);
    expect(() => parseProviderRunBy({ reviewed: false, note: "n", rule: "r", providers: {} })).toThrow(/ambiguous/);
  });
});
