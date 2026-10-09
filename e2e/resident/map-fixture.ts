import { createHash } from "node:crypto";
import type { Page, Route } from "@playwright/test";
import { buildManifest, CATALOGUE_HASH, GREY_TILE, listingUrl, TILE_URL } from "./directory-fixture";

export { TILE_URL };

// The map's sample data (S02.07): a directory release whose providers are spread over Thorncliffe Park and Flemingdon
// Park, with a cooling space, a water fountain and a public washroom, two providers at one spot (they always cluster)
// and one far outside the area the map opens on; two pilot buildings that the resident server's sample buildings file
// also has (so their pages open); and the tile provider, answered here with a plain grey tile. The resident server has
// no database and no Internet in these tests.

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
export const MAP_RELEASE = 11;

type Lang = "en" | "ur";

function text(lang: Lang, en: string, ur: string) {
  const original = { lang: "en" as const, body: en };
  if (lang === "en") return { lang: "en", body: en, machine: false, model: null, status: "source", source_hash: sha(en), original, review_status: "source", reviewed_on: null };
  return { lang, body: ur, machine: true, model: "north-small-translate-09-2026", status: "ok", source_hash: sha(en), original, review_status: "reviewed", reviewed_on: "2026-09-20" };
}

type Sample = { id: string; name: string; sub: [en: string, ur: string] | null; at: [number, number] };

export const MAP_PROVIDERS: Sample[] = [
  { id: "M101", name: "Overlea Cooling Centre", sub: ["Cooling Spaces", "ٹھنڈک کی جگہیں"], at: [43.699, -79.35] },
  { id: "M102", name: "Gateway Park Fountain", sub: ["Water Fountains", "پانی کے فوارے"], at: [43.724, -79.33] },
  { id: "M103", name: "Leaside Park Washrooms", sub: ["Public Washrooms", "عوامی بیت الخلا"], at: [43.699, -79.328] },
  { id: "M104", name: "Thorncliffe Food Bank", sub: null, at: [43.7105, -79.338] },
  { id: "M105", name: "Thorncliffe Family Clinic", sub: null, at: [43.7105, -79.338] },
  { id: "M106", name: "Far East Library", sub: null, at: [43.77, -79.23] },
];

/** The ids on screen when the map opens (everything but the far one), and after zooming in twice on the middle. */
export const IN_HOME_VIEW = ["M101", "M102", "M103", "M104", "M105"];
export const IN_MIDDLE = ["M104", "M105"];

export const MAP_BUILDINGS = [
  { rsn: "4154146", address: "4 Milepost Pl", neighbourhoodId: "TP", neighbourhood: "Thorncliffe Park", lat: 43.724, lng: -79.35, floors: [] },
  { rsn: "4154159", address: "85-95 Thorncliffe Park Dr", neighbourhoodId: "TP", neighbourhood: "Thorncliffe Park", lat: 43.712, lng: -79.352, floors: [] },
];

export function mapListing(lang: Lang) {
  return {
    v: 1,
    release_v: MAP_RELEASE,
    lang,
    catalogue_hash: CATALOGUE_HASH,
    categories: [{ id: "community", sort_order: 1, name: text(lang, "Public spaces", "عوامی مقامات") }],
    providers: MAP_PROVIDERS.map((s) => ({
      id: s.id,
      name: s.name,
      category_ids: ["community"],
      neighbourhood_ids: ["TP"],
      subcategories: s.sub ? [text(lang, s.sub[0], s.sub[1])] : [],
      locations: [{ street: `${s.id.slice(1)} Overlea Blvd`, city: "Toronto", postal: null, lat: s.at[0], lng: s.at[1] }],
      contact: { phone: [], email: [], social: [], web: [] },
      services: text(lang, "Open to everyone in the neighbourhood.", "محلے میں سب کے لیے کھلا۔"),
      emergency_role: null,
      last_confirmed: "2026-09-30",
    })),
  };
}


export type MapServer = { manifestDown: boolean; listingDown: boolean; tilesDown: boolean; tileRequests: string[] };

/** Answers the release routes, the building list and the tiles, for every page of the browser context. */
export async function stubMap(page: Page): Promise<MapServer> {
  const server: MapServer = { manifestDown: false, listingDown: false, tilesDown: false, tileRequests: [] };
  const context = page.context();
  await context.route("**/api/directory/manifest", (route: Route) =>
    server.manifestDown ? route.abort("internetdisconnected") : route.fulfill({ json: buildManifest(MAP_RELEASE), headers: { "Cache-Control": "no-store" } }),
  );
  await context.route(/\/api\/directory\/\d+\/[A-Za-z-]+\.json$/, (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    const lang = path.endsWith("/ur.json") ? "ur" : "en";
    if (server.listingDown || path !== listingUrl(MAP_RELEASE, lang)) return route.abort("internetdisconnected");
    return route.fulfill({ json: mapListing(lang), headers: { "Cache-Control": "public, max-age=31536000, immutable" } });
  });
  await context.route("**/api/buildings", (route: Route) =>
    route.fulfill({ json: { v: 1, generated_at: new Date().toISOString(), buildings: MAP_BUILDINGS }, headers: { "Cache-Control": "no-store" } }),
  );
  await context.route(TILE_URL, (route: Route) => {
    server.tileRequests.push(route.request().url());
    if (server.tilesDown) return route.abort("internetdisconnected");
    return route.fulfill({ body: GREY_TILE, contentType: "image/png", headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "max-age=86400" } });
  });
  return server;
}
