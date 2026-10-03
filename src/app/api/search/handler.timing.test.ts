// The `Server-Timing` header of POST /api/search and the cold start's overlap of the limiter with the release's load: through
// the real handler and search use case over fakes of the database, the store and the Cohere client, on vitest's fake clock.
// Nothing here reaches a database or a vendor.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cohereQueryEmbedder, createSearch, type CohereEmbedClient, type SearchService } from "@/modules/directory";
import { releaseDb, releaseStore } from "../../../../test/helpers/searchRelease";
import { searchResponse, type SearchRouteDeps } from "./handler";

const QUESTION = { q: "Where can I find a family doctor near Thorncliffe?", lang: "en", v: 5 };

function embedClient(calls: { n: number }): CohereEmbedClient {
  return {
    v2: {
      embed: () => {
        calls.n += 1;
        return new Promise((resolve) => setTimeout(() => resolve({ embeddings: { float: [[1, 0]] }, meta: { billedUnits: { inputTokens: 4 } } }), 150));
      },
    },
  };
}

describe("POST /api/search: Server-Timing and the cold start", () => {
  let deferred: Promise<unknown>[];
  let embeds: { n: number };

  beforeEach(() => {
    vi.useFakeTimers();
    deferred = [];
    embeds = { n: 0 };
  });
  afterEach(() => vi.useRealTimers());

  function search(parts: { db?: ReturnType<typeof releaseDb>; store?: ReturnType<typeof releaseStore> } = {}): SearchService {
    const db = parts.db ?? releaseDb();
    const store = parts.store ?? releaseStore();
    return createSearch({
      db: () => db.db,
      storage: () => store.storage,
      embedder: cohereQueryEmbedder({ apiKey: "test-key", client: embedClient(embeds) }),
      writer: { log: async () => undefined, spend: async () => undefined },
      defer: (work) => void deferred.push(work),
      clock: () => Date.now(),
    });
  }

  function route(service: SearchService, extra: Partial<SearchRouteDeps> = {}): SearchRouteDeps {
    return {
      search: () => service,
      limiter: () => ({ check: async () => ({ allowed: true }) }),
      client: () => "203.0.113.9",
      defer: (work) => void deferred.push(work),
      clock: () => Date.now(),
      ...extra,
    };
  }

  async function post(deps: SearchRouteDeps, body: unknown = QUESTION): Promise<Response> {
    const pending = searchResponse(deps, new Request("https://x.test/api/search", { method: "POST", body: JSON.stringify(body) }));
    await vi.advanceTimersByTimeAsync(10_000);
    return pending;
  }

  const phases = (response: Response) => (response.headers.get("server-timing") ?? "").split(", ").map((part) => part.split(";")[0]);
  const duration = (response: Response, phase: string) => Number(new RegExp(`${phase};dur=([0-9.]+)`).exec(response.headers.get("server-timing") ?? "")?.[1]);

  it("names every phase of a cold first request, with the snapshot flagged cold and the boot time of the instance", async () => {
    const response = await post(route(search(), { boot: () => 812 }));

    expect(response.status).toBe(200);
    expect(phases(response)).toEqual(["boot", "limiter", "snapshot", "embed", "rank", "total"]);
    expect(response.headers.get("server-timing")).toMatch(/^boot;dur=812, limiter;dur=\d+, snapshot;dur=\d+;desc=cold, embed;dur=150, rank;dur=\d+, total;dur=\d+$/);
  });

  it("does not flag the snapshot cold or report a boot once the instance holds the release's data", async () => {
    const service = search();
    await post(route(service, { boot: () => 812 }));
    const second = await post(route(service, { boot: () => null }));

    expect(phases(second)).toEqual(["limiter", "snapshot", "embed", "rank", "total"]);
    expect(second.headers.get("server-timing")).not.toContain("cold");
  });

  it("has no `translate` phase for a question that needs no translation", async () => {
    expect((await post(route(search()))).headers.get("server-timing")).not.toContain("translate");
  });

  it("carries no question, no provider id, no release number and no address, on an answer or on a failure", async () => {
    const answered = await post(route(search()));
    const refused = await post(route(search(), { limiter: () => ({ check: async () => ({ allowed: false, retryAfterSeconds: 30 }) }) }));
    const unreadable = await post(route(search(), { limiter: () => ({ check: async () => { throw new Error("boom: 203.0.113.9 family doctor"); } }) }));
    const invalid = await post(route(search()), { q: "", lang: "en" });

    for (const response of [answered, refused, unreadable, invalid]) {
      const header = response.headers.get("server-timing") ?? "";
      expect(header).toMatch(/^(?:[a-z]+;dur=\d+(?:\.\d)?(?:;desc=cold)?(?:, )?)+$/);
      for (const secret of ["doctor", "Thorncliffe", "M001", "203.0.113.9", "boom", "releases/"]) expect(header).not.toContain(secret);
    }
    expect(phases(refused)).toEqual(["limiter", "total"]);
    expect(phases(unreadable)).toEqual(["limiter", "total"]);
    expect(phases(invalid)).toEqual(["total"]);
  });

  it("gives the 503 of the hard deadline its header too", async () => {
    const response = await post(route(search({ store: releaseStore({ never: true }) })));

    expect(response.status).toBe(503);
    expect(phases(response)).toEqual(expect.arrayContaining(["limiter", "snapshot", "total"]));
  });

  describe("a cold instance loads the release beside the limiter", () => {
    it("starts the release's read and the store's downloads before a slow limiter answers, and answers sooner for it", async () => {
      const db = releaseDb();
      const store = releaseStore({ ms: 300 });
      const limiter = { check: () => new Promise<{ allowed: boolean }>((resolve) => setTimeout(() => resolve({ allowed: true }), 400)) };
      const started = Date.now();
      let took = -1;
      const pending = searchResponse(route(search({ db, store }), { limiter: () => limiter }), new Request("https://x.test/api/search", { method: "POST", body: JSON.stringify(QUESTION) }));
      void pending.then(() => (took = Date.now() - started));

      await vi.advanceTimersByTimeAsync(100);
      // The limiter has not answered, and the release is being read and its files downloaded.
      expect(db.transactions()).toBe(1);
      expect(store.gets).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(10_000);
      const response = await pending;

      expect(response.status).toBe(200);
      // One read of the release and one download of each file, shared by the request and its warm-up.
      expect(db.transactions()).toBe(1);
      expect(store.gets).toHaveLength(2);
      // Limiter 400 ms, then the question's embedding 150 ms: the release (5 + 300 ms) was ready before the limiter was.
      expect(took).toBe(400 + 150);
      expect(duration(response, "snapshot")).toBe(305);
    });

    it("calls no model when the limiter refuses, though the release was loaded for it", async () => {
      const db = releaseDb();
      const service = search({ db });
      const response = await post(route(service, { limiter: () => ({ check: async () => ({ allowed: false, retryAfterSeconds: 12 }) }) }));

      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("12");
      expect(embeds.n).toBe(0);
    });

    it("answers as before when the warm-up itself throws", async () => {
      const service = search();
      service.warm = () => {
        throw new Error("never mind");
      };
      expect((await post(route(service))).status).toBe(200);
    });
  });
});
