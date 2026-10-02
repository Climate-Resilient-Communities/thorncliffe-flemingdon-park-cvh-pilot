// The phone's copy of the map tiles it has shown (S02.07, AR-3). Only when the tile provider's terms allow it
// (MapTileConfig.cacheable), only tiles the map actually drew, at most the provider's limit and never more than 200, the
// least recently used dropped first, each for no longer than the provider allows. Nothing is ever downloaded ahead of
// being viewed: the loader fetches exactly the tile it is asked for, when the map asks for it.
//
// The tiles are kept on the phone (Cache Storage), and the list of which ones (their URLs, so the parts of the map this
// phone has looked at) in localStorage. Neither ever leaves the phone (AD-3).

export const TILE_INDEX_KEY = "cvh.map.tiles";
export const TILE_CACHE_NAME = "cvh-map-tiles-v1";

const DAY_MS = 24 * 60 * 60 * 1000;

export type IndexStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Where the tile images are kept. */
export interface TileStore {
  get(url: string): Promise<Blob | null>;
  put(url: string, blob: Blob): Promise<void>;
  delete(url: string): Promise<void>;
  /** Every URL the store holds, to drop what the index no longer lists. */
  keys(): Promise<string[]>;
}

type Entry = { url: string; savedAt: number };

/**
 * Which tiles are kept, least recently used first, at most `limit` of them. Saved to `storage` after every change, so it
 * survives the page; a list that cannot be read or saved only means nothing is kept.
 */
export class TileIndex {
  private entries: Entry[];

  constructor(
    readonly limit: number,
    private readonly storage: IndexStorage | null,
  ) {
    this.entries = limit > 0 ? read(storage).slice(-limit) : [];
  }

  /** The kept tile's entry, or null. */
  lookup(url: string): Entry | null {
    return this.entries.find((entry) => entry.url === url) ?? null;
  }

  /** Marks a kept tile as just used: it is the last to be dropped. */
  touch(url: string): void {
    const at = this.entries.findIndex((entry) => entry.url === url);
    if (at < 0 || at === this.entries.length - 1) return;
    const [entry] = this.entries.splice(at, 1);
    this.entries.push(entry);
    this.save();
  }

  /** Records a tile as kept (or kept again) and returns the URLs that must be dropped to stay within the limit. */
  add(url: string, savedAt: number): string[] {
    if (this.limit <= 0) return [url];
    this.entries = this.entries.filter((entry) => entry.url !== url);
    this.entries.push({ url, savedAt });
    const dropped = this.entries.length > this.limit ? this.entries.splice(0, this.entries.length - this.limit).map((entry) => entry.url) : [];
    this.save();
    return dropped;
  }

  remove(url: string): void {
    const before = this.entries.length;
    this.entries = this.entries.filter((entry) => entry.url !== url);
    if (this.entries.length !== before) this.save();
  }

  /** The kept URLs, least recently used first. */
  urls(): string[] {
    return this.entries.map((entry) => entry.url);
  }

  private save(): void {
    if (!this.storage) return;
    try {
      if (this.entries.length === 0) this.storage.removeItem(TILE_INDEX_KEY);
      else this.storage.setItem(TILE_INDEX_KEY, JSON.stringify({ v: 1, entries: this.entries }));
    } catch {
      // A full or blocked store: the tiles are still drawn, they are just not remembered.
    }
  }
}

function read(storage: IndexStorage | null): Entry[] {
  if (!storage) return [];
  try {
    const value = JSON.parse(storage.getItem(TILE_INDEX_KEY) ?? "null") as { v?: unknown; entries?: unknown } | null;
    if (value?.v !== 1 || !Array.isArray(value.entries)) return [];
    return value.entries.filter((entry): entry is Entry => typeof entry?.url === "string" && typeof entry?.savedAt === "number");
  } catch {
    return [];
  }
}

export type TileResult = { kind: "image"; blob: Blob; from: "cache" | "network" } | { kind: "missing" };

export type TileLoaderDeps = {
  /** 0: the provider does not allow keeping tiles, and nothing is read from or written to the store. */
  limit: number;
  /** How long a kept tile may be used, in days. */
  cacheDays: number;
  store: TileStore | null;
  index: TileIndex;
  fetcher?: typeof fetch;
  now?: () => number;
};

/**
 * Loads one tile the map is about to draw. A kept tile younger than `cacheDays` is used as it is (and becomes the most
 * recently used); otherwise the tile is downloaded, kept when the provider allows, and the least recently used tiles
 * beyond the limit are dropped. With no signal, a tile that was never kept is `missing`: the map draws a plain square
 * there and says that part of the map is not saved on the phone. Only the tile asked for is ever requested.
 */
export function createTileLoader(deps: TileLoaderDeps) {
  const fetcher = deps.fetcher ?? fetch;
  const now = deps.now ?? Date.now;
  const keeping = deps.limit > 0 && deps.store !== null;
  const maxAgeMs = deps.cacheDays * DAY_MS;

  async function fromStore(url: string): Promise<Blob | null> {
    if (!keeping) return null;
    const entry = deps.index.lookup(url);
    if (!entry) return null;
    if (now() - entry.savedAt > maxAgeMs) {
      deps.index.remove(url);
      await deps.store!.delete(url).catch(() => undefined);
      return null;
    }
    const blob = await deps.store!.get(url).catch(() => null);
    if (!blob) {
      deps.index.remove(url);
      return null;
    }
    deps.index.touch(url);
    return blob;
  }

  async function keep(url: string, blob: Blob): Promise<void> {
    if (!keeping) return;
    try {
      await deps.store!.put(url, blob);
    } catch {
      return;
    }
    for (const dropped of deps.index.add(url, now())) await deps.store!.delete(dropped).catch(() => undefined);
  }

  return {
    async load(url: string): Promise<TileResult> {
      const kept = await fromStore(url);
      if (kept) return { kind: "image", blob: kept, from: "cache" };
      try {
        // No cookies, and the Referer is the app's origin only (the browser's default policy): the provider learns
        // which tile was asked for, from which site, and nothing about the resident's choices.
        const response = await fetcher(url, { mode: "cors", credentials: "omit" });
        if (!response.ok) return { kind: "missing" };
        const blob = await response.blob();
        await keep(url, blob);
        return { kind: "image", blob, from: "network" };
      } catch {
        return { kind: "missing" };
      }
    },
  };
}

/** Drops kept tiles the index no longer lists (a page closed between keeping a tile and dropping an old one). */
export async function pruneStore(store: TileStore, index: TileIndex): Promise<void> {
  const listed = new Set(index.urls());
  for (const url of await store.keys().catch(() => [])) if (!listed.has(url)) await store.delete(url).catch(() => undefined);
}

/** The browser's Cache Storage as a TileStore, or null where there is none (an insecure page, a blocked store). */
export function cacheStorageStore(): TileStore | null {
  if (typeof caches === "undefined") return null;
  const open = () => caches.open(TILE_CACHE_NAME);
  return {
    async get(url) {
      const response = await (await open()).match(url);
      return response ? response.blob() : null;
    },
    async put(url, blob) {
      await (await open()).put(url, new Response(blob, { headers: { "Content-Type": blob.type || "image/png" } }));
    },
    async delete(url) {
      await (await open()).delete(url);
    },
    async keys() {
      return (await (await open()).keys()).map((request) => request.url);
    },
  };
}

/** Removes every kept tile and the index: for a provider that no longer allows keeping them. */
export async function clearKeptTiles(storage: IndexStorage | null): Promise<void> {
  try {
    storage?.removeItem(TILE_INDEX_KEY);
  } catch {
    // Nothing to remove.
  }
  if (typeof caches !== "undefined") await caches.delete(TILE_CACHE_NAME).catch(() => false);
}
