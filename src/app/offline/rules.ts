// The service worker's rules (S02.12, AD-1), as plain functions so they are unit-tested (rules.test.ts) apart from the
// worker. Which request the worker answers and how, what it may ever store, and which caches it removes.
//
//   /{lang}/**                    a page: network first; the copy is kept; without signal the kept copy, or the offline page
//   /api/feed                     network first; the copy is kept unless older than one kept; without signal the kept
//                                 copy, marked x-cvh-fallback (never shown as current)
//   /api/directory/manifest       network first; the last copy kept, marked x-cvh-fallback when it stands in
//   /api/directory/{v}/{lang}.json  cache first (a release file never changes); older releases removed once a newer is kept
//   /_next/static/**, /brand/**, /icons/**  precached (scripts, styles) or cache first (fonts, images)
//   /a/{slug}?l={lang}            (the share link's landing, S05.08) not answered and never kept: it is the network's, and
//                                 its content follows `?l=`, which the kept pages' key leaves out. The alert page it
//                                 moves to and the share screen /{lang}/alerts/{slug}/share are pages like any other
//   /staff/ambassador/round, /api/staff/ambassador/round and /marks  (S08.07, the open check-in round page, AD-1's one exception: the page
//                                 keeps the round in its own memory only) never answered and never kept, whatever the request looks like; named
//                                 on their own, before the staff rule below, so no change to that rule can reach them
//   everything else               not answered by the worker at all: the browser goes to the network as if there were no
//                                 worker. That is every /staff/** and /api/staff/** request, every subscription page and API,
//                                 search, the building list, Next's own data requests (RSC), any request that is not a GET,
//                                 and every request to another origin, which includes every map tile: the map page keeps its
//                                 tiles itself (cvh-map-tiles-v1, S02.07), so they are not kept twice.
import { MARK_ROUTE, ROUND_PAGE, ROUND_ROUTE } from "@/contracts/roundPaths";
import { LAUNCH_CODES, type LaunchCode } from "@/i18n/languages";
import { TILE_CACHE_NAME } from "@/ui/map/tile-cache";
import { DATA_CACHE, PAGES_CACHE_PREFIX, STATIC_CACHE_PREFIX } from "@/ui/offline/protocol";

export type Handling =
  | { kind: "page"; lang: LaunchCode }
  | { kind: "feed" }
  | { kind: "manifest" }
  | { kind: "directory"; release: number }
  | { kind: "static" }
  | { kind: "pass"; reason: PassReason };

export type PassReason = "method" | "cross-origin" | "round" | "staff" | "subscription" | "next-data" | "worker" | "not-listed";

/** The parts of a request the rules read, so a test can pass a plain object. */
export interface RequestFacts {
  method: string;
  url: string;
  /** `navigate` for a document the browser loads. */
  mode?: string;
  headers: { get(name: string): string | null };
}

const LANGS = new Set<string>(LAUNCH_CODES);
const DIRECTORY_FILE = /^\/api\/directory\/(\d+)\/[A-Za-z-]+\.json$/;

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/**
 * S08.07: the open check-in round page, its read and its marks (AD-1: "once loaded, its data lives only in that page's memory"): never answered, never
 * stored, whatever the request looks like. They are staff paths as well; this rule names them on their own.
 */
export const isRoundPath = (path: string) => under(path, ROUND_PAGE) || under(path, ROUND_ROUTE) || under(path, MARK_ROUTE);

/** The staff surface and its API (AD-1): never answered, never stored. */
export const isStaffPath = (path: string) => under(path, "/staff") || under(path, "/api/staff");

/**
 * Subscription pages and API (AD-1): network only, never stored. S07.06's one-time web link is `/{lang}/subscription/{token}` (the token in
 * the address) and `/api/subscription/view`, `/change` and `/delete` (POSTs, which the worker never answers either).
 */
export function isSubscriptionPath(path: string): boolean {
  if (under(path, "/api/subscription")) return true;
  const [, first, second] = path.split("/");
  return LANGS.has(first) && second === "subscription";
}

/** The launch language a resident path starts with, or null. */
export function langOf(path: string): LaunchCode | null {
  const first = path.split("/")[1];
  return LANGS.has(first) ? (first as LaunchCode) : null;
}

const isStaticPath = (path: string) => path.startsWith("/_next/static/") || path.startsWith("/brand/") || path.startsWith("/icons/");

/** How the worker handles a request from a page of `origin`. */
export function classify(request: RequestFacts, origin: string): Handling {
  if (request.method !== "GET") return { kind: "pass", reason: "method" };
  const url = new URL(request.url);
  if (url.origin !== origin) return { kind: "pass", reason: "cross-origin" };
  const path = url.pathname;
  if (isRoundPath(path)) return { kind: "pass", reason: "round" };
  if (isStaffPath(path)) return { kind: "pass", reason: "staff" };
  if (isSubscriptionPath(path)) return { kind: "pass", reason: "subscription" };
  if (under(path, "/serwist")) return { kind: "pass", reason: "worker" };
  if (isStaticPath(path)) return { kind: "static" };
  if (path === "/api/feed") return { kind: "feed" };
  if (path === "/api/directory/manifest") return { kind: "manifest" };
  const file = DIRECTORY_FILE.exec(path);
  if (file) return { kind: "directory", release: Number(file[1]) };
  const lang = langOf(path);
  if (lang === null) return { kind: "pass", reason: "not-listed" };
  // Next's own data for a page drawn in the browser (React Server Components): it depends on what the page already shows,
  // so it is never kept. Without signal the request fails and Next loads the page as a document, which is kept.
  if (request.headers.get("rsc") !== null || url.searchParams.has("_rsc")) return { kind: "pass", reason: "next-data" };
  // A file under a language (the web app manifest) is not a page.
  if (/\.[A-Za-z0-9]+$/.test(path)) return { kind: "pass", reason: "not-listed" };
  if (request.mode === "navigate" || (request.headers.get("accept") ?? "").includes("text/html")) return { kind: "page", lang };
  return { kind: "pass", reason: "not-listed" };
}

/**
 * Whether a response for `url` may ever be written to a cache. Every write the worker makes goes through this (a second
 * line behind `classify`): only this origin, only the resident pages, the feed, the directory files and static files.
 * Never the check-in round page or its API (S08.07), `/staff/**`, `/api/staff/**`, subscription pages or API, or another origin (map tiles).
 */
export function mayStore(url: string, origin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.origin !== origin) return false;
  const path = parsed.pathname;
  if (isRoundPath(path) || isStaffPath(path) || isSubscriptionPath(path)) return false;
  if (isStaticPath(path) || path === "/api/feed" || path === "/api/directory/manifest" || DIRECTORY_FILE.test(path)) return true;
  return langOf(path) !== null && !/\.[A-Za-z0-9]+$/.test(path);
}

export const pagesCache = (build: string) => `${PAGES_CACHE_PREFIX}${build}`;
export const staticCache = (build: string) => `${STATIC_CACHE_PREFIX}${build}`;

/**
 * The caches a worker of `build` removes when it takes over: the pages and static files of every other build. Never the
 * map's tile cache, the data cache (a release file stays valid across deploys), Serwist's precache (Serwist cleans its own
 * entries) or anything the worker did not make.
 */
export function cachesToDelete(names: readonly string[], build: string): string[] {
  const own = new Set([pagesCache(build), staticCache(build)]);
  return names.filter((name) => name !== TILE_CACHE_NAME && name !== DATA_CACHE && !own.has(name) && (name.startsWith(PAGES_CACHE_PREFIX) || name.startsWith(STATIC_CACHE_PREFIX)));
}

/** The release a directory file URL belongs to, or null for any other URL. */
export function releaseOf(url: string): number | null {
  try {
    const match = DIRECTORY_FILE.exec(new URL(url).pathname);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

/** The kept directory files to remove once a file of release `kept` is stored: every file of an older release. */
export const directoryFilesToDelete = (urls: readonly string[], kept: number): string[] =>
  urls.filter((url) => {
    const release = releaseOf(url);
    return release !== null && release < kept;
  });

/** Whether a feed answer of `incoming` replaces the kept copy: never one older than the newest kept (AD-17). */
export const shouldKeepFeed = (incoming: number, highestKept: number | null) => highestKept === null || incoming >= highestKept;

/** A page's <title>, or null. Only the first title in the document; the few entities Next writes are decoded. */
export function titleOf(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) return null;
  const text = match[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
  return text === "" ? null : text;
}

/**
 * The build a worker belongs to, from its precache list (the scripts and styles of the build, each with its hash): a deploy
 * that changes any of them is a new build, with new page caches. FNV-1a, enough to tell builds apart.
 */
export function buildIdOf(entries: readonly (string | { url: string; revision?: string | null })[] | undefined): string {
  if (!entries || entries.length === 0) return "dev";
  let hash = 0x811c9dc5;
  const text = entries.map((entry) => (typeof entry === "string" ? entry : `${entry.url}#${entry.revision ?? ""}`)).join("\n");
  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
