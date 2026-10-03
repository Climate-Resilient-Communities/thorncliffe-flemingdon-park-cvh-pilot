// The map's base tiles (S02.07): which tile provider the resident map draws, the credit it must show, and whether and
// how much of it a phone may keep. One set of values per environment, so IT can switch provider without a code change
// (docs/config.md, the spine's "Map Tile Provider (S02.07)" record). The values are public: they are written into the
// map page, which every visitor downloads. A tile URL may hold a provider's public browser key (CARTO's `?key=`), never
// a secret.
//
// The map pages are prerendered, so a change takes effect with the next deploy.

/** The most viewed tiles a phone ever keeps, whatever a provider allows (AR-3). */
export const MAX_CACHED_TILES = 200;

export interface MapTileConfig {
  /** Leaflet URL template with {z}, {x} and {y}, and {s} when `subdomains` is set. https only. */
  urlTemplate: string;
  /** The letters {s} takes (spread over the provider's hosts); empty when the template has no {s}. */
  subdomains: string;
  /** The credit the provider requires, shown on the map in every language, as the provider writes it. */
  attribution: string;
  /** Where the credit links to (the provider's copyright page); null for no link. */
  attributionUrl: string | null;
  /** The deepest zoom the provider serves. */
  maxZoom: number;
  /** Whether the provider's terms allow a phone to keep tiles it has shown. */
  cacheable: boolean;
  /** How many viewed tiles a phone keeps: the provider's limit and never more than MAX_CACHED_TILES; 0 when not cacheable. */
  cacheLimit: number;
  /** How many days a kept tile may be used before it must be downloaded again (the provider's limit). */
  cacheDays: number;
}

/**
 * CARTO Positron (light_all), confirmed by IT on 2026-10-02: free for non-profit use up to 5 million tile requests a
 * month, browser caching allowed for up to 30 days. Production and preview set the keyed URL
 * (https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}.png?key=..., no {s}) in MAP_TILE_URL, with its
 * credit and MAP_TILE_CACHEABLE=true; the key is not stored in the repository. This keyless URL is only the fallback
 * for local runs and tests: CARTO's keyless legacy access ends 2026-11-30.
 */
export const DEFAULT_MAP_TILES: MapTileConfig = {
  urlTemplate: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
  subdomains: "abcd",
  attribution: "© OpenStreetMap contributors © CARTO",
  attributionUrl: "https://carto.com/attributions",
  maxZoom: 19,
  cacheable: true,
  cacheLimit: MAX_CACHED_TILES,
  cacheDays: 30,
};

export class MapTileConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Map tile settings are not valid:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "MapTileConfigError";
  }
}

const blank = (value: string | undefined): value is undefined => value === undefined || value.trim() === "";

function integer(name: string, value: string | undefined, min: number, max: number, fallback: number, problems: string[]): number {
  if (blank(value)) return fallback;
  const text = value.trim();
  const n = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) {
    problems.push(`${name}: must be a whole number from ${min} to ${max}`);
    return fallback;
  }
  return n;
}

function httpsUrl(value: string): boolean {
  try {
    return new URL(value.replace(/\{[a-z]+\}/g, "a")).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The map tile settings from MAP_TILE_* variables, each defaulting to DEFAULT_MAP_TILES. Throws MapTileConfigError,
 * naming each variable and its rule, when a set value is not valid.
 *
 * MAP_TILE_URL              https URL template with {z}, {x}, {y} (and {s} with MAP_TILE_SUBDOMAINS)
 * MAP_TILE_SUBDOMAINS       letters for {s}, e.g. "abcd"; empty when the template has no {s}
 * MAP_TILE_ATTRIBUTION      the provider's required credit
 * MAP_TILE_ATTRIBUTION_URL  https link for the credit, or "none"
 * MAP_TILE_MAX_ZOOM         1 to 22
 * MAP_TILE_CACHEABLE        "true" or "false": whether the provider allows a phone to keep viewed tiles
 * MAP_TILE_CACHE_LIMIT      0 or more: the provider's limit on kept tiles; the phone keeps at most 200
 * MAP_TILE_CACHE_DAYS       1 to 365: how long a kept tile may be used
 */
export function readMapTileConfig(source: Record<string, string | undefined> = process.env): MapTileConfig {
  const problems: string[] = [];
  const d = DEFAULT_MAP_TILES;
  const urlChanged = !blank(source.MAP_TILE_URL);
  const urlTemplate = urlChanged ? source.MAP_TILE_URL!.trim() : d.urlTemplate;
  // A different provider does not inherit CARTO's subdomains or credit by accident.
  const subdomains = blank(source.MAP_TILE_SUBDOMAINS) ? (urlChanged ? "" : d.subdomains) : source.MAP_TILE_SUBDOMAINS.trim();
  if (!httpsUrl(urlTemplate) || !["{z}", "{x}", "{y}"].every((part) => urlTemplate.includes(part))) {
    problems.push("MAP_TILE_URL: must be an https URL template containing {z}, {x} and {y}");
  }
  if (urlTemplate.includes("{s}") && !/^[a-z0-9]+$/i.test(subdomains)) problems.push("MAP_TILE_SUBDOMAINS: the URL has {s}, so give the letters it takes, such as abcd");
  if (!urlTemplate.includes("{s}") && subdomains !== "" && !blank(source.MAP_TILE_SUBDOMAINS)) problems.push("MAP_TILE_SUBDOMAINS: set, but MAP_TILE_URL has no {s}");

  let attribution = d.attribution;
  if (!blank(source.MAP_TILE_ATTRIBUTION)) attribution = source.MAP_TILE_ATTRIBUTION.trim();
  else if (urlChanged) problems.push("MAP_TILE_ATTRIBUTION: required when MAP_TILE_URL is set (the new provider's credit)");

  let attributionUrl: string | null = urlChanged ? null : d.attributionUrl;
  const rawLink = source.MAP_TILE_ATTRIBUTION_URL;
  if (!blank(rawLink)) {
    const link = rawLink.trim();
    if (link === "none") attributionUrl = null;
    else if (httpsUrl(link)) attributionUrl = link;
    else problems.push('MAP_TILE_ATTRIBUTION_URL: must be an https URL or "none"');
  }

  const maxZoom = integer("MAP_TILE_MAX_ZOOM", source.MAP_TILE_MAX_ZOOM, 1, 22, d.maxZoom, problems);

  let cacheable = urlChanged ? false : d.cacheable;
  const rawCacheable = source.MAP_TILE_CACHEABLE;
  if (!blank(rawCacheable)) {
    const value = rawCacheable.trim().toLowerCase();
    if (value === "true" || value === "false") cacheable = value === "true";
    else problems.push('MAP_TILE_CACHEABLE: must be "true" or "false"');
  }
  const limit = integer("MAP_TILE_CACHE_LIMIT", source.MAP_TILE_CACHE_LIMIT, 0, 1_000_000, d.cacheLimit, problems);
  const cacheDays = integer("MAP_TILE_CACHE_DAYS", source.MAP_TILE_CACHE_DAYS, 1, 365, d.cacheDays, problems);

  if (problems.length > 0) throw new MapTileConfigError(problems);
  return {
    urlTemplate,
    subdomains: urlTemplate.includes("{s}") ? subdomains : "",
    attribution,
    attributionUrl,
    maxZoom,
    cacheable,
    cacheLimit: cacheable ? Math.min(limit, MAX_CACHED_TILES) : 0,
    cacheDays,
  };
}
