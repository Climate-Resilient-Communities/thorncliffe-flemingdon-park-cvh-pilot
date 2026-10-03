import { describe, expect, it } from "vitest";
import { mapNotice } from "./notice";
import { KEPT_BUILDINGS_KEY, keepBuildings, readKeptBuildings } from "./kept-buildings";

describe("mapNotice", () => {
  it("a provider that allows caching: only a part of the map never saved gets the notice", () => {
    expect(mapNotice({ cacheable: true, online: false, missingTiles: 0 })).toBeNull();
    expect(mapNotice({ cacheable: true, online: false, missingTiles: 3 })).toBe("not-saved");
    expect(mapNotice({ cacheable: true, online: true, missingTiles: 0 })).toBeNull();
  });

  it("a provider that does not allow caching: without signal the map is not available", () => {
    expect(mapNotice({ cacheable: false, online: false, missingTiles: 0 })).toBe("no-signal");
    expect(mapNotice({ cacheable: false, online: true, missingTiles: 2 })).toBe("no-signal");
    expect(mapNotice({ cacheable: false, online: true, missingTiles: 0 })).toBeNull();
  });
});

describe("kept buildings", () => {
  it("keeps the pins of the building list, and only what the map draws", () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    expect(readKeptBuildings(storage)).toBeNull();
    const list = {
      v: 1 as const,
      generated_at: new Date().toISOString(),
      buildings: [
        { rsn: "1", address: "1 A St", neighbourhoodId: "TP", neighbourhood: "Thorncliffe Park", lat: 43.7, lng: -79.34, floors: [{ id: "x", label: "1" }] },
        { rsn: "2", address: "2 A St", neighbourhoodId: "TP", neighbourhood: "Thorncliffe Park", floors: [] },
      ],
    };
    keepBuildings(storage, list);
    expect(readKeptBuildings(storage)).toEqual([{ rsn: "1", address: "1 A St", neighbourhood: "Thorncliffe Park", lat: 43.7, lng: -79.34 }]);
    expect(data.get(KEPT_BUILDINGS_KEY)).not.toContain("floors");
  });
});
