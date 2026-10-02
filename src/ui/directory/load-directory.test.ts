import { describe, expect, it } from "vitest";
import { buildListing, buildManifest } from "../../../e2e/resident/directory-fixture";
import { CACHE_PREFIX, FALLBACK_HEADER, FETCH_TIMEOUT_MS, keep, keptState, loadDirectory, MANIFEST_URL, readKept, type DirectoryState, type KeptStorage } from "./load-directory";

/** A phone's storage in memory. */
function memory(limit = Infinity): KeptStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    key: (at) => [...data.keys()][at] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      const others = [...data].filter(([existing]) => existing !== key).reduce((total, [k, v]) => total + k.length + v.length, 0);
      if (others + key.length + value.length > limit) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      data.set(key, value);
    },
    removeItem: (key) => void data.delete(key),
  };
}

type Answers = {
  manifest?: unknown | "down";
  files?: Record<string, unknown | "down" | "short" | "hang">;
  /** URLs whose answers carry the header with which a service worker marks a response it made up (S02.12). */
  marked?: string[];
};

/** A fetch that answers the release routes and records what it was asked. */
function server(answers: Answers) {
  const asked: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    asked.push({ url, init });
    const answer = url === MANIFEST_URL ? answers.manifest : answers.files?.[url];
    if (answer === undefined || answer === "down") throw new TypeError("Failed to fetch");
    // A request that never answers, until its signal gives up.
    if (answer === "hang") return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    const headers = answers.marked?.includes(url) ? { [FALLBACK_HEADER]: "1" } : undefined;
    if (answer === "short") return new Response(JSON.stringify(buildListing("en", 8)).slice(0, 500), { status: 200, headers });
    return new Response(JSON.stringify(answer), { status: 200, headers });
  }) as typeof fetch;
  return { fetcher, asked };
}

const release = (n: number, lang: "en" | "ur" = "en") => ({ manifest: buildManifest(n), files: { [`/api/directory/${n}/${lang}.json`]: buildListing(lang, n) } });

describe("loadDirectory", () => {
  it("downloads the current release when nothing is kept, keeps it, and shows it as current", async () => {
    const storage = memory();
    const { fetcher, asked } = server(release(7));

    const state = await loadDirectory("en", { fetcher, storage });

    expect(state).toMatchObject({ status: "ready", current: true, publishedAt: "2026-10-01T15:00:00.000Z" });
    expect(state.status === "ready" && state.listing.release_v).toBe(7);
    expect(asked.map((a) => a.url)).toEqual([MANIFEST_URL, "/api/directory/7/en.json"]);
    expect(readKept(storage, "en")?.listing.release_v).toBe(7);
  });

  it("sends nothing about the resident: no credentials, no query, no body", async () => {
    const { fetcher, asked } = server(release(7));

    await loadDirectory("en", { fetcher, storage: memory() });

    for (const { url, init } of asked) {
      expect(url).not.toContain("?");
      expect(init?.credentials).toBe("omit");
      expect(init?.body).toBeUndefined();
      expect(init?.method ?? "GET").toBe("GET");
    }
  });

  it("does not download the file again when the kept listing is the current release", async () => {
    const storage = memory();
    await loadDirectory("en", { fetcher: server(release(7)).fetcher, storage });
    const { fetcher, asked } = server(release(7));

    const state = await loadDirectory("en", { fetcher, storage });

    expect(state).toMatchObject({ status: "ready", current: true });
    expect(asked.map((a) => a.url)).toEqual([MANIFEST_URL]);
  });

  it("downloads a newer release completely before it replaces the kept one", async () => {
    const storage = memory();
    await loadDirectory("en", { fetcher: server(release(7)).fetcher, storage });
    const seen: DirectoryState[] = [];

    const state = await loadDirectory("en", { fetcher: server(release(8)).fetcher, storage, onKept: (kept) => seen.push(kept) });

    expect(seen).toMatchObject([{ status: "ready", current: false }]);
    expect(seen[0].status === "ready" && seen[0].listing.release_v).toBe(7);
    expect(state.status === "ready" && state.listing.release_v).toBe(8);
    expect(readKept(storage, "en")?.listing.release_v).toBe(8);
  });

  it.each([
    ["the file cannot be downloaded", { files: { "/api/directory/8/en.json": "down" } }],
    ["the file is incomplete", { files: { "/api/directory/8/en.json": "short" } }],
    ["the file fails its schema", { files: { "/api/directory/8/en.json": { ...buildListing("en", 8), providers: [{ id: "nope" }] } } }],
    ["the file is another release than the manifest named", { files: { "/api/directory/8/en.json": buildListing("en", 9) } }],
    ["the file is another language", { files: { "/api/directory/8/en.json": buildListing("ur", 8) } }],
    ["the file was made from another catalogue than the manifest names", { files: { "/api/directory/8/en.json": buildListing("en", 8, { hash: "f".repeat(64) }) } }],
  ])("keeps showing the previous complete release, not as current, when %s", async (_name, answers) => {
    const storage = memory();
    await loadDirectory("en", { fetcher: server(release(7)).fetcher, storage });
    const before = storage.getItem(`${CACHE_PREFIX}en`);

    const state = await loadDirectory("en", { fetcher: server({ manifest: buildManifest(8), ...answers }).fetcher, storage });

    expect(state).toMatchObject({ status: "ready", current: false });
    expect(state.status === "ready" && state.listing.release_v).toBe(7);
    expect(storage.getItem(`${CACHE_PREFIX}en`)).toBe(before);
  });

  it("tries the newer release again on the next visit: a failure is not remembered", async () => {
    const storage = memory();
    await loadDirectory("en", { fetcher: server(release(7)).fetcher, storage });
    await loadDirectory("en", { fetcher: server({ manifest: buildManifest(8), files: { "/api/directory/8/en.json": "down" } }).fetcher, storage });
    const again = server(release(8));

    const state = await loadDirectory("en", { fetcher: again.fetcher, storage });

    expect(again.asked.map((a) => a.url)).toEqual([MANIFEST_URL, "/api/directory/8/en.json"]);
    expect(state).toMatchObject({ status: "ready", current: true });
  });

  describe("a kept release is current only when it is the manifest's own", () => {
    it("downloads the manifest's release when the kept one is newer than the manifest names, and shows that as current", async () => {
      const storage = memory();
      await loadDirectory("en", { fetcher: server(release(9)).fetcher, storage });
      const again = server(release(7));

      const state = await loadDirectory("en", { fetcher: again.fetcher, storage });

      expect(again.asked.map((a) => a.url)).toEqual([MANIFEST_URL, "/api/directory/7/en.json"]);
      expect(state).toMatchObject({ status: "ready", current: true });
      expect(state.status === "ready" && state.listing.release_v).toBe(7);
      expect(readKept(storage, "en")?.listing.release_v).toBe(7);
    });

    it("does not call a kept release newer than the manifest current when the manifest's release cannot be downloaded", async () => {
      const storage = memory();
      await loadDirectory("en", { fetcher: server(release(9)).fetcher, storage });

      const state = await loadDirectory("en", { fetcher: server({ manifest: buildManifest(7), files: { "/api/directory/7/en.json": "down" } }).fetcher, storage });

      expect(state).toMatchObject({ status: "ready", current: false });
      expect(state.status === "ready" && state.listing.release_v).toBe(9);
    });

    it("downloads the file when the kept release has the manifest's number but was made from another catalogue", async () => {
      const storage = memory();
      const OTHER = "e".repeat(64);
      await loadDirectory("en", { fetcher: server({ manifest: buildManifest(7, OTHER), files: { "/api/directory/7/en.json": buildListing("en", 7, { hash: OTHER }) } }).fetcher, storage });
      const again = server(release(7));

      const state = await loadDirectory("en", { fetcher: again.fetcher, storage });

      expect(again.asked.map((a) => a.url)).toEqual([MANIFEST_URL, "/api/directory/7/en.json"]);
      expect(state).toMatchObject({ status: "ready", current: true });
      expect(state.status === "ready" && state.listing.catalogue_hash).toBe(buildManifest(7).catalogue_hash);
      expect(readKept(storage, "en")?.listing.catalogue_hash).toBe(buildManifest(7).catalogue_hash);
    });

    it("keeps the kept release, not as current, when the same number from another catalogue cannot be replaced", async () => {
      const storage = memory();
      await loadDirectory("en", { fetcher: server({ manifest: buildManifest(7, "e".repeat(64)), files: { "/api/directory/7/en.json": buildListing("en", 7, { hash: "e".repeat(64) }) } }).fetcher, storage });

      const state = await loadDirectory("en", { fetcher: server({ manifest: buildManifest(7), files: { "/api/directory/7/en.json": "down" } }).fetcher, storage });

      expect(state).toMatchObject({ status: "ready", current: false });
    });

    it("shows the kept listing to onKept as not current, before the server has been asked", async () => {
      const storage = memory();
      await loadDirectory("en", { fetcher: server(release(7)).fetcher, storage });
      const states: DirectoryState[] = [];

      await loadDirectory("en", { fetcher: server(release(7)).fetcher, storage, onKept: (state) => states.push(state) });

      expect(states).toHaveLength(1);
      expect(states[0]).toMatchObject({ status: "ready", current: false, publishedAt: "2026-10-01T15:00:00.000Z" });
      expect(keptState(readKept(storage, "en")!)).toEqual(states[0]);
    });
  });

  describe("a response a service worker made up counts as unreachable (S02.12)", () => {
    it("does not take a manifest that carries the fallback header for the server's answer: the kept release is not current", async () => {
      const storage = memory();
      await loadDirectory("en", { fetcher: server(release(7)).fetcher, storage });

      const state = await loadDirectory("en", { fetcher: server({ ...release(7), marked: [MANIFEST_URL] }).fetcher, storage });

      expect(state).toMatchObject({ status: "ready", current: false });
    });

    it("is unavailable, not current, when nothing was kept and the only manifest there is carries the fallback header", async () => {
      expect(await loadDirectory("en", { fetcher: server({ ...release(7), marked: [MANIFEST_URL] }).fetcher, storage: memory() })).toEqual({ status: "unavailable" });
    });

    it("does not keep or show a listing file that carries the fallback header", async () => {
      const storage = memory();
      await loadDirectory("en", { fetcher: server(release(7)).fetcher, storage });
      const before = storage.getItem(`${CACHE_PREFIX}en`);

      const state = await loadDirectory("en", { fetcher: server({ ...release(8), marked: ["/api/directory/8/en.json"] }).fetcher, storage });

      expect(state).toMatchObject({ status: "ready", current: false });
      expect(state.status === "ready" && state.listing.release_v).toBe(7);
      expect(storage.getItem(`${CACHE_PREFIX}en`)).toBe(before);
    });

    it("still takes the same manifest without the header", async () => {
      const storage = memory();
      await loadDirectory("en", { fetcher: server(release(7)).fetcher, storage });

      expect(await loadDirectory("en", { fetcher: server(release(7)).fetcher, storage })).toMatchObject({ status: "ready", current: true });
    });
  });

  describe("a request that never answers", () => {
    it("gives every request a signal that stops it after 8 seconds", async () => {
      const { fetcher, asked } = server(release(7));

      await loadDirectory("en", { fetcher, storage: memory() });

      expect(FETCH_TIMEOUT_MS).toBe(8000);
      expect(asked).toHaveLength(2);
      for (const { init } of asked) expect(init?.signal).toBeInstanceOf(AbortSignal);
    });

    it("gives up on a manifest that never answers: the kept release shows, not as current", async () => {
      const storage = memory();
      await loadDirectory("en", { fetcher: server(release(7)).fetcher, storage });

      const state = await loadDirectory("en", { fetcher: server({ manifest: "hang" }).fetcher, storage, timeoutMs: 30 });

      expect(state).toMatchObject({ status: "ready", current: false });
    });

    it("gives up on a listing file that never answers, and keeps what it had", async () => {
      const storage = memory();
      await loadDirectory("en", { fetcher: server(release(7)).fetcher, storage });
      const before = storage.getItem(`${CACHE_PREFIX}en`);

      const state = await loadDirectory("en", { fetcher: server({ manifest: buildManifest(8), files: { "/api/directory/8/en.json": "hang" } }).fetcher, storage, timeoutMs: 30 });

      expect(state).toMatchObject({ status: "ready", current: false });
      expect(storage.getItem(`${CACHE_PREFIX}en`)).toBe(before);
    });

    it("is unavailable when nothing was kept and the manifest never answers", async () => {
      expect(await loadDirectory("en", { fetcher: server({ manifest: "hang" }).fetcher, storage: memory(), timeoutMs: 30 })).toEqual({ status: "unavailable" });
    });
  });

  it("shows the kept release, not as current, when the server cannot be asked at all", async () => {
    const storage = memory();
    await loadDirectory("en", { fetcher: server(release(7)).fetcher, storage });

    expect(await loadDirectory("en", { fetcher: server({ manifest: "down" }).fetcher, storage })).toMatchObject({ status: "ready", current: false });
    expect(await loadDirectory("en", { fetcher: server({ manifest: { not: "a manifest" } }).fetcher, storage })).toMatchObject({ status: "ready", current: false });
  });

  it("is unavailable when nothing was ever kept and nothing can be downloaded", async () => {
    expect(await loadDirectory("en", { fetcher: server({ manifest: "down" }).fetcher, storage: memory() })).toEqual({ status: "unavailable" });
    expect(await loadDirectory("en", { fetcher: server({ manifest: buildManifest(7), files: { "/api/directory/7/en.json": "short" } }).fetcher, storage: memory() })).toEqual({ status: "unavailable" });
  });

  it("works without storage: it shows the release and keeps nothing", async () => {
    expect(await loadDirectory("en", { fetcher: server(release(7)).fetcher, storage: null })).toMatchObject({ status: "ready", current: true });
  });

  it("works when the phone refuses to keep the listing", async () => {
    const storage = memory();
    storage.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };

    expect(await loadDirectory("en", { fetcher: server(release(7)).fetcher, storage })).toMatchObject({ status: "ready", current: true });
  });

  describe("a full phone", () => {
    const bodyOf = (lang: "en" | "ur", release: number) => JSON.stringify({ v: 1, publishedAt: "2026-10-01T15:00:00.000Z", listing: buildListing(lang, release) });

    it("removes the other kept listings, and nothing else, and tries once more when the write fails with QuotaExceededError", () => {
      const ur = bodyOf("ur", 7);
      const en = bodyOf("en", 7);
      // Room for the choices and the larger of the two listings: not for both listings.
      const storage = memory(Math.max(en.length, ur.length) + 100);
      storage.setItem(`${CACHE_PREFIX}ur`, ur);
      storage.setItem("cvh.choices", "{}");
      expect(() => storage.setItem(`${CACHE_PREFIX}en`, en)).toThrow(DOMException);

      keep(storage, { listing: buildListing("en", 7) as never, publishedAt: "2026-10-01T15:00:00.000Z" });

      expect([...storage.data.keys()].sort()).toEqual(["cvh.choices", `${CACHE_PREFIX}en`]);
      expect(readKept(storage, "en")?.listing.release_v).toBe(7);
    });

    it("tries only once more: a phone that is still full keeps nothing and does not throw, and the other listings are already gone", () => {
      const storage = memory(100);
      storage.setItem(`${CACHE_PREFIX}ur`, "x".repeat(50));
      let writes = 0;
      const setItem = storage.setItem;
      storage.setItem = (key, value) => {
        writes += 1;
        setItem(key, value);
      };

      expect(() => keep(storage, { listing: buildListing("en", 7) as never, publishedAt: "2026-10-01T15:00:00.000Z" })).not.toThrow();

      expect(writes).toBe(2);
      expect(readKept(storage, "en")).toBeNull();
      expect(storage.data.has(`${CACHE_PREFIX}ur`)).toBe(false);
    });

    it("leaves the other listings alone when the write fails for another reason", () => {
      const storage = memory();
      storage.setItem(`${CACHE_PREFIX}ur`, bodyOf("ur", 7));
      storage.setItem = () => {
        throw new DOMException("blocked", "SecurityError");
      };

      keep(storage, { listing: buildListing("en", 7) as never, publishedAt: "2026-10-01T15:00:00.000Z" });

      expect([...storage.data.keys()]).toEqual([`${CACHE_PREFIX}ur`]);
    });

    it("shows the release it just downloaded even when the phone had no room for the old listing of another language", async () => {
      const ur = bodyOf("ur", 7);
      const storage = memory(Math.max(bodyOf("en", 8).length, ur.length) + 100);
      storage.data.set(`${CACHE_PREFIX}ur`, ur);

      const state = await loadDirectory("en", { fetcher: server(release(8)).fetcher, storage });

      expect(state).toMatchObject({ status: "ready", current: true });
      expect(readKept(storage, "en")?.listing.release_v).toBe(8);
      expect(storage.data.has(`${CACHE_PREFIX}ur`)).toBe(false);
    });
  });

  it("ignores a kept listing that no longer passes the schema or is in another language", () => {
    const storage = memory();
    storage.setItem(`${CACHE_PREFIX}en`, JSON.stringify({ v: 1, publishedAt: "x", listing: { v: 1 } }));
    storage.setItem(`${CACHE_PREFIX}ur`, JSON.stringify({ v: 1, publishedAt: "x", listing: buildListing("en", 7) }));
    storage.setItem(`${CACHE_PREFIX}fr`, "not json");

    expect(readKept(storage, "en")).toBeNull();
    expect(readKept(storage, "ur")).toBeNull();
    expect(readKept(storage, "fr")).toBeNull();
  });

  it("drops the kept listings of older releases when a newer one is kept, and leaves what is not the directory's", () => {
    const storage = memory();
    storage.setItem("cvh.choices", "{}");
    keep(storage, { listing: buildListing("ur", 6) as never, publishedAt: "2026-09-01T00:00:00.000Z" });
    keep(storage, { listing: buildListing("en", 7) as never, publishedAt: "2026-10-01T00:00:00.000Z" });

    expect([...storage.data.keys()].sort()).toEqual(["cvh.choices", `${CACHE_PREFIX}en`]);
  });
});
