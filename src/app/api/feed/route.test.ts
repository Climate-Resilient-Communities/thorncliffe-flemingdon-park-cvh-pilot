import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeedErrorV1, FeedV1 } from "@/contracts/feed";
import { LANG_CODES } from "@/contracts/lang";

// What the alerting module's feed answers, set by each test: this test is about the route's answer, not the reading.
let answer: (lang: string) => Promise<unknown>;
const reads: string[] = [];
vi.mock("./source", () => ({
  readFeed: (lang: string) => {
    reads.push(lang);
    return answer(lang);
  },
}));

// Next's data cache as far as the route depends on it: the function is run once per key and its value kept (a failure is
// not kept), and the options the route gave are recorded.
const cacheOptions = vi.hoisted(() => ({ seen: [] as { keys?: string[]; options?: { revalidate?: number | false; tags?: string[] } }[] }));
const cached = vi.hoisted(() => ({ values: new Map<string, unknown>() }));
vi.mock("next/cache", () => ({
  unstable_cache:
    <T>(fn: () => Promise<T>, keys?: string[], options?: { revalidate?: number | false; tags?: string[] }) => {
      cacheOptions.seen.push({ keys, options });
      return async () => {
        const key = (keys ?? []).join("|");
        if (!cached.values.has(key)) cached.values.set(key, await fn());
        return cached.values.get(key) as T;
      };
    },
}));

const { GET } = await import("./route");
const get = (path: string) => GET(new Request(`http://localhost${path}`));

const places = { buildings: [{ rsn: "4154146", status: "none", verified: true }], neighbourhoods: [{ id: "TP", status: "none", verified: true }, { id: "FP", status: "none", verified: true }] };
const feed = (over: Record<string, unknown> = {}) => ({ v: 1, feed_version: 0, server_now: "2026-10-01T15:00:00.000Z", threads: [], places, ...over });

beforeEach(() => {
  answer = async () => feed();
  reads.length = 0;
  cached.values.clear();
});

describe("GET /api/feed", () => {
  it("before any alert exists, answers a valid FeedV1 with no threads and every building and neighbourhood at status none", async () => {
    const response = await get("/api/feed?lang=en");

    expect(response.status).toBe(200);
    const body = FeedV1.parse(await response.json());
    expect(body.threads).toEqual([]);
    expect([...body.places.buildings, ...body.places.neighbourhoods].every((place) => place.status === "none")).toBe(true);
  });

  it.each(["/api/feed?lang=en&building=4154146", "/api/feed?lang=en&lang=ur&x=1", "/api/feed?lang=en&floor=2", "/api/feed?Lang=en"])(
    "refuses any query parameter other than lang (%s) with 400 and no-store, without reading the feed",
    async (path) => {
      const response = await get(path);

      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(FeedErrorV1.parse(await response.json()).error.code).toBe("LANG_INVALID");
      expect(reads).toEqual([]);
    },
  );

  it("sets no cookie, and is shareable for 15 seconds at the edge", async () => {
    const response = await get("/api/feed?lang=ur");

    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=0, s-maxage=15");
  });

  it.each(LANG_CODES)("answers for %s", async (lang) => {
    expect((await get(`/api/feed?lang=${lang}`)).status).toBe(200);
    expect(reads).toEqual([lang]);
  });

  it.each([["no language", "/api/feed"], ["an empty language", "/api/feed?lang="], ["a language that is not one", "/api/feed?lang=xx"], ["a building in the query", "/api/feed?lang=%27%20or%201"]])("refuses %s with a failure body, never cached", async (_name, path) => {
    const response = await get(path);

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(FeedErrorV1.parse(await response.json()).error.code).toBe("LANG_INVALID");
    expect(reads).toEqual([]);
  });

  it("reads once per language however many requests come, whatever else is in the query", async () => {
    await get("/api/feed?lang=en");
    await get("/api/feed?lang=en&rsn=4154146");
    await get("/api/feed?lang=en&floors=a,b");
    await get("/api/feed?lang=fr");

    expect(reads).toEqual(["en", "fr"]);
  });

  it("keeps the feed for 15 seconds under the tag every web-visible change revalidates", async () => {
    await get("/api/feed?lang=en");

    expect(cacheOptions.seen.at(-1)?.options).toEqual({ revalidate: 15, tags: ["feed"] });
  });

  it("says unavailable, not cached, when the feed cannot be read, and reads again next time", async () => {
    answer = () => Promise.reject(new Error("connection refused"));

    const response = await get("/api/feed?lang=en");

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(FeedErrorV1.parse(await response.json()).error.code).toBe("FEED_UNAVAILABLE");
    answer = async () => feed();
    expect((await get("/api/feed?lang=en")).status).toBe(200);
  });

  it("does not hand out a feed that breaks the contract", async () => {
    answer = async () => feed({ places: { buildings: [{ rsn: "not-a-number", status: "none", verified: true }], neighbourhoods: [] } });

    expect((await get("/api/feed?lang=en")).status).toBe(503);
  });
});
