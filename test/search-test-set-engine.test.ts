// The production engine of the search test-set runner (S03.07) asks production's REAL search use case, with fake adapters: a
// fake of the database read and of the private bucket (the release's files), and fakes of Cohere's two clients (the real
// adapters, `cohereQueryEmbedder` and `cohereTranslator`, are on top of them). Nothing here reaches a vendor, a database or
// the network. What it proves: the answer is the use case's own (the same as `createSearch` gives with the same parts), the
// embedding is the release's model as a query, the translated-question leg takes the route and the fallback from the settings,
// the spend is the use case's (purpose test_set) and no search_log row is written, the vendor calls are counted by model and a
// 429 is told from another failure, and the scores below the threshold come from the use case's `observe`.
import { describe, expect, it } from "vitest";
import { createSearch, cohereQueryEmbedder, type CohereEmbedClient } from "@/modules/directory";
import type { CohereChatClient } from "@/modules/translation";
import type { SpendEventInput } from "@/modules/spend";
import type { TestQuestion } from "@/contracts/searchTestSet";
import { DEFAULT_SEARCH_SETTINGS, type SearchSettings } from "@/platform/config/env";
import type { Db } from "@/platform/db";
import { EMBED_MODEL, RELEASE_V, VECTORS_PATH, releaseDb, releaseFiles, releaseRow, releaseStore } from "./helpers/searchRelease";
import { engineFrom } from "../scripts/search-test-set/productionEngine";
import { outcomeOf } from "../scripts/search-test-set/tuningRun";

const NORTH = "north-small-translate-09-2026";
const COMMAND_A = "command-a-translate-08-2025";
const PASHTO = "زه وړیا حقوقي مشوره غواړم";
const PASHTO_EN = "I want free legal advice";
const MARKER = "zq5-marker-text-that-must-stay-out";

// Three providers on three axes: M001 legal, M002 health, M003 food. A text the model knows nothing of points at no provider.
const VECTORS: Record<string, number[]> = {
  "free legal help": [1, 0, 0],
  "see a doctor": [0, 1, 0],
  [PASHTO]: [0, 0, 0],
  [PASHTO_EN]: [1, 0, 0],
};

function release() {
  const files = releaseFiles();
  files.set(
    VECTORS_PATH,
    JSON.stringify({
      v: 1,
      release_v: RELEASE_V,
      catalogue_hash: "c".repeat(64),
      embed_model: EMBED_MODEL,
      dims: 3,
      providers: [
        { id: "M001", text_hash: "a".repeat(64), vector: [1, 0, 0] },
        { id: "M002", text_hash: "b".repeat(64), vector: [0, 1, 0] },
        { id: "M003", text_hash: "d".repeat(64), vector: [0, 0, 1] },
      ],
    }),
  );
  const row = releaseRow(files);
  row.search.dims = 3;
  row.search.vector_count = 3;
  const { db, statements } = releaseDb({ row });
  const ended: string[] = [];
  (db as unknown as { $client: { end: () => Promise<void> } }).$client = { end: async () => void ended.push("closed") };
  const store = releaseStore({ files });
  return { db: db as Db, storage: store.storage, statements, ended };
}

const vendorError = (statusCode: number, message: string) => Object.assign(new Error(`Status code: ${statusCode} body: ${MARKER}`), { statusCode, body: { message } });

/** A fake of Cohere's embed endpoint: records every request, can refuse a text. */
function embedClient(options: { fail?: (text: string) => unknown } = {}) {
  const requests: { model: string; texts: string[]; inputType: string; outputDimension?: number }[] = [];
  const client: CohereEmbedClient = {
    v2: {
      async embed(request) {
        requests.push({ model: request.model, texts: request.texts, inputType: request.inputType, ...(request.outputDimension === undefined ? {} : { outputDimension: request.outputDimension }) });
        const failure = options.fail?.(request.texts[0]!);
        if (failure) throw failure;
        return { embeddings: { float: [VECTORS[request.texts[0]!] ?? [0, 0, 0]] }, meta: { billedUnits: { inputTokens: 7 } } };
      },
    },
  };
  return { client, requests };
}

/** A fake of Cohere's chat endpoint: translates Pashto to English; a model named in `refuse` answers with the given vendor error. */
function chatClient(options: { refuse?: Record<string, unknown>; english?: string } = {}) {
  const requests: { model: string; system: string }[] = [];
  const client: CohereChatClient = {
    v2: {
      async chat(request) {
        requests.push({ model: request.model, system: request.messages[0]!.content });
        const refusal = options.refuse?.[request.model];
        if (refusal) throw refusal;
        return { message: { content: [{ type: "text", text: options.english ?? PASHTO_EN }] }, usage: { billedUnits: { inputTokens: 30, outputTokens: 6 } } };
      },
    },
  };
  return { client, requests };
}

function question(id: string, q: string, over: Partial<TestQuestion> = {}): TestQuestion {
  return { id, lang: "en", q, form: "native", intent: "normal", expected: ["M001"], split: "tuning", author: "dev-agent", added: "2026-10-02", checked_by: null, checked_on: null, ...over };
}

function setup(over: { embed?: ReturnType<typeof embedClient>; chat?: ReturnType<typeof chatClient>; settings?: Partial<SearchSettings> } = {}) {
  const world = release();
  const embed = over.embed ?? embedClient();
  const chat = over.chat ?? chatClient();
  const spends: SpendEventInput[] = [];
  const logs: unknown[] = [];
  const settings: SearchSettings = { ...DEFAULT_SEARCH_SETTINGS, ...over.settings };
  const parts = {
    db: world.db,
    storage: world.storage,
    clients: { embed: embed.client, chat: chat.client },
    settings,
    writer: { log: async (row: unknown) => void logs.push(row), spend: async (event: SpendEventInput) => void spends.push(event) },
  };
  return { world, embed, chat, spends, logs, settings, parts };
}

describe("the production engine", () => {
  it("answers with the search use case's own answer: the same as createSearch gives with the same parts", async () => {
    const { parts, spends } = setup();
    const engine = await engineFrom(parts, { translatedLeg: false });

    const asked = await engine.ask(question("en-01", "free legal help"));

    // The use case, built by hand over the same adapters and the same fakes.
    const direct = await createSearch({
      db: () => parts.db,
      storage: () => parts.storage,
      embedder: cohereQueryEmbedder({ apiKey: "", client: embedClient().client }),
      emergencyThreshold: parts.settings.emergencyThreshold,
      spendPurpose: "test_set",
      log: false,
      writer: { log: async () => undefined, spend: async () => undefined },
    }).search({ q: "free legal help", lang: "en" });

    expect(asked.failure).toBeNull();
    expect(asked.answer).toEqual(direct);
    expect(asked.answer).toEqual({ v: 1, release_v: RELEASE_V, query_lang: "en", status: "ok", emergency_first: false, results: [{ provider_id: "M001", score: 1 }] });
    expect(spends).toHaveLength(1);
  });

  it("says which release, embedding model and threshold it measures", async () => {
    const engine = await engineFrom(setup().parts, { translatedLeg: false });
    expect(engine.facts).toEqual({ release: RELEASE_V, model: EMBED_MODEL, threshold: 0.3 });
  });

  it("embeds the question as a query with the release's model, through Cohere's adapter, and the clients see nothing else", async () => {
    const { parts, embed } = setup();
    const engine = await engineFrom(parts, { translatedLeg: false });

    await engine.ask(question("en-01", "free legal help", { page_lang: "ur" }));

    expect(embed.requests).toEqual([{ model: EMBED_MODEL, texts: ["free legal help"], inputType: "search_query" }]);
  });

  it("counts the embedding as purpose test_set, with the release number and the tokens the vendor billed, and writes no search_log row", async () => {
    const { parts, spends, logs } = setup();
    const engine = await engineFrom(parts, { translatedLeg: false });

    await engine.ask(question("en-01", "free legal help"));
    await engine.ask(question("en-02", "see a doctor", { expected: ["M002"] }));
    await engine.close();

    expect(spends).toEqual([
      expect.objectContaining({ kind: "embed", purpose: "test_set", model: EMBED_MODEL, releaseV: RELEASE_V, tokens: 7, tokensEstimated: false }),
      expect.objectContaining({ kind: "embed", purpose: "test_set", model: EMBED_MODEL, releaseV: RELEASE_V, tokens: 7, tokensEstimated: false }),
    ]);
    expect(logs).toEqual([]);
  });

  it("hands over the similarity of every provider before the threshold, which the answer does not hold", async () => {
    const { parts } = setup();
    const engine = await engineFrom(parts, { translatedLeg: false });

    const asked = await engine.ask(question("en-09", "something nobody can answer", { intent: "no_match", expected: [] }));

    expect(asked.answer).toMatchObject({ status: "no_clear_match", results: [] });
    expect(asked.observation).toMatchObject({ releaseV: RELEASE_V, threshold: 0.3, translatedLeg: "not_needed" });
    expect([...asked.observation!.legs[0]!.similarities]).toEqual([["M001", 0], ["M002", 0], ["M003", 0]]);
  });

  it("counts the vendor calls of a question: one embedding with the leg off, even for a question that would be translated", async () => {
    const { parts, chat } = setup();
    const engine = await engineFrom(parts, { translatedLeg: false });

    const asked = await engine.ask(question("ps-01", PASHTO, { lang: "ps" }));

    expect(chat.requests).toEqual([]);
    expect(asked.trace).toEqual({ embedding: 1, translation: 0, translationModels: [], failures: [] });
    expect(asked.observation).toMatchObject({ translatedLeg: "not_needed" });
    expect(engine.plan(question("ps-01", PASHTO, { lang: "ps" }))).toMatchObject({ embeddings: 1, translations: 0 });
  });

  describe("the translated-question leg", () => {
    it("translates with the model production's route names, then embeds the translation, and the second leg's scores are handed over", async () => {
      const { parts, chat, embed, spends } = setup();
      const engine = await engineFrom(parts, { translatedLeg: true });

      const asked = await engine.ask(question("ps-01", PASHTO, { lang: "ps" }));

      expect(chat.requests.map((r) => r.model)).toEqual([NORTH]);
      expect(embed.requests.map((r) => r.texts[0]).sort()).toEqual([PASHTO, PASHTO_EN].sort());
      expect(asked.answer).toMatchObject({ status: "ok", results: [{ provider_id: "M001", score: 1 }] });
      expect(asked.observation).toMatchObject({ translatedLeg: "used" });
      expect(asked.observation!.legs.map((l) => l.leg)).toEqual(["direct", "translated"]);
      expect(asked.trace).toEqual({ embedding: 2, translation: 1, translationModels: [NORTH], failures: [] });
      expect(spends.map((s) => [s.kind, s.purpose, s.model])).toEqual(
        expect.arrayContaining([
          ["translate", "test_set", NORTH],
          ["embed", "test_set", EMBED_MODEL],
        ]),
      );
      expect(engine.usage()).toMatchObject({
        embedding: { calls: 2, by_model: { [EMBED_MODEL]: { calls: 2, tokens: 14 } } },
        translation: { calls: 1, tokens: 36, by_model: { [NORTH]: { calls: 1, tokens: 36 } } },
      });
    });

    it("takes the model from SEARCH_QUESTION_ROUTE as it is resolved: a kind switched off makes no translation call, and the plan says so", async () => {
      const route = { ...DEFAULT_SEARCH_SETTINGS.questionRoute, ps: COMMAND_A, ur: null };
      const { parts, chat } = setup({ settings: { questionRoute: route } });
      const engine = await engineFrom(parts, { translatedLeg: true });

      await engine.ask(question("ps-01", PASHTO, { lang: "ps" }));
      expect(chat.requests.map((r) => r.model)).toEqual([COMMAND_A]);

      const urdu = question("ur-01", "مجھے وکیل چاہیے", { lang: "ur" });
      expect(engine.plan(urdu)).toMatchObject({ embeddings: 1, translations: 0, model: null });
    });

    it("retries once with the model SEARCH_QUESTION_FALLBACK names when the routed model is past its limit, counts the 429 (as the quota, which the run stops at), and still scores the question: the fallback did the leg", async () => {
      const chat = chatClient({ refuse: { [NORTH]: vendorError(429, "You are past the per-month request limit for this model") } });
      const { parts } = setup({ chat, settings: { questionFallback: { ...DEFAULT_SEARCH_SETTINGS.questionFallback, ps: COMMAND_A } } });
      const engine = await engineFrom(parts, { translatedLeg: true });

      const asked = await engine.ask(question("ps-01", PASHTO, { lang: "ps" }));

      expect(chat.requests.map((r) => r.model)).toEqual([NORTH, COMMAND_A]);
      expect(asked.observation).toMatchObject({ translatedLeg: "used" });
      expect(asked.trace.failures).toEqual([{ kind: "translation", model: NORTH, class: "quota" }]); // past the month's limit: the translation module's own `quota`
      expect(asked.trace.translationModels).toEqual([NORTH, COMMAND_A]); // the report shows which model translated
      expect(outcomeOf(question("ps-01", PASHTO), asked)).toBe("hit");
      expect(engine.usage().translation).toMatchObject({ calls: 2, rate_limited: 1, by_model: { [NORTH]: { calls: 1, rate_limited: 1 }, [COMMAND_A]: { calls: 1, rate_limited: 0 } } });
    });

    it("with no fallback (Pashto, by default), a 429 leaves the leg failed and the question is rate_limited: not scored, never a miss", async () => {
      const chat = chatClient({ refuse: { [NORTH]: vendorError(429, "Rate limit exceeded: 20 requests per minute") } });
      const { parts } = setup({ chat });
      const engine = await engineFrom(parts, { translatedLeg: true });

      const asked = await engine.ask(question("ps-01", PASHTO, { lang: "ps" }));

      expect(chat.requests.map((r) => r.model)).toEqual([NORTH]);
      expect(asked.observation).toMatchObject({ translatedLeg: "failed" });
      expect(asked.answer).toMatchObject({ status: "no_clear_match" }); // the direct leg alone knows no Pashto: it would look like a miss
      expect(outcomeOf(question("ps-01", PASHTO), asked)).toBe("rate_limited");
    });

    it("plans the calls with the same route and fallback: a question that is translated costs a translation and a second embedding, and a retry is possible", async () => {
      const { parts } = setup();
      const engine = await engineFrom(parts, { translatedLeg: true });
      const urdu = question("ur-01", "مجھے وکیل چاہیے", { lang: "ur" });

      expect(engine.plan(urdu)).toEqual({ embeddings: 2, translations: 1, retries: 1, model: NORTH, fallbackModel: COMMAND_A });
      expect(engine.plan(question("en-01", "free legal help"))).toEqual({ embeddings: 1, translations: 0, retries: 0, model: null, fallbackModel: null });
    });
  });

  describe("a vendor failure", () => {
    it("is told apart: a 429 from the embedding endpoint is a limit (a transient one, or the quota when it says it is past the month's), any other failure an error, and the search fails with search_unavailable rather than answering wrong", async () => {
      const embed = embedClient({ fail: (text) => (text === "free legal help" ? vendorError(429, "Too Many Requests") : text === "see a doctor" ? vendorError(500, "boom") : undefined) });
      const { parts } = setup({ embed });
      const engine = await engineFrom(parts, { translatedLeg: false });

      const limited = await engine.ask(question("en-01", "free legal help"));
      const broken = await engine.ask(question("en-02", "see a doctor", { expected: ["M002"] }));

      expect(limited).toMatchObject({ answer: null, failure: "search_unavailable", observation: null });
      expect(limited.trace.failures).toEqual([{ kind: "embedding", model: EMBED_MODEL, class: "limit" }]);
      expect(outcomeOf(question("en-01", "free legal help"), limited)).toBe("rate_limited");
      expect(broken.trace.failures).toEqual([{ kind: "embedding", model: EMBED_MODEL, class: "error" }]);
      expect(outcomeOf(question("en-02", "see a doctor"), broken)).toBe("vendor_error");
      expect(engine.usage().embedding).toMatchObject({ calls: 2, rate_limited: 1, failed: 1 });
    });

    it("keeps nothing of the question or the vendor's words: the traces, usage and observation hold none (the vendor's error echoed the marker)", async () => {
      const embed = embedClient({ fail: () => vendorError(429, `Too Many Requests ${MARKER}`) });
      const { parts } = setup({ embed });
      const engine = await engineFrom(parts, { translatedLeg: false });

      const asked = await engine.ask(question("en-01", `free legal help ${MARKER}`));

      expect(JSON.stringify({ asked, usage: engine.usage() })).not.toContain(MARKER);
    });
  });

  it("waits for the writes the use case finishes after its answer, then lets go of the database", async () => {
    const { parts, world } = setup();
    const engine = await engineFrom(parts, { translatedLeg: false });
    await engine.ask(question("en-01", "free legal help"));

    await engine.close();

    expect(world.ended).toEqual(["closed"]);
  });

  it("fails the run, naming the question, when the current release is not the one it started with", async () => {
    const { parts } = setup();
    const engine = await engineFrom(parts, { translatedLeg: false });
    (engine.facts as { release: number }).release = RELEASE_V + 1;

    await expect(engine.ask(question("en-01", "free legal help"))).rejects.toThrow(/en-01.*release changed/);
  });

  it("refuses to start without a current release that has search data", async () => {
    const { parts } = setup();
    const row = { ...releaseRow(), search: null } as unknown as ReturnType<typeof releaseRow>;
    const noSearch = releaseDb({ row });
    await expect(engineFrom({ ...parts, db: noSearch.db }, { translatedLeg: false })).rejects.toThrow(/no current release with search data/);
  });
});
