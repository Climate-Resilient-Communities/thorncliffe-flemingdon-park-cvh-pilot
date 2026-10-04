import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeCaches } from "../../../test/helpers/fake-caches";
import { CACHED_AT_HEADER, TITLE_HEADER } from "./protocol";
import { askPersistOnce, checkOfflineSupport, keptAt, listKeptPages, PERSIST_ASKED_KEY, resetPersistAsked, type SupportEnv } from "./support";

const ORIGIN = "https://cvh.example";

function flags(): Pick<Storage, "getItem" | "setItem"> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}

async function keep(caches: FakeCaches, cache: string, path: string, title: string | null, at = 1_000) {
  const headers: Record<string, string> = { [CACHED_AT_HEADER]: String(at), "content-type": "text/html" };
  if (title) headers[TITLE_HEADER] = encodeURIComponent(title);
  await (await caches.open(cache)).put(`${ORIGIN}${path}`, new Response("<html></html>", { headers }));
}

beforeEach(() => resetPersistAsked());

describe("askPersistOnce", () => {
  it("asks the browser once, and remembers it on the phone", async () => {
    const storage = flags();
    const persist = vi.fn(async () => true);
    expect(await askPersistOnce(storage, { persist })).toBe(true);
    resetPersistAsked();
    expect(await askPersistOnce(storage, { persist })).toBeNull();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(storage.data.get(PERSIST_ASKED_KEY)).toBe("1");
  });

  it("asks once per open session when the phone keeps nothing", async () => {
    const persist = vi.fn(async () => false);
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(await askPersistOnce(broken, { persist })).toBe(false);
    expect(await askPersistOnce(broken, { persist })).toBeNull();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("does nothing where the browser cannot be asked", async () => {
    expect(await askPersistOnce(flags(), undefined)).toBeNull();
  });
});

describe("checkOfflineSupport: R-34's \"This phone may not keep pages for offline use\"", () => {
  const env = (caches: FakeCaches, change: Partial<SupportEnv> = {}): SupportEnv => ({
    serviceWorker: { controller: null },
    caches: caches as unknown as CacheStorage,
    storageUsable: true,
    estimate: async () => ({ usage: 10, quota: 1000 }),
    origin: ORIGIN,
    lang: "ur",
    ...change,
  });

  it("is ok with a service worker, a cache and space, before and after the worker has stored the numbers", async () => {
    const caches = new FakeCaches();
    expect(await checkOfflineSupport(env(caches))).toBe("ok");
    await keep(caches, "cvh-pages-b1", "/ur/ready/numbers", "Numbers");
    expect(await checkOfflineSupport(env(caches, { serviceWorker: { controller: {} as ServiceWorker } }))).toBe("ok");
  });

  it("is limited without a service worker or a cache, or when localStorage keeps nothing (choices last for the session)", async () => {
    const caches = new FakeCaches();
    expect(await checkOfflineSupport(env(caches, { serviceWorker: undefined }))).toBe("limited");
    expect(await checkOfflineSupport(env(caches, { caches: undefined }))).toBe("limited");
    expect(await checkOfflineSupport(env(caches, { storageUsable: false }))).toBe("limited");
    caches.blocked = true;
    expect(await checkOfflineSupport(env(caches))).toBe("limited");
  });

  it("is limited when the store is nearly full", async () => {
    expect(await checkOfflineSupport(env(new FakeCaches(), { estimate: async () => ({ usage: 950, quota: 1000 }) }))).toBe("limited");
  });

  it("is limited when a worker runs but the numbers page it stores on install is gone (cleared by the browser)", async () => {
    expect(await checkOfflineSupport(env(new FakeCaches(), { serviceWorker: { controller: {} as ServiceWorker } }))).toBe("limited");
  });
});

describe("what the phone kept", () => {
  it("says when a page's copy was kept, and nothing for a page never kept or a cache that cannot be read", async () => {
    const caches = new FakeCaches();
    await keep(caches, "cvh-pages-b1", "/en/ready", "Be ready", 4_242);
    expect(await keptAt(caches as unknown as CacheStorage, ORIGIN, "/en/ready")).toBe(4_242);
    expect(await keptAt(caches as unknown as CacheStorage, ORIGIN, "/en/ready/")).toBe(4_242);
    expect(await keptAt(caches as unknown as CacheStorage, ORIGIN, "/en/map")).toBeNull();
    expect(await keptAt(undefined, ORIGIN, "/en/ready")).toBeNull();
  });

  it("lists the language's kept pages, home first, by title, without the offline page or other languages", async () => {
    const caches = new FakeCaches();
    await keep(caches, "cvh-pages-b1", "/en/ready/numbers", "Numbers I might need");
    await keep(caches, "cvh-pages-b1", "/en/offline", "Not saved");
    await keep(caches, "cvh-pages-b1", "/en", "Community Virtual Hub");
    await keep(caches, "cvh-pages-b1", "/en/directory", "Services and organisations");
    await keep(caches, "cvh-pages-b1", "/ur", "CVH");
    await keep(caches, "cvh-map-tiles-v1", "/en/not-a-page", "x");
    await keep(caches, "cvh-pages-b1", "/en/ready/heat", null);
    const pages = await listKeptPages(caches as unknown as CacheStorage, ORIGIN, "en");
    expect(pages.map((page) => [page.path, page.title])).toEqual([
      ["/en", "Community Virtual Hub"],
      ["/en/ready/heat", null],
      ["/en/ready/numbers", "Numbers I might need"],
      ["/en/directory", "Services and organisations"],
    ]);
  });

  it("lists nothing when the caches cannot be read", async () => {
    const caches = new FakeCaches();
    caches.blocked = true;
    expect(await listKeptPages(caches as unknown as CacheStorage, ORIGIN, "en")).toEqual([]);
    expect(await listKeptPages(undefined, ORIGIN, "en")).toEqual([]);
  });
});
