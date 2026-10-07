// The direct route's reranker (interim tuning of 2026-10-07, arm R2) with fakes for the snapshot, the embedding model, the
// reranker and the month's count: which questions are reranked, what the results are, the fallback to the floor and gap on a
// timeout, a 429, the monthly limit or too little time, and the emergency flag, which the rerank never changes. Time is vitest's
// fake clock. The count over spend_event is in test/db/search.db.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpendEventInput } from "@/modules/spend";
import { createQuestionTranslator, type Translator } from "@/modules/translation";
import { RerankError, type QueryEmbedder, type Reranker } from "./ports";
import { RERANK_LIMITED_BACKOFF_MS, RERANK_MIN_BUDGET_MS, RERANK_TIMEOUT_MS } from "./rerank";
import { createSearch, type SearchFailureNote, type SearchObservation, type SearchSnapshot } from "./search";

const MODEL = "embed-v4.0";
const TAGALOG = "Saan ako makakakuha ng pagkain?"; // "Where can I get food?": the live question that answered nothing
const SPANISH = "necesito un abogado gratis";
const ENGLISH = "where can I get food";
const PASHTO = "زه وړیا حقوقي مشوره غواړم";
const EMERGENCY_TAMIL = "என் வீட்டில் தீ பிடித்துள்ளது"; // "my house is on fire"

/** A unit vector whose similarity with P1..P4 is the given number (the fifth axis is "nothing in particular"). */
const unit = (s: [number, number, number, number]) => [...s, Math.sqrt(1 - s.reduce((sum, x) => sum + x * x, 0))];

const VECTORS: Record<string, number[]> = {
  // Food (P3) is the best match but below the direct floor (0.24): no result without the reranker, as in production today.
  [TAGALOG]: unit([0.12, 0.05, 0.2, 0.1]),
  // Over the floor: P1 0.26, P2 0.2 and P4 0.18 within the gap.
  [SPANISH]: unit([0.26, 0.2, 0.1, 0.18]),
  [ENGLISH]: unit([0.1, 0, 0.32, 0]),
  "I need a lawyer": [1, 0, 0, 0, 0],
  // The emergency provider P2 is the best match at 0.2 (over the emergency top threshold 0.14).
  [EMERGENCY_TAMIL]: unit([0.05, 0.2, 0.1, 0.05]),
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
      ["P4", "Library\nCategories: Learning"],
    ]),
  },
};

function fakeEmbedder(ms = 100): QueryEmbedder {
  return {
    embedQuery({ text, signal }) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ vector: VECTORS[text] ?? [0, 0, 0, 0, 1], tokens: 4 }), ms);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("aborted"));
        });
      });
    },
  };
}

/** Relevance per provider, by the provider's name line in the text it is given. */
const RELEVANCE: Record<string, number> = { "Legal Clinic": 0.03, "Fire Station": 0.01, "Food Bank": 0.41, Library: 0.06 };

function fakeReranker(options: { ms?: number; fail?: () => Error; relevance?: Record<string, number> } = {}) {
  const calls: { query: string; documents: readonly string[]; aborted: boolean }[] = [];
  const reranker: Reranker = {
    model: "rerank-v3.5",
    rerank({ query, documents, signal }) {
      const call = { query, documents, aborted: false };
      calls.push(call);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (options.fail) return reject(options.fail());
          const table = options.relevance ?? RELEVANCE;
          resolve({ results: documents.map((text, index) => ({ index, relevance: table[text.split("\n")[0]!] ?? 0 })).sort((a, b) => b.relevance - a.relevance) });
        }, options.ms ?? 150);
        signal.addEventListener("abort", () => {
          call.aborted = true;
          clearTimeout(timer);
          reject(new RerankError("aborted"));
        });
      });
    },
  };
  return { reranker, calls };
}

describe("the direct route's reranker", () => {
  let spends: SpendEventInput[];
  let notes: SearchFailureNote[];
  let seen: SearchObservation[];
  let counted: number;

  beforeEach(() => {
    vi.useFakeTimers();
    spends = [];
    notes = [];
    seen = [];
    counted = 0;
  });
  afterEach(() => vi.useRealTimers());

  function service(parts: { reranker?: Reranker | null; monthly?: number; used?: number; countFails?: boolean; embedMs?: number; translator?: Translator }) {
    return createSearch({
      db: () => {
        throw new Error("no database in this test");
      },
      storage: () => {
        throw new Error("no store in this test");
      },
      embedder: fakeEmbedder(parts.embedMs),
      translator: parts.translator ? createQuestionTranslator({ translator: parts.translator, route: { ps: "north-small-translate-09-2026", prs: null, ur: null, romanized_or_mixed: null, ambiguous_arabic: null } }) : null,
      snapshot: async () => SNAPSHOT,
      reranker: parts.reranker ?? null,
      rerankMonthlyCalls: parts.monthly,
      rerankCalls: async () => {
        counted += 1;
        if (parts.countFails) throw new Error("the database is down");
        return parts.used ?? 0;
      },
      writer: { log: async () => undefined, spend: async (event) => void spends.push(event) },
      onFailure: async (note) => void notes.push(note),
      observe: (o) => void seen.push(o),
      clock: () => Date.now(),
    });
  }

  async function ask(search: ReturnType<typeof service>, q: string, lang: "en" | "tl" | "es" | "ta" | "ps", startedAgoMs = 0) {
    const started = Date.now() - startedAgoMs;
    const pending = search.search({ q, lang }, started);
    pending.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(5000);
    return pending;
  }

  it("answers the Tagalog food question that has no result today: the food bank, ordered by relevance, its score still its similarity", async () => {
    const without = await ask(service({}), TAGALOG, "tl");
    expect(without).toMatchObject({ status: "no_clear_match", results: [] });

    const rr = fakeReranker();
    const result = await ask(service({ reranker: rr.reranker }), TAGALOG, "tl");

    // P3 0.41 and P4 0.06 reach 0.05; P1 0.03 and P2 0.01 do not.
    expect(result).toMatchObject({ status: "ok", query_lang: "tl", emergency_first: false });
    expect(result.results).toEqual([
      { provider_id: "P3", score: expect.closeTo(0.2, 6) },
      { provider_id: "P4", score: expect.closeTo(0.1, 6) },
    ]);
    // The question and the providers' English search texts, best similarity first.
    expect(rr.calls).toHaveLength(1);
    expect(rr.calls[0]!.query).toBe(TAGALOG);
    expect(rr.calls[0]!.documents[0]).toBe("Food Bank\nCategories: Food");
    expect(spends.filter((s) => s.kind === "rerank")).toEqual([{ kind: "rerank", purpose: "search", model: "rerank-v3.5", releaseV: 3, calls: 1, tokens: 0, ms: 150 }]);
    expect(seen.at(-1)).toMatchObject({ route: "direct", rerank: "used", reranked: result.results });
    expect(counted).toBe(1);
  });

  it("answers no clear match when the reranker finds nothing relevant enough, even over the direct floor", async () => {
    const rr = fakeReranker({ relevance: { "Legal Clinic": 0.04 } });
    expect(await ask(service({ reranker: rr.reranker }), SPANISH, "es")).toMatchObject({ status: "no_clear_match", results: [] });
  });

  it("never calls the reranker, nor counts its month, for an English question or one that takes the translated leg", async () => {
    const rr = fakeReranker();
    const search = service({
      reranker: rr.reranker,
      translator: { translate: async () => ({ text: "I need a lawyer", inputTokens: 1, outputTokens: 1 }) },
    });

    expect(await ask(search, ENGLISH, "en")).toMatchObject({ status: "ok", results: [{ provider_id: "P3" }] });
    expect(await ask(search, PASHTO, "ps")).toMatchObject({ status: "ok", results: [{ provider_id: "P1" }] });

    expect(rr.calls).toHaveLength(0);
    expect(counted).toBe(0);
    expect(seen.map((o) => o.rerank)).toEqual(["not_needed", "not_needed"]);
  });

  describe("falls back to the floor and gap, silently for the resident", () => {
    const FALLBACK = ["P1", "P2", "P4"]; // the Spanish question by the direct floor and gap

    it("when the call takes longer than its 1.2 s: cancelled, counted (it may be billed), and told to ops as timed out", async () => {
      const rr = fakeReranker({ ms: 5000 });
      const started = Date.now();
      const result = await ask(service({ reranker: rr.reranker }), SPANISH, "es");

      expect(result.results.map((r) => r.provider_id)).toEqual(FALLBACK);
      expect(rr.calls[0]!.aborted).toBe(true);
      expect(spends.filter((s) => s.kind === "rerank")).toEqual([expect.objectContaining({ calls: 1, ms: RERANK_TIMEOUT_MS })]);
      expect(notes).toEqual([{ reason: "rerank_failed", releaseV: 3, ms: expect.any(Number), answered: true, model: "rerank-v3.5", error: "timed_out" }]);
      expect(notes[0]!.ms).toBeLessThan(2200);
      expect(seen.at(-1)!.rerank).toBe("timed_out");
      expect(Date.now() - started).toBeGreaterThan(0);
    });

    it("when the vendor answers 429: not counted, told to ops, and the model is not called again for 5 minutes", async () => {
      const rr = fakeReranker({ fail: () => new RerankError("rerank_failed", "limited") });
      const search = service({ reranker: rr.reranker });

      expect((await ask(search, SPANISH, "es")).results.map((r) => r.provider_id)).toEqual(FALLBACK);
      expect(spends.filter((s) => s.kind === "rerank")).toEqual([]);
      expect(notes).toEqual([expect.objectContaining({ reason: "rerank_failed", error: "rerank_failed:limited", model: "rerank-v3.5" })]);

      expect((await ask(search, TAGALOG, "tl")).results).toEqual([]);
      expect(rr.calls).toHaveLength(1);
      expect(seen.at(-1)!.rerank).toBe("limited");

      await vi.advanceTimersByTimeAsync(RERANK_LIMITED_BACKOFF_MS);
      await ask(search, TAGALOG, "tl");
      expect(rr.calls).toHaveLength(2);
    });

    it("when the month's calls reached SEARCH_RERANK_MONTHLY_CALLS: no call, and ops is told", async () => {
      const rr = fakeReranker();
      const result = await ask(service({ reranker: rr.reranker, monthly: 900, used: 900 }), SPANISH, "es");

      expect(result.results.map((r) => r.provider_id)).toEqual(FALLBACK);
      expect(rr.calls).toHaveLength(0);
      expect(notes).toEqual([expect.objectContaining({ reason: "rerank_quota", model: "rerank-v3.5" })]);
      expect(seen.at(-1)!.rerank).toBe("quota");
    });

    it("counts its own calls between two counts, and stops at the limit", async () => {
      const rr = fakeReranker();
      const search = service({ reranker: rr.reranker, monthly: 2, used: 0 });
      for (let i = 0; i < 3; i += 1) await ask(search, TAGALOG, "tl");

      expect(rr.calls).toHaveLength(2);
      expect(counted).toBe(1); // one count for the three searches (within 30 s)
      expect(seen.map((o) => o.rerank)).toEqual(["used", "used", "quota"]);
    });

    it("when the month's calls cannot be counted", async () => {
      const rr = fakeReranker();
      const result = await ask(service({ reranker: rr.reranker, countFails: true }), SPANISH, "es");

      expect(result.results.map((r) => r.provider_id)).toEqual(FALLBACK);
      expect(rr.calls).toHaveLength(0);
      expect(notes).toEqual([expect.objectContaining({ reason: "rerank_quota", error: "count_failed" })]);
    });

    it("when less than 0.3 s of the leg's 2.2 s is left after the embedding", async () => {
      const rr = fakeReranker();
      const result = await ask(service({ reranker: rr.reranker }), SPANISH, "es", 2200 - 100 - RERANK_MIN_BUDGET_MS + 1);

      expect(result.results.map((r) => r.provider_id)).toEqual(FALLBACK);
      expect(rr.calls).toHaveLength(0);
      expect(notes).toEqual([]);
      expect(seen.at(-1)!.rerank).toBe("no_time");
    });

    it("and a call cut at the leg's deadline still answers within the budget", async () => {
      const rr = fakeReranker({ ms: 5000 });
      const started = Date.now();
      const pending = service({ reranker: rr.reranker }).search({ q: SPANISH, lang: "es" }, started - 1500);
      let took = -1;
      void pending.then(() => (took = Date.now() - (started - 1500)));
      await vi.advanceTimersByTimeAsync(5000);
      const result = await pending;

      expect(result.results.map((r) => r.provider_id)).toEqual(FALLBACK);
      expect(took).toBeLessThanOrEqual(2200);
    });
  });

  it("leaves the emergency flag to the legs' similarities: a rerank that ranks the emergency provider low cannot turn off the 911 block", async () => {
    const rr = fakeReranker(); // Fire Station 0.01: below the bar, not a result
    const result = await ask(service({ reranker: rr.reranker }), EMERGENCY_TAMIL, "ta");

    expect(rr.calls).toHaveLength(1);
    expect(result.emergency_first).toBe(true);
    expect(result.results.map((r) => r.provider_id)).not.toContain("P2");
  });
});
