// What the service worker (src/app/sw.ts, S02.12) and the pages agree on: the worker's address, the names of its
// caches, the headers it puts on what it keeps, and the messages a page may send it. Nothing here runs anything.

/** Where the service worker is served from (src/app/serwist/[path]/route.ts). Its scope is the whole origin. */
export const SW_URL = "/serwist/sw.js";
export const SW_SCOPE = "/";

/**
 * The header with which the worker marks a response it took from its cache because the network did not answer. A response
 * that carries it is not the server's answer: the manifest and the feed are then not current (load-directory.ts, use-feed.ts).
 */
export const FALLBACK_HEADER = "x-cvh-fallback";
/** When (ms since 1970, the phone's clock) the worker stored a response: "Last updated" for a page, the feed or the manifest. */
export const CACHED_AT_HEADER = "x-cvh-cached-at";
/**
 * The <meta> the worker writes into a kept page it hands out instead of the network's answer: its content is when (ms since
 * 1970) that copy was stored. The page reads it on its first render to say "last loaded" (offline-support.tsx).
 */
export const KEPT_AT_META = "cvh-kept-at";
/** A kept page's <title>, URI-encoded, for the offline page's list of what can be read without signal. */
export const TITLE_HEADER = "x-cvh-title";
/** A kept feed's `feed_version`, so the worker never replaces a feed with an older one (AD-17). */
export const FEED_VERSION_HEADER = "x-cvh-feed-version";

/** Pages of one build: `cvh-pages-{build}`. A page refers to that build's scripts, so the two go together. */
export const PAGES_CACHE_PREFIX = "cvh-pages-";
/** Fonts and images of one build that were not precached: `cvh-static-{build}`. */
export const STATIC_CACHE_PREFIX = "cvh-static-";
/** The feed, the directory manifest and the directory release files. Not tied to a build: a release file never changes. */
export const DATA_CACHE = "cvh-data-v1";

/** The page a resident gets for a page of the CVH this phone has never kept, when there is no signal. */
export const offlinePath = (lang: string) => `/${lang}/offline`;

/**
 * What is stored when the worker installs, for every language the phone uses: home (the shell), the essential numbers and
 * the offline page, each with the 911 block. A new worker takes over only once all of them are stored.
 */
export const criticalPaths = (lang: string): string[] => [`/${lang}`, `/${lang}/ready/numbers`, offlinePath(lang)];

/** The key a page is kept under: its path without the query or a trailing slash (`/en/` and `/en?x=1` are `/en`). */
export function pageKey(url: URL | string): string {
  const parsed = typeof url === "string" ? new URL(url) : url;
  const path = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, "") : parsed.pathname;
  return `${parsed.origin}${path}`;
}

/** Messages a page sends the worker. */
export type PageMessage =
  /** The page moved to `path` without loading a document (a Next link): keep that page too. */
  | { type: "cvh:keep-page"; path: string }
  /** Was this page's document taken from the cache? Answered on the message's port with a ServedAnswer. */
  | { type: "cvh:served" };

/** `cachedAt` is set when the worker answered this page's navigation from its cache (no signal, or too slow). */
export type ServedAnswer = { cachedAt: number | null };

/** One feed ask is given up by the page after this long (S02.11); the worker answers from its kept copy before that (app/offline/worker.ts). */
export const FEED_TIMEOUT_MS = 20_000;
