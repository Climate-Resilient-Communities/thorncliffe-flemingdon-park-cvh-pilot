// Translate-first (2026-10-07 measurement): a question confidently in a launch language the embedding reads poorly (by default
// Tamil and Punjabi) is translated to English and searched on both legs, like a Pashto one; when its translation fails, is past
// the month's limit or is rejected, it takes today's route: the direct leg, reranked. A language whose route is off (Tagalog by
// default) is searched as before. Fakes for the snapshot, the embedding model, the translation model and the reranker; time is
// vitest's fake clock.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpendEventInput } from "@/modules/spend";
import { TRANSLATE_FIRST_OFF, TranslateError, createQuestionTranslator, type QuestionRoute, type Translator } from "@/modules/translation";
import type { QueryEmbedder, Reranker } from "./ports";
import { createSearch, type SearchFailureNote, type SearchObservation, type SearchSnapshot } from "./search";

const MODEL = "embed-v4.0";
const COMMAND = "command-a-translate-08-2025";
const NORTH = "north-small-translate-09-2026";
// "Where can I get food?": the live questions that answered daycares (Tamil) and a mix (Tagalog) in production.
const TAMIL = "எனக்கு உணவு எங்கே கிடைக்கும்?";
const TAGALOG = "Saan ako makakakuha ng pagkain?";
const FOOD = "Where can I get food?";

/** A unit vector whose similarity with P1..P4 is the given number (the fifth axis is "nothing in particular"). */
const unit = (s: [number, number, number, number]) => [...s, Math.sqrt(1 - s.reduce((sum, x) => sum + x * x, 0))];

const VECTORS: Record<string, number[]> = {
  // As in production: everything about 0.11, the daycare (P4) a hair ahead; nothing reaches the direct floor (0.24).
  [TAMIL]: unit([0.1, 0.05, 0.11, 0.12]),
  [TAGALOG]: unit([0.1, 0.05, 0.12, 0.11]),
  // The English translation finds the food bank (P3) well over the threshold (0.27).
  [FOOD]: unit([0.05, 0.02, 0.36, 0.08]),
};

const SNAPSHOT: SearchSnapshot = {
  releaseV: 3,
  data: {
    releaseV: 3,
    model: MODEL,
    dims: 5,
    threshold: 0.27,
    ids: ["P1", "P2", "P3", "P4"],
    vectors: [
      [1, 0, 0, 0, 0],
      [0, 1, 0, 0, 0],
      [0, 0, 1, 0, 0],
      [0, 0, 0, 1, 0],
    ],
    known: new Set(["P1", "P2", "P3", "P4"]),
    emergency: new Set(["P2"]),
    searchTexts: new Map([
      ["P1", "Legal Clinic\nCategories: Legal"],
      ["P2", "Fire Station\nCategories: Support & Emergency Services"],
      ["P3", "Food Bank\nCategories: Food"],
      ["P4", "Daycare\nCategories: Children"],
    ]),
  },
};

/** The route as deployed by default for these kinds: Tamil and Punjabi on, the other translate-first languages off. */
const ROUTE: QuestionRoute = { ps: NORTH, prs: NORTH, ur: NORTH, romanized_or_mixed: COMMAND, ambiguous_arabic: COMMAND, ...TRANSLATE_FIRST_OFF, ta: COMMAND, pa: COMMAND };
// No fallback for the translate-first languages: North Small Translate's month is alert translation's (S04.02).
const FALLBACK: QuestionRoute = { ps: null, prs: COMMAND, ur: COMMAND, romanized_or_mixed: COMMAND, ambiguous_arabic: COMMAND, ...TRANSLATE_FIRST_OFF };

function fakeEmbedder(): QueryEmbedder {
  return {
    embedQuery({ text, signal }) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ vector: VECTORS[text] ?? [0, 0, 0, 0, 1], tokens: 4 }), 100);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("aborted"));
        });
      });
    },
  };
}

/** A translation model per model id: the English it answers, or the error it fails with. */
function fakeTranslator(byModel: Record<string, string | TranslateError>) {
  const calls: { text: string; from: string | null; model: string }[] = [];
  const translator: Translator = {
    translate({ text, from, model }) {
      calls.push({ text, from, model });
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          const answer = byModel[model];
          if (answer === undefined) return reject(new TranslateError("other"));
          if (answer instanceof TranslateError) return reject(answer);
          resolve({ text: answer, inputTokens: 30, outputTokens: 6 });
        }, 300);
      });
    },
  };
  return { translator, calls };
}

/** The reranker finds the food bank, as rerank-v3.5 did for the Tagalog question (#158). */
function fakeReranker() {
  const calls: string[] = [];
  const relevance: Record<string, number> = { "Food Bank": 0.41, Daycare: 0.02, "Legal Clinic": 0.01, "Fire Station": 0.01 };
  const reranker: Reranker = {
    model: "rerank-v3.5",
    rerank({ query, documents }) {
      calls.push(query);
      return new Promise((resolve) =>
        setTimeout(() => resolve({ results: documents.map((text, index) => ({ index, relevance: relevance[text.split("\n")[0]!] ?? 0 })).sort((a, b) => b.relevance - a.relevance) }), 150),
      );
    },
  };
  return { reranker, calls };
}

describe("translate-first languages", () => {
  let spends: SpendEventInput[];
  let notes: SearchFailureNote[];
  let seen: SearchObservation[];

  beforeEach(() => {
    vi.useFakeTimers();
    spends = [];
    notes = [];
    seen = [];
    translateCounts = [];
  });
  afterEach(() => vi.useRealTimers());

  let translateCounts: string[];

  function service(parts: { translator: Translator; reranker?: Reranker | null; route?: QuestionRoute; fallback?: QuestionRoute; monthly?: number; used?: number; countFails?: boolean }) {
    return createSearch({
      db: () => {
        throw new Error("no database in this test");
      },
      storage: () => {
        throw new Error("no store in this test");
      },
      embedder: fakeEmbedder(),
      translator: createQuestionTranslator({ translator: parts.translator, route: parts.route ?? ROUTE, fallback: parts.fallback ?? FALLBACK }),
      translateFirstMonthlyCalls: parts.monthly,
      translateCalls: async (model) => {
        translateCounts.push(model);
        if (parts.countFails) throw new Error("the database is down");
        return parts.used ?? 0;
      },
      snapshot: async () => SNAPSHOT,
      reranker: parts.reranker ?? null,
      rerankCalls: async () => 0,
      writer: { log: async () => undefined, spend: async (event) => void spends.push(event) },
      onFailure: async (note) => void notes.push(note),
      observe: (o) => void seen.push(o),
      clock: () => Date.now(),
    });
  }

  async function ask(search: ReturnType<typeof service>, q: string, lang: "ta" | "tl" | "en") {
    const pending = search.search({ q, lang }, Date.now());
    pending.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(5000);
    return pending;
  }

  it("answers the Tamil food question with the food bank: translated to English with the routed model, both legs, the hybrid route, no rerank", async () => {
    const words = fakeTranslator({ [COMMAND]: FOOD });
    const rr = fakeReranker();
    const result = await ask(service({ translator: words.translator, reranker: rr.reranker }), TAMIL, "en");

    expect(result).toMatchObject({ status: "ok", query_lang: "ta", emergency_first: false });
    expect(result.results[0]).toMatchObject({ provider_id: "P3" });
    expect(words.calls).toEqual([{ text: TAMIL, from: "ta", model: COMMAND }]);
    expect(rr.calls).toHaveLength(0);
    expect(seen.at(-1)).toMatchObject({ route: "hybrid", translatedLeg: "used", rerank: "not_needed" });
    // The translation is counted like the other kinds' (spend_event kind `translate`), beside the two embeddings.
    expect(spends.filter((s) => s.kind === "translate")).toEqual([expect.objectContaining({ kind: "translate", purpose: "search", model: COMMAND, tokens: 36, tokensEstimated: false })]);
    expect(spends.filter((s) => s.kind !== "translate")).toHaveLength(2);
  });

  it("answers the Tagalog food question with the food bank when Tagalog is switched on in the route; off (the default), it is searched directly and reranked as before", async () => {
    const on = fakeTranslator({ [COMMAND]: FOOD });
    const translated = await ask(service({ translator: on.translator, reranker: fakeReranker().reranker, route: { ...ROUTE, tl: COMMAND } }), TAGALOG, "tl");
    expect(translated.results[0]).toMatchObject({ provider_id: "P3" });
    expect(on.calls).toEqual([{ text: TAGALOG, from: "tl", model: COMMAND }]);
    expect(seen.at(-1)).toMatchObject({ route: "hybrid", translatedLeg: "used" });

    const off = fakeTranslator({ [COMMAND]: FOOD });
    const rr = fakeReranker();
    const direct = await ask(service({ translator: off.translator, reranker: rr.reranker }), TAGALOG, "tl");
    expect(direct.results.map((r) => r.provider_id)).toEqual(["P3"]);
    expect(off.calls).toHaveLength(0);
    expect(rr.calls).toEqual([TAGALOG]);
    expect(seen.at(-1)).toMatchObject({ route: "direct", translatedLeg: "not_needed", rerank: "used" });
  });

  describe("falls back to today's route (the direct leg, reranked) when the translation cannot be used", () => {
    it("when the translation model fails", async () => {
      const words = fakeTranslator({ [COMMAND]: new TranslateError("unavailable") });
      const rr = fakeReranker();
      const result = await ask(service({ translator: words.translator, reranker: rr.reranker }), TAMIL, "en");

      expect(result).toMatchObject({ status: "ok", query_lang: "ta" });
      expect(result.results.map((r) => r.provider_id)).toEqual(["P3"]);
      expect(rr.calls).toEqual([TAMIL]);
      expect(seen.at(-1)).toMatchObject({ route: "direct", translatedLeg: "failed", rerank: "used" });
      expect(notes).toContainEqual(expect.objectContaining({ reason: "translate_failed", model: COMMAND, answered: true }));
      // A call the vendor refused is not billed.
      expect(spends.filter((s) => s.kind === "translate")).toEqual([]);
    });

    it("when the routed model is past its limit: no retry with another model (none is configured), the direct leg reranked", async () => {
      const words = fakeTranslator({ [COMMAND]: new TranslateError("quota"), [NORTH]: FOOD });
      const rr = fakeReranker();
      const result = await ask(service({ translator: words.translator, reranker: rr.reranker }), TAMIL, "en");

      expect(words.calls.map((c) => c.model)).toEqual([COMMAND]);
      expect(result.results.map((r) => r.provider_id)).toEqual(["P3"]);
      expect(rr.calls).toEqual([TAMIL]);
      expect(seen.at(-1)).toMatchObject({ route: "direct", translatedLeg: "failed", rerank: "used" });
      expect(notes).toContainEqual(expect.objectContaining({ reason: "translate_quota", model: COMMAND }));
    });

    it("when the model's month (every purpose, alert translation included) has reached SEARCH_TRANSLATE_FIRST_MONTHLY_CALLS: no call at all", async () => {
      const words = fakeTranslator({ [COMMAND]: FOOD });
      const rr = fakeReranker();
      const result = await ask(service({ translator: words.translator, reranker: rr.reranker, monthly: 600, used: 600 }), TAMIL, "en");

      expect(words.calls).toHaveLength(0);
      expect(translateCounts).toContain(COMMAND);
      expect(result.results.map((r) => r.provider_id)).toEqual(["P3"]);
      expect(rr.calls).toEqual([TAMIL]);
      expect(seen.at(-1)).toMatchObject({ route: "direct", translatedLeg: "failed", rerank: "used" });
      expect(notes).toContainEqual(expect.objectContaining({ reason: "translate_quota", model: COMMAND, error: "search_monthly_limit" }));
      expect(spends.filter((s) => s.kind === "translate")).toEqual([]);
    });

    it("when the month cannot be counted: no call (the reserve is not risked)", async () => {
      const words = fakeTranslator({ [COMMAND]: FOOD });
      const result = await ask(service({ translator: words.translator, reranker: fakeReranker().reranker, countFails: true }), TAMIL, "en");

      expect(words.calls).toHaveLength(0);
      expect(result.results.map((r) => r.provider_id)).toEqual(["P3"]);
      expect(notes).toContainEqual(expect.objectContaining({ reason: "translate_quota", model: COMMAND, error: "count_failed" }));
    });

    it("counts its own calls between two counts: the call that reaches the limit is the last", async () => {
      const words = fakeTranslator({ [COMMAND]: FOOD });
      const search = service({ translator: words.translator, reranker: fakeReranker().reranker, monthly: 600, used: 599 });
      expect(seen.length).toBe(0);
      await ask(search, TAMIL, "en");
      expect(seen.at(-1)).toMatchObject({ route: "hybrid", translatedLeg: "used" });
      await ask(search, TAMIL, "en");
      expect(seen.at(-1)).toMatchObject({ route: "direct", translatedLeg: "failed", rerank: "used" });
      expect(words.calls).toHaveLength(1);
    });

    it("when the answer is not English (rejected)", async () => {
      const words = fakeTranslator({ [COMMAND]: TAMIL });
      const rr = fakeReranker();
      const result = await ask(service({ translator: words.translator, reranker: rr.reranker }), TAMIL, "en");

      expect(result.results.map((r) => r.provider_id)).toEqual(["P3"]);
      expect(rr.calls).toEqual([TAMIL]);
      expect(seen.at(-1)).toMatchObject({ route: "direct", translatedLeg: "failed", rerank: "used" });
    });
  });
});
