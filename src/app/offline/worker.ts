// What the service worker does with a request, when it installs and when it takes over (S02.12, AD-1), apart from the
// service worker's own events (src/app/sw.ts) so it runs in a unit test with an in-memory cache (worker.test.ts).
// The rules for which request is handled how are in rules.ts.
import type { LaunchCode } from "@/i18n/languages";
import {
  CACHED_AT_HEADER,
  DATA_CACHE,
  FALLBACK_HEADER,
  FEED_VERSION_HEADER,
  KEPT_AT_META,
  PAGES_CACHE_PREFIX,
  TITLE_HEADER,
  criticalPaths,
  offlinePath,
  pageKey,
} from "@/ui/offline/protocol";
import {
  cachesToDelete,
  classify,
  directoryFilesToDelete,
  isSubscriptionPath,
  langOf,
  mayStore,
  pagesCache,
  shouldKeepFeed,
  staticCache,
  titleOf,
} from "./rules";

/** How long a page may take before the kept copy is shown instead (the network answer still updates the copy). */
export const PAGE_TIMEOUT_MS = 6_000;
/** The same for the directory manifest, below the phone's own 8 s limit. The feed has none here: the page owns its 20 s limit (S02.11, spine S02.12). */
export const DATA_TIMEOUT_MS = 6_000;
/** At most this many pages kept by the previous build are fetched again when a new build installs; the rest go. */
export const REFRESH_LIMIT = 20;
/** Pages fetched at the same time while installing, so an older phone on weak signal is not flooded. */
const INSTALL_CONCURRENCY = 3;

export interface WorkerEnv {
  caches: CacheStorage;
  fetch: typeof fetch;
  /** The CVH's origin: nothing from another origin is answered or stored. */
  origin: string;
  /** This worker's build (rules.buildIdOf): its page and static caches carry it. */
  build: string;
  now?: () => number;
  pageTimeoutMs?: number;
  dataTimeoutMs?: number;
}

/** What the worker needs from a fetch event. */
export interface FetchContext {
  waitUntil(promise: Promise<unknown>): void;
  /** The window this navigation will become (FetchEvent.resultingClientId). */
  resultingClientId?: string;
}

type NetResult = { response: Response } | { error: unknown } | { timedOut: true };

export interface OfflineWorker {
  /** The response for a request the worker handles, or null when the worker leaves it to the network (rules.classify). */
  handle(request: Request, context: FetchContext): Promise<Response> | null;
  /**
   * Stores what a new build needs before it may take over: home, the numbers page and the offline page in every language
   * open in a window or kept by the previous build. Rejects when any of them cannot be stored, so the browser drops this
   * worker and the previous one keeps working. Then, as far as signal allows, it fetches again the pages the open windows
   * show and up to REFRESH_LIMIT pages the previous build kept.
   */
  install(windowUrls: readonly string[]): Promise<void>;
  /** Removes the pages and static files of every other build. */
  activate(): Promise<void>;
  /** Keeps a resident page the phone moved to without loading a document (a Next link). */
  keepPage(path: string): Promise<void>;
  /** When the kept page that answered the navigation of `clientId` was stored, or null if the network answered it. */
  servedFor(clientId: string): number | null;
}

export function createOfflineWorker(env: WorkerEnv): OfflineWorker {
  const now = env.now ?? Date.now;
  const pageTimeout = env.pageTimeoutMs ?? PAGE_TIMEOUT_MS;
  const dataTimeout = env.dataTimeoutMs ?? DATA_TIMEOUT_MS;
  const pages = pagesCache(env.build);
  const statics = staticCache(env.build);
  const served = new Map<string, number>();
  const warming = new Map<LaunchCode, Promise<void>>();

  /** The network's answer, or that it failed, or that it took longer than `ms` (`full` still settles later); null waits for the network. */
  function fetchWithin(request: Request | string, ms: number | null, init?: RequestInit): { first: Promise<NetResult>; full: Promise<Response> } {
    const full = env.fetch(request, init);
    const first = new Promise<NetResult>((resolve) => {
      const timer = ms === null ? null : setTimeout(() => resolve({ timedOut: true }), ms);
      full.then(
        (response) => {
          if (timer !== null) clearTimeout(timer);
          resolve({ response });
        },
        (error: unknown) => {
          if (timer !== null) clearTimeout(timer);
          resolve({ error });
        },
      );
    });
    return { first, full };
  }

  /** A kept response, or null. A cache that cannot be opened (storage blocked or cleared) is the same as an empty one. */
  async function match(cacheName: string, key: string): Promise<Response | null> {
    try {
      const cache = await env.caches.open(cacheName);
      return (await cache.match(key)) ?? null;
    } catch {
      return null;
    }
  }

  /** Every write goes through here: refused for anything rules.mayStore refuses; a full or blocked store keeps nothing. */
  async function put(cacheName: string, key: string, response: Response): Promise<boolean> {
    if (!mayStore(key, env.origin)) return false;
    try {
      const cache = await env.caches.open(cacheName);
      await cache.put(key, response);
      return true;
    } catch {
      return false;
    }
  }

  /** A kept response handed out because the network did not answer: marked so the page never takes it as current. */
  function fallback(kept: Response): Response {
    const headers = new Headers(kept.headers);
    headers.set(FALLBACK_HEADER, "1");
    return new Response(kept.body, { status: 200, statusText: "OK", headers });
  }

  const keepable = (response: Response) =>
    response.status === 200 && response.type !== "opaqueredirect" && !response.redirected && (response.headers.get("content-type") ?? "").includes("text/html");

  /** Stores a page under its key, with the time and its title. The whole body is read first: a page cut short is not kept. */
  async function storePage(key: string, response: Response): Promise<boolean> {
    let html: string;
    try {
      html = await response.text();
    } catch {
      return false;
    }
    const headers = new Headers({ "content-type": response.headers.get("content-type") ?? "text/html; charset=utf-8", [CACHED_AT_HEADER]: String(now()) });
    const title = titleOf(html);
    if (title) headers.set(TITLE_HEADER, encodeURIComponent(title));
    return put(pages, key, new Response(html, { status: 200, headers }));
  }

  /** Fetches a resident page as a document and keeps it. False when it could not be fetched completely or kept. */
  async function fetchAndStore(path: string): Promise<boolean> {
    const url = `${env.origin}${path}`;
    const handling = classify({ method: "GET", url, mode: "navigate", headers: new Headers({ accept: "text/html" }) }, env.origin);
    if (handling.kind !== "page") return false;
    try {
      const response = await env.fetch(url, { credentials: "same-origin", headers: { accept: "text/html" } });
      return keepable(response) && (await storePage(pageKey(url), response));
    } catch {
      return false;
    }
  }

  /** Stores whatever of a language's critical pages is missing (a language the phone has just started to use). */
  function ensureLanguage(lang: LaunchCode): Promise<void> {
    const running = warming.get(lang);
    if (running) return running;
    const work = (async () => {
      for (const path of criticalPaths(lang)) {
        if (!(await match(pages, pageKey(`${env.origin}${path}`)))) await fetchAndStore(path);
      }
    })().finally(() => warming.delete(lang));
    warming.set(lang, work);
    return work;
  }

  /**
   * A kept page handed out because the network did not answer, with the time it was stored written into the document itself
   * (<meta name="cvh-kept-at">), so the page can say "last loaded" from its own first render, with or without signal, and
   * whether or not the browser has stopped this worker since (the in-memory `served` list below is only a second source).
   */
  async function fallbackPage(kept: Response, cachedAt: number): Promise<Response> {
    let html: string;
    try {
      html = await kept.text();
    } catch {
      return fallback(kept);
    }
    const marked = Number.isFinite(cachedAt) ? html.replace(/<head(\s[^>]*)?>/i, (head) => `${head}<meta name="${KEPT_AT_META}" content="${cachedAt}">`) : html;
    const headers = new Headers(kept.headers);
    headers.set(FALLBACK_HEADER, "1");
    return new Response(marked, { status: 200, statusText: "OK", headers });
  }

  /** The kept page, or the offline page of its language; null when neither is kept. */
  async function keptPage(key: string, lang: LaunchCode, context: FetchContext): Promise<Response | null> {
    const kept = await match(pages, key);
    if (kept) {
      const cachedAt = Number(kept.headers.get(CACHED_AT_HEADER));
      if (context.resultingClientId && Number.isFinite(cachedAt)) {
        served.set(context.resultingClientId, cachedAt);
        // Only the last few windows matter; the map must not grow for as long as the worker lives.
        if (served.size > 20) served.delete(served.keys().next().value as string);
      }
      return fallbackPage(kept, cachedAt);
    }
    const offline = await match(pages, pageKey(`${env.origin}${offlinePath(lang)}`));
    return offline ? fallback(offline) : null;
  }

  /** The server says this page does not exist (any more): the copy kept for it is not offered again. */
  async function forget(key: string): Promise<void> {
    try {
      const cache = await env.caches.open(pages);
      await cache.delete(key);
    } catch {
      // A store that cannot be opened keeps nothing to remove.
    }
  }

  async function page(request: Request, lang: LaunchCode, context: FetchContext): Promise<Response> {
    const key = pageKey(request.url);
    const { first, full } = fetchWithin(request, pageTimeout);
    const result = await first;
    if ("response" in result) {
      const response = result.response;
      if (keepable(response)) {
        context.waitUntil(storePage(key, response.clone()));
        context.waitUntil(ensureLanguage(lang));
        return response;
      }
      // A 404 or a redirect is the server's answer; a 404 or 410 also removes the copy kept for that address (an alert that no
      // longer resolves is not offered again). A server error is not an answer: a kept copy is better than an error page.
      if (response.status === 404 || response.status === 410) context.waitUntil(forget(key));
      if (response.status < 500) return response;
      return (await keptPage(key, lang, context)) ?? response;
    }
    if ("timedOut" in result) {
      context.waitUntil(full.then((response) => (keepable(response) ? storePage(key, response.clone()) : false)).catch(() => false));
    }
    const kept = await keptPage(key, lang, context);
    if (kept) return kept;
    // Nothing kept: wait for the slow network after all, or let the browser show its own page for no connection.
    return "timedOut" in result ? full : Response.error();
  }

  /** The feed and the manifest: the network's answer when there is one; the kept copy, marked, when there is not or (manifest only) when it is slower than `timeoutMs`. */
  async function networkFirst(request: Request, context: FetchContext, store: (response: Response) => Promise<unknown>, timeoutMs: number | null): Promise<Response> {
    const { first, full } = fetchWithin(request, timeoutMs);
    const result = await first;
    if ("response" in result && result.response.ok) {
      context.waitUntil(store(result.response.clone()));
      return result.response;
    }
    if ("timedOut" in result) {
      context.waitUntil(full.then((response) => (response.ok ? store(response.clone()) : false)).catch(() => false));
    }
    const kept = await match(DATA_CACHE, request.url);
    if (kept) return fallback(kept);
    if ("response" in result) return result.response;
    return "timedOut" in result ? full : Response.error();
  }

  /** The newest feed_version kept for any language (the version is one counter for the whole feed). */
  async function highestFeedKept(): Promise<number | null> {
    try {
      const cache = await env.caches.open(DATA_CACHE);
      let highest: number | null = null;
      for (const request of await cache.keys()) {
        if (new URL(request.url).pathname !== "/api/feed") continue;
        const version = Number((await cache.match(request))?.headers.get(FEED_VERSION_HEADER));
        if (Number.isFinite(version) && (highest === null || version > highest)) highest = version;
      }
      return highest;
    } catch {
      return null;
    }
  }

  async function storeFeed(url: string, response: Response): Promise<boolean> {
    let text: string;
    let version: unknown;
    try {
      text = await response.text();
      version = (JSON.parse(text) as { feed_version?: unknown }).feed_version;
    } catch {
      return false;
    }
    if (typeof version !== "number" || !shouldKeepFeed(version, await highestFeedKept())) return false;
    const headers = new Headers({ "content-type": "application/json; charset=utf-8", [CACHED_AT_HEADER]: String(now()), [FEED_VERSION_HEADER]: String(version) });
    return put(DATA_CACHE, url, new Response(text, { status: 200, headers }));
  }

  async function storeJson(url: string, response: Response): Promise<boolean> {
    let text: string;
    try {
      text = await response.text();
      JSON.parse(text);
    } catch {
      return false;
    }
    const headers = new Headers({ "content-type": "application/json; charset=utf-8", [CACHED_AT_HEADER]: String(now()) });
    return put(DATA_CACHE, url, new Response(text, { status: 200, headers }));
  }

  /** Keeps a complete release file, then removes the files of older releases (S02.12: once a newer release is loaded). */
  async function storeDirectory(url: string, release: number, response: Response): Promise<void> {
    let body: ArrayBuffer;
    try {
      body = await response.arrayBuffer();
    } catch {
      return;
    }
    const headers = new Headers(response.headers);
    headers.set(CACHED_AT_HEADER, String(now()));
    if (!(await put(DATA_CACHE, url, new Response(body, { status: 200, headers })))) return;
    try {
      const cache = await env.caches.open(DATA_CACHE);
      const urls = (await cache.keys()).map((request) => request.url);
      await Promise.all(directoryFilesToDelete(urls, release).map((old) => cache.delete(old)));
    } catch {
      // Old files that stay only take room; the next newer release removes them.
    }
  }

  async function directory(request: Request, release: number, context: FetchContext): Promise<Response> {
    const kept = await match(DATA_CACHE, request.url);
    if (kept) return kept;
    const response = await env.fetch(request);
    if (response.status === 200) context.waitUntil(storeDirectory(request.url, release, response.clone()));
    return response;
  }

  async function staticFile(request: Request, context: FetchContext): Promise<Response> {
    const kept = await match(statics, request.url);
    if (kept) return kept;
    const response = await env.fetch(request);
    if (response.status === 200 && response.type !== "opaque") context.waitUntil(put(statics, request.url, response.clone()));
    return response;
  }

  /** Runs `work` over `items`, a few at a time. */
  async function inBatches<T, R>(items: readonly T[], work: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = [];
    for (let at = 0; at < items.length; at += INSTALL_CONCURRENCY) {
      results.push(...(await Promise.all(items.slice(at, at + INSTALL_CONCURRENCY).map(work))));
    }
    return results;
  }

  /** The paths of the pages the previous builds kept. */
  async function previousPages(): Promise<string[]> {
    try {
      const names = (await env.caches.keys()).filter((name) => name.startsWith(PAGES_CACHE_PREFIX) && name !== pages);
      const paths: string[] = [];
      for (const name of names) {
        const cache = await env.caches.open(name);
        for (const request of await cache.keys()) paths.push(new URL(request.url).pathname);
      }
      return paths;
    } catch {
      return [];
    }
  }

  return {
    handle(request, context) {
      const handling = classify(request, env.origin);
      switch (handling.kind) {
        case "page":
          return page(request, handling.lang, context);
        case "feed":
          return networkFirst(request, context, (response) => storeFeed(request.url, response), null);
        case "manifest":
          return networkFirst(request, context, (response) => storeJson(request.url, response), dataTimeout);
        case "directory":
          return directory(request, handling.release, context);
        case "static":
          return staticFile(request, context);
        case "pass":
          return null;
      }
    },

    async install(windowUrls) {
      const langs = new Set<LaunchCode>();
      const wanted: string[] = [];
      const note = (path: string) => {
        const lang = langOf(path);
        if (lang === null || isSubscriptionPath(path)) return;
        langs.add(lang);
        if (!wanted.includes(path)) wanted.push(path);
      };
      for (const raw of windowUrls) {
        try {
          const url = new URL(raw);
          if (url.origin === env.origin) note(new URL(pageKey(url)).pathname);
        } catch {
          // Not a URL of ours.
        }
      }
      const open = wanted.length;
      for (const path of await previousPages()) note(path);

      const critical = [...langs].flatMap(criticalPaths);
      const stored = await inBatches(critical, fetchAndStore);
      if (stored.some((ok) => !ok)) throw new Error("The pages a resident needs without signal could not all be stored; the previous version stays.");
      // The open windows' pages first, then up to REFRESH_LIMIT of what the previous build kept, as far as signal allows.
      const rest = wanted.slice(0, open + REFRESH_LIMIT).filter((path) => !critical.includes(path));
      await inBatches(rest, fetchAndStore);
    },

    async activate() {
      try {
        const names = await env.caches.keys();
        await Promise.all(cachesToDelete(names, env.build).map((name) => env.caches.delete(name)));
      } catch {
        // Nothing to remove when the store cannot be read.
      }
    },

    async keepPage(path) {
      const lang = langOf(path);
      if (lang === null) return;
      await fetchAndStore(new URL(pageKey(`${env.origin}${path}`)).pathname);
      await ensureLanguage(lang);
    },

    servedFor(clientId) {
      return served.get(clientId) ?? null;
    },
  };
}
