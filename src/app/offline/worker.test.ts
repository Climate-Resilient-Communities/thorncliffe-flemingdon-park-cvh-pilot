import { beforeEach, describe, expect, it } from "vitest";
import { FakeCaches } from "../../../test/helpers/fake-caches";
import { TILE_CACHE_NAME } from "@/ui/map/tile-cache";
import { CACHED_AT_HEADER, DATA_CACHE, FALLBACK_HEADER, KEPT_AT_META, TITLE_HEADER } from "@/ui/offline/protocol";
import { FEED_TIMEOUT_MS } from "@/ui/offline/protocol";
import { FEED_WORKER_TIMEOUT_MS, createOfflineWorker, type FetchContext } from "./worker";

const ORIGIN = "https://cvh.example";
const BUILD = "b2";

type Answer = { status?: number; body?: string; type?: string; headers?: Record<string, string> } | "hang";

/** A network of fixed answers by path; `down` makes every request fail as it does without signal. */
class Network {
  down = false;
  answers = new Map<string, Answer>();
  requests: string[] = [];
  /** Paths that fail even with signal (a request cut off halfway through an install). */
  failing = new Set<string>();

  fetch = async (input: RequestInfo | URL, ...rest: [RequestInit?]): Promise<Response> => {
    void rest;
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const key = `${url.pathname}${url.search}`;
    this.requests.push(key);
    if (this.down || this.failing.has(url.pathname)) throw new TypeError("Failed to fetch");
    const answer = this.answers.get(key) ?? this.answers.get(url.pathname);
    if (answer === "hang") return new Promise<Response>(() => {});
    if (!answer) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
    return new Response(answer.body ?? "", { status: answer.status ?? 200, headers: answer.headers ?? {} });
  };
}

const html = (title: string) => ({ body: `<!doctype html><html><head><title>${title}</title></head><body>${title}</body></html>`, headers: { "content-type": "text/html; charset=utf-8" } });
const json = (value: unknown, headers: Record<string, string> = {}) => ({ body: JSON.stringify(value), headers: { "content-type": "application/json", ...headers } });

function navigation(path: string): Request {
  // Node's Request cannot be made with mode "navigate"; an HTML Accept header classifies it the same way.
  return new Request(`${ORIGIN}${path}`, { headers: { accept: "text/html" } });
}

function context(resultingClientId?: string): FetchContext & { settled: () => Promise<unknown> } {
  const waits: Promise<unknown>[] = [];
  return { waitUntil: (promise) => waits.push(promise), resultingClientId, settled: async () => {
    // Waits may add more waits (a page stores itself, then its language's pages).
    for (let seen = 0; seen < waits.length; seen = waits.length) await Promise.all(waits.slice(seen));
  } };
}

let caches: FakeCaches;
let net: Network;
let clock: number;

function worker(options: { pageTimeoutMs?: number; dataTimeoutMs?: number; build?: string } = {}) {
  return createOfflineWorker({ caches: caches.asCacheStorage, fetch: net.fetch, origin: ORIGIN, build: options.build ?? BUILD, now: () => clock, ...options });
}

function servePages(lang = "en") {
  net.answers.set(`/${lang}`, html("Community Virtual Hub"));
  net.answers.set(`/${lang}/ready/numbers`, html("Numbers I might need"));
  net.answers.set(`/${lang}/offline`, html("This page is not saved on your phone"));
  net.answers.set(`/${lang}/ready`, html("Be ready"));
  net.answers.set(`/${lang}/ready/heat`, html("Extreme heat"));
}

async function respond(w: ReturnType<typeof worker>, request: Request, ctx = context()): Promise<Response> {
  const response = await w.handle(request, ctx);
  await ctx.settled();
  if (!response) throw new Error(`not handled: ${request.url}`);
  return response;
}

beforeEach(() => {
  caches = new FakeCaches();
  net = new Network();
  clock = 1_000_000;
  servePages("en");
});

describe("pages: network first, kept for later, the kept copy without signal (S02.12)", () => {
  it("answers from the network with signal and keeps the page with its time and title, and its language's pages", async () => {
    const w = worker();
    const response = await respond(w, navigation("/en/ready/heat"));
    expect(response.headers.get(FALLBACK_HEADER)).toBeNull();
    expect(await response.text()).toContain("Extreme heat");
    const kept = await caches.match(`${ORIGIN}/en/ready/heat`);
    expect(kept?.headers.get(CACHED_AT_HEADER)).toBe(String(clock));
    expect(decodeURIComponent(kept?.headers.get(TITLE_HEADER) ?? "")).toBe("Extreme heat");
    // Home, the numbers page and the offline page of the language are kept as soon as the language is used.
    for (const path of ["/en", "/en/ready/numbers", "/en/offline"]) expect(await caches.match(`${ORIGIN}${path}`), path).toBeDefined();
    expect([...caches.stores.keys()]).toEqual([`cvh-pages-${BUILD}`]);
  });

  it("without signal answers with the kept copy, marked, and remembers which window it answered", async () => {
    const w = worker();
    await respond(w, navigation("/en/ready/heat"));
    clock += 60_000;
    net.down = true;
    const response = await respond(w, navigation("/en/ready/heat?from=home"), context("window-1"));
    expect(response.status).toBe(200);
    expect(response.headers.get(FALLBACK_HEADER)).toBe("1");
    expect(await response.text()).toContain("Extreme heat");
    expect(w.servedFor("window-1")).toBe(1_000_000);
    expect(w.servedFor("window-2")).toBeNull();
  });

  it("without signal answers a page never kept with the offline page of its language", async () => {
    const w = worker();
    await respond(w, navigation("/en"));
    net.down = true;
    const response = await respond(w, navigation("/en/terms"));
    expect(response.headers.get(FALLBACK_HEADER)).toBe("1");
    expect(await response.text()).toContain("This page is not saved on your phone");
  });

  it("with nothing kept at all leaves the browser to show its own page (a first visit without signal)", async () => {
    net.down = true;
    const response = await respond(worker(), navigation("/en"));
    expect(response.type).toBe("error");
  });

  it("on a slow network shows the kept copy after the timeout and still keeps the late answer", async () => {
    const w = worker({ pageTimeoutMs: 20 });
    await respond(w, navigation("/en/ready/heat"));
    let release: (r: Response) => void = () => {};
    const late = new Promise<Response>((resolve) => (release = resolve));
    const slowFetch = net.fetch;
    const slow = createOfflineWorker({ caches: caches.asCacheStorage, fetch: (input, init) => (String(input instanceof Request ? input.url : input).endsWith("/en/ready/heat") ? late : slowFetch(input, init)), origin: ORIGIN, build: BUILD, now: () => clock, pageTimeoutMs: 20 });
    clock = 2_000_000;
    const ctx = context();
    const response = await slow.handle(navigation("/en/ready/heat"), ctx);
    expect(response?.headers.get(FALLBACK_HEADER)).toBe("1");
    release(new Response(html("Extreme heat, updated").body, { headers: { "content-type": "text/html" } }));
    await ctx.settled();
    const kept = await caches.match(`${ORIGIN}/en/ready/heat`);
    expect(await kept?.text()).toContain("updated");
    expect(kept?.headers.get(CACHED_AT_HEADER)).toBe("2000000");
  });

  it("returns a 404 as the server's answer and keeps nothing; a server error falls back to the kept copy", async () => {
    const w = worker();
    const missing = await respond(w, navigation("/en/nowhere"));
    expect(missing.status).toBe(404);
    expect(await caches.match(`${ORIGIN}/en/nowhere`)).toBeUndefined();
    await respond(w, navigation("/en/ready"));
    net.answers.set("/en/ready", { status: 500, body: "boom", headers: { "content-type": "text/html" } });
    const failed = await respond(w, navigation("/en/ready"));
    expect(failed.headers.get(FALLBACK_HEADER)).toBe("1");
    expect(await failed.text()).toContain("Be ready");
  });

  it("an alert page (R-07, closed or open) is the server's answer with signal and only ever the kept copy, marked, without it (S04.08, S05.03)", async () => {
    const w = worker();
    net.answers.set("/en/alerts/kbcdfghj", html("Elevator out of service"));
    net.answers.set("/en/alerts/rslvdabc", html("Power is back"));
    await respond(w, navigation("/en/alerts/kbcdfghj"));
    await respond(w, navigation("/en/alerts/rslvdabc"));
    // With signal the page is what the server says now, not what was kept: an update replaces it at once.
    clock += 60_000;
    net.answers.set("/en/alerts/kbcdfghj", html("Elevator back in service"));
    const live = await respond(w, navigation("/en/alerts/kbcdfghj"), context("window-1"));
    expect(live.headers.get(FALLBACK_HEADER)).toBeNull();
    expect(await live.text()).toContain("Elevator back in service");
    expect(w.servedFor("window-1")).toBeNull();
    // An alert that has since closed is the server's 404 or its closed page, never the kept open one.
    net.answers.set("/en/alerts/rslvdabc", { status: 404, body: "gone", headers: { "content-type": "text/html" } });
    expect((await respond(w, navigation("/en/alerts/rslvdabc"))).status).toBe(404);
    // The server said the address does not exist: its kept copy is gone, so later without signal the offline page shows instead.
    expect(await caches.match(`${ORIGIN}/en/alerts/rslvdabc`)).toBeUndefined();

    clock += 60_000;
    net.down = true;
    const kept = await respond(w, navigation("/en/alerts/kbcdfghj"), context("window-2"));
    expect(kept.headers.get(FALLBACK_HEADER)).toBe("1");
    expect(await kept.text()).toContain("Elevator back in service");
    // The page is told when the copy was stored (the note says "last loaded {time}"), the time of the last answer it kept.
    expect(w.servedFor("window-2")).toBe(1_060_000);
    // The alert the server no longer knows is not offered from the phone either.
    const forgotten = await respond(w, navigation("/en/alerts/rslvdabc"));
    expect(await forgotten.text()).toContain("This page is not saved on your phone");
    // An alert never opened is the offline page, not another alert.
    const never = await respond(w, navigation("/en/alerts/mnpqrstv"));
    expect(never.headers.get(FALLBACK_HEADER)).toBe("1");
    expect(await never.text()).toContain("This page is not saved on your phone");
  });

  it("a kept page handed out while the network is up (a server error, a timeout) carries when it was stored in the document itself", async () => {
    const w = worker({ pageTimeoutMs: 20 });
    net.answers.set("/en/alerts/kbcdfghj", html("Elevator out of service"));
    await respond(w, navigation("/en/alerts/kbcdfghj"));
    // The server fails: no connection problem, so only the document can say the copy is old (no worker memory is consulted).
    clock += 90_000;
    net.answers.set("/en/alerts/kbcdfghj", { status: 503, body: "down", headers: { "content-type": "text/html" } });
    const failed = await respond(w, navigation("/en/alerts/kbcdfghj"));
    expect(failed.headers.get(FALLBACK_HEADER)).toBe("1");
    const failedHtml = await failed.text();
    expect(failedHtml).toContain("Elevator out of service");
    expect(failedHtml).toContain(`<meta name="${KEPT_AT_META}" content="1000000">`);
    // Too slow: the same.
    net.answers.set("/en/alerts/kbcdfghj", "hang");
    // (not through respond(): the hanging request's own wait never settles)
    const slow = await w.handle(navigation("/en/alerts/kbcdfghj"), context());
    expect(await slow?.text()).toContain(`<meta name="${KEPT_AT_META}" content="1000000">`);
    // The network's own answer never carries it.
    net.answers.set("/en/alerts/kbcdfghj", html("Elevator back in service"));
    expect(await (await respond(w, navigation("/en/alerts/kbcdfghj"))).text()).not.toContain(KEPT_AT_META);
  });

  it("keeps a page the phone moved to inside the app (a Next link)", async () => {
    const w = worker();
    await w.keepPage("/en/ready/heat");
    expect(await caches.match(`${ORIGIN}/en/ready/heat`)).toBeDefined();
    expect(await caches.match(`${ORIGIN}/en/ready/numbers`)).toBeDefined();
  });

  it("keeps working online when the phone's storage is blocked or full", async () => {
    caches.blocked = true;
    const blocked = worker();
    const response = await respond(blocked, navigation("/en/ready/heat"));
    expect(await response.text()).toContain("Extreme heat");
    net.down = true;
    expect((await respond(blocked, navigation("/en/ready/heat"))).type).toBe("error");

    caches = new FakeCaches();
    caches.failPuts = true;
    net.down = false;
    const full = worker();
    expect(await (await respond(full, navigation("/en/ready"))).text()).toContain("Be ready");
    expect(caches.everything()).toEqual([]);
  });
});

describe("never stored: the staff surface, subscriptions, map tiles (AD-1, S02.07)", () => {
  it("does not handle them, so nothing about them is ever written", async () => {
    const w = worker();
    const passed = [
      navigation("/staff/sign-in"),
      new Request(`${ORIGIN}/api/staff/me`),
      navigation("/en/subscription"),
      new Request(`${ORIGIN}/api/subscription/x`),
      new Request("https://a.basemaps.cartocdn.com/light_all/15/9161/11958.png"),
      new Request(`${ORIGIN}/api/search`, { method: "POST", body: "{}" }),
      new Request(`${ORIGIN}/api/buildings`),
    ];
    for (const request of passed) expect(w.handle(request, context()), request.url).toBeNull();
    await w.keepPage("/staff/sign-in");
    await w.keepPage("/en/subscription");
    await w.install([`${ORIGIN}/staff/sign-in`, `${ORIGIN}/en/subscription`, `${ORIGIN}/en`]);
    const stored = caches.everything();
    expect(stored.length).toBeGreaterThan(0);
    for (const entry of stored) {
      expect(entry).not.toMatch(/\/staff(\/|$)|\/api\/staff\/|subscription|basemaps|tile/);
    }
    expect(caches.stores.has(TILE_CACHE_NAME)).toBe(false);
  });
});

describe("the feed: never shown stale as fresh (S02.11, AD-17)", () => {
  const feed = (version: number) => ({ v: 1, feed_version: version, generated_at: "2026-10-01T12:00:00.000Z", threads: [], statuses: [] });

  it("answers from the network with signal, unmarked, and keeps the copy", async () => {
    net.answers.set("/api/feed?lang=en", json(feed(7)));
    const w = worker();
    const response = await respond(w, new Request(`${ORIGIN}/api/feed?lang=en`));
    expect(response.headers.get(FALLBACK_HEADER)).toBeNull();
    expect((await caches.open(DATA_CACHE)).entries.has(`${ORIGIN}/api/feed?lang=en`)).toBe(true);
  });

  it("without signal answers with the kept copy, marked as such and with when it was kept", async () => {
    net.answers.set("/api/feed?lang=en", json(feed(7)));
    const w = worker();
    await respond(w, new Request(`${ORIGIN}/api/feed?lang=en`));
    net.down = true;
    const response = await respond(w, new Request(`${ORIGIN}/api/feed?lang=en`));
    expect(response.headers.get(FALLBACK_HEADER)).toBe("1");
    expect(response.headers.get(CACHED_AT_HEADER)).toBe(String(clock));
    expect((await response.json()).feed_version).toBe(7);
  });

  it("answers from its kept copy before the page gives up on the feed, and the page owns the rest of the wait", () => {
    expect(FEED_WORKER_TIMEOUT_MS).toBeLessThan(FEED_TIMEOUT_MS);
    expect(FEED_WORKER_TIMEOUT_MS).toBeGreaterThan(6_000);
  });

  it("serves a feed slower than the data limit as the server's answer, unmarked, and keeps it", async () => {
    net.answers.set("/api/feed?lang=en", json(feed(7)));
    await respond(worker(), new Request(`${ORIGIN}/api/feed?lang=en`));
    let release: (r: Response) => void = () => {};
    const late = new Promise<Response>((resolve) => (release = resolve));
    const slow = createOfflineWorker({ caches: caches.asCacheStorage, fetch: () => late, origin: ORIGIN, build: BUILD, now: () => clock, dataTimeoutMs: 20 });
    const ctx = context();
    const pending = slow.handle(new Request(`${ORIGIN}/api/feed?lang=en`), ctx);
    await new Promise((resolve) => setTimeout(resolve, 60));
    release(new Response(JSON.stringify(feed(8)), { headers: { "content-type": "application/json" } }));
    const response = await pending;
    await ctx.settled();
    expect(response?.headers.get(FALLBACK_HEADER)).toBeNull();
    expect((await response?.json()).feed_version).toBe(8);
    expect((await caches.match(`${ORIGIN}/api/feed?lang=en`))?.headers.get("x-cvh-feed-version")).toBe("8");
  });

  it("serves the kept feed, marked, when the network hangs past the feed limit (a resident on a very weak signal)", async () => {
    net.answers.set("/api/feed?lang=en", json(feed(7)));
    await respond(worker(), new Request(`${ORIGIN}/api/feed?lang=en`));
    const hanging = createOfflineWorker({ caches: caches.asCacheStorage, fetch: () => new Promise<Response>(() => {}), origin: ORIGIN, build: BUILD, now: () => clock, feedTimeoutMs: 20 });
    const response = await hanging.handle(new Request(`${ORIGIN}/api/feed?lang=en`), context());
    expect(response?.headers.get(FALLBACK_HEADER)).toBe("1");
    expect((await response?.json()).feed_version).toBe(7);
  });

  it("still gives up on a slow directory manifest after the data limit", async () => {
    net.answers.set("/api/directory/manifest", json({ v: 1 }));
    await respond(worker(), new Request(`${ORIGIN}/api/directory/manifest`));
    const slow = createOfflineWorker({ caches: caches.asCacheStorage, fetch: () => new Promise<Response>(() => {}), origin: ORIGIN, build: BUILD, now: () => clock, dataTimeoutMs: 20 });
    const response = await slow.handle(new Request(`${ORIGIN}/api/directory/manifest`), context());
    expect(response?.headers.get(FALLBACK_HEADER)).toBe("1");
  });

  it("never replaces a kept feed with an older one, in any language", async () => {
    const w = worker();
    net.answers.set("/api/feed?lang=en", json(feed(9)));
    await respond(w, new Request(`${ORIGIN}/api/feed?lang=en`));
    net.answers.set("/api/feed?lang=en", json(feed(8)));
    net.answers.set("/api/feed?lang=ur", json(feed(8)));
    const older = await respond(w, new Request(`${ORIGIN}/api/feed?lang=en`));
    // The network's answer still reaches the page (it discards it itself); only the kept copy stays the newer.
    expect((await older.json()).feed_version).toBe(8);
    await respond(w, new Request(`${ORIGIN}/api/feed?lang=ur`));
    net.down = true;
    expect((await (await respond(w, new Request(`${ORIGIN}/api/feed?lang=en`))).json()).feed_version).toBe(9);
    expect((await respond(w, new Request(`${ORIGIN}/api/feed?lang=ur`))).type).toBe("error");
  });

  it("keeps the highest feed_version of answers served out of order (S05.07), and without signal serves that one, whatever order they came in", async () => {
    const w = worker();
    for (const version of [9, 8, 11, 10, 7]) {
      net.answers.set("/api/feed?lang=en", json(feed(version)));
      await respond(w, new Request(`${ORIGIN}/api/feed?lang=en`));
    }
    net.down = true;

    const kept = await respond(w, new Request(`${ORIGIN}/api/feed?lang=en`));

    expect(kept.headers.get(FALLBACK_HEADER)).toBe("1");
    expect(kept.headers.get("x-cvh-feed-version")).toBe("11");
    expect((await kept.json()).feed_version).toBe(11);
  });

  it("takes an equal version again, which only refreshes when it was kept", async () => {
    const w = worker();
    net.answers.set("/api/feed?lang=en", json(feed(4)));
    await respond(w, new Request(`${ORIGIN}/api/feed?lang=en`));
    const first = clock;
    clock += 5_000;
    await respond(w, new Request(`${ORIGIN}/api/feed?lang=en`));
    net.down = true;

    const kept = await respond(w, new Request(`${ORIGIN}/api/feed?lang=en`));

    expect(Number(kept.headers.get(CACHED_AT_HEADER))).toBe(first + 5_000);
  });

  it("with nothing kept and no signal, fails as the network does", async () => {
    net.down = true;
    expect((await respond(worker(), new Request(`${ORIGIN}/api/feed?lang=en`))).type).toBe("error");
  });
});

describe("the directory: manifest network first, release files cache first (S02.05)", () => {
  const manifest = (release: number) => ({ v: 1, release_v: release, files: { en: `/api/directory/${release}/en.json` } });

  it("answers the manifest from the network, and the last copy, marked, without signal", async () => {
    net.answers.set("/api/directory/manifest", json(manifest(4), { "cache-control": "no-store" }));
    const w = worker();
    expect((await respond(w, new Request(`${ORIGIN}/api/directory/manifest`))).headers.get(FALLBACK_HEADER)).toBeNull();
    net.answers.set("/api/directory/manifest", json(manifest(5)));
    expect((await (await respond(w, new Request(`${ORIGIN}/api/directory/manifest`))).json()).release_v).toBe(5);
    net.down = true;
    const fallback = await respond(w, new Request(`${ORIGIN}/api/directory/manifest`));
    expect(fallback.headers.get(FALLBACK_HEADER)).toBe("1");
    expect((await fallback.json()).release_v).toBe(5);
  });

  it("keeps a complete release file, answers it from the cache after, and removes older releases once a newer is kept", async () => {
    const w = worker();
    net.answers.set("/api/directory/4/en.json", json({ release_v: 4 }));
    net.answers.set("/api/directory/4/ur.json", json({ release_v: 4 }));
    net.answers.set("/api/directory/5/en.json", json({ release_v: 5 }));
    await respond(w, new Request(`${ORIGIN}/api/directory/4/en.json`));
    await respond(w, new Request(`${ORIGIN}/api/directory/4/ur.json`));
    net.down = true;
    expect((await (await respond(w, new Request(`${ORIGIN}/api/directory/4/en.json`))).json()).release_v).toBe(4);
    net.down = false;
    await respond(w, new Request(`${ORIGIN}/api/directory/5/en.json`));
    const kept = [...(await caches.open(DATA_CACHE)).entries.keys()];
    expect(kept).toEqual([`${ORIGIN}/api/directory/5/en.json`]);
  });

  it("does not keep an error answer for a release file", async () => {
    net.answers.set("/api/directory/6/en.json", { status: 503, body: "{}", headers: { "cache-control": "no-store" } });
    await respond(worker(), new Request(`${ORIGIN}/api/directory/6/en.json`));
    expect(caches.everything()).toEqual([]);
  });
});

describe("a new build: install, take over, clean up (S02.12)", () => {
  it("stores home, the numbers page and the offline page of every language in use before it may take over", async () => {
    servePages("ur");
    const w = worker();
    await w.install([`${ORIGIN}/ur/ready/heat`, "https://elsewhere.example/en"]);
    for (const path of ["/ur", "/ur/ready/numbers", "/ur/offline", "/ur/ready/heat"]) {
      expect((await caches.open(`cvh-pages-${BUILD}`)).entries.has(`${ORIGIN}${path}`), path).toBe(true);
    }
    expect(net.requests.some((path) => path.startsWith("/en"))).toBe(false);
  });

  it("fails the install when signal is lost before the critical pages are stored, so the previous version stays", async () => {
    const old = worker({ build: "b1" });
    await old.install([`${ORIGIN}/en`]);
    net.failing.add("/en/ready/numbers");
    await expect(worker({ build: "b2" }).install([`${ORIGIN}/en`])).rejects.toThrow();
    // The previous build's pages are untouched and still answer without signal.
    net.down = true;
    const response = await respond(old, navigation("/en/ready/numbers"));
    expect(await response.text()).toContain("Numbers I might need");
  });

  it("fetches again the pages the previous build kept, and its languages' critical pages, as far as signal allows", async () => {
    servePages("ur");
    const old = worker({ build: "b1" });
    await respond(old, navigation("/ur/ready/heat"));
    await respond(old, navigation("/en/ready"));
    net.failing.add("/en/ready");
    const next = worker({ build: "b2" });
    await next.install([]);
    const kept = [...(await caches.open("cvh-pages-b2")).entries.keys()].map((url) => new URL(url).pathname).sort();
    expect(kept).toEqual(["/en", "/en/offline", "/en/ready/numbers", "/ur", "/ur/offline", "/ur/ready/heat", "/ur/ready/numbers"]);
  });

  it("removes the previous build's pages and static files when it takes over, and leaves map tiles and data alone", async () => {
    await caches.open("cvh-pages-b1");
    await caches.open("cvh-static-b1");
    await caches.open(TILE_CACHE_NAME);
    await caches.open(DATA_CACHE);
    await caches.open(`cvh-pages-${BUILD}`);
    await worker().activate();
    expect([...caches.stores.keys()].sort()).toEqual([DATA_CACHE, TILE_CACHE_NAME, `cvh-pages-${BUILD}`].sort());
  });
});

describe("static files", () => {
  it("are kept as they are used and answered from the build's cache after", async () => {
    net.answers.set("/_next/static/media/font.woff2", { body: "font", headers: { "content-type": "font/woff2" } });
    const w = worker();
    expect((await respond(w, new Request(`${ORIGIN}/_next/static/media/font.woff2`))).status).toBe(200);
    net.down = true;
    expect(await (await respond(w, new Request(`${ORIGIN}/_next/static/media/font.woff2`))).text()).toBe("font");
    expect([...caches.stores.keys()]).toEqual([`cvh-static-${BUILD}`]);
  });
});
