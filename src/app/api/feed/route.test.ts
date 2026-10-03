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

  it.each(["/api/feed?lang=en&building=4154146", "/api/feed?lang=en&lang=ur&x=1", "/api/feed?lang=en&floor=2", "/api/feed?lang=ur&rsn=4154146&floors=a,b"])(
    "refuses any query parameter besides a valid lang (%s) with 400, no-store and its own code, without reading the feed",
    async (path) => {
      const response = await get(path);

      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(FeedErrorV1.parse(await response.json()).error).toEqual({ code: "query_invalid", message_key: "feed.queryInvalid" });
      expect(reads).toEqual([]);
    },
  );

  it("names the language, not the query, when the language is the problem, even with other parameters", async () => {
    for (const path of ["/api/feed?Lang=en", "/api/feed?lang=xx&building=4154146"]) {
      const response = await get(path);

      expect(response.status).toBe(400);
      expect(FeedErrorV1.parse(await response.json()).error.code).toBe("LANG_INVALID");
    }
    expect(reads).toEqual([]);
  });

  it("marks its failure bodies v 1 (AD-20)", async () => {
    expect((await (await get("/api/feed?lang=xx")).json()).v).toBe(1);
  });

  it("sets no cookie, and is shareable for 15 seconds at the edge", async () => {
    const response = await get("/api/feed?lang=ur");

    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=0, s-maxage=15");
  });

  it.each(LANG_CODES)("answers for %s", async (lang) => {
    expect((await get(`/api/feed?lang=${lang}`)).status).toBe(200);
    expect(reads).toEqual([lang]);
  });

  it.each([["no language", "/api/feed"], ["an empty language", "/api/feed?lang="], ["a language that is not one", "/api/feed?lang=xx"], ["a language that is not one, with quotes in it", "/api/feed?lang=%27%20or%201"]])("refuses %s with a failure body, never cached", async (_name, path) => {
    const response = await get(path);

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(FeedErrorV1.parse(await response.json()).error.code).toBe("LANG_INVALID");
    expect(reads).toEqual([]);
  });

  it("reads once per language however many valid requests come", async () => {
    for (const path of ["/api/feed?lang=en", "/api/feed?lang=en", "/api/feed?lang=fr", "/api/feed?lang=en", "/api/feed?lang=fr"]) {
      expect((await get(path)).status).toBe(200);
    }

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

  it("logs a failed read as one line with no personal data: the event, the language and the kind of error, never its message", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      answer = () => Promise.reject(new TypeError("connection refused to postgres://user:secret@host/db while reading 4 Milepost Pl"));

      await get("/api/feed?lang=ur");

      expect(log).toHaveBeenCalledTimes(1);
      const line = String(log.mock.calls[0][0]);
      expect(JSON.parse(line)).toEqual({ level: "error", evt: "resident.feed_read_failed", module: "app", lang: "ur", error: "TypeError" });
      expect(line).not.toMatch(/secret|postgres|Milepost|connection/);
    } finally {
      log.mockRestore();
    }
  });

  it("logs a feed that breaks the contract too, and logs nothing for a request it refuses or answers", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await get("/api/feed?lang=en");
      await get("/api/feed?lang=xx");
      await get("/api/feed?lang=en&x=1");
      expect(log).not.toHaveBeenCalled();

      answer = async () => feed({ places: { buildings: [{ rsn: "not-a-number", status: "none", verified: true }], neighbourhoods: [] } });
      cached.values.clear();
      await get("/api/feed?lang=fr");
      expect(log).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({ evt: "resident.feed_read_failed", lang: "fr", error: "ZodError" });
    } finally {
      log.mockRestore();
    }
  });

  it("does not hand out a feed that breaks the contract", async () => {
    answer = async () => feed({ places: { buildings: [{ rsn: "not-a-number", status: "none", verified: true }], neighbourhoods: [] } });

    expect((await get("/api/feed?lang=en")).status).toBe(503);
  });
});
