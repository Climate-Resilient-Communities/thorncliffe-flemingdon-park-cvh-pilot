import type { MapTiles } from "@/ui/map";
import { readMapTileConfig } from "@/platform/config/mapTiles";

/** The tile provider's settings a page passes to the browser (MAP_TILE_*): the map's, and the small map of a provider's page on a desktop. */
export function pageMapTiles(): MapTiles {
  const config = readMapTileConfig();
  return {
    urlTemplate: config.urlTemplate,
    subdomains: config.subdomains,
    maxZoom: config.maxZoom,
    cacheable: config.cacheable,
    cacheLimit: config.cacheLimit,
    cacheDays: config.cacheDays,
    attribution: config.attribution,
    attributionUrl: config.attributionUrl,
  };
}
