// The closed-thread read behind a public address (S05.03): cached under the feed's tag, and gated by one cached read of the closed slugs, so a guessed address
// costs the database nothing more.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FEED_TAG } from "@/contracts/feed";

const state = vi.hoisted(() => ({
  slugs: [] as string[],
  slugReads: 0,
  closedReads: [] as string[],
  archiveReads: [] as string[],
  cached: new Map<string, unknown>(),
  tags: [] as string[][],
  revalidate: [] as (number | false | undefined)[],
}));

vi.mock("next/cache", () => ({
  // The data cache stands in as a map keyed by the key parts: a repeated call with the same key is answered from it.
  unstable_cache: (fn: () => Promise<unknown>, key: string[], options: { tags: string[]; revalidate?: number | false }) => async () => {
    const id = key.join("|");
    state.tags.push(options.tags);
    state.revalidate.push(options.revalidate);
    if (!state.cached.has(id)) state.cached.set(id, await fn());
    return state.cached.get(id);
  },
}));
vi.mock("@/platform/config/env", () => ({ getEnv: () => ({ residentAlertsEnabled: true, publicBaseUrl: "http://test" }) }));
vi.mock("./api/feed/source", () => ({
  readFeed: async () => ({}),
  readArchive: async (lang: string, page: number) => {
    state.archiveReads.push(`${lang}:${page}`);
    return { v: 1, page, has_more: false, server_now: "2026-10-01T15:00:00.000Z", threads: [] };
  },
  readClosedSlugs: async () => {
    state.slugReads += 1;
    return state.slugs;
  },
  readClosedAlert: async (lang: string, slug: string) => {
    state.closedReads.push(`${lang}:${slug}`);
    return { thread: { slug }, serverNow: new Date("2026-10-01T15:00:00.000Z") };
  },
}));

import { readCachedArchive, readCachedClosedAlert } from "./feedCache";

beforeEach(() => {
  state.slugs = ["abcd1234"];
  state.slugReads = 0;
  state.closedReads = [];
  state.cached.clear();
  state.tags = [];
  state.revalidate = [];
  state.archiveReads = [];
});

describe("readCachedClosedAlert", () => {
  it("answers null for a slug that is not a closed thread's without reading the thread", async () => {
    expect(await readCachedClosedAlert("en", "zzzzzzzz")).toBeNull();
    expect(state.closedReads).toEqual([]);
  });

  it("reads a closed thread once per language and slug, and hands its time as a string", async () => {
    const first = await readCachedClosedAlert("en", "abcd1234");
    const second = await readCachedClosedAlert("en", "abcd1234");
    expect(first).toEqual({ thread: { slug: "abcd1234" }, serverNow: "2026-10-01T15:00:00.000Z" });
    expect(second).toEqual(first);
    expect(state.closedReads).toEqual(["en:abcd1234"]);
    await readCachedClosedAlert("ur", "abcd1234");
    expect(state.closedReads).toEqual(["en:abcd1234", "ur:abcd1234"]);
    expect(state.slugReads).toBe(1);
  });

  it("is cached under the feed's tag, so an approval's revalidateTag clears it with the feed", async () => {
    await readCachedClosedAlert("en", "abcd1234");
    expect(state.tags.length).toBeGreaterThan(0);
    for (const tags of state.tags) expect(tags).toContain(FEED_TAG);
  });
});

describe("readCachedArchive (S05.07)", () => {
  it("reads a page once per language and page, and keeps it for 60 seconds under the feed's tag, so an approval's revalidateTag clears it with the feed", async () => {
    await readCachedArchive("en", 1);
    await readCachedArchive("en", 1);
    await readCachedArchive("en", 2);
    await readCachedArchive("ur", 1);

    expect(state.archiveReads).toEqual(["en:1", "en:2", "ur:1"]);
    expect(state.revalidate.every((seconds) => seconds === 60)).toBe(true);
    for (const tags of state.tags) expect(tags).toEqual([FEED_TAG]);
  });
});
