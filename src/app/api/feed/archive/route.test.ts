import { beforeEach, describe, expect, it, vi } from "vitest";
import { ARCHIVE_MAX_PAGE, ARCHIVE_PAGE_SIZE, ArchiveV1, FeedErrorV1 } from "@/contracts/feed";
import { LANG_CODES } from "@/contracts/lang";

// What the alerting module's archive answers, set by each test: this test is about the route's answer, not the reading.
let answer: (lang: string, page: number) => Promise<unknown>;
const reads: string[] = [];
vi.mock("../source", () => ({
  readArchive: (lang: string, page: number) => {
    reads.push(`${lang}:${page}`);
    return answer(lang, page);
  },
  readFeed: async () => ({}),
  readClosedSlugs: async () => [],
  readClosedAlert: async () => null,
}));

const gate = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/platform/config/env", () => ({ getEnv: () => ({ residentAlertsEnabled: gate.enabled, publicBaseUrl: "https://cvh.example" }) }));

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

const E = (n: number) => `0198a000-0000-7000-8000-0000000004${String(n).padStart(2, "0")}`;
const closedThread = (n: number) => ({
  id: E(n),
  slug: `closed${String(n).padStart(3, "0")}`,
  types: ["power"],
  audience: { scope: "neighbourhood", neighbourhood_ids: ["TP"], groups: [], types: ["power"] },
  state: "closed",
  close_reason: "resolved",
  closed_at: "2026-10-01T14:00:00.000Z",
  valid_until: "2026-10-01T13:00:00.000Z",
  entries: [
    {
      id: E(n),
      kind: "ack",
      phase: "problem",
      verified: true,
      attribution: { role: "hub" },
      published_at: "2026-10-01T12:00:00.000Z",
      text: { lang: "en", body: "Power is out.", machine: false, model: null, status: "source", source_hash: "h" },
      original: { lang: "en", body: "Power is out." },
    },
  ],
});
const archive = (page: number, threads: unknown[] = [], hasMore = false) => ({ v: 1, page, has_more: hasMore, server_now: "2026-10-01T15:00:00.000Z", threads });

beforeEach(() => {
  gate.enabled = true;
  answer = async (_lang, page) => archive(page);
  reads.length = 0;
  cached.values.clear();
  cacheOptions.seen.length = 0;
});

describe("GET /api/feed/archive", () => {
  it("answers a valid ArchiveV1: page 1 when no page is asked for, with no threads before any alert has closed", async () => {
    const response = await get("/api/feed/archive?lang=en");

    expect(response.status).toBe(200);
    expect(ArchiveV1.parse(await response.json())).toMatchObject({ v: 1, page: 1, has_more: false, threads: [] });
    expect(reads).toEqual(["en:1"]);
  });

  it("answers the page asked for, in the language asked for, with the closed threads in it", async () => {
    answer = async (_lang, page) => archive(page, [closedThread(1), closedThread(2)], true);

    const body = ArchiveV1.parse(await (await get("/api/feed/archive?lang=ur&page=3")).json());

    expect(reads).toEqual(["ur:3"]);
    expect(body).toMatchObject({ page: 3, has_more: true });
    expect(body.threads.map((thread) => thread.slug)).toEqual(["closed001", "closed002"]);
  });

  it("sets no cookie, and is shareable for at most 60 seconds at the edge", async () => {
    const response = await get("/api/feed/archive?lang=ur&page=2");

    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=0, s-maxage=60");
  });

  it("keeps a page for 60 seconds under the tag every web-visible change revalidates, keyed by language, page, the launch gate and the deployment's address", async () => {
    await get("/api/feed/archive?lang=en&page=2");

    expect(cacheOptions.seen.at(-1)).toEqual({ keys: ["archive", "en", "2", "alerts-on", "https://cvh.example"], options: { revalidate: 60, tags: ["feed"] } });
    gate.enabled = false;
    await get("/api/feed/archive?lang=en&page=2");
    expect(cacheOptions.seen.at(-1)?.keys).toEqual(["archive", "en", "2", "alerts-off", "https://cvh.example"]);
    expect(reads).toEqual(["en:2", "en:2"]);
  });

  it("reads once per language and page however many valid requests come", async () => {
    for (const path of ["/api/feed/archive?lang=en", "/api/feed/archive?lang=en&page=1", "/api/feed/archive?lang=en&page=2", "/api/feed/archive?lang=fr", "/api/feed/archive?lang=en"]) {
      expect((await get(path)).status).toBe(200);
    }

    expect(reads).toEqual(["en:1", "en:2", "fr:1"]);
  });

  it.each(LANG_CODES)("answers for %s", async (lang) => {
    expect((await get(`/api/feed/archive?lang=${lang}`)).status).toBe(200);
  });

  it.each([["no language", "/api/feed/archive"], ["a language that is not one", "/api/feed/archive?lang=xx"], ["an empty language", "/api/feed/archive?lang=&page=1"]])("refuses %s with its own code, never cached", async (_name, path) => {
    const response = await get(path);

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(FeedErrorV1.parse(await response.json()).error.code).toBe("LANG_INVALID");
    expect(reads).toEqual([]);
  });

  it.each([
    ["a page of zero", "page=0"],
    ["a negative page", "page=-1"],
    ["a fraction", "page=1.5"],
    ["a page that is not a number", "page=two"],
    ["a leading zero", "page=01"],
    ["a page past the last a request may name", `page=${ARCHIVE_MAX_PAGE + 1}`],
    ["an empty page", "page="],
    ["two pages", "page=1&page=2"],
    ["any other parameter", "building=4154146"],
    ["a parameter beside a good page", "page=1&floor=2"],
  ])("refuses %s with 400, no-store and the query code, without reading the archive", async (_name, query) => {
    const response = await get(`/api/feed/archive?lang=en&${query}`);

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(FeedErrorV1.parse(await response.json()).error).toEqual({ code: "query_invalid", message_key: "feed.queryInvalid" });
    expect(reads).toEqual([]);
  });

  it("takes the last page a request may name", async () => {
    expect((await get(`/api/feed/archive?lang=en&page=${ARCHIVE_MAX_PAGE}`)).status).toBe(200);
  });

  it("refuses an answer that is too long for a page, as a failure, not cached", async () => {
    answer = async (_lang, page) => archive(page, Array.from({ length: ARCHIVE_PAGE_SIZE + 1 }, (_, n) => closedThread(n)));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const response = await get("/api/feed/archive?lang=en");

      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    } finally {
      log.mockRestore();
    }
  });

  it("says unavailable, not cached, when the archive cannot be read, and logs only the kind of error", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      answer = () => Promise.reject(new TypeError("connection refused to postgres://user:secret@host/db"));

      const response = await get("/api/feed/archive?lang=ur");

      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(FeedErrorV1.parse(await response.json()).error.code).toBe("FEED_UNAVAILABLE");
      const line = String(log.mock.calls[0][0]);
      expect(JSON.parse(line)).toEqual({ level: "error", evt: "resident.feed_read_failed", module: "app", lang: "ur", error: "TypeError" });
      expect(line).not.toMatch(/secret|postgres/);
      answer = async (_lang, page) => archive(page);
      expect((await get("/api/feed/archive?lang=ur")).status).toBe(200);
    } finally {
      log.mockRestore();
    }
  });
});
