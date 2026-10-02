import { describe, expect, it } from "vitest";
import { buildListing, buildManifest } from "../../../e2e/resident/directory-fixture";
import { CACHE_PREFIX, keep, loadDirectory, MANIFEST_URL, readKept, type KeptStorage } from "./load-directory";

/** A phone's storage in memory. */
function memory(): KeptStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    key: (at) => [...data.keys()][at] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

type Answers = { manifest?: unknown | "down"; files?: Record<string, unknown | "down" | "short"> };

/** A fetch that answers the release routes and records what it was asked. */
function server(answers: Answers) {
  const asked: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    asked.push({ url, init });
    const answer = url === MANIFEST_URL ? answers.manifest : answers.files?.[url];
    if (answer === undefined || answer === "down") throw new TypeError("Failed to fetch");
    if (answer === "short") return new Response(JSON.stringify(buildListing("en", 8)).slice(0, 500), { status: 200 });
    return new Response(JSON.stringify(answer), { status: 200 });
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
    const seen: number[] = [];

    const state = await loadDirectory("en", { fetcher: server(release(8)).fetcher, storage, onKept: (kept) => seen.push(kept.listing.release_v) });

    expect(seen).toEqual([7]);
    expect(state.status === "ready" && state.listing.release_v).toBe(8);
    expect(readKept(storage, "en")?.listing.release_v).toBe(8);
  });

  it.each([
    ["the file cannot be downloaded", { files: { "/api/directory/8/en.json": "down" } }],
    ["the file is incomplete", { files: { "/api/directory/8/en.json": "short" } }],
    ["the file fails its schema", { files: { "/api/directory/8/en.json": { ...buildListing("en", 8), providers: [{ id: "nope" }] } } }],
    ["the file is another release than the manifest named", { files: { "/api/directory/8/en.json": buildListing("en", 9) } }],
    ["the file is another language", { files: { "/api/directory/8/en.json": buildListing("ur", 8) } }],
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
