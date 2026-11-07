import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsePartnerSeed } from "./seedData";

const FILE = path.join(__dirname, "..", "..", "..", "..", "data", "partners", "seed.json");
const raw = () => JSON.parse(readFileSync(FILE, "utf8"));

describe("the partner space's dummy data (data/partners/seed.json)", () => {
  it("is usable as committed", () => {
    const data = parsePartnerSeed(raw());
    expect(data.orgs.length).toBeGreaterThanOrEqual(5);
    expect(data.orgs[0].id).toBe("HUB");
  });

  it("names only fictional contacts: 555 numbers and example.org addresses", () => {
    const data = parsePartnerSeed(raw());
    for (const org of data.orgs) {
      expect(org.contactPhone, org.id).toMatch(/^\(\d{3}\) 555-01\d{2}$/);
      expect(org.contactEmail, org.id).toMatch(/example\.org$/);
    }
  });

  it("links every space with a place to a provider of the directory's catalogue, once", () => {
    const catalogue = JSON.parse(readFileSync(path.join(FILE, "..", "..", "catalogue", "providers.json"), "utf8")) as { providers: { id: string }[] };
    const ids = new Set(catalogue.providers.map((provider) => provider.id));
    const data = parsePartnerSeed(raw());
    for (const space of data.spaces) if (space.providerId) expect(ids.has(space.providerId), `${space.id} -> ${space.providerId}`).toBe(true);
  });

  it("refuses a real-looking number, a reference to nothing and an open space nobody confirmed, naming each problem", () => {
    const phone = raw();
    phone.orgs[0].contactPhone = "(416) 396-2874";
    expect(() => parsePartnerSeed(phone)).toThrow(/orgs\.0\.contactPhone: must be a fictional 555-01xx number/);
    // The references are checked once every row has its shape, and every problem is named, not only the first.
    const data = raw();
    data.statements[0].org = "NOPE";
    data.spaces[0].confirmedBy = null;
    expect(() => parsePartnerSeed(data)).toThrow(/space SP01 is open but nobody confirmed it[\s\S]*statement ST01 names an organisation/);
  });
});
