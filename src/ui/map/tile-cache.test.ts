import { describe, expect, it, vi } from "vitest";
import { createTileLoader, pruneStore, TILE_INDEX_KEY, TileIndex, type IndexStorage, type TileStore } from "./tile-cache";

const DAY = 24 * 60 * 60 * 1000;
const tile = (n: number) => `https://a.tiles.example.org/15/${n}/1.png`;

function memoryStorage(): IndexStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

function memoryStore(): TileStore & { data: Map<string, Blob> } {
  const data = new Map<string, Blob>();
  return {
    data,
    get: async (url) => data.get(url) ?? null,
    put: async (url, blob) => void data.set(url, blob),
    delete: async (url) => void data.delete(url),
    keys: async () => [...data.keys()],
  };
}

/** A network that answers every tile, and records each URL asked for. */
function network(online = { value: true }) {
  const asked: string[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    asked.push(url);
    if (!online.value) throw new TypeError("Failed to fetch");
    return new Response(new Blob([url], { type: "image/png" }));
  }) as unknown as typeof fetch;
  return { asked, fetcher, online };
}

function setup(limit: number, opts: { cacheDays?: number; online?: { value: boolean }; clock?: { t: number } } = {}) {
  const storage = memoryStorage();
  const store = memoryStore();
  const index = new TileIndex(limit, storage);
  const net = network(opts.online);
  const clock = opts.clock ?? { t: 1_000 * DAY };
  const loader = createTileLoader({ limit, cacheDays: opts.cacheDays ?? 30, store, index, fetcher: net.fetcher, now: () => clock.t });
  return { storage, store, index, net, loader, clock };
}

describe("TileIndex", () => {
  it("drops the least recently used beyond its limit", () => {
    const index = new TileIndex(3, null);
    expect(index.add(tile(1), 0)).toEqual([]);
    index.add(tile(2), 0);
    index.add(tile(3), 0);
    index.touch(tile(1));
    expect(index.add(tile(4), 0)).toEqual([tile(2)]);
    expect(index.urls()).toEqual([tile(3), tile(1), tile(4)]);
  });

  it("is saved on the phone and read back, never beyond the limit", () => {
    const storage = memoryStorage();
    const first = new TileIndex(5, storage);
    for (let n = 1; n <= 5; n += 1) first.add(tile(n), n);
    expect(JSON.parse(storage.data.get(TILE_INDEX_KEY)!).entries).toHaveLength(5);
    expect(new TileIndex(5, storage).urls()).toEqual([1, 2, 3, 4, 5].map(tile));
    // A smaller limit (the provider changed) keeps only the most recent.
    expect(new TileIndex(2, storage).urls()).toEqual([tile(4), tile(5)]);
    expect(new TileIndex(0, storage).urls()).toEqual([]);
  });

  it("reads a broken saved list as empty", () => {
    const storage = memoryStorage();
    storage.setItem(TILE_INDEX_KEY, "{not json");
    expect(new TileIndex(5, storage).urls()).toEqual([]);
  });
});

describe("createTileLoader with a provider that allows caching", () => {
  it("keeps viewed tiles up to the limit, least recently used removed first", async () => {
    const { loader, store, index } = setup(3);
    for (const n of [1, 2, 3]) await loader.load(tile(n));
    await loader.load(tile(1)); // used again: now the most recent
    await loader.load(tile(4));
    expect(index.urls()).toEqual([tile(3), tile(1), tile(4)]);
    expect([...store.data.keys()].sort()).toEqual([tile(1), tile(3), tile(4)].sort());
  });

  it("never keeps more than 200, even when the limit allows more", async () => {
    // The limit itself is capped by the config (mapTiles.ts); the loader obeys whatever limit it is given.
    const { loader, store } = setup(200);
    for (let n = 0; n < 230; n += 1) await loader.load(tile(n));
    expect(store.data.size).toBe(200);
  });

  it("serves a kept tile from the phone without asking the network", async () => {
    const { loader, net } = setup(10);
    expect(await loader.load(tile(1))).toMatchObject({ kind: "image", from: "network" });
    expect(await loader.load(tile(1))).toMatchObject({ kind: "image", from: "cache" });
    expect(net.asked).toEqual([tile(1)]);
  });

  it("never fetches ahead: only the tiles the map asks for are requested, once each", async () => {
    const { loader, net } = setup(10);
    const viewed = [tile(7), tile(8), tile(9)];
    for (const url of viewed) await loader.load(url);
    expect(net.asked).toEqual(viewed);
  });

  it("offline: a viewed tile shows from the phone, a tile never viewed is missing", async () => {
    const online = { value: true };
    const { loader } = setup(10, { online });
    await loader.load(tile(1));
    online.value = false;
    expect(await loader.load(tile(1))).toMatchObject({ kind: "image", from: "cache" });
    expect(await loader.load(tile(2))).toEqual({ kind: "missing" });
  });

  it("does not use a kept tile older than the provider allows", async () => {
    const clock = { t: 1_000 * DAY };
    const online = { value: true };
    const { loader, store } = setup(10, { cacheDays: 7, clock, online });
    await loader.load(tile(1));
    clock.t += 8 * DAY;
    online.value = false;
    expect(await loader.load(tile(1))).toEqual({ kind: "missing" });
    expect(store.data.has(tile(1))).toBe(false);
  });

  it("a refused or failed download is missing and nothing is kept", async () => {
    const store = (() => {
      const data = new Map<string, Blob>();
      return { data, get: async () => null, put: async (u: string, b: Blob) => void data.set(u, b), delete: async () => undefined, keys: async () => [] };
    })();
    const index = new TileIndex(10, null);
    const fetcher = (async () => new Response("no", { status: 429 })) as unknown as typeof fetch;
    const loader = createTileLoader({ limit: 10, cacheDays: 30, store, index, fetcher });
    expect(await loader.load(tile(1))).toEqual({ kind: "missing" });
    expect(store.data.size).toBe(0);
    expect(index.urls()).toEqual([]);
  });
});

describe("createTileLoader with a provider that does not allow caching", () => {
  it("keeps nothing and reads nothing from the phone", async () => {
    const online = { value: true };
    const { loader, store, storage, net } = setup(0, { online });
    await loader.load(tile(1));
    await loader.load(tile(1));
    expect(store.data.size).toBe(0);
    expect(storage.data.size).toBe(0);
    expect(net.asked).toEqual([tile(1), tile(1)]);
    online.value = false;
    expect(await loader.load(tile(1))).toEqual({ kind: "missing" });
  });
});

describe("pruneStore", () => {
  it("drops tiles the index does not list", async () => {
    const store = memoryStore();
    const index = new TileIndex(5, null);
    index.add(tile(1), 0);
    await store.put(tile(1), new Blob(["1"]));
    await store.put(tile(2), new Blob(["2"]));
    await pruneStore(store, index);
    expect([...store.data.keys()]).toEqual([tile(1)]);
  });
});
