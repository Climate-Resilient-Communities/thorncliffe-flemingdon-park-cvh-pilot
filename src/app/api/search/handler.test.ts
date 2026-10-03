// POST /api/search answers within 2.5 s of the request start whatever never answers (S03.04, S03.05): through the real handler
// and the real search use case, with the database read of the current release, the release's store and the Cohere SDK clients
// faked (the vendor adapters are the real ones), and with the route's own hard deadline over what no stage bounds (the body,
// a wait inside the search). The question is the Urdu one of the production incident. Time is vitest's fake clock: nothing
// here waits for real, and nothing reaches a database or a vendor. The same waits against a real database are in
// test/db/search.db.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchErrorSchema } from "@/contracts/search";
import { SearchV1Schema } from "@/contracts/searchTestSet";
import { DEFAULT_LEG_TIMEOUT_MS, DEFAULT_TOTAL_BUDGET_MS, cohereQueryEmbedder, createSearch, type CohereEmbedClient, type SearchService } from "@/modules/directory";
import { cohereTranslator, createQuestionTranslator, type CohereChatClient } from "@/modules/translation";
import { DEFAULT_SEARCH_SETTINGS } from "@/platform/config/env";
import { LISTING_PATH, VECTORS_PATH, never, releaseDb, releaseStore } from "../../../../test/helpers/searchRelease";
import { searchResponse, type SearchRouteDeps } from "./handler";

/** "There is a fire in my building", in Urdu, on the Urdu page, by a phone holding release 5. */
const QUESTION = { q: "میری عمارت میں آگ لگی ہے", lang: "ur", v: 5 };

/** Cohere's embed endpoint: provider M001's axis after 150 ms, or (`hang`) no answer at all, not even once cancelled. */
function embedClient(options: { hang?: boolean } = {}) {
  const signals: AbortSignal[] = [];
  const client: CohereEmbedClient = {
    v2: {
      embed: (_request, { abortSignal }) => {
        signals.push(abortSignal);
        if (options.hang) return never();
        return new Promise((resolve) => setTimeout(() => resolve({ embeddings: { float: [[1, 0]] }, meta: { billedUnits: { inputTokens: 4 } } }), 150));
      },
    },
  };
  return { client, signals };
}

/** Cohere's chat endpoint with a translate model: an English translation after 400 ms, or (`hang`) no answer at all. */
function chatClient(options: { hang?: boolean } = {}) {
  const signals: AbortSignal[] = [];
  const client: CohereChatClient = {
    v2: {
      chat: (_request, { abortSignal }) => {
        signals.push(abortSignal);
        if (options.hang) return never();
        return new Promise((resolve) =>
          setTimeout(() => resolve({ message: { content: [{ type: "text", text: "There is a fire in my building" }] }, usage: { billedUnits: { inputTokens: 30, outputTokens: 8 } } }), 400),
        );
      },
    },
  };
  return { client, signals };
}

describe("POST /api/search within 2.5 s of the request start", () => {
  let deadlines: number[];
  let deferred: Promise<unknown>[];

  beforeEach(() => {
    vi.useFakeTimers();
    deadlines = [];
    deferred = [];
  });
  afterEach(() => vi.useRealTimers());

  /** The search use case of the route, over fakes of the database, the store and the two Cohere clients. */
  function search(parts: { db?: ReturnType<typeof releaseDb>; store?: ReturnType<typeof releaseStore>; embed?: ReturnType<typeof embedClient>; chat?: ReturnType<typeof chatClient> } = {}) {
    const db = parts.db ?? releaseDb();
    const store = parts.store ?? releaseStore();
    return createSearch({
      db: () => db.db,
      storage: () => store.storage,
      embedder: cohereQueryEmbedder({ apiKey: "test-key", client: (parts.embed ?? embedClient()).client }),
      translator: createQuestionTranslator({ translator: cohereTranslator({ apiKey: "test-key", client: (parts.chat ?? chatClient()).client }), route: DEFAULT_SEARCH_SETTINGS.questionRoute }),
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
      onDeadline: async (ms) => void deadlines.push(ms),
      defer: (work) => void deferred.push(work),
      clock: () => Date.now(),
      ...extra,
    };
  }

  /** Posts now, on fake time, without moving the clock; `took` is when the response came, from the request's start. */
  function post(deps: SearchRouteDeps, body: BodyInit = JSON.stringify(QUESTION)) {
    const started = Date.now();
    let took = -1;
    let response: Response | undefined;
    void searchResponse(deps, new Request("https://x.test/api/search", { method: "POST", body, duplex: "half" } as RequestInit)).then((r) => {
      response = r;
      took = Date.now() - started;
    });
    return { took: () => took, response: () => response! };
  }

  async function errorCode(response: Response) {
    return SearchErrorSchema.parse(await response.json()).error.code;
  }

  describe("when something the search waits for never answers", () => {
    it("the store's download of the release's vectors: 503 search_unavailable at 2.2 s", async () => {
      const store = releaseStore({ never: true });
      const request = post(route(search({ store })));

      await vi.advanceTimersByTimeAsync(10_000);

      expect(request.response().status).toBe(503);
      expect(await errorCode(request.response())).toBe("search_unavailable");
      expect(request.took()).toBe(DEFAULT_LEG_TIMEOUT_MS);
      expect(store.gets).toEqual([VECTORS_PATH, LISTING_PATH]);
      expect(deadlines).toEqual([]); // the search ended itself, before the hard deadline
    });

    it.each([
      ["is never connected", { connect: "never" as const }],
      ["never answers the read", { read: "never" as const }],
    ])("the database that %s of the current release: 503 at 2.2 s", async (_, behaviour) => {
      const request = post(route(search({ db: releaseDb(behaviour) })));

      await vi.advanceTimersByTimeAsync(10_000);

      expect(request.response().status).toBe(503);
      expect(request.took()).toBe(DEFAULT_LEG_TIMEOUT_MS);
    });

    it("a load of the release's data that a second request joined: each answers within 2.5 s of its own start, from one download", async () => {
      const store = releaseStore({ never: true });
      const service = search({ store });

      const first = post(route(service));
      await vi.advanceTimersByTimeAsync(1500);
      const second = post(route(service));
      await vi.advanceTimersByTimeAsync(10_000);

      for (const request of [first, second]) {
        expect(request.response().status).toBe(503);
        expect(request.took()).toBeLessThanOrEqual(DEFAULT_TOTAL_BUDGET_MS);
      }
      expect(store.gets).toEqual([VECTORS_PATH, LISTING_PATH]);
    });

    it("the Cohere embedding, never answering even once cancelled: both legs are cut at 2.2 s, 503", async () => {
      const embed = embedClient({ hang: true });
      const chat = chatClient();
      const request = post(route(search({ embed, chat })));

      await vi.advanceTimersByTimeAsync(10_000);

      expect(request.response().status).toBe(503);
      expect(request.took()).toBe(DEFAULT_LEG_TIMEOUT_MS);
      // The direct leg's embedding and the translation's embedding were both cancelled.
      expect(embed.signals).toHaveLength(2);
      expect(embed.signals.every((signal) => signal.aborted)).toBe(true);
    });

    it("the Cohere translation, never answering even once cancelled: the direct leg answers, 200 at 2.2 s, and the translation is cancelled", async () => {
      const chat = chatClient({ hang: true });
      const request = post(route(search({ chat })));

      await vi.advanceTimersByTimeAsync(10_000);

      expect(request.response().status).toBe(200);
      expect(SearchV1Schema.parse(await request.response().json())).toMatchObject({ release_v: 5, query_lang: "ur", status: "ok", results: [{ provider_id: "M001" }] });
      expect(request.took()).toBe(DEFAULT_LEG_TIMEOUT_MS);
      expect(chat.signals).toHaveLength(1);
      expect(chat.signals[0]!.aborted).toBe(true);
    });

    it("answers the Urdu question with both legs when nothing is slow", async () => {
      const embed = embedClient();
      const chat = chatClient();
      const request = post(route(search({ embed, chat })));

      await vi.advanceTimersByTimeAsync(10_000);

      expect(request.response().status).toBe(200);
      expect(await request.response().json()).toMatchObject({ status: "ok", results: [{ provider_id: "M001" }] });
      expect(request.took()).toBeLessThan(1000);
      expect(embed.signals).toHaveLength(2); // the question, and its translation
    });

    it("a slow (not hung) load of the release's data still completes for a later request, which joins it", async () => {
      // Each file takes 3 s (the two are downloaded together): the load the first request starts ends at about 3 s, after that request gave up.
      const store = releaseStore({ ms: 3000 });
      const service = search({ store });

      const first = post(route(service));
      await vi.advanceTimersByTimeAsync(2500);
      const second = post(route(service));
      await vi.advanceTimersByTimeAsync(10_000);
      const third = post(route(service));
      await vi.advanceTimersByTimeAsync(10_000);

      expect(first.response().status).toBe(503);
      expect(first.took()).toBe(DEFAULT_LEG_TIMEOUT_MS);
      expect(second.response().status).toBe(200);
      expect(second.took()).toBeLessThan(DEFAULT_LEG_TIMEOUT_MS);
      expect(third.response().status).toBe(200);
      expect(store.gets).toEqual([VECTORS_PATH, LISTING_PATH]);
    });
  });

  describe("the route's hard deadline, over what no stage bounds", () => {
    it("answers 503 search_unavailable at 2.5 s to a body that never arrives, and tells the app after the response", async () => {
      const service = search();
      const asked = vi.spyOn(service, "search");
      const request = post(route(service), new ReadableStream({ start() {} }));

      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.all(deferred);

      expect(request.response().status).toBe(503);
      expect(request.response().headers.get("cache-control")).toBe("no-store");
      expect(await errorCode(request.response())).toBe("search_unavailable");
      expect(request.took()).toBe(DEFAULT_TOTAL_BUDGET_MS);
      expect(asked).not.toHaveBeenCalled();
      expect(deadlines).toEqual([DEFAULT_TOTAL_BUDGET_MS]);
    });

    it("answers 503 at 2.5 s when the search itself never settles (a wait none of its stages bounds), and tells the app how long it ran", async () => {
      const stuck: SearchService = { search: () => never(), has: () => never() };
      const request = post(route(stuck));

      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.all(deferred);

      expect(request.response().status).toBe(503);
      expect(await errorCode(request.response())).toBe("search_unavailable");
      expect(request.took()).toBe(DEFAULT_TOTAL_BUDGET_MS);
      expect(deadlines).toEqual([DEFAULT_TOTAL_BUDGET_MS]);
    });

    it("does not turn a ready answer into a 503 when its writes never finish: the search answers at 2.4 s, before the deadline", async () => {
      const db = releaseDb();
      const store = releaseStore();
      const service = createSearch({
        db: () => db.db,
        storage: () => store.storage,
        embedder: cohereQueryEmbedder({ apiKey: "test-key", client: embedClient().client }),
        writer: { log: never, spend: never },
        defer: (work) => void deferred.push(work),
        clock: () => Date.now(),
      });
      const request = post(route(service));

      await vi.advanceTimersByTimeAsync(10_000);

      expect(request.response().status).toBe(200);
      expect(request.took()).toBeLessThan(DEFAULT_TOTAL_BUDGET_MS);
      expect(deadlines).toEqual([]);
    });

    it("leaves a limiter that never counts to its own 503 at 1 s: that is not a deadline", async () => {
      const request = post(route(search(), { limiter: () => ({ check: () => never() }) }));

      await vi.advanceTimersByTimeAsync(10_000);

      expect(request.response().status).toBe(503);
      expect(request.took()).toBe(1000);
      expect(deadlines).toEqual([]);
    });

    it("can be set for a test: a deadline of 300 ms cuts a search that would take 2.2 s", async () => {
      const request = post(route(search({ store: releaseStore({ never: true }) }), { deadlineMs: 300 }));

      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.all(deferred);

      expect(request.response().status).toBe(503);
      expect(request.took()).toBe(300);
      expect(deadlines).toEqual([300]);
    });
  });
});
