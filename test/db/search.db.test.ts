// Search against a real database and a release the publish job really wrote (S03.04, FR-D2-Q, AD-3, AD-11, AD-22): the
// SearchV1 answer, the request snapshot, the ranking sequence, the time limit, spend and search_log, the privacy of the
// question, the per-client limit, and the route's answers. The embedding model is a fake: nothing here reaches Cohere.
import { randomBytes, randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { searchResponse, type SearchRouteDeps } from "../../src/app/api/search/handler";
import { migrate } from "../../scripts/db/migrate.mjs";
import { runQuestions } from "../../scripts/search-test-set/lib";
import { SearchErrorSchema } from "@/contracts/search";
import { SearchV1Schema, TestQuestionSchema } from "@/contracts/searchTestSet";
import {
  cohereQueryEmbedder,
  createSearch,
  memoryDirectoryStorage,
  publishDirectory,
  SearchFailure,
  type Embedder,
  type PublishDeps,
  type QueryEmbedder,
  type SearchDeps,
  type SearchFailureNote,
} from "@/modules/directory";
import { SPEND_LOCK_KEY } from "@/modules/spend";
import { recordOpsEvent } from "@/modules/ops";
import { SEARCH_RATE_LIMIT, createRateLimiter } from "@/modules/subscriptions";
import { cohereTranslator, createQuestionTranslator, type QuestionRoute, type Translator } from "@/modules/translation";
import { createDb, type Db } from "@/platform/db";
import { connect, serverUrl } from "./helpers";

const MODEL = "embed-v4.0";
const MARKER = "zq7-marker-unique-question-text";
/** A marker in the English translation of a question (S03.05): it must be kept nowhere either. */
const TRANSLATED_MARKER = "zqtranslatedmarker";
const ROUTE: QuestionRoute = {
  ps: "north-small-translate-09-2026",
  prs: "north-small-translate-09-2026",
  romanized_or_mixed: "command-a-translate-08-2025",
  ambiguous_arabic: "command-a-translate-08-2025",
};
/** A Pashto question (Pashto letters): the embedding model makes nothing of it, its English translation finds the legal clinic. */
const PASHTO = "زه وړیا حقوقي مشوره غواړم";

/** A fake of the translation model: answers with `answer`, fails echoing its request, or stalls until cancelled. */
function fakeTranslator(options: { answer?: string; echoError?: boolean; stall?: boolean } = {}) {
  let aborted = false;
  const translator: Translator = {
    async translate({ text, signal }) {
      signal.addEventListener("abort", () => (aborted = true));
      if (options.echoError) throw Object.assign(new Error(`400 bad request: ${JSON.stringify({ messages: [{ content: text }] })}`), { body: { text }, cause: new Error(text) });
      if (options.stall) await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error(`aborted: ${text}`))));
      return { text: options.answer ?? "I need a lawyer", inputTokens: 30, outputTokens: 6 };
    },
  };
  return { translator, wasAborted: () => aborted, questions: createQuestionTranslator({ translator, route: ROUTE }) };
}

/** Dimensions: legal, health, food, other. A document's vector is its subject; a question's is the subjects it names. */
const SUBJECTS: [RegExp, number[]][] = [
  [/lawyer|legal/i, [1, 0, 0, 0]],
  [/doctor|health|clinic/i, [0, 1, 0, 0]],
  [/food|hamper/i, [0, 0, 1, 0]],
];
/** A provider's search text names its category on the "Categories:" line; that decides its vector. */
const vectorOfText = (text: string) => {
  const category = /^Categories: (.*)$/m.exec(text)?.[1] ?? "";
  return category.includes("Legal") ? [1, 0, 0, 0.1] : category.includes("Health") ? [0, 1, 0, 0.1] : [0, 0, 1, 0.1];
};
/** Words, not the vectors above, decide a question; a question naming nothing is "other". */
const vectorOfQuestion = (q: string) => {
  const v: number[] = [0, 0, 0, 0];
  for (const [pattern, add] of SUBJECTS) if (pattern.test(q)) add.forEach((x, i) => (v[i] += x));
  if (!v.some((x) => x !== 0)) v[3] = 1;
  return v;
};

interface QueryCall {
  text: string;
  model: string;
  dims: number | null;
  signal: AbortSignal;
}

/** A fake of the question side of the model: records every call, and can wait, stall until cancelled, or fail echoing its request. */
function fakeQueryEmbedder(options: { wait?: Promise<void>; stall?: boolean; echoError?: boolean; tokens?: number | null; onCall?: () => Promise<void> } = {}) {
  const calls: QueryCall[] = [];
  let aborted = false;
  const embedder: QueryEmbedder = {
    async embedQuery(input) {
      calls.push(input);
      input.signal.addEventListener("abort", () => (aborted = true));
      await options.onCall?.();
      if (options.wait) await options.wait;
      if (options.stall) await new Promise((_, reject) => input.signal.addEventListener("abort", () => reject(new Error(`aborted: ${input.text}`))));
      if (options.echoError) throw Object.assign(new Error(`400 bad request: ${JSON.stringify({ texts: [input.text] })}`), { body: { texts: [input.text] }, cause: new Error(input.text) });
      return { vector: vectorOfQuestion(input.text), tokens: options.tokens === undefined ? 7 : options.tokens };
    },
  };
  return { embedder, calls, wasAborted: () => aborted };
}

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => (open = resolve));
  return { promise, open };
}

describe("search", () => {
  let sql: ReturnType<typeof connect>;
  let appSql: ReturnType<typeof connect>;
  let app: Db;
  let storage: ReturnType<typeof memoryDirectoryStorage>;
  const staffId = randomUUID();
  let auditBaseline = 0;

  const docEmbedder = (model = MODEL): Embedder => ({
    model,
    config: { model, inputType: "search_document", embeddingType: "float", dims: null },
    async embedDocuments(texts) {
      return { vectors: texts.map(vectorOfText), tokens: 10 };
    },
  });

  const publishDeps = (change: { search?: boolean; model?: string; threshold?: number } = {}): PublishDeps => ({
    storage,
    catalogue: async () => ({ hash: "b".repeat(64), gitCommit: null }),
    zhHant: async () => ({ convert: (text: string) => text, openccVersion: "1.4.2", config: "test" }),
    neighbourhoods: async () => ({ reviewed: true, byProvider: { M001: ["TP"], M002: ["FP"], M003: [] } }),
    onFailure: async () => {},
    sleep: async () => {},
    ...(change.search === false
      ? {}
      : {
          search: {
            embedder: docEmbedder(change.model),
            threshold: change.threshold ?? 0.3,
            emergencyCategories: ["Health"],
            allowance: { callsPerMonth: 100, tokensPerMonth: 1_000_000 },
          },
        }),
  });
  const publish = (change: Parameters<typeof publishDeps>[0] = {}) => publishDirectory(app, publishDeps(change), staffId);

  async function wipe() {
    await sql.unsafe(`
      alter table directory_release disable trigger directory_release_guard;
      delete from directory_release;
      alter table directory_release enable trigger directory_release_guard;
      delete from catalogue_load;
      delete from provider_category; delete from provider_location; delete from provider; delete from category;
      delete from search_log; delete from spend_event; delete from rate_limit; delete from ops_event`);
    storage = memoryDirectoryStorage();
  }

  beforeAll(async () => {
    sql = connect(serverUrl());
    await migrate({ sql });
    [{ max: auditBaseline }] = await sql`select coalesce(max(id), 0)::int as max from audit_event`;
    const password = randomBytes(18).toString("hex");
    await sql.unsafe(`alter role cvh_app_login password '${password}'`);
    const url = new URL(serverUrl());
    url.username = "cvh_app_login";
    url.password = password;
    app = createDb(url.href);
    appSql = connect(url.href);
    await sql`
      insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password)
      values (${staffId}, ${randomUUID()}, ${`admin${randomBytes(3).toString("hex")}`}, 'Ann', 'Okafor', 'someone@example.org', 'admin', false)`;
  });

  afterAll(async () => {
    await wipe();
    await sql.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await sql`delete from audit_event where id > ${auditBaseline}`;
    await sql.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
    await sql`delete from staff_account where id = ${staffId}`;
    await sql.unsafe("alter role cvh_app_login password null");
    await appSql.end({ timeout: 5 });
    await app.$client.end({ timeout: 5 });
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await wipe();
    await sql`insert into catalogue_load (hash) values (${"b".repeat(64)})`;
    await sql`insert into category (id, name, sort_order, labels) values ('c-legal', 'Legal', 1, ${sql.json({ en: "Legal" })}), ('c-health', 'Health', 2, ${sql.json({ en: "Health" })}), ('c-food', 'Food', 3, ${sql.json({ en: "Food" })})`;
    const rows: [string, string, string, string][] = [
      ["M001", "Thorncliffe Legal Clinic", "Free legal help.", "c-legal"],
      ["M002", "Flemingdon Health Centre", "Walk-in clinic.", "c-health"],
      ["M003", "East York Food Bank", "Food hampers.", "c-food"],
    ];
    for (const [id, name, services, category] of rows) {
      await sql`
        insert into provider (id, name, texts, published, published_at, last_confirmed)
        values (${id}, ${name}, ${sql.json({ services: { en: services } })}, true, now(), '2026-09-20')`;
      await sql`insert into provider_location (provider_id, street, city, lat, lng) values (${id}, '1 Overlea Blvd', 'East York', 43.7, -79.34)`;
      await sql`insert into provider_category (provider_id, category_id) values (${id}, ${category})`;
    }
  });

  const service = (embedder: QueryEmbedder | null, extra: Partial<Pick<SearchDeps, "translator" | "onFailure" | "legTimeoutMs" | "spendPurpose" | "log" | "defer" | "totalBudgetMs" | "snapshotFailureTtlMs" | "storage">> = {}) =>
    createSearch({ db: () => app, storage: () => storage, embedder, ...extra });
  const rows = (table: string) => sql.unsafe(`select * from ${table} order by id`).then((r) => r.map((row) => ({ ...row })));
  const routeDeps = (embedder: QueryEmbedder | null, now?: () => Date): SearchRouteDeps => ({
    search: () => service(embedder),
    limiter: () => createRateLimiter({ db: app, key: "route-test-key", ...(now ? { now } : {}) }),
    client: (headers) => headers.get("x-real-ip") ?? "unknown",
  });
  const post = (deps: SearchRouteDeps, body: unknown, headers: Record<string, string> = {}) =>
    searchResponse(deps, new Request("https://x.test/api/search", { method: "POST", headers: { "x-real-ip": "198.51.100.7", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));

  describe("the answer", () => {
    it("returns SearchV1 with the providers that qualify, best first, and the release and the language of the question", async () => {
      await publish();
      const model = fakeQueryEmbedder();

      const body = await service(model.embedder).search({ q: "I need a lawyer", lang: "en" });

      expect(SearchV1Schema.parse(body)).toEqual({
        v: 1,
        release_v: 1,
        query_lang: "en",
        status: "ok",
        emergency_first: false,
        results: [{ provider_id: "M001", score: expect.closeTo(0.995037, 5) }],
      });
    });

    it("embeds the question as a query with the release's model, not the document type or a model of its own choosing", async () => {
      await publish({ model: "embed-v4.0" });
      const model = fakeQueryEmbedder();

      await service(model.embedder).search({ q: "lawyer", lang: "ur" });

      expect(model.calls.map(({ text, model: m, dims }) => ({ text, model: m, dims }))).toEqual([{ text: "lawyer", model: "embed-v4.0", dims: null }]);
    });

    it("returns only the providers that qualify, never padded to fill the list, and none below the threshold", async () => {
      await publish();

      const body = await service(fakeQueryEmbedder().embedder).search({ q: "a lawyer or a doctor", lang: "en" });

      expect(body.status).toBe("ok");
      expect(body.results.map((r) => r.provider_id).sort()).toEqual(["M001", "M002"]);
      expect(body.results.every((r) => r.score >= 0.3)).toBe(true);
    });

    it("answers no_clear_match with no results when no provider qualifies", async () => {
      await publish();

      const body = await service(fakeQueryEmbedder().embedder).search({ q: "xyzzy", lang: "en" });

      expect(body).toEqual({ v: 1, release_v: 1, query_lang: "en", status: "no_clear_match", emergency_first: false, results: [] });
    });

    it("uses the threshold recorded on the release, not a setting of the running code", async () => {
      await publish({ threshold: 0.99 });

      // 0.9950 qualifies at 0.99 ...
      expect((await service(fakeQueryEmbedder().embedder).search({ q: "lawyer", lang: "en" })).status).toBe("ok");
      // ... and 0.704 does not.
      expect((await service(fakeQueryEmbedder().embedder).search({ q: "lawyer and doctor", lang: "en" })).status).toBe("no_clear_match");
    });

    it("sets emergency_first when a result is in an emergency category recorded on the release", async () => {
      await publish();

      expect((await service(fakeQueryEmbedder().embedder).search({ q: "doctor", lang: "en" })).emergency_first).toBe(true);
      expect((await service(fakeQueryEmbedder().embedder).search({ q: "lawyer", lang: "en" })).emergency_first).toBe(false);
      expect((await service(fakeQueryEmbedder().embedder).search({ q: "xyzzy", lang: "en" })).emergency_first).toBe(false);
    });

    it("takes the language of a question written in another language, and the page language when it cannot tell", async () => {
      await publish();
      const search = service(fakeQueryEmbedder().embedder);

      expect((await search.search({ q: "doctor", lang: "en" })).query_lang).toBe("en");
      expect((await search.search({ q: "ডাক্তার", lang: "en" })).query_lang).toBe("bn");
      expect((await search.search({ q: "12345", lang: "ur" })).query_lang).toBe("ur");
    });

    it("reads the vectors once and keeps them in memory", async () => {
      await publish();
      const reads = vi.spyOn(storage, "get");
      const search = service(fakeQueryEmbedder().embedder);

      await search.search({ q: "lawyer", lang: "en" });
      const first = reads.mock.calls.length;
      await search.search({ q: "doctor", lang: "en" });

      expect(first).toBe(2);
      expect(reads.mock.calls.length).toBe(first);
    });
  });

  describe("search that cannot answer from this release", () => {
    it("answers status unavailable, and calls no model, for a release without search data", async () => {
      await publish({ search: false });
      const model = fakeQueryEmbedder();

      const body = await service(model.embedder).search({ q: "lawyer", lang: "en" });

      expect(body).toEqual({ v: 1, release_v: 1, query_lang: "en", status: "unavailable", emergency_first: false, results: [] });
      expect(model.calls).toEqual([]);
      expect(await rows("spend_event")).toEqual([]);
      expect(await rows("search_log")).toMatchObject([{ status: "unavailable", result_count: 0, release_v: 1 }]);
    });

    it("answers status unavailable, and calls no model, where no embedding key is configured", async () => {
      await publish();

      const body = await service(null).search({ q: "lawyer", lang: "en" });

      expect(body).toMatchObject({ release_v: 1, status: "unavailable", results: [] });
    });

    it("answers status unavailable with release 0 before any release exists", async () => {
      const model = fakeQueryEmbedder();

      const body = await service(model.embedder).search({ q: "lawyer", lang: "en" });

      expect(SearchV1Schema.parse(body)).toMatchObject({ release_v: 0, status: "unavailable" });
      expect(model.calls).toEqual([]);
    });

    it("fails with search_unavailable, not a wrong answer, when the vectors file is not what the release recorded", async () => {
      await publish();
      storage.files.set("releases/1/vectors.json", "{}");
      const notes: SearchFailureNote[] = [];

      await expect(service(fakeQueryEmbedder().embedder, { onFailure: async (n) => void notes.push(n) }).search({ q: "lawyer", lang: "en" })).rejects.toMatchObject({ name: "SearchFailure", code: "search_unavailable" });

      expect(notes).toMatchObject([{ reason: "snapshot_failed", releaseV: 1 }]);
    });

    it("does not download a bad release again, nor alert again, for 60 s: the next search fails at once, and the release is tried again after that", async () => {
      await publish();
      storage.files.set("releases/1/vectors.json", "{}");
      const gets: string[] = [];
      const counting = { put: storage.put, get: async (file: string) => (gets.push(file), storage.get(file)) };
      const notes: SearchFailureNote[] = [];
      const search = service(fakeQueryEmbedder().embedder, { storage: () => counting, snapshotFailureTtlMs: 150, onFailure: async (n) => void notes.push(n) });

      for (let i = 0; i < 3; i++) await expect(search.search({ q: "lawyer", lang: "en" })).rejects.toMatchObject({ code: "search_unavailable" });

      expect(gets).toEqual(["releases/1/vectors.json"]);
      expect(notes).toHaveLength(1);
      // Each failed search is still one search_log row.
      expect(await rows("search_log")).toMatchObject([{ status: "error" }, { status: "error" }, { status: "error" }]);

      await new Promise((resolve) => setTimeout(resolve, 200));
      await expect(search.search({ q: "lawyer", lang: "en" })).rejects.toMatchObject({ code: "search_unavailable" });

      expect(gets).toEqual(["releases/1/vectors.json", "releases/1/vectors.json"]);
      expect(notes).toHaveLength(2);
    });
  });

  describe("the request snapshot", () => {
    it("uses only its snapshot when a release is made current during the search, and the next search uses the new release", async () => {
      await publish({ model: "embed-v4.0", threshold: 0.3 });
      const held = gate();
      const reached = gate();
      const slow = fakeQueryEmbedder({ wait: held.promise, onCall: async () => reached.open() });
      const search = service(slow.embedder);

      const running = search.search({ q: "lawyer and doctor", lang: "en" });
      await reached.promise;
      // While the question is being embedded, release 2 is published with another model and a threshold nothing reaches.
      await publish({ model: "embed-v5.0", threshold: 0.99 });
      expect((await sql`select number from directory_release where is_current`)[0].number).toBe(2);
      held.open();
      const body = await running;

      expect(body).toMatchObject({ release_v: 1, status: "ok" });
      expect(body.results).toHaveLength(2);
      expect(slow.calls[0]!.model).toBe("embed-v4.0");

      const next = fakeQueryEmbedder();
      const later = await search.search({ q: "lawyer and doctor", lang: "en" });
      await service(next.embedder).search({ q: "lawyer", lang: "en" });

      expect(later).toMatchObject({ release_v: 2, status: "no_clear_match" });
      expect(next.calls[0]!.model).toBe("embed-v5.0");
    });

    it("returns the current release_v to a client holding an older v", async () => {
      await publish();
      await publish();

      const body = await service(fakeQueryEmbedder().embedder).search({ q: "lawyer", lang: "en", v: 1 });

      expect(body.release_v).toBe(2);
    });
  });

  describe("time limit", () => {
    it("answers search_unavailable within 2.5 s when the embedding takes 3 s, cancels the call, and counts the failure without the question", async () => {
      await publish();
      const stalled = fakeQueryEmbedder({ stall: true });
      const notes: SearchFailureNote[] = [];
      const search = service(stalled.embedder, { onFailure: async (n) => void notes.push(n) });
      // A first question, so that the spend and log rows below show the failure beside an answer.
      await service(fakeQueryEmbedder().embedder).search({ q: "lawyer", lang: "en" });

      const started = performance.now();
      const failure = await search.search({ q: MARKER, lang: "en" }).catch((e: unknown) => e);
      const took = performance.now() - started;

      expect(failure).toBeInstanceOf(SearchFailure);
      expect((failure as SearchFailure).code).toBe("search_unavailable");
      expect(took).toBeLessThan(2500);
      expect(took).toBeGreaterThanOrEqual(2150);
      expect(stalled.wasAborted()).toBe(true);
      expect(notes).toMatchObject([{ reason: "timed_out", releaseV: 1 }]);
      expect(notes[0]!.ms).toBeLessThan(2500);
      // The cancelled call may have been billed: it is counted, as an estimate.
      expect((await rows("spend_event")).filter((r) => r.purpose !== "publish")).toMatchObject([{ purpose: "search" }, { purpose: "search", tokens_estimated: true }]);
      expect(await rows("search_log")).toMatchObject([{ status: "ok" }, { status: "error", result_count: 0, top_score: null }]);
    }, 15_000);

    it("counts the 2.2 s leg from the start the caller passes in: a request that began 2 s ago has 0.2 s", async () => {
      await publish();
      const stalled = fakeQueryEmbedder({ stall: true });
      const notes: SearchFailureNote[] = [];

      const started = performance.now();
      const failure = await service(stalled.embedder, { onFailure: async (n) => void notes.push(n) })
        .search({ q: "lawyer", lang: "en" }, started - 2000)
        .catch((e: unknown) => e);
      const took = performance.now() - started;

      expect(failure).toMatchObject({ code: "search_unavailable" });
      expect(took).toBeLessThan(600);
      expect(stalled.wasAborted()).toBe(true);
      expect(notes).toMatchObject([{ reason: "timed_out" }]);
      expect(notes[0]!.ms).toBeGreaterThanOrEqual(2150);
    });

    it("does not call the model, or count a spend, when the budget is spent before the call (a slow body or limiter)", async () => {
      await publish();
      const model = fakeQueryEmbedder();
      const notes: SearchFailureNote[] = [];

      const failure = await service(model.embedder, { onFailure: async (n) => void notes.push(n) })
        .search({ q: "lawyer", lang: "en" }, performance.now() - 2300)
        .catch((e: unknown) => e);

      expect(failure).toMatchObject({ code: "search_unavailable" });
      expect(model.calls).toEqual([]);
      expect(notes).toMatchObject([{ reason: "timed_out" }]);
      expect((await rows("spend_event")).filter((r) => r.purpose !== "publish")).toEqual([]);
    });

    it("answers within 2.5 s of the request start when the limiter is slow: the leg gets what is left", async () => {
      await publish();
      const stalled = fakeQueryEmbedder({ stall: true });
      const slow: SearchRouteDeps = { ...routeDeps(stalled.embedder), limiterBudgetMs: 1800, limiter: () => ({ check: async () => (await new Promise((r) => setTimeout(r, 1500)), { allowed: true }) }) };

      const started = performance.now();
      const response = await post(slow, { q: "lawyer", lang: "en" });
      const took = performance.now() - started;

      expect(response.status).toBe(503);
      expect(took).toBeLessThan(2500);
      expect(took).toBeGreaterThanOrEqual(2150);
      expect(stalled.wasAborted()).toBe(true);
    }, 15_000);

    it("answers 503 search_unavailable within 2.5 s, and calls no model, when the limiter never answers, and reports it", async () => {
      await publish();
      const model = fakeQueryEmbedder();
      const reported: number[] = [];
      const deferred: Promise<unknown>[] = [];
      const hung: SearchRouteDeps = {
        ...routeDeps(model.embedder),
        limiter: () => ({ check: () => new Promise(() => undefined) }),
        onLimiterFailure: async (ms) => void reported.push(ms),
        defer: (work) => void deferred.push(work),
      };

      const started = performance.now();
      const response = await post(hung, { q: "lawyer", lang: "en" });
      const took = performance.now() - started;
      await Promise.all(deferred);

      expect(response.status).toBe(503);
      expect(SearchErrorSchema.parse(await response.json()).error.code).toBe("search_unavailable");
      expect(took).toBeLessThan(2500);
      expect(model.calls).toEqual([]);
      expect(reported).toHaveLength(1);
      expect(reported[0]!).toBeGreaterThanOrEqual(950);
    });

    it("answers 503 within 2.5 s of the request start when the rate_limit table is locked, through the limiter's own lock and statement timeouts", async () => {
      await publish();
      const model = fakeQueryEmbedder();
      const locked = gate();
      const release = gate();
      const holder = connect(serverUrl());
      const holding = holder.begin(async (tx) => {
        await tx.unsafe("lock table rate_limit in access exclusive mode");
        locked.open();
        await release.promise;
      });
      await locked.promise;
      try {
        const deps: SearchRouteDeps = { ...routeDeps(model.embedder), limiter: () => createRateLimiter({ db: app, key: "route-test-key", timeoutMs: 300 }) };

        const started = performance.now();
        const response = await post(deps, { q: "lawyer", lang: "en" });
        const took = performance.now() - started;

        expect(response.status).toBe(503);
        expect(took).toBeGreaterThanOrEqual(250);
        expect(took).toBeLessThan(2500);
        expect(model.calls).toEqual([]);
      } finally {
        release.open();
        await holding;
        await holder.end({ timeout: 5 });
      }
    }, 15_000);

    it("stops a count that waits for a lock after the limiter's own timeout, not the connection's", async () => {
      const locked = gate();
      const release = gate();
      const holder = connect(serverUrl());
      const holding = holder.begin(async (tx) => {
        await tx.unsafe("lock table rate_limit in access exclusive mode");
        locked.open();
        await release.promise;
      });
      await locked.promise;
      try {
        const started = performance.now();
        await expect(createRateLimiter({ db: app, key: "k", timeoutMs: 200 }).check(SEARCH_RATE_LIMIT, "203.0.113.5")).rejects.toThrow();
        expect(performance.now() - started).toBeLessThan(1500);
      } finally {
        release.open();
        await holding;
        await holder.end({ timeout: 5 });
      }
    });
  });

  describe("spend and search_log", () => {
    it("records the question's embedding in spend_event as purpose search, outside the publish lock and with no transaction held across the call", async () => {
      await publish();
      await sql`delete from spend_event`;
      const holder = connect(serverUrl());
      await holder.begin(async (tx) => {
        // Someone holds the publish job's spend lock for the whole search.
        await tx`select pg_advisory_xact_lock(${SPEND_LOCK_KEY})`;
        let open = -1;
        const model = fakeQueryEmbedder({
          tokens: 321,
          onCall: async () => {
            [{ n: open }] = await sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and state = 'idle in transaction' and pid <> pg_backend_pid() and query not like '%pg_advisory_xact_lock(%'`;
          },
        });
        const body = await service(model.embedder).search({ q: "lawyer", lang: "en" });
        expect(body.status).toBe("ok");
        expect(open).toBe(0);
      });
      await holder.end({ timeout: 5 });

      expect(await rows("spend_event")).toMatchObject([
        { kind: "embed", purpose: "search", model: MODEL, release_v: 1, calls: 1, tokens: "321", tokens_estimated: false, price_per_million_tokens_cad: null },
      ]);
    });

    it("does not count a question against the publish allowance", async () => {
      await publish();
      await service(fakeQueryEmbedder().embedder).search({ q: "lawyer", lang: "en" });

      const [{ calls }] = await sql`select coalesce(sum(calls), 0)::int as calls from spend_event where purpose = 'publish'`;
      const [{ all }] = await sql`select coalesce(sum(calls), 0)::int as all from spend_event`;
      expect(all).toBe(calls + 1);
    });

    it("estimates the tokens, and says so, when the vendor did not bill any", async () => {
      await publish();
      await sql`delete from spend_event`;

      await service(fakeQueryEmbedder({ tokens: null }).embedder).search({ q: "lawyer", lang: "en" });

      expect(await rows("spend_event")).toMatchObject([{ purpose: "search", tokens_estimated: true }]);
    });

    it("counts the usage, as reported or estimated, of an embedding that answered with no usable vector", async () => {
      await publish();
      await sql`delete from spend_event`;
      const answering = (answer: { vector: number[]; tokens: number | null }): QueryEmbedder => ({ embedQuery: async () => answer });
      const notes: SearchFailureNote[] = [];
      const onFailure = async (n: SearchFailureNote) => void notes.push(n);

      for (const answer of [{ vector: [1, 0], tokens: 9 }, { vector: [], tokens: 4 }, { vector: undefined as unknown as number[], tokens: null }]) {
        await expect(service(answering(answer), { onFailure }).search({ q: "lawyer", lang: "en" })).rejects.toMatchObject({ code: "search_unavailable" });
      }

      expect(notes.map((n) => n.reason)).toEqual(["embed_invalid", "embed_invalid", "embed_invalid"]);
      expect(await rows("spend_event")).toMatchObject([
        { purpose: "search", tokens: "9", tokens_estimated: false },
        { purpose: "search", tokens: "4", tokens_estimated: false },
        { purpose: "search", tokens_estimated: true },
      ]);
    });

    it("hands the writes still pending at the end of the budget to defer, which finishes them", async () => {
      await publish();
      await sql.unsafe("delete from spend_event; delete from search_log");
      const deferred: Promise<unknown>[] = [];

      const body = await service(fakeQueryEmbedder().embedder, { totalBudgetMs: 0, defer: (work) => void deferred.push(work) }).search({ q: "lawyer", lang: "en" });
      await Promise.all(deferred);

      expect(body.status).toBe("ok");
      expect(deferred).toHaveLength(1);
      expect(await rows("spend_event")).toMatchObject([{ purpose: "search" }]);
      expect(await rows("search_log")).toMatchObject([{ status: "ok" }]);
    });

    it("records what the translated-question leg did in search_log.translated_leg (S03.05), and the translation's usage in spend_event as kind translate", async () => {
      await publish();
      await sql.unsafe("delete from spend_event; delete from search_log");
      const model = fakeQueryEmbedder();

      // used: the direct leg finds nothing in Pashto, the translation finds the legal clinic.
      const used = await service(model.embedder, { translator: fakeTranslator().questions }).search({ q: PASHTO, lang: "ps" });
      // failed: the translation model fails, and the direct leg answers alone.
      const failed = await service(model.embedder, { translator: fakeTranslator({ echoError: true }).questions }).search({ q: PASHTO, lang: "ps" });
      // timed_out: the translation is still running when the leg's time is up.
      const stalled = fakeTranslator({ stall: true });
      const timedOut = await service(model.embedder, { translator: stalled.questions, legTimeoutMs: 1000 }).search({ q: PASHTO, lang: "ps" });
      // not_needed: a question confidently in English. (A lone word such as "lawyer" is not confidently English, S03.03, so it
      // gets the leg too.)
      await service(model.embedder, { translator: fakeTranslator().questions }).search({ q: "I need a lawyer", lang: "en" });

      expect(used).toMatchObject({ status: "ok", query_lang: "ps", results: [{ provider_id: "M001" }] });
      expect(failed.status).toBe("no_clear_match");
      expect(timedOut.status).toBe("no_clear_match");
      expect(stalled.wasAborted()).toBe(true);
      expect(await rows("search_log")).toMatchObject([
        { lang: "ps", query_lang: "ps", status: "ok", result_count: 1, translated_leg: "used" },
        { status: "no_clear_match", translated_leg: "failed" },
        { status: "no_clear_match", translated_leg: "timed_out" },
        { status: "ok", translated_leg: "not_needed" },
      ]);
      const spend = await rows("spend_event");
      expect(spend.filter((r) => r.kind === "translate")).toMatchObject([
        { purpose: "search", model: "north-small-translate-09-2026", release_v: 1, calls: 1, tokens: "36", tokens_estimated: false },
        // The cancelled translation may have been billed: an estimate.
        { purpose: "search", model: "north-small-translate-09-2026", tokens_estimated: true },
      ]);
      // Four questions embedded as typed, plus the one translation that was used.
      expect(spend.filter((r) => r.kind === "embed")).toHaveLength(5);
    });

    it("stores in search_log only at, lang, query_lang, release_v, ms, result_count, status, top_score and translated_leg", async () => {
      await publish();

      await service(fakeQueryEmbedder().embedder).search({ q: "lawyer", lang: "ur" });

      const columns = await sql`select column_name from information_schema.columns where table_name = 'search_log' order by ordinal_position`;
      expect(columns.map((c) => c.column_name)).toEqual(["id", "at", "lang", "query_lang", "release_v", "ms", "result_count", "status", "top_score", "translated_leg"]);
      const [row] = await rows("search_log");
      expect(row).toMatchObject({ lang: "ur", query_lang: "ur", release_v: 1, result_count: 1, status: "ok", translated_leg: "not_needed" });
      expect(row!.top_score).toBeCloseTo(0.995037, 5);
      expect(row!.ms).toBeGreaterThanOrEqual(0);
    });
  });

  describe("privacy (AD-3)", () => {
    function captureOutput() {
      const lines: string[] = [];
      const grab = (...args: unknown[]) => void lines.push(args.map((a) => (typeof a === "string" ? a : inspect(a, { depth: 8 }))).join(" "));
      const spies: { mockRestore(): void }[] = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(grab));
      const write = (chunk: unknown) => (lines.push(String(chunk)), true);
      spies.push(vi.spyOn(process.stdout, "write").mockImplementation(write as never), vi.spyOn(process.stderr, "write").mockImplementation(write as never));
      return { lines, restore: () => spies.forEach((spy) => spy.mockRestore()) };
    }
    afterEach(() => vi.restoreAllMocks());

    async function everythingStored() {
      const tables = await sql`select tablename from pg_tables where schemaname = 'public' order by tablename`;
      const out: string[] = [];
      for (const { tablename } of tables) out.push(...(await sql.unsafe(`select to_jsonb(t)::text as j from "${tablename}" t`)).map((r) => `${tablename}: ${r.j}`));
      return out.join("\n");
    }

    it("leaves the question in no table, no log, no ops event, no error response and no error object, even when the embedding adapter throws an error that echoes its request", async () => {
      await publish();
      const out = captureOutput();
      const responses: string[] = [];
      const errors: unknown[] = [];
      const deps = (embedder: QueryEmbedder | null): SearchRouteDeps => {
        const notes = service(embedder, {
          onFailure: async ({ reason, releaseV, ms }) => {
            await appSql`insert into ops_event (kind, severity, subject_type, subject_id, detail) values ('search.unavailable', 'warning', 'directory_release', ${String(releaseV)}, ${appSql.json({ reason, ms })})`;
          },
        });
        return { search: () => notes, limiter: () => createRateLimiter({ db: app, key: "k" }), client: () => "203.0.113.9" };
      };
      const ask = async (d: SearchRouteDeps) => {
        const response = await searchResponse(d, new Request("https://x.test/api/search", { method: "POST", body: JSON.stringify({ q: MARKER, lang: "en" }) }));
        responses.push(`${response.status} ${[...response.headers].join(";")} ${await response.text()}`);
      };

      // An embedder that fails echoing its request, directly, and the real adapter over a client that does the same.
      await ask(deps(fakeQueryEmbedder({ echoError: true }).embedder));
      const echoing = { v2: { embed: async (request: { texts: string[] }) => { throw Object.assign(new Error(`bad request ${JSON.stringify(request)}`), { body: request, cause: request.texts }); } } };
      const wrapped = cohereQueryEmbedder({ apiKey: "k", client: echoing as never });
      await ask(deps(wrapped));
      await wrapped.embedQuery({ text: MARKER, model: MODEL, dims: null, signal: new AbortController().signal }).catch((e: unknown) => errors.push(e));
      // A search that succeeds and one that finds nothing.
      await ask(deps(fakeQueryEmbedder().embedder));
      await ask(deps(null));
      out.restore();

      expect(responses.join("\n")).not.toContain(MARKER);
      expect(responses[0]).toMatch(/^503 .*search_unavailable/);
      expect(errors).toHaveLength(1);
      const error = errors[0] as Error;
      expect([error.message, String(error.stack), JSON.stringify(error), inspect(error, { depth: 10, showHidden: true })].join("\n")).not.toContain(MARKER);
      expect(error).toMatchObject({ name: "QueryEmbedError", code: "embed_failed" });
      expect(out.lines.join("\n")).not.toContain(MARKER);
      expect(await everythingStored()).not.toContain(MARKER);
      expect(await rows("ops_event")).toMatchObject([{ kind: "search.unavailable" }, { kind: "search.unavailable" }]);
    });

    it("leaves neither the question nor its English translation anywhere, through the translated-question leg too, even when the translation model throws an error that echoes its request (S03.05)", async () => {
      await publish();
      const out = captureOutput();
      const responses: string[] = [];
      const errors: unknown[] = [];
      const question = `${MARKER} mujhe lawyer chahiye`; // romanized: the leg runs
      const deps = (translator: Translator): SearchRouteDeps => {
        const s = service(fakeQueryEmbedder().embedder, { translator: createQuestionTranslator({ translator, route: ROUTE }) });
        return { search: () => s, limiter: () => createRateLimiter({ db: app, key: "k" }), client: () => "203.0.113.10" };
      };
      const ask = async (d: SearchRouteDeps) => {
        const response = await searchResponse(d, new Request("https://x.test/api/search", { method: "POST", body: JSON.stringify({ q: question, lang: "en" }) }));
        responses.push(`${response.status} ${[...response.headers].join(";")} ${await response.text()}`);
      };

      // A translation that is used, one that fails echoing its request, and the real adapter over a client that does the same.
      await ask(deps(fakeTranslator({ answer: `I need a lawyer ${TRANSLATED_MARKER}` }).translator));
      await ask(deps(fakeTranslator({ echoError: true }).translator));
      const echoing = { v2: { chat: async (request: unknown) => { throw Object.assign(new Error(`bad request ${JSON.stringify(request)}`), { body: request, cause: request }); } } };
      const wrapped = cohereTranslator({ apiKey: "k", client: echoing as never });
      await ask(deps(wrapped));
      await wrapped.translate({ text: question, from: null, to: "en", model: "m", signal: new AbortController().signal }).catch((e: unknown) => errors.push(e));
      out.restore();

      const everything = [responses.join("\n"), out.lines.join("\n"), await everythingStored()].join("\n");
      expect(everything).not.toContain(MARKER);
      expect(everything).not.toContain(TRANSLATED_MARKER);
      expect(responses.every((r) => r.startsWith("200 "))).toBe(true);
      expect(errors).toHaveLength(1);
      const error = errors[0] as Error;
      expect([error.message, String(error.stack), JSON.stringify(error), inspect(error, { depth: 10, showHidden: true })].join("\n")).not.toContain(MARKER);
      expect(error).toMatchObject({ name: "TranslateError", code: "failed" });
      expect((await rows("search_log")).map((r) => r.translated_leg)).toEqual(["used", "failed", "failed"]);
    });

    it("keeps the question out of the error a failed search throws", async () => {
      await publish();

      const failure = await service(fakeQueryEmbedder({ echoError: true }).embedder).search({ q: MARKER, lang: "en" }).catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(SearchFailure);
      expect([(failure as Error).message, String((failure as Error).stack), JSON.stringify(failure), inspect(failure, { depth: 10, showHidden: true })].join("\n")).not.toContain(MARKER);
    });
  });

  describe("the route's answers", () => {
    it("answers 200 with SearchV1, never cached, and sets no cookie", async () => {
      await publish();

      const response = await post(routeDeps(fakeQueryEmbedder().embedder), { q: "lawyer", lang: "en", v: 1 });

      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Set-Cookie")).toBeNull();
      expect(SearchV1Schema.parse(await response.json())).toMatchObject({ status: "ok", release_v: 1 });
    });

    it.each([
      ["an empty question", { q: "", lang: "en" }, "invalid_question"],
      ["a blank question", { q: "   ", lang: "en" }, "invalid_question"],
      ["a question of 201 characters", { q: "a".repeat(201), lang: "en" }, "invalid_question"],
      ["no question", { lang: "en" }, "invalid_question"],
      ["a language that is not a LangCode", { q: "lawyer", lang: "xx" }, "invalid_lang"],
      ["no language", { q: "lawyer" }, "invalid_lang"],
      ["a release that is not a number", { q: "lawyer", lang: "en", v: "1" }, "invalid_request"],
      ["a body that is not JSON", "not json", "invalid_request"],
      ["a body that is not an object", "[1]", "invalid_request"],
    ])("answers 400 {error:{code, message_key}} for %s and calls no model", async (_name, body, code) => {
      await publish();
      const model = fakeQueryEmbedder();

      const response = await post(routeDeps(model.embedder), body);

      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(SearchErrorSchema.parse(await response.json())).toEqual({ error: { code, message_key: `search.${code}` } });
      expect(model.calls).toEqual([]);
      expect(await rows("search_log")).toEqual([]);
    });

    it("accepts a question of exactly 200 characters, counted as characters and not bytes", async () => {
      await publish();

      expect((await post(routeDeps(fakeQueryEmbedder().embedder), { q: "ڈ".repeat(200), lang: "ur" })).status).toBe(200);
      expect((await post(routeDeps(fakeQueryEmbedder().embedder), { q: "ڈ".repeat(201), lang: "ur" })).status).toBe(400);
    });

    it("answers 503 search_unavailable when no leg completes", async () => {
      await publish();

      const response = await post(routeDeps(fakeQueryEmbedder({ echoError: true }).embedder), { q: "lawyer", lang: "en" });

      expect(response.status).toBe(503);
      expect(SearchErrorSchema.parse(await response.json())).toEqual({ error: { code: "search_unavailable", message_key: "search.search_unavailable" } });
    });

    it("answers 200 status unavailable (not an error) for a release without search", async () => {
      await publish({ search: false });

      const response = await post(routeDeps(fakeQueryEmbedder().embedder), { q: "lawyer", lang: "en" });

      expect(response.status).toBe(200);
      expect(SearchV1Schema.parse(await response.json())).toMatchObject({ status: "unavailable" });
    });

    it("answers 429 rate_limited, and calls no model, once a client has asked 30 questions in 10 minutes; another client is not affected", async () => {
      await publish();
      const model = fakeQueryEmbedder();
      const deps = routeDeps(model.embedder);

      for (let i = 0; i < SEARCH_RATE_LIMIT.limit; i++) expect((await post(deps, { q: "lawyer", lang: "en" })).status).toBe(200);
      const refused = await post(deps, { q: "lawyer", lang: "en" });

      expect(refused.status).toBe(429);
      expect(refused.headers.get("Cache-Control")).toBe("no-store");
      expect(refused.headers.get("Set-Cookie")).toBeNull();
      // The oldest of the 30 leaves the window in at most 10 minutes.
      const retryAfter = Number(refused.headers.get("Retry-After"));
      expect(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 600).toBe(true);
      expect(SearchErrorSchema.parse(await refused.json())).toEqual({ error: { code: "rate_limited", message_key: "search.rate_limited" } });
      expect(model.calls).toHaveLength(30);
      expect((await post(deps, { q: "lawyer", lang: "en" }, { "x-real-ip": "198.51.100.8" })).status).toBe(200);
    });

    it("answers 503 and calls no model when the limit cannot be counted", async () => {
      await publish();
      const model = fakeQueryEmbedder();
      const deferred: Promise<unknown>[] = [];
      const deps: SearchRouteDeps = {
        ...routeDeps(model.embedder),
        limiter: () => ({ check: async () => { throw new Error("db down"); } }),
        // What the composition root does: the ops event, written after the response.
        onLimiterFailure: (ms) => recordOpsEvent(app, { kind: "search.unavailable", detail: { reason: "rate_limit_failed", ms } }),
        defer: (work) => void deferred.push(work),
      };

      expect((await post(deps, { q: "lawyer", lang: "en" })).status).toBe(503);
      await Promise.all(deferred);

      expect(model.calls).toEqual([]);
      expect(await rows("ops_event")).toMatchObject([{ kind: "search.unavailable", detail: { reason: "rate_limit_failed" } }]);
    });

    it("counts the IPv6 addresses of one /64 as one client, and a mapped IPv4 address as that IPv4 client", async () => {
      await publish();
      const deps = routeDeps(fakeQueryEmbedder().embedder);
      const asked = (address: string) => post(deps, { q: "lawyer", lang: "en" }, { "x-real-ip": address });

      for (let i = 0; i < SEARCH_RATE_LIMIT.limit; i++) expect((await asked(`2001:db8:1:2:${i + 1}::${i + 7}`)).status).toBe(200);
      expect((await asked("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).status).toBe(429);
      expect((await asked("2001:db8:1:3::1")).status).toBe(200);

      for (let i = 0; i < SEARCH_RATE_LIMIT.limit; i++) expect((await asked(i % 2 ? "198.51.100.77" : "::ffff:198.51.100.77")).status).toBe(200);
      expect((await asked("::ffff:c633:644d")).status).toBe(429);
    });
  });

  describe("the per-client limit (AD-22, AD-13)", () => {
    it("lets a client in again once its questions are more than 10 minutes old, and counts a refused question as nothing", async () => {
      let now = new Date("2026-10-02T12:00:00Z");
      const limiter = createRateLimiter({ db: app, key: "k", now: () => now });

      for (let i = 0; i < 30; i++) expect(await limiter.check(SEARCH_RATE_LIMIT, "203.0.113.1")).toEqual({ allowed: true });
      expect(await limiter.check(SEARCH_RATE_LIMIT, "203.0.113.1")).toMatchObject({ allowed: false, retryAfterSeconds: 600 });
      expect(await limiter.check(SEARCH_RATE_LIMIT, "203.0.113.1")).toMatchObject({ allowed: false, retryAfterSeconds: 600 });
      now = new Date("2026-10-02T12:10:01Z");

      expect(await limiter.check(SEARCH_RATE_LIMIT, "203.0.113.1")).toEqual({ allowed: true });
      expect(await sql`select count(*)::int as n from rate_limit`).toEqual([{ n: 31 }]);
    });

    it("keeps no address: only a keyed hash, different under another key or scope, and deletes hashes after 24 hours", async () => {
      let now = new Date("2026-10-02T12:00:00Z");
      const limiter = createRateLimiter({ db: app, key: "k", now: () => now });
      await limiter.check(SEARCH_RATE_LIMIT, "203.0.113.1");
      await createRateLimiter({ db: app, key: "other", now: () => now }).check(SEARCH_RATE_LIMIT, "203.0.113.1");
      await limiter.check({ ...SEARCH_RATE_LIMIT, scope: "signup" }, "203.0.113.1");

      const stored = await sql`select scope, client_hash from rate_limit`;
      expect(new Set(stored.map((r) => r.client_hash)).size).toBe(3);
      expect(stored.every((r) => /^[0-9a-f]{64}$/.test(r.client_hash))).toBe(true);
      expect(JSON.stringify(stored)).not.toContain("203.0.113");

      now = new Date("2026-10-03T12:00:01Z");
      await limiter.check(SEARCH_RATE_LIMIT, "203.0.113.2");

      expect(await sql`select count(*)::int as n from rate_limit`).toEqual([{ n: 1 }]);
    });

    it("is a table the app reads, inserts into and deletes from, and nothing else", async () => {
      await expect(appSql`update rate_limit set scope = 'x'`).rejects.toThrow(/permission denied/);
      await expect(appSql`update search_log set status = 'ok'`).rejects.toThrow(/permission denied/);
      await expect(appSql`delete from search_log`).rejects.toThrow(/permission denied/);
    });
  });

  describe("the search test-set runner", () => {
    it("takes the search use case as its engine, and reports what a release holds", async () => {
      await publish();
      const question = (id: string, q: string, intent: "normal" | "emergency" | "no_match", expected: string[]) =>
        TestQuestionSchema.parse({ id, lang: "en", q, form: "native", intent, expected, split: "tuning", author: "ab", added: "2026-10-01", checked_by: null, checked_on: null });
      const questions = [question("lawyer", "a lawyer", "normal", ["M001"]), question("doctor", "see a doctor", "emergency", ["M002"]), question("nothing", "xyzzy", "no_match", []), question("gone", "a lawyer", "normal", ["M999"])];

      const results = await runQuestions(questions, service(fakeQueryEmbedder().embedder), { release: 1 });

      expect(results.map((r) => [r.question.id, r.status, r.emergency_first, r.results.map((x) => x.provider_id), r.missing])).toEqual([
        ["lawyer", "ok", false, ["M001"], []],
        ["doctor", "ok", true, ["M002"], []],
        ["nothing", "no_clear_match", false, [], []],
        ["gone", "ok", false, ["M001"], ["M999"]],
      ]);
    });

    it("writes no search_log row for its questions and counts their embeddings as purpose test_set", async () => {
      await publish();
      await sql.unsafe("delete from spend_event; delete from search_log");
      const q = (id: string, text: string) => TestQuestionSchema.parse({ id, lang: "en", q: text, form: "native", intent: "normal", expected: ["M001"], split: "tuning", author: "ab", added: "2026-10-01", checked_by: null, checked_on: null });
      const engine = service(fakeQueryEmbedder({ tokens: 12 }).embedder, { spendPurpose: "test_set", log: false });

      const results = await runQuestions([q("a", "a lawyer"), q("b", "see a doctor")], engine, { release: 1 });

      expect(results.map((r) => r.status)).toEqual(["ok", "ok"]);
      expect(await rows("search_log")).toEqual([]);
      expect(await rows("spend_event")).toMatchObject([
        { purpose: "test_set", tokens: "12" },
        { purpose: "test_set", tokens: "12" },
      ]);
      // A resident's search, beside it, is still logged and counted as search.
      await service(fakeQueryEmbedder().embedder).search({ q: "lawyer", lang: "en" });
      expect((await rows("spend_event")).map((r) => r.purpose)).toEqual(["test_set", "test_set", "search"]);
      expect(await rows("search_log")).toHaveLength(1);
    });

    it("records a failed search as error:search_unavailable and an unavailable release as unavailable", async () => {
      await publish();
      const q = TestQuestionSchema.parse({ id: "a", lang: "en", q: "a lawyer", form: "native", intent: "normal", expected: ["M001"], split: "tuning", author: "ab", added: "2026-10-01", checked_by: null, checked_on: null });

      const failed = await runQuestions([q], service(fakeQueryEmbedder({ echoError: true }).embedder));
      const unavailable = await runQuestions([q], service(null));

      expect(failed[0]!.status).toBe("error:search_unavailable");
      expect(unavailable[0]!.status).toBe("unavailable");
    });
  });
});
