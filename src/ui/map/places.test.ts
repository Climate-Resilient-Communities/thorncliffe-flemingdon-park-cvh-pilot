import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ListingProvider, ListingText } from "@/contracts/directory";
import { buildingPins, inBounds, listInView, markerOf, NEIGHBOURHOODS_VIEW, pinHref, providerPins } from "./places";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function text(en: string, ur?: string): ListingText {
  const original = { lang: "en" as const, body: en };
  return ur
    ? { lang: "ur", body: ur, machine: true, model: "m", status: "ok", source_hash: sha(en), original, review_status: "reviewed", reviewed_on: "2026-09-20" }
    : { lang: "en", body: en, machine: false, model: null, status: "source", source_hash: sha(en), original, review_status: "source", reviewed_on: null };
}

function provider(id: string, name: string, subcategories: ListingText[], locations: [number, number][]): ListingProvider {
  return {
    id,
    name,
    category_ids: ["c"],
    neighbourhood_ids: ["TP"],
    subcategories,
    locations: locations.map(([lat, lng]) => ({ street: `${id} St`, city: "Toronto", postal: null, lat, lng })),
    contact: { phone: [], email: [], social: [], web: [] },
    services: text("Services"),
    emergency_role: null,
    last_confirmed: "2026-09-30",
  };
}

const IN = [43.705, -79.345] as [number, number];
const OUT_OF_VIEW = [43.8, -79.2] as [number, number];

describe("markerOf", () => {
  it("gives cooling spaces, water fountains and public washrooms their own marker, labelled with the listing's own words", () => {
    const cooling = text("Cooling Spaces", "ٹھنڈک کی جگہیں");
    expect(markerOf({ subcategories: [cooling] })).toEqual({ marker: "cooling", label: cooling });
    expect(markerOf({ subcategories: [text("Water Fountains")] }).marker).toBe("water");
    expect(markerOf({ subcategories: [text("Public Washrooms")] }).marker).toBe("washroom");
  });

  it("matches on the English source text, whatever the page language", () => {
    const urdu = text("Public Washrooms", "عوامی بیت الخلا");
    expect(markerOf({ subcategories: [urdu] })).toEqual({ marker: "washroom", label: urdu });
  });

  it("a provider in none of them is a service pin with no label; the first special subcategory wins", () => {
    expect(markerOf({ subcategories: [text("Libraries")] })).toEqual({ marker: "service", label: null });
    expect(markerOf({ subcategories: [text("Community Centres"), text("Public Washrooms"), text("Cooling Spaces")] }).marker).toBe("cooling");
  });
});

describe("pins", () => {
  it("one pin per place of a provider, each provider once, and nothing outside Toronto", () => {
    const pins = providerPins([provider("P1", "A", [], [IN, OUT_OF_VIEW]), provider("P1", "A again", [], [IN]), provider("P2", "B", [], [[0, 0]])]);
    expect(pins.map((p) => p.key)).toEqual(["P1:0", "P1:1"]);
  });

  it("a building without a place has no pin", () => {
    const pins = buildingPins([
      { rsn: "1", address: "1 A St", neighbourhood: "TP", lat: IN[0], lng: IN[1] },
      { rsn: "2", address: "2 A St", neighbourhood: "TP" },
    ]);
    expect(pins.map((p) => p.rsn)).toEqual(["1"]);
  });

  it("leads to the same pages as the directory", () => {
    const [p] = providerPins([provider("P101", "A", [], [IN])]);
    const [b] = buildingPins([{ rsn: "4154146", address: "4 Milepost Pl", neighbourhood: "TP", lat: IN[0], lng: IN[1] }]);
    expect(pinHref(p, "ur")).toBe("/ur/directory/P101");
    expect(pinHref(b, "ur")).toBe("/ur/buildings/4154146");
  });
});

describe("listInView", () => {
  it("lists exactly the providers and buildings on screen, each provider once, sorted", () => {
    const pins = [
      ...providerPins([
        provider("P2", "Zeta", [], [IN]),
        provider("P1", "alpha", [], [OUT_OF_VIEW, IN]), // one place in view is enough
        provider("P3", "Mid", [], [OUT_OF_VIEW]), // not on screen
      ]),
      ...buildingPins([
        { rsn: "2", address: "10 Overlea Blvd", neighbourhood: "FP", lat: IN[0], lng: IN[1] },
        { rsn: "1", address: "4 Milepost Pl", neighbourhood: "TP", lat: IN[0] + 0.001, lng: IN[1] },
        { rsn: "3", address: "9 Far Rd", neighbourhood: "TP", lat: OUT_OF_VIEW[0], lng: OUT_OF_VIEW[1] },
      ]),
    ];
    const { providers, buildings } = listInView(pins, NEIGHBOURHOODS_VIEW, "en");
    expect(providers.map((p) => p.id)).toEqual(["P1", "P2"]);
    expect(buildings.map((b) => b.rsn)).toEqual(["1", "2"]);
    // The list is the pins on screen: every one of them is in the bounds, and no pin in the bounds is missing.
    const onScreen = new Set(pins.filter((pin) => inBounds(pin, NEIGHBOURHOODS_VIEW)).map((pin) => (pin.kind === "provider" ? pin.id : pin.rsn)));
    expect(new Set([...providers.map((p) => p.id), ...buildings.map((b) => b.rsn)])).toEqual(onScreen);
  });

  it("is empty for a part of the map with nothing in it", () => {
    const pins = providerPins([provider("P1", "A", [], [IN])]);
    expect(listInView(pins, { south: 43.75, west: -79.25, north: 43.76, east: -79.24 }, "en")).toEqual({ providers: [], buildings: [] });
  });
});
