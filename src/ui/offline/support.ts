// The phone's side of offline reading (S02.12): asking once for storage that is kept, finding out whether this phone can
// keep pages at all, when the page on screen was stored, and which pages can be read without signal. Every function takes
// what it reads as arguments, so it is unit-tested without a browser (support.test.ts). Nothing here reaches the server.
import { CACHED_AT_HEADER, PAGES_CACHE_PREFIX, TITLE_HEADER, criticalPaths, offlinePath, pageKey, type PageMessage, type ServedAnswer } from "./protocol";

/** localStorage key: the phone was asked once to keep this site's storage (navigator.storage.persist()). */
export const PERSIST_ASKED_KEY = "cvh.offline.persist-asked";

type FlagStorage = Pick<Storage, "getItem" | "setItem">;

// When localStorage cannot be used, the question is asked once per open session instead.
let askedThisSession = false;

/** For tests: forget that the question was asked in this session. */
export function resetPersistAsked(): void {
  askedThisSession = false;
}

/**
 * Asks the browser once to keep the CVH's storage when the phone runs short of space (some browsers ask the resident).
 * Resolves to the browser's answer, or null when it was asked before or the browser cannot be asked.
 */
export async function askPersistOnce(storage: FlagStorage | null, manager: Pick<StorageManager, "persist"> | undefined): Promise<boolean | null> {
  if (!manager?.persist) return null;
  let asked = askedThisSession;
  try {
    asked ||= storage?.getItem(PERSIST_ASKED_KEY) === "1";
  } catch {
    // An unreadable store: fall back to this session.
  }
  if (asked) return null;
  askedThisSession = true;
  try {
    storage?.setItem(PERSIST_ASKED_KEY, "1");
  } catch {
    // Not kept: the session flag above stands in.
  }
  try {
    return await manager.persist();
  } catch {
    return null;
  }
}

export type OfflineSupport = "ok" | "limited";

export interface SupportEnv {
  /** navigator.serviceWorker, undefined where the browser has none. */
  serviceWorker?: Pick<ServiceWorkerContainer, "controller">;
  /** window.caches, undefined where the browser has none or blocks it. */
  caches?: Pick<CacheStorage, "keys" | "match">;
  /** Whether localStorage keeps what is written (choicesStore.storageUsable()). */
  storageUsable: boolean;
  estimate?: () => Promise<StorageEstimate>;
  origin: string;
  lang: string;
}

/** A store more full than this counts as full: the next page or release may not fit. */
export const FULL_SHARE = 0.9;

/**
 * Whether this phone keeps pages for reading without signal. "limited" when the browser has no service worker or cache,
 * localStorage cannot be used (choices then last for the open session only), the store is (nearly) full, or a service
 * worker is running but the numbers page it stores on install is missing (the browser cleared it or could not store it).
 */
export async function checkOfflineSupport(env: SupportEnv): Promise<OfflineSupport> {
  if (!env.serviceWorker || !env.caches || !env.storageUsable) return "limited";
  try {
    await env.caches.keys();
  } catch {
    return "limited";
  }
  try {
    const estimate = await env.estimate?.();
    if (estimate?.quota && estimate.usage !== undefined && estimate.usage / estimate.quota > FULL_SHARE) return "limited";
  } catch {
    // No estimate: nothing to say about space.
  }
  if (env.serviceWorker.controller) {
    const numbers = criticalPaths(env.lang)[1];
    try {
      if (!(await env.caches.match(pageKey(`${env.origin}${numbers}`)))) return "limited";
    } catch {
      return "limited";
    }
  }
  return "ok";
}

/** When the stored copy of the page at `path` was kept, or null when there is none (or the cache cannot be read). */
export async function keptAt(caches: Pick<CacheStorage, "match"> | undefined, origin: string, path: string): Promise<number | null> {
  try {
    const kept = await caches?.match(pageKey(`${origin}${path}`));
    const at = Number(kept?.headers.get(CACHED_AT_HEADER));
    return kept && Number.isFinite(at) && at > 0 ? at : null;
  } catch {
    return null;
  }
}

/**
 * Asks the service worker whether it answered this page's navigation from its cache. Resolves to when that copy was kept,
 * or null: the network answered, there is no worker, or it did not answer within `timeoutMs`.
 */
export function askServed(controller: Pick<ServiceWorker, "postMessage"> | null | undefined, timeoutMs = 1500): Promise<number | null> {
  if (!controller || typeof MessageChannel === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), timeoutMs);
    channel.port1.onmessage = (event: MessageEvent<ServedAnswer>) => {
      clearTimeout(timer);
      resolve(typeof event.data?.cachedAt === "number" ? event.data.cachedAt : null);
    };
    const message: PageMessage = { type: "cvh:served" };
    try {
      controller.postMessage(message, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

export type KeptPage = { path: string; title: string | null; cachedAt: number | null };

/**
 * The pages of `lang` this phone can read without signal, home first and then by title; not the offline page itself.
 * Read from the service worker's page caches; an empty list when they cannot be read.
 */
export async function listKeptPages(caches: Pick<CacheStorage, "keys" | "open"> | undefined, origin: string, lang: string): Promise<KeptPage[]> {
  if (!caches) return [];
  const found = new Map<string, KeptPage>();
  try {
    for (const name of await caches.keys()) {
      if (!name.startsWith(PAGES_CACHE_PREFIX)) continue;
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const url = new URL(request.url);
        const path = url.pathname;
        if (url.origin !== origin || path === offlinePath(lang) || !(path === `/${lang}` || path.startsWith(`/${lang}/`))) continue;
        const response = await cache.match(request);
        const rawTitle = response?.headers.get(TITLE_HEADER);
        let title: string | null = null;
        try {
          title = rawTitle ? decodeURIComponent(rawTitle) : null;
        } catch {
          title = null;
        }
        const at = Number(response?.headers.get(CACHED_AT_HEADER));
        found.set(path, { path, title, cachedAt: Number.isFinite(at) && at > 0 ? at : null });
      }
    }
  } catch {
    return [];
  }
  const home = `/${lang}`;
  return [...found.values()].sort((a, b) => (a.path === home ? -1 : b.path === home ? 1 : (a.title ?? a.path).localeCompare(b.title ?? b.path)));
}
