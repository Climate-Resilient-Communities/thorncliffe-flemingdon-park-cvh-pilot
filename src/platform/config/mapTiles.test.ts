import { describe, expect, it } from "vitest";
import { DEFAULT_MAP_TILES, MAX_CACHED_TILES, MapTileConfigError, readMapTileConfig } from "./mapTiles";

function problemsOf(source: Record<string, string | undefined>): string[] {
  try {
    readMapTileConfig(source);
  } catch (error) {
    expect(error).toBeInstanceOf(MapTileConfigError);
    return (error as MapTileConfigError).problems;
  }
  throw new Error("expected readMapTileConfig to throw");
}

describe("readMapTileConfig", () => {
  it("defaults to the proposed provider, cacheable up to 200 tiles", () => {
    expect(readMapTileConfig({})).toEqual(DEFAULT_MAP_TILES);
    expect(DEFAULT_MAP_TILES.cacheLimit).toBe(MAX_CACHED_TILES);
    expect(DEFAULT_MAP_TILES.attribution).toContain("OpenStreetMap");
  });

  it("never keeps more than 200 tiles, whatever the provider allows", () => {
    expect(readMapTileConfig({ MAP_TILE_CACHE_LIMIT: "5000" }).cacheLimit).toBe(200);
    expect(readMapTileConfig({ MAP_TILE_CACHE_LIMIT: "50" }).cacheLimit).toBe(50);
  });

  it("a provider that does not allow caching keeps nothing", () => {
    const config = readMapTileConfig({ MAP_TILE_CACHEABLE: "false", MAP_TILE_CACHE_LIMIT: "100" });
    expect(config.cacheable).toBe(false);
    expect(config.cacheLimit).toBe(0);
  });

  it("switching provider is a config change: a new URL needs its own credit and is not cacheable unless said", () => {
    expect(problemsOf({ MAP_TILE_URL: "https://tiles.example.org/{z}/{x}/{y}.png" })).toEqual([
      "MAP_TILE_ATTRIBUTION: required when MAP_TILE_URL is set (the new provider's credit)",
    ]);
    const config = readMapTileConfig({ MAP_TILE_URL: "https://tiles.example.org/{z}/{x}/{y}.png", MAP_TILE_ATTRIBUTION: "© Example" });
    expect(config).toMatchObject({ subdomains: "", attribution: "© Example", attributionUrl: null, cacheable: false, cacheLimit: 0 });
    expect(
      readMapTileConfig({
        MAP_TILE_URL: "https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}.png",
        MAP_TILE_ATTRIBUTION: "© Stadia Maps © OpenMapTiles © OpenStreetMap",
        MAP_TILE_ATTRIBUTION_URL: "https://stadiamaps.com/attribution",
        MAP_TILE_MAX_ZOOM: "20",
        MAP_TILE_CACHEABLE: "true",
        MAP_TILE_CACHE_DAYS: "7",
      }),
    ).toMatchObject({ maxZoom: 20, cacheable: true, cacheLimit: 200, cacheDays: 7, attributionUrl: "https://stadiamaps.com/attribution" });
  });

  it("names each variable that is not valid", () => {
    expect(
      problemsOf({
        MAP_TILE_URL: "http://tiles.example.org/{z}/{x}.png",
        MAP_TILE_ATTRIBUTION: "x",
        MAP_TILE_MAX_ZOOM: "30",
        MAP_TILE_CACHEABLE: "yes",
        MAP_TILE_CACHE_LIMIT: "-1",
        MAP_TILE_CACHE_DAYS: "0",
        MAP_TILE_ATTRIBUTION_URL: "ftp://x",
      }).map((problem) => problem.split(":")[0]),
    ).toEqual(["MAP_TILE_URL", "MAP_TILE_ATTRIBUTION_URL", "MAP_TILE_MAX_ZOOM", "MAP_TILE_CACHEABLE", "MAP_TILE_CACHE_LIMIT", "MAP_TILE_CACHE_DAYS"]);
    expect(problemsOf({ MAP_TILE_URL: "https://{s}.example.org/{z}/{x}/{y}.png", MAP_TILE_ATTRIBUTION: "x" })[0]).toMatch(/^MAP_TILE_SUBDOMAINS/);
  });
});
