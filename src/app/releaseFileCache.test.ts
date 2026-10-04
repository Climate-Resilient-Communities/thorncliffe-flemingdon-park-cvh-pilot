import { beforeEach, describe, expect, it, vi } from "vitest";

// The Next data cache is faked with a map that records what the adapter asked of it; nothing here reaches Vercel or Supabase.
const fake = vi.hoisted(() => ({
  store: new Map<string, string>(),
  calls: [] as { keyParts: string[]; options: { revalidate?: number; tags?: string[] } }[],
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  unstable_cache: (callback: () => Promise<string>, keyParts: string[], options: { revalidate?: number; tags?: string[] }) => async () => {
    fake.calls.push({ keyParts, options });
    const name = keyParts.join("/");
    const held = fake.store.get(name);
    if (held !== undefined) return held;
    const value = await callback();
    fake.store.set(name, value);
    return value;
  },
}));

const { releaseFileCache, MAX_CACHED_BASE64_CHARS, DIRECTORY_RELEASE_TAG } = await import("./releaseFileCache");

const KEY = { release: 7, path: "releases/7/vectors.bin", sha256: "abc123" };

beforeEach(() => {
  fake.store.clear();
  fake.calls.length = 0;
});

describe("releaseFileCache", () => {
  it("names an entry by release, sha256 and path, and tags it with the directory tags", async () => {
    await releaseFileCache.read(KEY, async () => new Uint8Array([1, 2, 3]));
    expect(fake.calls[0]!.keyParts).toEqual(["directory-release-file", "7", "abc123", "releases/7/vectors.bin"]);
    expect(fake.calls[0]!.options.tags).toEqual([DIRECTORY_RELEASE_TAG, `${DIRECTORY_RELEASE_TAG}-7`]);
    expect(DIRECTORY_RELEASE_TAG).toBe("directory-release");
  });

  it("gives back the same bytes on a miss and on a hit, and loads once", async () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const load = vi.fn(async () => bytes);
    const miss = await releaseFileCache.read(KEY, load);
    const hit = await releaseFileCache.read(KEY, load);
    expect(Array.from(miss)).toEqual(Array.from(bytes));
    expect(Array.from(hit)).toEqual(Array.from(bytes));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps the fresh bytes and stores nothing when the file is too large for the cache", async () => {
    const big = new Uint8Array(Math.ceil((MAX_CACHED_BASE64_CHARS * 3) / 4) + 16).fill(7);
    const load = vi.fn(async () => big);
    const out = await releaseFileCache.read(KEY, load);
    expect(out).toBe(big);
    expect(fake.store.size).toBe(0);
  });

  it("lets an error from the load through", async () => {
    await expect(
      releaseFileCache.read(KEY, async () => {
        throw new Error("storage down");
      }),
    ).rejects.toThrow("storage down");
    expect(fake.store.size).toBe(0);
  });
});
