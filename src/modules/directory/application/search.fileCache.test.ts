// The shared cache of a release's files for cold search instances (the app's Vercel Data Cache), through the real search use case
// over fakes of the database, the store, the cache and the Cohere client. Nothing here reaches Supabase, Vercel or a vendor.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTimings } from "@/platform/serverTiming";
import {
  BINARY_PATH,
  LISTING_PATH,
  RELEASE_V,
  releaseBinary,
  releaseDb,
  releaseFiles,
  releaseRow,
  releaseStore,
} from "../../../../test/helpers/searchRelease";
import {
  cohereQueryEmbedder,
  type CohereEmbedClient,
} from "../adapters/cohereEmbedder";
import type { ReleaseFileCache } from "./ports";
import { createSearch, type SearchService } from "./search";

const QUESTION = {
  q: "Where can I find a family doctor near Thorncliffe?",
  lang: "en" as const,
  v: RELEASE_V,
};

const client: CohereEmbedClient = {
  v2: {
    embed: async () => ({
      embeddings: { float: [[1, 0]] },
      meta: { billedUnits: { inputTokens: 4 } },
    }),
  },
};

/** A fake of the shared cache: entries by the key's three parts; `loads` are the misses that went to the store. */
function fakeCache(
  options: {
    fail?: boolean;
    tamper?: boolean;
    entries?: Map<string, Uint8Array>;
  } = {},
) {
  const entries = options.entries ?? new Map<string, Uint8Array>();
  const keys: string[] = [];
  const loads: string[] = [];
  const cache: ReleaseFileCache = {
    async read(key, load) {
      if (options.fail) throw new Error("data cache unavailable");
      const name = `${key.release}/${key.sha256}/${key.path}`;
      keys.push(name);
      let held = entries.get(name);
      if (!held) {
        loads.push(key.path);
        held = await load();
        entries.set(name, held.slice());
      }
      const out = held.slice();
      if (options.tamper) out[out.length - 1] ^= 0xff;
      return out;
    },
  };
  return { cache, entries, keys, loads };
}

describe("the release files of a cold instance through the shared cache", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const binary = releaseBinary();
  const row = () => releaseRow(releaseFiles(), binary);
  const store = () => releaseStore({ bytes: new Map([[BINARY_PATH, binary]]) });

  function service(parts: {
    store: ReturnType<typeof releaseStore>;
    cache?: ReleaseFileCache;
  }): SearchService {
    return createSearch({
      db: () => releaseDb({ row: row() }).db,
      storage: () => parts.store.storage,
      ...(parts.cache ? { fileCache: parts.cache } : {}),
      embedder: cohereQueryEmbedder({ apiKey: "test-key", client }),
      writer: { log: async () => undefined, spend: async () => undefined },
      clock: () => Date.now(),
    });
  }

  async function ask(search: SearchService) {
    const timings = createTimings();
    const pending = search.search(QUESTION, undefined, timings);
    pending.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(5_000);
    const answer = await pending;
    return { answer, header: timings.header() };
  }

  it("downloads from the store once, for the first instance, and flags it cold; the next cold instance reads the cache and flags it cache", async () => {
    const shared = fakeCache();
    const first = store();
    const a = await ask(service({ store: first, cache: shared.cache }));
    expect(a.answer.status).toBe("ok");
    expect(a.header).toMatch(/snapshot;dur=\d+(?:\.\d)?;desc=cold/);
    expect(first.gets.sort()).toEqual([BINARY_PATH, LISTING_PATH].sort());

    // A second instance: new memory, the same shared cache, and a store that must not be asked.
    const second = store();
    const b = await ask(service({ store: second, cache: shared.cache }));
    expect(b.answer.status).toBe("ok");
    expect(b.answer.results).toEqual(a.answer.results);
    expect(b.header).toMatch(/snapshot;dur=\d+(?:\.\d)?;desc=cache/);
    expect(b.header).not.toContain("desc=cold");
    expect(second.gets).toEqual([]);
  });

  it("names an entry by release, sha256 and path, for the binary vectors and the English listing", async () => {
    const shared = fakeCache();
    await ask(service({ store: store(), cache: shared.cache }));
    const record = row();
    expect(shared.keys.sort()).toEqual(
      [
        `${RELEASE_V}/${record.search.binary!.sha256}/${BINARY_PATH}`,
        `${RELEASE_V}/${record.files.en.sha256}/${LISTING_PATH}`,
      ].sort(),
    );
  });

  it("does not flag the snapshot at all once the instance holds the data, cache or not", async () => {
    const shared = fakeCache();
    const search = service({ store: store(), cache: shared.cache });
    await ask(search);
    const again = await ask(search);
    expect(again.header).not.toMatch(/desc=/);
    expect(shared.keys).toHaveLength(2);
  });

  it("checks the sha256 of cached bytes: a cache that returns wrong bytes is bypassed and the store's bytes are used", async () => {
    const shared = fakeCache({ tamper: true });
    const s = store();
    const result = await ask(service({ store: s, cache: shared.cache }));
    expect(result.answer.status).toBe("ok");
    expect(result.header).toContain("desc=cold");
    // The store is read once per file, for the cache's miss; the bypass reuses those bytes.
    expect(s.gets.sort()).toEqual([BINARY_PATH, LISTING_PATH].sort());
  });

  it("gives up on a cache read that never answers and reads the store, within the timeout", async () => {
    const hanging: ReleaseFileCache = { read: () => new Promise<Uint8Array>(() => undefined) };
    const s = store();
    const search = createSearch({
      db: () => releaseDb({ row: row() }).db,
      storage: () => s.storage,
      fileCache: hanging,
      fileCacheTimeoutMs: 1_000,
      embedder: cohereQueryEmbedder({ apiKey: "test-key", client }),
      writer: { log: async () => undefined, spend: async () => undefined },
      clock: () => Date.now(),
    });
    const result = await ask(search);
    expect(result.answer.status).toBe("ok");
    expect(result.header).toContain("desc=cold");
    expect(s.gets.sort()).toEqual([BINARY_PATH, LISTING_PATH].sort());
  });

  it("still fails with the load's own code when the store's bytes are wrong, and never caches them", async () => {
    const shared = fakeCache();
    const bad = releaseStore({
      bytes: new Map([
        [
          BINARY_PATH,
          releaseBinary().map((b, i, all) =>
            i === all.length - 1 ? b ^ 0xff : b,
          ),
        ],
      ]),
    });
    const failed = ask(service({ store: bad, cache: shared.cache }));
    await expect(failed).rejects.toMatchObject({ code: "search_unavailable" });
    // The cache was asked, but its load refused the wrong bytes, so nothing is kept.
    expect(shared.entries.size).toBe(1);
    expect(
      [...shared.entries.keys()].some((name) => name.endsWith(BINARY_PATH)),
    ).toBe(false);
  });

  it("reads the store directly when the cache fails, and answers", async () => {
    const s = store();
    const result = await ask(
      service({ store: s, cache: fakeCache({ fail: true }).cache }),
    );
    expect(result.answer.status).toBe("ok");
    expect(result.header).toContain("desc=cold");
    expect(s.gets.sort()).toEqual([BINARY_PATH, LISTING_PATH].sort());
  });

  it("without a cache the store is read as before and flagged cold", async () => {
    const s = store();
    const result = await ask(service({ store: s }));
    expect(result.header).toContain("desc=cold");
    expect(s.gets).toHaveLength(2);
  });
});
