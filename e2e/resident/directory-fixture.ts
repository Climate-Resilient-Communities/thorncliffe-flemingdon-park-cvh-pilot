import { createHash } from "node:crypto";
import type { Page, Route } from "@playwright/test";
import { LANG_CODES, type LangCode } from "../../src/contracts/lang";

// A small directory release for the directory tests (S02.06): a manifest and listing files in the shape of
// DirectoryManifestV1 and DirectoryListingV1 (src/contracts/directory.ts). The resident server has no database in these
// tests, so the release routes are answered here. Every date is on or before 2026-10-01. The Urdu listing is machine
// translated, except one provider whose text is English with translation.unavailable; every other language's listing is
// English with translation.unavailable throughout.

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
export const CATALOGUE_HASH = sha("sample catalogue");

type Lang = LangCode;

/** One text of a listing: the English source, a machine translation (ur), or English standing in for a missing translation. */
function text(lang: Lang, en: string, ur: string | null, kind: "ok" | "fallback" = "ok") {
  const original = { lang: "en" as const, body: en };
  if (lang === "en") return { lang: "en", body: en, machine: false, model: null, status: "source", source_hash: sha(en), original, review_status: "source", reviewed_on: null };
  if (kind === "fallback" || ur === null || lang !== "ur") {
    return { lang, body: en, machine: false, model: null, status: "fallback_en", source_hash: sha(en), original, review_status: "none", reviewed_on: null, notice: "translation.unavailable" };
  }
  return { lang, body: ur, machine: true, model: "north-small-translate-09-2026", status: "ok", source_hash: sha(en), original, review_status: "reviewed", reviewed_on: "2026-09-20" };
}

const CATEGORIES = [
  { id: "food", order: 1, en: "Food", ur: "خوراک" },
  { id: "health", order: 2, en: "Health and wellness", ur: "صحت اور تندرستی" },
  { id: "legal", order: 3, en: "Legal and government services", ur: "قانونی اور سرکاری خدمات" },
  { id: "community", order: 4, en: "Public spaces", ur: "عوامی مقامات" },
] as const;

type Sample = {
  id: string;
  name: string;
  categories: string[];
  postal: string | null;
  /** The neighbourhoods the Hub's reviewed list gives this provider (the listing file carries them; the phone never works them out). */
  neighbourhoods: ("TP" | "FP")[];
  street: string;
  city: string;
  phone: string[];
  email: string[];
  web: string[];
  social: string[];
  services: [en: string, ur: string | null];
  emergency: [en: string, ur: string | null] | null;
  confirmed: string;
};

const SAMPLES: Sample[] = [
  {
    id: "P101",
    name: "Thorncliffe Park Food Bank",
    categories: ["food"],
    postal: "M4H 1K2",
    neighbourhoods: ["TP"],
    street: "45 Overlea Blvd",
    city: "Toronto",
    phone: ["(416)555-0101"],
    email: ["food@example.org"],
    web: ["https://example.org/food-bank/"],
    social: [],
    services: ["Free groceries every Tuesday and Friday, and hot meals on Saturday.", "ہر منگل اور جمعہ کو مفت راشن، اور ہفتہ کو گرم کھانا۔"],
    emergency: ["Hands out ready-to-eat food and water during a long power cut.", "طویل بجلی کی بندش میں کھانے کے لیے تیار خوراک اور پانی دیتا ہے۔"],
    confirmed: "2026-09-30",
  },
  {
    id: "P102",
    name: "Flemingdon Community Health Centre",
    categories: ["health"],
    postal: "M3C 1H9",
    neighbourhoods: ["FP"],
    street: "10 Gateway Blvd",
    city: "North York",
    phone: ["(416)555-0102 | (416)555-0103 (Ext 211)", "(613)555-0104 & (647)555-0105 (Spanish)"],
    email: ["care@example.org"],
    web: ["https://www.example.org/health"],
    social: ["X @example | Facebook @example"],
    services: ["Family doctors, nurses and mental health counselling. No appointment needed for walk-in nurses.", "فیملی ڈاکٹر، نرسیں اور ذہنی صحت کی مشاورت۔"],
    emergency: null,
    confirmed: "2026-09-15",
  },
  {
    id: "P103",
    name: "East York Legal Clinic",
    categories: ["legal"],
    postal: "M4C 2L3",
    neighbourhoods: [],
    street: "1 Main St",
    city: "East York",
    phone: [],
    email: [],
    web: [],
    social: [],
    services: ["Free legal advice on housing, immigration and benefits.", "رہائش، امیگریشن اور مراعات پر مفت قانونی مشورہ۔"],
    emergency: null,
    confirmed: "2026-08-15",
  },
  {
    id: "P104",
    name: "Overlea Cooling Room",
    categories: ["community"],
    postal: "M4H 1M5",
    neighbourhoods: ["TP"],
    street: "7 Overlea Blvd",
    city: "Toronto",
    phone: ["(416)555-0106"],
    email: [],
    web: [],
    social: [],
    services: ["A library reading room with free Wi-Fi and phone charging.", "مفت وائی فائی اور فون چارجنگ والا لائبریری ریڈنگ روم۔"],
    emergency: ["Open as a cooling room during heat warnings. Not a medical service.", "گرمی کی وارننگ کے دوران ٹھنڈے کمرے کے طور پر کھلا۔ طبی خدمت نہیں۔"],
    confirmed: "2026-09-28",
  },
  {
    id: "P105",
    name: "Don Mills Settlement Services",
    categories: ["legal", "community"],
    postal: "M3C 3N2",
    neighbourhoods: ["FP"],
    street: "20 Gateway Blvd",
    city: "North York",
    phone: ["Emergency: 911 | City: 311"],
    email: [],
    web: [],
    social: [],
    // English with translation.unavailable in Urdu.
    services: ["Help for newcomers: forms, job search and language classes.", null],
    emergency: null,
    confirmed: "2026-09-01",
  },
];

/** The listing file of one language, in the shape of DirectoryListingV1. */
export function buildListing(lang: Lang, release: number, change: { drop?: string[]; hash?: string } = {}) {
  const providers = SAMPLES.filter((s) => !(change.drop ?? []).includes(s.id)).map((s) => ({
    id: s.id,
    name: s.name,
    category_ids: s.categories,
    subcategories: [],
    neighbourhood_ids: s.neighbourhoods,
    locations: [{ street: s.street, city: s.city, postal: s.postal, lat: 43.705, lng: -79.34 }],
    contact: { phone: s.phone, email: s.email, social: s.social, web: s.web },
    services: text(lang, s.services[0], s.services[1]),
    emergency_role: s.emergency ? text(lang, s.emergency[0], s.emergency[1]) : null,
    last_confirmed: s.confirmed,
  }));
  return {
    v: 1,
    release_v: release,
    lang,
    catalogue_hash: change.hash ?? CATALOGUE_HASH,
    categories: CATEGORIES.map((c) => ({ id: c.id, sort_order: c.order, name: text(lang, c.en, c.ur) })),
    providers,
  };
}

export const listingUrl = (release: number, lang: string) => `/api/directory/${release}/${lang}.json`;

export function buildManifest(release: number, hash: string = CATALOGUE_HASH, search: "available" | "unavailable" = "unavailable") {
  return {
    v: 1,
    release_v: release,
    published_at: "2026-10-01T15:00:00.000Z",
    catalogue_hash: hash,
    search: search === "available" ? { status: "available", embed_model: "embed-v4.0", vectors_path: `releases/${release}/vectors.json` } : { status: "unavailable" },
    files: Object.fromEntries(LANG_CODES.map((lang) => [lang, listingUrl(release, lang)])),
  };
}

/** What the stubbed server does. A test changes it between visits, the way the Hub publishing a release would. */
export type DirectoryServer = {
  /** The release the manifest names. */
  release: number;
  /** Whether the manifest says search is available (S03.06). The default is unavailable, as for every release before E03. */
  search?: "available" | "unavailable";
  /** The manifest cannot be reached (no signal). */
  manifestDown?: boolean;
  /** How the listing files of the current release are answered. */
  file?: "ok" | "fail" | "truncated" | "invalid";
  /** Providers left out of the listing files. */
  drop?: string[];
  /** The catalogue hash the manifest and the listing files carry (the default is CATALOGUE_HASH). */
  hash?: string;
  /** Every request made to the release routes: "GET /path". */
  requests: string[];
};

export const newServer = (release: number): DirectoryServer => ({ release, requests: [] });

/** The tile provider's tile URLs (the default MAP_TILE_URL): the map, and the small map of a provider's page on a desktop. */
export const TILE_URL = /^https:\/\/[a-d]\.basemaps\.cartocdn\.com\/light_all\/\d+\/\d+\/\d+\.png$/;

// A 1 by 1 grey PNG: Leaflet draws each tile 256 pixels square.
export const GREY_TILE = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGN4AQAA6gDp3uJOLwAAAABJRU5ErkJggg==", "base64");

/**
 * Answers the release routes from `server`, for every page of the browser context (a second tab, a popup, a page opened by a
 * link), not only the one that was passed.
 */
export async function stubDirectory(page: Page, server: DirectoryServer) {
  const context = page.context();
  await context.route("**/api/directory/manifest", (route: Route) => {
    server.requests.push("GET /api/directory/manifest");
    return server.manifestDown ? route.abort("internetdisconnected") : route.fulfill({ json: buildManifest(server.release, server.hash, server.search), headers: { "Cache-Control": "no-store" } });
  });
  await context.route(/\/api\/directory\/\d+\/[A-Za-z-]+\.json$/, (route: Route) => {
    const url = new URL(route.request().url());
    server.requests.push(`GET ${url.pathname}`);
    const [, , , release, file] = url.pathname.split("/");
    const lang = file.replace(".json", "") as Lang;
    const listing = buildListing(lang, Number(release), { drop: server.drop, hash: server.hash });
    switch (server.file ?? "ok") {
      case "fail":
        return route.fulfill({ status: 503, json: { v: 1, error: { code: "unavailable", message_key: "directory.unavailable" } } });
      case "truncated":
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(listing).slice(0, 400) });
      case "invalid":
        return route.fulfill({ json: { ...listing, providers: [{ id: "nope" }] } });
      default:
        return route.fulfill({ json: listing, headers: { "Cache-Control": "public, max-age=31536000, immutable" } });
    }
  });
  // A provider's page on a desktop draws a small map of the whole area: its tiles are a plain grey tile here, as on the map.
  await context.route(TILE_URL, (route: Route) =>
    route.fulfill({ body: GREY_TILE, contentType: "image/png", headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "max-age=86400" } }),
  );
}
