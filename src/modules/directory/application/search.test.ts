// The translated-question leg of search (S03.05), with fakes for the snapshot, the embedding model, the translation model
// and the rows: which questions get the leg, the ranking over both legs, every way the leg can fail, and the 2.2 s / 2.5 s
// time limits, the translation starting with the request (not after the snapshot), the vendor failures told to ops, and the
// emergency fail-safe. Time is vitest's fake clock: nothing here waits for real, so no timing here can be flaky. The database
// side (search_log.translated_leg, spend_event, the privacy marker) is in test/db/search.db.test.ts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { QuestionTranslationError, TranslateError, createQuestionTranslator, type QuestionRoute, type QuestionTranslator, type TranslateErrorCode, type Translator } from "@/modules/translation";
import type { SpendEventInput } from "@/modules/spend";
import { detect } from "../domain/questionLanguage";
import type { QueryEmbedder } from "./ports";
import { DEFAULT_SEARCH_SETTINGS } from "@/platform/config/env";
import { SafeDetailError } from "@/platform/safeError";
import { LISTING_PATH, RELEASE_V, VECTORS_PATH, never, releaseDb, releaseStore } from "../../../../test/helpers/searchRelease";
import { DEFAULT_STORAGE_TIMEOUT_MS } from "../adapters/releaseStorage";
import {
  ANSWER_MARGIN_MS,
  DEFAULT_FALLBACK_MIN_BUDGET_MS,
  DEFAULT_LEG_TIMEOUT_MS,
  DEFAULT_TOTAL_BUDGET_MS,
  SNAPSHOT_LOAD_TIMEOUT_MS,
  SearchFailure,
  createSearch,
  questionSourceOf,
  type SearchDeps,
  type SearchFailureNote,
  type SearchLogRow,
  type SearchService,
  type SearchSnapshot,
  type SearchWriter,
} from "./search";

const MODEL = "embed-v4.0";
const ROUTE: QuestionRoute = {
  ps: "north-small-translate-09-2026",
  prs: "north-small-translate-09-2026",
  ur: "north-small-translate-09-2026",
  romanized_or_mixed: "command-a-translate-08-2025",
  ambiguous_arabic: "command-a-translate-08-2025",
};

// Four providers, one per axis (the fifth axis is "nothing in particular"); P2 is an emergency provider.
const SNAPSHOT: SearchSnapshot = {
  releaseV: 3,
  data: {
    releaseV: 3,
    model: MODEL,
    dims: 5,
    threshold: 0.3,
    ids: ["P1", "P2", "P3", "P4"],
    vectors: [
      [1, 0, 0, 0, 0],
      [0, 1, 0, 0, 0],
      [0, 0, 1, 0, 0],
      [0, 0, 0, 1, 0],
    ],
    known: new Set(["P1", "P2", "P3", "P4"]),
    emergency: new Set(["P2"]),
  },
};

const PASHTO = "زه وړیا حقوقي مشوره غواړم"; // confident ps (Pashto letters)
const PASHTO_EN = "I want free legal advice";
const ROMANIZED = "mujhe madad chahiye"; // romanized_or_mixed
const ROMANIZED_EN = "I need help";
const URDU = "مجھے وکیل چاہیے"; // confident ur (Urdu letters)
const URDU_EN = "I need a lawyer";
const DARI = "کلینیک صحی رایگان بدون کارت صحی کجا است؟"; // confident prs (Dari)

/** A unit vector whose similarity with provider P1..P4 is the given number (the fifth axis is "nothing in particular"). */
const unit = (similarities: [number, number, number, number]) => [...similarities, Math.sqrt(1 - similarities.reduce((sum, x) => sum + x * x, 0))];

/** What the embedding model makes of each text. A text it does not know points at nothing in particular. */
const VECTORS: Record<string, number[]> = {
  [PASHTO]: [0, 0, 0, 0, 1], // the embedding model does not list Pashto: nothing qualifies from the direct leg
  [PASHTO_EN]: [1, 0, 0, 0, 0], // P1
  // Direct: P1 > P2 > P3 all qualify. Translated: P2 > P3 qualify, P4 is below the threshold, P1 is 0.
  [ROMANIZED]: [0.9, 0.5, 0.45, 0, 0],
  [ROMANIZED_EN]: [0, 0.5, 0.45, 0.1, 0],
  "I need a lawyer": [1, 0, 0, 0, 0],
  // The emergency fail-safe: P2 is the emergency provider, the threshold is 0.3, the emergency-only threshold 0.25.
  "em just below": unit([0, 0.27, 0, 0]), // emergency 0.27: no clear match, but an emergency provider is first
  "em too low": unit([0, 0.24, 0, 0]), // emergency 0.24: below the emergency-only threshold
  "other just below": unit([0, 0, 0.27, 0]), // P3 (not emergency) 0.27
  "em fourth": unit([0.28, 0.27, 0.28, 0.28]), // emergency 0.27, but fourth: three others are above it
  "em fourth and clear": unit([0.5, 0.35, 0.5, 0.5]), // emergency 0.35 qualifies as a result, though fourth in the leg
  "I need an ambulance": unit([0, 0.27, 0, 0]),
};

interface Call {
  text: string;
  model: string;
  aborted: boolean;
  /** When the call began (fake clock). */
  at?: number;
}

/** A model call that takes `ms` of fake time. Cancelled while running, it records the abort and rejects; a stubborn one records it and answers anyway, late. */
function timed<T>(ms: number, signal: AbortSignal, call: Call, answer: () => T, stubborn = false): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      done = true;
      resolve(answer());
    }, ms);
    signal.addEventListener("abort", () => {
      if (done) return;
      call.aborted = true;
      if (stubborn) return;
      clearTimeout(timer);
      reject(new Error(`aborted: ${call.text}`));
    });
  });
}

function fakeEmbedder(options: { ms?: (text: string) => number; fail?: (text: string) => boolean; stubborn?: boolean } = {}) {
  const calls: (Call & { dims: number | null })[] = [];
  const embedder: QueryEmbedder = {
    embedQuery({ text, model, dims, signal }) {
      const call = { text, model, dims, aborted: false };
      calls.push(call);
      if (options.fail?.(text)) return Promise.reject(new Error(`embed failed: ${text}`));
      return timed(options.ms?.(text) ?? 100, signal, call, () => ({ vector: VECTORS[text] ?? [0, 0, 0, 0, 1], tokens: 4 }), options.stubborn);
    },
  };
  return { embedder, calls };
}

function fakeTranslator(options: { ms?: number; answer?: (text: string) => string; fail?: boolean; stubborn?: boolean } = {}) {
  const calls: Call[] = [];
  const translator: Translator = {
    translate({ text, model, signal }) {
      const call = { text, model, aborted: false, at: Date.now() };
      calls.push(call);
      if (options.fail) return Promise.reject(new Error(`vendor error echoing ${text}`));
      const answer = options.answer ?? ((t: string) => (t === PASHTO ? PASHTO_EN : t === ROMANIZED ? ROMANIZED_EN : "I need help"));
      return timed(options.ms ?? 200, signal, call, () => ({ text: answer(text), inputTokens: 30, outputTokens: 5 }), options.stubborn);
    },
  };
  return { translator, calls };
}

describe("the translated-question leg", () => {
  let logs: SearchLogRow[];
  let spends: SpendEventInput[];
  let deferred: Promise<unknown>[];

  beforeEach(() => {
    vi.useFakeTimers();
    logs = [];
    spends = [];
    deferred = [];
  });
  afterEach(() => vi.useRealTimers());

  function service(parts: {
    embedder: QueryEmbedder;
    translator?: Translator | null;
    route?: QuestionRoute;
    /** The fallback model per kind of question (none: the routed model alone). */
    fallback?: QuestionRoute | null;
    /** A question translator of its own instead of the one made from `translator`, `route` and `fallback`. */
    questions?: QuestionTranslator;
    fallbackMinBudgetMs?: number;
    onSpendWritten?: SearchDeps["onSpendWritten"];
    onFailure?: SearchDeps["onFailure"];
    snapshotMs?: number;
    /** The request snapshot instead of SNAPSHOT (a read that fails). */
    snapshot?: () => Promise<SearchSnapshot>;
    emergencyThreshold?: number;
  }) {
    return createSearch({
      db: () => {
        throw new Error("no database in this test");
      },
      storage: () => {
        throw new Error("no store in this test");
      },
      embedder: parts.embedder,
      translator: parts.questions ?? (parts.translator ? createQuestionTranslator({ translator: parts.translator, route: parts.route ?? ROUTE, fallback: parts.fallback }) : null),
      fallbackMinBudgetMs: parts.fallbackMinBudgetMs,
      onSpendWritten: parts.onSpendWritten,
      snapshot:
        parts.snapshot ??
        (async () => {
          if (parts.snapshotMs) await new Promise<void>((resolve) => setTimeout(resolve, parts.snapshotMs));
          return SNAPSHOT;
        }),
      emergencyThreshold: parts.emergencyThreshold,
      writer: {
        log: async (row) => void logs.push(row),
        spend: async (event) => void spends.push(event),
      },
      defer: (work) => void deferred.push(work),
      onFailure: parts.onFailure,
      clock: () => Date.now(),
    });
  }

  /** Runs a search on fake time; `took` is when it answered, in ms from the request start. */
  async function ask(search: ReturnType<typeof service>, q: string, lang: "en" | "ur" | "ps" = "en", startedAgoMs = 0) {
    const started = Date.now() - startedAgoMs;
    let took = -1;
    const pending = search.search({ q, lang }, started).then(
      (body) => ((took = Date.now() - started), body),
      (error: unknown) => {
        took = Date.now() - started;
        throw error;
      },
    );
    pending.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(5000);
    return { result: await pending.catch((e: unknown) => e), took: () => took };
  }

  describe("which questions get it", () => {
    it("is run for Pashto, Dari, native-script Urdu, romanized or mixed, and ambiguous Arabic script, and for no other question", () => {
      const of = (q: string, page: "en" | "ur" = "en") => questionSourceOf(detect(q, page), q);
      expect(of(PASHTO)).toBe("ps");
      expect(of("کلینیک صحی رایگان بدون کارت صحی کجا است؟")).toBe("prs");
      expect(of(ROMANIZED)).toBe("romanized_or_mixed");
      expect(of("Mujhe nearby free dental clinic batao")).toBe("romanized_or_mixed");
      expect(of("مکان")).toBe("ambiguous_arabic");
      expect(of("I need a lawyer")).toBeNull();
      expect(of(URDU)).toBe("ur"); // confident Urdu (owner decision 40)
      expect(of(URDU, "ur")).toBe("ur");
      expect(of("Necesito un abogado")).toBeNull();
    });

    it("matches the test set's native-script questions: every Pashto, Dari and Urdu one gets it, and none of the other scripts' (Latin-letter questions are the detector's, tuned in S03.07)", () => {
      const lines = readFileSync(path.join(process.cwd(), "data/search-test-set/questions.jsonl"), "utf8").split("\n").filter((l) => l.trim() !== "");
      const questions = lines.map((l) => JSON.parse(l) as { id: string; lang: string; q: string; form: string });
      const arabic = questions.filter((x) => x.form === "native" && ["ps", "prs", "ur"].includes(x.lang));
      const otherScripts = questions.filter((x) => x.form === "native" && ["bn", "pa", "gu", "ta", "el", "zh", "zh-Hant", "hi"].includes(x.lang));
      expect(arabic.length).toBeGreaterThan(0);
      expect(otherScripts.length).toBeGreaterThan(0);
      // The page language is English: the leg depends on how the question is written, not the page.
      for (const x of arabic) expect(questionSourceOf(detect(x.q, "en"), x.q), x.id).toBe(x.lang);
      for (const x of otherScripts) expect(questionSourceOf(detect(x.q, "en"), x.q), x.id).toBeNull();
    });

    it("is not run, and is logged not_needed, for an English question", async () => {
      const model = fakeEmbedder();
      const words = fakeTranslator();

      const { result } = await ask(service({ embedder: model.embedder, translator: words.translator }), "I need a lawyer");

      expect(result).toMatchObject({ status: "ok", results: [{ provider_id: "P1" }] });
      expect(words.calls).toEqual([]);
      expect(model.calls.map((c) => c.text)).toEqual(["I need a lawyer"]);
      expect(logs).toMatchObject([{ translatedLeg: "not_needed" }]);
    });

    it("is not run for a clearly English question that eld only reads as romanized or mixed: no translate call for lawyer, rent, car repair", async () => {
      for (const q of ["lawyer", "rent", "car repair"]) {
        const model = fakeEmbedder();
        const words = fakeTranslator();
        logs = [];

        await ask(service({ embedder: model.embedder, translator: words.translator }), q);

        expect(words.calls, q).toEqual([]);
        expect(model.calls.map((c) => c.text), q).toEqual([q]);
        expect(logs, q).toMatchObject([{ translatedLeg: "not_needed" }]);
      }
    });

    it("is still run for a romanized question with a romanized marker, even when eld reads it as English", async () => {
      const words = fakeTranslator();

      await ask(service({ embedder: fakeEmbedder().embedder, translator: words.translator }), "Mujhe nearby free dental clinic batao");

      expect(words.calls).toHaveLength(1);
    });

    it("is not run when the route switches it off for that kind of question, or no translator is configured", async () => {
      const words = fakeTranslator();
      await ask(service({ embedder: fakeEmbedder().embedder, translator: words.translator, route: { ...ROUTE, ps: null } }), PASHTO, "ps");
      await ask(service({ embedder: fakeEmbedder().embedder, translator: null }), PASHTO, "ps");

      expect(words.calls).toEqual([]);
      expect(logs).toMatchObject([{ translatedLeg: "not_needed" }, { translatedLeg: "not_needed" }]);
    });
  });

  describe("when it completes", () => {
    it("translates with the routed model, embeds the translation with the snapshot's model in parallel with the direct leg, and uses it", async () => {
      const model = fakeEmbedder();
      const words = fakeTranslator();

      const { result, took } = await ask(service({ embedder: model.embedder, translator: words.translator }), PASHTO, "ps");

      expect(words.calls).toMatchObject([{ text: PASHTO, model: "north-small-translate-09-2026", aborted: false }]);
      // Both embeddings with the snapshot's model and size; the direct leg did not wait for the translation.
      expect(model.calls).toMatchObject([
        { text: PASHTO, model: MODEL, dims: 5 },
        { text: PASHTO_EN, model: MODEL, dims: 5 },
      ]);
      // The direct leg alone finds nothing (the model does not list Pashto); the translation finds the legal clinic.
      expect(result).toEqual({ v: 1, release_v: 3, query_lang: "ps", status: "ok", emergency_first: false, results: [{ provider_id: "P1", score: 1 }] });
      // 100 ms direct leg in parallel with 200 ms translation then 100 ms embedding.
      expect(took()).toBe(300);
      expect(logs).toEqual([{ lang: "ps", queryLang: "ps", releaseV: 3, ms: 300, status: "ok", resultCount: 1, topScore: 1, translatedLeg: "used" }]);
    });

    it("runs for native-script Urdu with the model the route names for ur, and uses the translation (owner decision 40)", async () => {
      const model = fakeEmbedder();
      const words = fakeTranslator({ answer: () => URDU_EN });

      const { result } = await ask(service({ embedder: model.embedder, translator: words.translator }), URDU, "ur");

      expect(words.calls).toMatchObject([{ text: URDU, model: "north-small-translate-09-2026" }]);
      expect(model.calls.map((c) => c.text)).toEqual([URDU, URDU_EN]);
      expect(result).toMatchObject({ status: "ok", query_lang: "ur", results: [{ provider_id: "P1" }] });
      expect(logs).toMatchObject([{ translatedLeg: "used" }]);
    });

    it("ranks over both legs: threshold first, then reciprocal rank fusion of the qualifying providers, never by an RRF score against the threshold", async () => {
      const { result } = await ask(service({ embedder: fakeEmbedder().embedder, translator: fakeTranslator().translator }), ROMANIZED);

      // By similarity alone P1 (0.80) would be first; RRF puts P2 (2nd direct, 1st translated) and P3 (3rd, 2nd) above it.
      // P4 is below the threshold in the translated leg and absent from the direct one: it is never added.
      expect(result).toMatchObject({ status: "ok", query_lang: "en", emergency_first: true });
      const hits = (result as { results: { provider_id: string; score: number }[] }).results;
      expect(hits.map((h) => h.provider_id)).toEqual(["P2", "P3", "P1"]);
      // Each provider's score is its higher similarity from the two legs.
      expect(hits[0]!.score).toBeCloseTo(0.5 / Math.hypot(0.5, 0.45, 0.1), 5);
      expect(hits[2]!.score).toBeCloseTo(0.9 / Math.hypot(0.9, 0.5, 0.45), 5);
      expect(logs).toMatchObject([{ translatedLeg: "used", resultCount: 3 }]);
    });

    it("records the usage of the translation and of both embeddings in spend_event, without text", async () => {
      await ask(service({ embedder: fakeEmbedder().embedder, translator: fakeTranslator().translator }), PASHTO, "ps");

      expect(spends).toEqual(
        expect.arrayContaining([
          { kind: "embed", purpose: "search", model: MODEL, releaseV: 3, tokens: 4, tokensEstimated: false, ms: 100 },
          { kind: "translate", purpose: "search", model: "north-small-translate-09-2026", releaseV: 3, tokens: 35, tokensEstimated: false, ms: 200 },
        ]),
      );
      expect(spends.filter((s) => s.kind === "embed")).toHaveLength(2);
      expect(JSON.stringify(spends)).not.toContain(PASHTO_EN);
      expect(JSON.stringify(spends) + JSON.stringify(logs)).not.toMatch(/[؀-ۿ]/);
    });

    it("takes the results from the translated leg alone when the direct leg fails", async () => {
      const model = fakeEmbedder({ fail: (text) => text === PASHTO });

      const { result } = await ask(service({ embedder: model.embedder, translator: fakeTranslator().translator }), PASHTO, "ps");

      expect(result).toMatchObject({ status: "ok", results: [{ provider_id: "P1" }] });
      expect(logs).toMatchObject([{ status: "ok", translatedLeg: "used" }]);
    });

    it("takes the results from the translated leg alone when the direct leg is still running at 2.2 s, cancels it, and answers within 2.5 s", async () => {
      const model = fakeEmbedder({ ms: (text) => (text === ROMANIZED ? 3000 : 100) });

      const { result, took } = await ask(service({ embedder: model.embedder, translator: fakeTranslator().translator }), ROMANIZED);

      expect(result).toMatchObject({ status: "ok" });
      expect((result as { results: { provider_id: string }[] }).results.map((h) => h.provider_id)).toEqual(["P2", "P3"]);
      expect(took()).toBe(2200);
      expect(model.calls.find((c) => c.text === ROMANIZED)!.aborted).toBe(true);
      // The cancelled direct embedding may have been billed: it is counted as an estimate.
      expect(spends).toContainEqual(expect.objectContaining({ kind: "embed", tokensEstimated: true }));
    });
  });

  describe("when it fails or runs out of time", () => {
    it.each([
      ["the translation fails", { fail: true }],
      ["the translation is not English", { answer: () => "Necesito asesoría legal gratuita" }],
      ["the model answers instead of translating", { answer: () => "There are many free legal clinics in Toronto. Call 211 to find one near you, or visit the Thorncliffe office." }],
    ])("answers from the direct leg alone, logged failed, when %s", async (_, options) => {
      const model = fakeEmbedder();

      const { result, took } = await ask(service({ embedder: model.embedder, translator: fakeTranslator(options).translator }), ROMANIZED);

      expect((result as { results: { provider_id: string }[] }).results.map((h) => h.provider_id)).toEqual(["P1", "P2", "P3"]);
      expect(took()).toBeLessThan(2500);
      expect(model.calls.map((c) => c.text)).toEqual([ROMANIZED]); // nothing unusable is embedded
      expect(logs).toMatchObject([{ status: "ok", translatedLeg: "failed" }]);
    });

    it("counts an answer it did not use (it was billed), and no usage for a call that failed", async () => {
      await ask(service({ embedder: fakeEmbedder().embedder, translator: fakeTranslator({ answer: () => "Necesito ayuda" }).translator }), ROMANIZED);
      expect(spends.filter((s) => s.kind === "translate")).toEqual([expect.objectContaining({ tokens: 35, tokensEstimated: false })]);

      spends = [];
      await ask(service({ embedder: fakeEmbedder().embedder, translator: fakeTranslator({ fail: true }).translator }), ROMANIZED);
      expect(spends.filter((s) => s.kind === "translate")).toEqual([]);
    });

    it("cancels a slow translation (3 s) at 2.2 s, records the abort, answers from the direct leg within 2.5 s, and logs timed_out", async () => {
      const model = fakeEmbedder();
      const words = fakeTranslator({ ms: 3000 });

      const { result, took } = await ask(service({ embedder: model.embedder, translator: words.translator }), ROMANIZED);

      expect(took()).toBe(2200);
      expect(words.calls).toMatchObject([{ aborted: true }]);
      expect((result as { results: { provider_id: string }[] }).results.map((h) => h.provider_id)).toEqual(["P1", "P2", "P3"]);
      expect(logs).toMatchObject([{ status: "ok", translatedLeg: "timed_out", ms: 2200 }]);
      // The cancelled translation may have been billed: it is counted, as an estimate.
      expect(spends).toContainEqual(expect.objectContaining({ kind: "translate", tokensEstimated: true }));
    });

    it("with a slow translation (2 s), cancels the translation's embedding still running at 2.2 s and never uses its late result", async () => {
      const model = fakeEmbedder({ ms: (text) => (text === ROMANIZED_EN ? 500 : 100), stubborn: true });
      const words = fakeTranslator({ ms: 2000 });

      const { result, took } = await ask(service({ embedder: model.embedder, translator: words.translator }), ROMANIZED);

      expect(took()).toBe(2200);
      expect(words.calls).toMatchObject([{ aborted: false }]);
      expect(model.calls.find((c) => c.text === ROMANIZED_EN)).toMatchObject({ aborted: true });
      // The embedding answered at 2.5 s anyway: its result is not in the answer, and nothing more is written for it.
      expect((result as { results: { provider_id: string }[] }).results.map((h) => h.provider_id)).toEqual(["P1", "P2", "P3"]);
      expect(logs).toMatchObject([{ translatedLeg: "timed_out" }]);
      const written = spends.length;
      await vi.advanceTimersByTimeAsync(5000);
      expect(spends).toHaveLength(written);
      expect(logs).toHaveLength(1);
    });

    it("with a slow translated embedding (translation 0.5 s, embedding 2 s), cancels the embedding at 2.2 s, records the abort and answers within 2.5 s", async () => {
      const model = fakeEmbedder({ ms: (text) => (text === ROMANIZED_EN ? 2000 : 100) });
      const words = fakeTranslator({ ms: 500 });

      const { result, took } = await ask(service({ embedder: model.embedder, translator: words.translator }), ROMANIZED);

      expect(took()).toBe(2200);
      expect(model.calls.find((c) => c.text === ROMANIZED_EN)).toMatchObject({ aborted: true });
      expect((result as { results: { provider_id: string }[] }).results.map((h) => h.provider_id)).toEqual(["P1", "P2", "P3"]);
      expect(logs).toMatchObject([{ translatedLeg: "timed_out" }]);
      expect(spends).toContainEqual(expect.objectContaining({ kind: "embed", tokensEstimated: true }));
      expect(spends).toContainEqual(expect.objectContaining({ kind: "translate", tokensEstimated: false }));
    });

    it("counts the 2.2 s from the request start: a request that began 2 s ago gives the leg 0.2 s", async () => {
      const words = fakeTranslator({ ms: 500 });

      const { took } = await ask(service({ embedder: fakeEmbedder().embedder, translator: words.translator }), ROMANIZED, "en", 2000);

      expect(took()).toBe(2200);
      expect(words.calls).toMatchObject([{ aborted: true }]);
      expect(logs).toMatchObject([{ translatedLeg: "timed_out" }]);
    });

    it("answers search_unavailable within 2.5 s when neither leg completes, logs what the leg did, and reports the direct leg's reason", async () => {
      const notes: unknown[] = [];
      const model = fakeEmbedder({ ms: () => 3000 });
      const words = fakeTranslator({ fail: true });

      const { result, took } = await ask(service({ embedder: model.embedder, translator: words.translator, onFailure: async (n) => void notes.push(n) }), ROMANIZED);

      expect(result).toBeInstanceOf(SearchFailure);
      expect((result as SearchFailure).code).toBe("search_unavailable");
      expect(took()).toBe(2200);
      expect(model.calls).toMatchObject([{ text: ROMANIZED, aborted: true }]);
      expect(logs).toMatchObject([{ status: "error", resultCount: 0, translatedLeg: "failed" }]);
      // The translation's vendor failure is told too (the search did not answer, and it is not the direct leg's reason).
      expect(notes).toEqual([
        { reason: "translate_failed", releaseV: 3, ms: 2200, answered: true, model: "command-a-translate-08-2025", error: "translate_failed:other" },
        { reason: "timed_out", releaseV: 3, ms: 2200, error: "timed_out" },
      ]);
    });

    it("answers search_unavailable when the direct leg fails and the translated leg times out", async () => {
      const model = fakeEmbedder({ fail: (text) => text === ROMANIZED });

      const { result } = await ask(service({ embedder: model.embedder, translator: fakeTranslator({ ms: 4000 }).translator }), ROMANIZED);

      expect(result).toMatchObject({ code: "search_unavailable" });
      expect(logs).toMatchObject([{ status: "error", translatedLeg: "timed_out" }]);
    });
  });
  describe("the translation starts with the request, not after the snapshot (P2-1)", () => {
    it("with a snapshot that takes 1 s and a translation that takes 1 s, the leg completes within 2.2 s: only the translation's embedding waits for the snapshot", async () => {
      const model = fakeEmbedder();
      const words = fakeTranslator({ ms: 1000 });

      const { result, took } = await ask(service({ embedder: model.embedder, translator: words.translator, snapshotMs: 1000 }), PASHTO, "ps");

      // The translation began at the start of the request, in parallel with the snapshot read.
      expect(words.calls).toMatchObject([{ text: PASHTO, aborted: false, at: expect.any(Number) }]);
      expect(words.calls[0]!.at! - (Date.now() - 5000)).toBeLessThanOrEqual(5000); // sanity: a number on the same clock
      // 1 s for both in parallel, then 100 ms to embed (in series they would take 2.1 s).
      expect(took()).toBe(1100);
      expect(result).toMatchObject({ status: "ok", results: [{ provider_id: "P1" }] });
      expect(logs).toMatchObject([{ status: "ok", translatedLeg: "used", ms: 1100 }]);
    });

    it("completes where waiting for the snapshot first would run out of time (1.2 s and 1.2 s: 2.4 s in series)", async () => {
      const words = fakeTranslator({ ms: 1200 });

      const { result, took } = await ask(service({ embedder: fakeEmbedder().embedder, translator: words.translator, snapshotMs: 1200 }), PASHTO, "ps");

      expect(took()).toBe(1300);
      expect(result).toMatchObject({ status: "ok", results: [{ provider_id: "P1" }] });
      expect(logs).toMatchObject([{ translatedLeg: "used" }]);
    });

    it("starts the translation before the snapshot is known", async () => {
      const words = fakeTranslator({ ms: 100 });
      const search = service({ embedder: fakeEmbedder().embedder, translator: words.translator, snapshotMs: 1000 });
      const pending = search.search({ q: PASHTO, lang: "ps" }, Date.now());

      await vi.advanceTimersByTimeAsync(1);
      expect(words.calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(5000);
      await pending;
    });

    it("writes the translation's spend row with the release number even though the translation settled before the snapshot", async () => {
      const words = fakeTranslator({ ms: 200 });

      await ask(service({ embedder: fakeEmbedder().embedder, translator: words.translator, snapshotMs: 1000 }), PASHTO, "ps");

      expect(spends).toContainEqual(expect.objectContaining({ kind: "translate", releaseV: 3, tokensEstimated: false, ms: 200 }));
    });

    it("cancels the translation, and counts it, when the snapshot then fails or the budget is gone", async () => {
      const words = fakeTranslator({ ms: 3000 });
      const search = createSearch({
        db: () => {
          throw new Error("no database in this test");
        },
        storage: () => {
          throw new Error("no store in this test");
        },
        embedder: fakeEmbedder().embedder,
        translator: createQuestionTranslator({ translator: words.translator, route: ROUTE }),
        snapshot: async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, 100));
          throw new Error("store down");
        },
        writer: { log: async (row) => void logs.push(row), spend: async (event) => void spends.push(event) },
        defer: (work) => void deferred.push(work),
        clock: () => Date.now(),
      });

      const { result } = await ask(search, PASHTO, "ps");

      expect(result).toMatchObject({ code: "search_unavailable" });
      expect(words.calls).toMatchObject([{ aborted: true }]);
      await Promise.all(deferred);
      expect(spends).toContainEqual(expect.objectContaining({ kind: "translate", tokensEstimated: true }));
      expect(logs).toMatchObject([{ status: "error", translatedLeg: "failed" }]);
    });
  });

  describe("vendor failures are visible to ops (P2-2)", () => {
    it("tells ops about a translation that failed at the vendor, although the direct leg answered", async () => {
      const notes: SearchFailureNote[] = [];

      const { result } = await ask(
        service({ embedder: fakeEmbedder().embedder, translator: fakeTranslator({ fail: true }).translator, onFailure: async (n) => void notes.push(n) }),
        ROMANIZED,
      );

      expect(result).toMatchObject({ status: "ok" });
      expect(notes).toEqual([{ reason: "translate_failed", releaseV: 3, ms: expect.any(Number), answered: true, model: "command-a-translate-08-2025", error: "translate_failed:other" }]);
      expect(JSON.stringify(notes)).not.toContain(ROMANIZED);
    });

    it.each([
      ["is not English", () => "Necesito asesoría legal gratuita"],
      ["is empty", () => ""],
      ["is an answer, not a translation", () => "There are many free legal clinics in Toronto. Call 211 to find one near you, or visit the Thorncliffe office."],
      ["is the question itself, already English", (t: string) => t],
    ])("does not tell ops about a translation that %s: a check rejected it, the vendor did not fail", async (_, answer) => {
      const notes: SearchFailureNote[] = [];

      await ask(service({ embedder: fakeEmbedder().embedder, translator: fakeTranslator({ answer }).translator, onFailure: async (n) => void notes.push(n) }), "Mujhe nearby free dental clinic batao");

      expect(notes).toEqual([]);
    });

    it("tells ops about a direct leg whose embedding failed even though the translated leg rescued the answer", async () => {
      const notes: SearchFailureNote[] = [];
      const model = fakeEmbedder({ fail: (text) => text === PASHTO });

      const { result } = await ask(service({ embedder: model.embedder, translator: fakeTranslator().translator, onFailure: async (n) => void notes.push(n) }), PASHTO, "ps");

      expect(result).toMatchObject({ status: "ok", results: [{ provider_id: "P1" }] });
      expect(notes).toEqual([{ reason: "embed_failed", releaseV: 3, ms: expect.any(Number), answered: true, error: "Error" }]);
    });

    it("does not tell ops about a direct leg that merely ran out of time", async () => {
      const notes: SearchFailureNote[] = [];
      const model = fakeEmbedder({ ms: (text) => (text === ROMANIZED ? 3000 : 100) });

      await ask(service({ embedder: model.embedder, translator: fakeTranslator().translator, onFailure: async (n) => void notes.push(n) }), ROMANIZED);

      expect(notes).toEqual([]);
    });

    it("tells ops of the same failure once a minute, not on every search", async () => {
      const notes: SearchFailureNote[] = [];
      const search = service({ embedder: fakeEmbedder().embedder, translator: fakeTranslator({ fail: true }).translator, onFailure: async (n) => void notes.push(n) });

      await ask(search, ROMANIZED);
      await ask(search, ROMANIZED);
      await ask(search, "mujhe khana chahiye");
      expect(notes).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(61_000);
      await ask(search, ROMANIZED);
      expect(notes).toHaveLength(2);
    });

    it("keeps a different failure apart from one already reported", async () => {
      const notes: SearchFailureNote[] = [];
      const model = fakeEmbedder({ fail: (text) => text === ROMANIZED });
      const search = service({ embedder: model.embedder, translator: fakeTranslator({ fail: true }).translator, onFailure: async (n) => void notes.push(n) });

      // Direct embedding fails and the translation fails: no leg completes. The primary reason is told as always, and the translation's besides.
      await ask(search, ROMANIZED);

      expect(notes.map((n) => n.reason).sort()).toEqual(["embed_failed", "translate_failed"]);
    });
  });

  describe("why a search could not answer: the safe classification in the note and in one log line", () => {
    const QUESTION = "mujhe madad chahiye meri building 203.0.113.9";
    let logged: MockInstance<typeof console.error>;
    beforeEach(() => {
      logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    });
    afterEach(() => logged.mockRestore());
    const lines = () => logged.mock.calls.map((c) => c.join(" "));

    /** A search whose request snapshot fails with `thrown`, and the note it told. */
    async function failedSnapshot(thrown: unknown) {
      const notes: SearchFailureNote[] = [];
      const { result } = await ask(
        service({
          embedder: fakeEmbedder().embedder,
          snapshot: async () => {
            throw thrown;
          },
          onFailure: async (n) => void notes.push(n),
        }),
        QUESTION,
      );
      expect(result).toMatchObject({ code: "search_unavailable" });
      return notes;
    }

    it("names the schema path of a listing that does not parse, not its content", async () => {
      const notes = await failedSnapshot(new SafeDetailError("listing_schema:providers.0.name"));

      expect(notes).toEqual([{ reason: "snapshot_failed", releaseV: null, ms: expect.any(Number), error: "listing_schema:providers.0.name" }]);
      expect(lines()).toEqual([expect.stringMatching(/^search\.failed reason=snapshot_failed code=listing_schema:providers\.0\.name ms=\d+$/)]);
    });

    it("names the Postgres SQLSTATE, else the class name, else unknown, and never the error's message, an address or the question", async () => {
      const stopped = Object.assign(new Error("canceling statement due to statement timeout for 203.0.113.9"), { code: "57014" });
      class PostgresLikeError extends Error {}
      const errors = [
        ...(await failedSnapshot(stopped)).map((n) => n.error),
        ...(await failedSnapshot(new PostgresLikeError(QUESTION))).map((n) => n.error),
        ...(await failedSnapshot(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).map((n) => n.error),
        ...(await failedSnapshot("a string")).map((n) => n.error),
      ];

      expect(errors).toEqual(["57014", "PostgresLikeError", "Error", "unknown"]);
      expect(lines().map((l) => l.replace(/ ms=\d+$/, ""))).toEqual([
        "search.failed reason=snapshot_failed code=57014",
        "search.failed reason=snapshot_failed code=PostgresLikeError",
        "search.failed reason=snapshot_failed code=Error",
        "search.failed reason=snapshot_failed code=unknown",
      ]);
      expect(JSON.stringify([errors, lines()])).not.toMatch(/203\.0\.113|canceling|madad/);
    });

    it("names a timeout as timed_out (the legs cut at 2.2 s)", async () => {
      const notes: SearchFailureNote[] = [];

      const { result } = await ask(service({ embedder: fakeEmbedder({ ms: () => 3000 }).embedder, onFailure: async (n) => void notes.push(n) }), "I need a lawyer");

      expect(result).toMatchObject({ code: "search_unavailable" });
      expect(notes).toEqual([{ reason: "timed_out", releaseV: 3, ms: 2200, error: "timed_out" }]);
      expect(lines()).toEqual(["search.failed reason=timed_out code=timed_out ms=2200"]);
    });

    it("names the snapshot's own timeout as timed_out", async () => {
      const notes: SearchFailureNote[] = [];

      const { result } = await ask(service({ embedder: fakeEmbedder().embedder, snapshotMs: 3000, onFailure: async (n) => void notes.push(n) }), "I need a lawyer");

      expect(result).toMatchObject({ code: "search_unavailable" });
      expect(notes).toMatchObject([{ reason: "timed_out", error: "timed_out" }]);
    });

    it("names the class of an embedding that failed at the vendor, not its message", async () => {
      const notes: SearchFailureNote[] = [];
      const embedder: QueryEmbedder = {
        embedQuery: () => Promise.reject(Object.assign(new Error(`vendor said no to: ${QUESTION}`), { code: "429" })),
      };

      const { result } = await ask(service({ embedder, onFailure: async (n) => void notes.push(n) }), "I need a lawyer");

      expect(result).toMatchObject({ code: "search_unavailable" });
      expect(notes).toEqual([{ reason: "embed_failed", releaseV: 3, ms: expect.any(Number), error: "Error" }]);
      expect(JSON.stringify([notes, lines()])).not.toMatch(/203\.0\.113|vendor said|madad/);
    });

    it("gives no classification where the reason says it all (an embedding that is not a vector of the release's size)", async () => {
      const notes: SearchFailureNote[] = [];
      const embedder: QueryEmbedder = { embedQuery: async () => ({ vector: [1, 2], tokens: 3 }) };

      await ask(service({ embedder, onFailure: async (n) => void notes.push(n) }), "I need a lawyer");

      expect(notes).toEqual([{ reason: "embed_invalid", releaseV: 3, ms: expect.any(Number) }]);
      expect(lines()).toEqual([expect.stringMatching(/^search\.failed reason=embed_invalid code=none ms=\d+$/)]);
    });
  });

  describe("the fallback model when the routed one is past a limit", () => {
    type Step = { ms: number; fail?: TranslateErrorCode; answer?: string; stubborn?: boolean };
    /** A translator whose behaviour depends on the model asked: a failure of the given class, or an answer, after `ms` of fake time. */
    function byModel(steps: Record<string, Step>) {
      const calls: Call[] = [];
      const translator: Translator = {
        translate({ text, model, signal }) {
          const call = { text, model, aborted: false, at: Date.now() };
          calls.push(call);
          const step = steps[model] ?? { ms: 100, fail: "other" as const };
          return timed(step.ms, signal, call, () => ({ text: step.answer ?? PASHTO_EN, inputTokens: 30, outputTokens: 5 }), step.stubborn).then((answer) => {
            if (step.fail) throw new TranslateError(step.fail);
            return answer;
          });
        },
      };
      return { translator, calls };
    }
    const NORTH = "north-small-translate-09-2026";
    const COMMAND = "command-a-translate-08-2025";
    const translateSpends = () => spends.filter((s) => s.kind === "translate");
    const reasons = (notes: SearchFailureNote[]) => notes.map((n) => n.reason);
    /** The same fallback model for every kind of question. */
    const everyKind = (model: string): QuestionRoute => ({ ps: model, prs: model, ur: model, romanized_or_mixed: model, ambiguous_arabic: model });
    const withFallback = (parts: Parameters<typeof service>[0], fallback: QuestionRoute | null = everyKind(COMMAND)) => service({ ...parts, fallback });

    it("retries once with the fallback when the routed model is past its quota, uses its translation, logs used, and bills only the call that answered", async () => {
      const notes: SearchFailureNote[] = [];
      const words = byModel({ [NORTH]: { ms: 100, fail: "quota" }, [COMMAND]: { ms: 200 } });

      const { result, took } = await ask(withFallback({ embedder: fakeEmbedder().embedder, translator: words.translator, onFailure: async (n) => void notes.push(n) }), PASHTO, "ps");

      expect(words.calls.map((c) => c.model)).toEqual([NORTH, COMMAND]);
      expect(result).toMatchObject({ status: "ok", results: [{ provider_id: "P1" }] });
      // 100 ms to the 429, 200 ms for the fallback, 100 ms to embed the translation.
      expect(took()).toBe(400);
      expect(logs).toMatchObject([{ status: "ok", translatedLeg: "used" }]);
      // The 429 wrote no spend row; the row of the translation is the model that was billed.
      expect(translateSpends()).toEqual([expect.objectContaining({ model: COMMAND, tokens: 35, tokensEstimated: false, releaseV: 3 })]);
      // Ops hears of the quota (it needs someone) and of the rescue, each with its model, and the search did not fail.
      expect(notes).toEqual([
        { reason: "translate_quota", releaseV: 3, ms: expect.any(Number), answered: true, model: NORTH, error: "translate_failed:quota" },
        { reason: "translate_fallback_used", releaseV: 3, ms: expect.any(Number), answered: true, model: COMMAND },
      ]);
    });

    it("also falls back from a transient rate limit, and tells ops only that the fallback was used", async () => {
      const notes: SearchFailureNote[] = [];
      const words = byModel({ [NORTH]: { ms: 100, fail: "rate_limited" }, [COMMAND]: { ms: 200 } });

      await ask(withFallback({ embedder: fakeEmbedder().embedder, translator: words.translator, onFailure: async (n) => void notes.push(n) }), PASHTO, "ps");

      expect(words.calls.map((c) => c.model)).toEqual([NORTH, COMMAND]);
      expect(logs).toMatchObject([{ translatedLeg: "used" }]);
      expect(reasons(notes)).toEqual(["translate_fallback_used"]);
    });

    it("logs failed, answers from the direct leg, writes no spend row and tells ops two reasons when the fallback fails too", async () => {
      const notes: SearchFailureNote[] = [];
      const words = byModel({ [NORTH]: { ms: 100, fail: "quota" }, [COMMAND]: { ms: 200, fail: "unavailable" } });

      const { result } = await ask(withFallback({ embedder: fakeEmbedder().embedder, translator: words.translator, onFailure: async (n) => void notes.push(n) }), PASHTO, "ps");

      expect(words.calls.map((c) => c.model)).toEqual([NORTH, COMMAND]); // one retry, never a third call
      expect(result).toMatchObject({ status: "no_clear_match" });
      expect(logs).toMatchObject([{ translatedLeg: "failed" }]);
      expect(translateSpends()).toEqual([]);
      expect(reasons(notes)).toEqual(["translate_quota", "translate_failed"]);
      expect(notes[0]).toMatchObject({ model: NORTH });
      expect(notes[1]).toMatchObject({ model: COMMAND });
    });

    it("tells ops the quota once a minute, and the rescue once a minute, as it does every reason", async () => {
      const notes: SearchFailureNote[] = [];
      const words = byModel({ [NORTH]: { ms: 100, fail: "quota" }, [COMMAND]: { ms: 200 } });
      const search = withFallback({ embedder: fakeEmbedder().embedder, translator: words.translator, onFailure: async (n) => void notes.push(n) });

      await ask(search, PASHTO, "ps");
      await ask(search, PASHTO, "ps");
      expect(reasons(notes)).toEqual(["translate_quota", "translate_fallback_used"]);

      await vi.advanceTimersByTimeAsync(61_000);
      await ask(search, PASHTO, "ps");
      expect(reasons(notes)).toEqual(["translate_quota", "translate_fallback_used", "translate_quota", "translate_fallback_used"]);
    });

    it("skips the fallback when too little of the 2.2 s is left (fake clock): one call, failed, the quota still told, no timed_out", async () => {
      const notes: SearchFailureNote[] = [];
      // The quota error comes back at 1.95 s: 250 ms are left, less than a translation needs.
      const words = byModel({ [NORTH]: { ms: 1950, fail: "quota" }, [COMMAND]: { ms: 100 } });

      const { result, took } = await ask(withFallback({ embedder: fakeEmbedder().embedder, translator: words.translator, onFailure: async (n) => void notes.push(n) }), PASHTO, "ps");

      expect(words.calls.map((c) => c.model)).toEqual([NORTH]);
      expect(result).toMatchObject({ status: "no_clear_match" });
      expect(took()).toBeLessThan(2500);
      expect(logs).toMatchObject([{ translatedLeg: "failed" }]);
      expect(translateSpends()).toEqual([]);
      expect(reasons(notes)).toEqual(["translate_quota"]);
    });

    it("tries the fallback when there is time for it (1.3 s: 900 ms left) and ends the leg timed_out if even that is too slow, counting the cancelled call as an estimate of the fallback's model, and still tells ops the routed model's quota (P2-1)", async () => {
      const notes: SearchFailureNote[] = [];
      // The fallback ignores the abort and answers at 2.3 s, after the leg was given up on: whatever the rejection chain adds after the
      // deadline comes too late, so the quota must have been told before the retry.
      const words = byModel({ [NORTH]: { ms: 1300, fail: "quota" }, [COMMAND]: { ms: 1000, stubborn: true } });

      const { took } = await ask(withFallback({ embedder: fakeEmbedder().embedder, translator: words.translator, onFailure: async (n) => void notes.push(n) }), PASHTO, "ps");

      expect(words.calls).toMatchObject([{ model: NORTH, aborted: false }, { model: COMMAND, aborted: true }]); // the same deadline and signal
      expect(took()).toBe(2200);
      expect(logs).toMatchObject([{ translatedLeg: "timed_out" }]);
      expect(translateSpends()).toEqual([expect.objectContaining({ model: COMMAND, tokensEstimated: true })]);
      expect(notes).toEqual([{ reason: "translate_quota", releaseV: 3, ms: expect.any(Number), answered: true, model: NORTH, error: "translate_failed:quota" }]);
    });

    it("tells ops the routed model's quota when neither leg completes either: the fallback is cut at the deadline, the direct leg is too slow, and the search fails with the quota told first", async () => {
      const notes: SearchFailureNote[] = [];
      const words = byModel({ [NORTH]: { ms: 1300, fail: "quota" }, [COMMAND]: { ms: 1000 } });

      const { result, took } = await ask(withFallback({ embedder: fakeEmbedder({ ms: () => 3000 }).embedder, translator: words.translator, onFailure: async (n) => void notes.push(n) }), PASHTO, "ps");

      expect(result).toMatchObject({ code: "search_unavailable" });
      expect(took()).toBe(2200);
      expect(logs).toMatchObject([{ status: "error", translatedLeg: "timed_out" }]);
      expect(notes).toEqual([
        { reason: "translate_quota", releaseV: 3, ms: 2200, answered: true, model: NORTH, error: "translate_failed:quota" },
        { reason: "timed_out", releaseV: 3, ms: 2200, error: "timed_out" },
      ]);
    });

    it("does not tell ops of a transient rate limit when the fallback is cut at the deadline and never answers: it is told only if the fallback fails too (a quota is told first, above)", async () => {
      const notes: SearchFailureNote[] = [];
      // A transient limit is told only if the fallback fails too: a fallback cut at the deadline that never answers tells nothing of it.
      const words = byModel({ [NORTH]: { ms: 1300, fail: "rate_limited" }, [COMMAND]: { ms: 1000, stubborn: true } });

      await ask(withFallback({ embedder: fakeEmbedder().embedder, translator: words.translator, onFailure: async (n) => void notes.push(n) }), PASHTO, "ps");

      expect(logs).toMatchObject([{ translatedLeg: "timed_out" }]);
      expect(notes).toEqual([]);
    });

    it("does not retry when the routed model already is the fallback, or the fallback is off", async () => {
      for (const [fallback, route] of [
        [everyKind(COMMAND), { ...ROUTE, ps: COMMAND }],
        [null, ROUTE],
      ] as const) {
        const notes: SearchFailureNote[] = [];
        const words = byModel({ [NORTH]: { ms: 100, fail: "quota" }, [COMMAND]: { ms: 100, fail: "quota" } });

        await ask(withFallback({ embedder: fakeEmbedder().embedder, translator: words.translator, route, onFailure: async (n) => void notes.push(n) }, fallback), PASHTO, "ps");

        expect(words.calls).toHaveLength(1);
        expect(logs.at(-1)).toMatchObject({ translatedLeg: "failed" });
        expect(reasons(notes)).toEqual(["translate_quota"]);
        logs = [];
        spends = [];
      }
    });

    it.each(["unavailable", "other"] as const)("does not retry a %s failure: another model would not help, and it is told as translate_failed", async (fail) => {
      const notes: SearchFailureNote[] = [];
      const words = byModel({ [NORTH]: { ms: 100, fail }, [COMMAND]: { ms: 100 } });

      await ask(withFallback({ embedder: fakeEmbedder().embedder, translator: words.translator, onFailure: async (n) => void notes.push(n) }), PASHTO, "ps");

      expect(words.calls.map((c) => c.model)).toEqual([NORTH]);
      expect(reasons(notes)).toEqual(["translate_failed"]);
    });

    it("bills a fallback answer that was refused by the checks (it answered), and tells ops only the quota", async () => {
      const notes: SearchFailureNote[] = [];
      const words = byModel({ [NORTH]: { ms: 100, fail: "quota" }, [COMMAND]: { ms: 200, answer: "Necesito asesoría legal gratuita" } });

      await ask(withFallback({ embedder: fakeEmbedder().embedder, translator: words.translator, onFailure: async (n) => void notes.push(n) }), PASHTO, "ps");

      expect(logs).toMatchObject([{ translatedLeg: "failed" }]);
      expect(translateSpends()).toEqual([expect.objectContaining({ model: COMMAND, tokens: 35, tokensEstimated: false })]);
      expect(reasons(notes)).toEqual(["translate_quota"]);
    });

    it("keeps the question and its translation out of everything it tells ops and records", async () => {
      const notes: SearchFailureNote[] = [];
      const words = byModel({ [NORTH]: { ms: 100, fail: "quota" }, [COMMAND]: { ms: 200 } });

      await ask(withFallback({ embedder: fakeEmbedder().embedder, translator: words.translator, onFailure: async (n) => void notes.push(n) }), PASHTO, "ps");

      const everything = JSON.stringify([notes, spends, logs]);
      expect(everything).not.toContain(PASHTO);
      expect(everything).not.toContain(PASHTO_EN);
    });

    it("tells ops of each model's failure on its own: both models at quota give two translate_quota events, one per model (P2-2)", async () => {
      const notes: SearchFailureNote[] = [];
      const words = byModel({ [NORTH]: { ms: 100, fail: "quota" }, [COMMAND]: { ms: 200, fail: "quota" } });
      const search = withFallback({ embedder: fakeEmbedder().embedder, translator: words.translator, onFailure: async (n) => void notes.push(n) });

      await ask(search, PASHTO, "ps");

      expect(words.calls.map((c) => c.model)).toEqual([NORTH, COMMAND]);
      expect(notes).toEqual([
        { reason: "translate_quota", releaseV: 3, ms: expect.any(Number), answered: true, model: NORTH, error: "translate_failed:quota" },
        { reason: "translate_quota", releaseV: 3, ms: expect.any(Number), answered: true, model: COMMAND, error: "translate_failed:quota" },
      ]);
      // Each is still told once a minute, not on every search.
      await ask(search, PASHTO, "ps");
      expect(notes).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(61_000);
      await ask(search, PASHTO, "ps");
      expect(notes).toHaveLength(4);
    });

    it("tells ops of a fallback that is unavailable after a rate limit, although a translate_failed was just reported for the routed model (P2-2)", async () => {
      const notes: SearchFailureNote[] = [];
      const words = byModel({ [NORTH]: { ms: 100, fail: "rate_limited" }, [COMMAND]: { ms: 200, fail: "unavailable" } });

      await ask(withFallback({ embedder: fakeEmbedder().embedder, translator: words.translator, onFailure: async (n) => void notes.push(n) }), PASHTO, "ps");

      expect(notes).toEqual([
        { reason: "translate_failed", releaseV: 3, ms: expect.any(Number), answered: true, model: NORTH, error: "translate_failed:rate_limited" },
        { reason: "translate_failed", releaseV: 3, ms: expect.any(Number), answered: true, model: COMMAND, error: "translate_failed:unavailable" },
      ]);
    });

    it("tells ops the fallback was used only once its translation was embedded: not when the embedding of it fails (P3-4)", async () => {
      const notes: SearchFailureNote[] = [];
      const words = byModel({ [NORTH]: { ms: 100, fail: "quota" }, [COMMAND]: { ms: 200 } });
      const model = fakeEmbedder({ fail: (text) => text === PASHTO_EN });

      const { result } = await ask(withFallback({ embedder: model.embedder, translator: words.translator, onFailure: async (n) => void notes.push(n) }), PASHTO, "ps");

      expect(result).toMatchObject({ status: "no_clear_match" }); // the direct leg answers alone
      expect(logs).toMatchObject([{ translatedLeg: "failed" }]);
      expect(reasons(notes)).toEqual(["translate_quota", "embed_failed"]);
    });

    it("tells ops the fallback was used only once its translation was embedded: not when the embedding is cut at the deadline (P3-4)", async () => {
      const notes: SearchFailureNote[] = [];
      const words = byModel({ [NORTH]: { ms: 100, fail: "quota" }, [COMMAND]: { ms: 200 } });
      const model = fakeEmbedder({ ms: (text) => (text === PASHTO_EN ? 3000 : 100), stubborn: true });

      await ask(withFallback({ embedder: model.embedder, translator: words.translator, onFailure: async (n) => void notes.push(n) }), PASHTO, "ps");

      expect(logs).toMatchObject([{ translatedLeg: "timed_out" }]);
      expect(reasons(notes)).toEqual(["translate_quota"]);
    });

    describe("per kind of question (P2-3, owner decision 45)", () => {
      /** The defaults' shape: Dari and Urdu fall back to Command A, Pashto does not. */
      const DEFAULTS: QuestionRoute = { ps: null, prs: COMMAND, ur: COMMAND, romanized_or_mixed: COMMAND, ambiguous_arabic: COMMAND };

      it("retries a Dari question and an Urdu question with Command A when the routed model is past its quota", async () => {
        for (const [q, lang] of [
          [DARI, "en"],
          [URDU, "ur"],
        ] as const) {
          const words = byModel({ [NORTH]: { ms: 100, fail: "quota" }, [COMMAND]: { ms: 200 } });
          logs = [];

          await ask(withFallback({ embedder: fakeEmbedder().embedder, translator: words.translator }, DEFAULTS), q, lang);

          expect(words.calls.map((c) => c.model), q).toEqual([NORTH, COMMAND]);
          expect(logs, q).toMatchObject([{ translatedLeg: "used" }]);
        }
      });

      it("does not retry a Pashto question: the fallback is off for it, so one call, failed, the quota told", async () => {
        const notes: SearchFailureNote[] = [];
        const words = byModel({ [NORTH]: { ms: 100, fail: "quota" }, [COMMAND]: { ms: 200 } });

        const { result } = await ask(withFallback({ embedder: fakeEmbedder().embedder, translator: words.translator, onFailure: async (n) => void notes.push(n) }, DEFAULTS), PASHTO, "ps");

        expect(words.calls.map((c) => c.model)).toEqual([NORTH]);
        expect(result).toMatchObject({ status: "no_clear_match" });
        expect(logs).toMatchObject([{ translatedLeg: "failed" }]);
        expect(reasons(notes)).toEqual(["translate_quota"]);
      });

      it("takes the model of the kind it is: a Pashto fallback set by config is tried for Pashto and not for Dari", async () => {
        const words = byModel({ [NORTH]: { ms: 100, fail: "quota" }, "pashto-model-1": { ms: 200 }, [COMMAND]: { ms: 200 } });
        const fallback: QuestionRoute = { ...DEFAULTS, ps: "pashto-model-1" };

        await ask(withFallback({ embedder: fakeEmbedder().embedder, translator: words.translator }, fallback), PASHTO, "ps");
        expect(words.calls.map((c) => c.model)).toEqual([NORTH, "pashto-model-1"]);

        words.calls.length = 0;
        await ask(withFallback({ embedder: fakeEmbedder().embedder, translator: words.translator }, fallback), DARI);
        expect(words.calls.map((c) => c.model)).toEqual([NORTH, COMMAND]);
      });

      it("does not retry a romanized question routed to Command A with Command A as its fallback: there is no other model", async () => {
        const words = byModel({ [COMMAND]: { ms: 100, fail: "quota" } });

        await ask(withFallback({ embedder: fakeEmbedder().embedder, translator: words.translator }, DEFAULTS), ROMANIZED);

        expect(words.calls.map((c) => c.model)).toEqual([COMMAND]);
        expect(logs).toMatchObject([{ translatedLeg: "failed" }]);
      });
    });

    describe("the least time left for the fallback (P3-2)", () => {
      it("is 800 ms by default: the same as SEARCH_FALLBACK_MIN_BUDGET_MS's default", () => {
        expect(DEFAULT_FALLBACK_MIN_BUDGET_MS).toBe(800);
        expect(DEFAULT_SEARCH_SETTINGS.fallbackMinBudgetMs).toBe(DEFAULT_FALLBACK_MIN_BUDGET_MS);
      });

      it("keeps the fallback for a quota at 1.4 s (800 ms left) and not for one at 1.5 s (700 ms left)", async () => {
        const at14 = byModel({ [NORTH]: { ms: 1400, fail: "quota" }, [COMMAND]: { ms: 100 } });
        await ask(withFallback({ embedder: fakeEmbedder().embedder, translator: at14.translator }), PASHTO, "ps");
        expect(at14.calls.map((c) => c.model)).toEqual([NORTH, COMMAND]);

        const at15 = byModel({ [NORTH]: { ms: 1500, fail: "quota" }, [COMMAND]: { ms: 100 } });
        await ask(withFallback({ embedder: fakeEmbedder().embedder, translator: at15.translator }), PASHTO, "ps");
        expect(at15.calls.map((c) => c.model)).toEqual([NORTH]);
      });

      it("follows the setting: 300 ms retries at 1.8 s, 2200 ms never retries, and 0 always does", async () => {
        const run = async (fallbackMinBudgetMs: number, quotaAt: number) => {
          const words = byModel({ [NORTH]: { ms: quotaAt, fail: "quota" }, [COMMAND]: { ms: 100 } });
          await ask(withFallback({ embedder: fakeEmbedder().embedder, translator: words.translator, fallbackMinBudgetMs }), PASHTO, "ps");
          return words.calls.map((c) => c.model);
        };

        expect(await run(300, 1800)).toEqual([NORTH, COMMAND]);
        expect(await run(800, 1800)).toEqual([NORTH]);
        expect(await run(2200, 1)).toEqual([NORTH]); // 2199 ms left of 2200: not at least 2200
        expect(await run(0, 2000)).toEqual([NORTH, COMMAND]);
      });
    });
  });

  describe("a translation that failed in a way of our own (P3-3)", () => {
    const notesOf = async (parts: Parameters<typeof service>[0]) => {
      const notes: SearchFailureNote[] = [];
      const { result } = await ask(service({ ...parts, onFailure: async (n) => void notes.push(n) }), PASHTO, "ps");
      return { notes, result };
    };

    it("is told to ops as translate_failed when the adapter says it was cancelled but the signal was not aborted", async () => {
      const translator: Translator = { translate: () => Promise.reject(new TranslateError("aborted")) };

      const { notes, result } = await notesOf({ embedder: fakeEmbedder().embedder, translator });

      expect(result).toMatchObject({ status: "no_clear_match" }); // the direct leg answers
      expect(logs).toMatchObject([{ translatedLeg: "failed" }]);
      expect(notes).toEqual([{ reason: "translate_failed", releaseV: 3, ms: expect.any(Number), answered: true, model: "north-small-translate-09-2026", error: "aborted" }]);
    });

    it("is told to ops as translate_failed when something unexpected is thrown that is not a QuestionTranslationError", async () => {
      const questions: QuestionTranslator = {
        modelFor: () => "north-small-translate-09-2026",
        fallbackFor: () => null,
        toEnglish: () => Promise.reject(new TypeError("a bug of ours")),
      };

      const { notes } = await notesOf({ embedder: fakeEmbedder().embedder, questions });

      expect(logs).toMatchObject([{ translatedLeg: "failed" }]);
      expect(notes).toEqual([{ reason: "translate_failed", releaseV: 3, ms: expect.any(Number), answered: true, model: "north-small-translate-09-2026", error: "TypeError" }]);
      expect(JSON.stringify(notes)).not.toContain("a bug of ours");
    });

    it("is not told when the translation was only refused by a check (it is not a vendor failure)", async () => {
      const questions: QuestionTranslator = {
        modelFor: () => "north-small-translate-09-2026",
        fallbackFor: () => null,
        toEnglish: () => Promise.reject(new QuestionTranslationError("not_english", 5)),
      };

      const { notes } = await notesOf({ embedder: fakeEmbedder().embedder, questions });

      expect(logs).toMatchObject([{ translatedLeg: "failed" }]);
      expect(notes).toEqual([]);
    });
  });

  describe("each spend row is handed to the app once written", () => {
    it("tells the hook of the translation's row and of the embeddings', after each was written, and a hook that throws changes nothing", async () => {
      const heard: { event: SpendEventInput; written: boolean }[] = [];
      const words = fakeTranslator({ ms: 100 });

      const { result } = await ask(
        service({
          embedder: fakeEmbedder().embedder,
          translator: words.translator,
          onSpendWritten: (event) => {
            heard.push({ event, written: spends.includes(event) });
            throw new Error("the app's hook failed");
          },
        }),
        PASHTO,
        "ps",
      );

      expect(result).toMatchObject({ status: "ok", results: [{ provider_id: "P1" }] });
      expect(heard.map((h) => h.event.kind).sort()).toEqual(["embed", "embed", "translate"]);
      expect(heard.every((h) => h.written)).toBe(true);
      expect(heard.find((h) => h.event.kind === "translate")?.event).toMatchObject({ model: "north-small-translate-09-2026", purpose: "search" });
    });

    it("is not told of a row that could not be written", async () => {
      const heard: SpendEventInput[] = [];
      const words = fakeTranslator({ ms: 100 });
      const search = createSearch({
        db: () => {
          throw new Error("no database in this test");
        },
        storage: () => {
          throw new Error("no store in this test");
        },
        embedder: fakeEmbedder().embedder,
        translator: createQuestionTranslator({ translator: words.translator, route: ROUTE }),
        snapshot: async () => SNAPSHOT,
        writer: {
          log: async (row) => void logs.push(row),
          spend: async () => {
            throw new Error("the insert failed");
          },
        },
        onSpendWritten: (event) => void heard.push(event),
        defer: (work) => void deferred.push(work),
        clock: () => Date.now(),
      });

      const { result } = await ask(search, PASHTO, "ps");

      expect(result).toMatchObject({ status: "ok" });
      expect(heard).toEqual([]);
    });
  });

  describe("a translation that is the question itself", () => {
    it("is logged not_needed, not failed, when the unchanged text passes the English check, and the direct leg answers alone", async () => {
      const model = fakeEmbedder();
      const words = fakeTranslator({ answer: (t) => t });

      const { result } = await ask(service({ embedder: model.embedder, translator: words.translator }), "Mujhe nearby free dental clinic batao");

      expect(result).toMatchObject({ status: "no_clear_match" });
      expect(model.calls.map((c) => c.text)).toEqual(["Mujhe nearby free dental clinic batao"]); // not embedded a second time
      expect(logs).toMatchObject([{ translatedLeg: "not_needed" }]);
      // The call was still billed.
      expect(spends).toContainEqual(expect.objectContaining({ kind: "translate", tokensEstimated: false }));
    });

    it("is still logged failed when the unchanged text is not English", async () => {
      await ask(service({ embedder: fakeEmbedder().embedder, translator: fakeTranslator({ answer: (t) => t }).translator }), ROMANIZED);

      expect(logs).toMatchObject([{ translatedLeg: "failed" }]);
    });
  });

  describe("the emergency fail-safe (owner decision 41)", () => {
    const run = (q: string, parts: Partial<Parameters<typeof service>[0]> = {}) => ask(service({ embedder: fakeEmbedder().embedder, ...parts }), q);

    it("sets emergency_first on a no_clear_match: an emergency provider at 0.27 with a threshold of 0.3, and the results stay empty", async () => {
      const { result } = await run("em just below");

      expect(result).toEqual({ v: 1, release_v: 3, query_lang: "en", status: "no_clear_match", emergency_first: true, results: [] });
      expect(logs).toMatchObject([{ status: "no_clear_match", resultCount: 0, topScore: null }]);
    });

    it("does not set it for a provider that is not an emergency one at 0.27", async () => {
      const { result } = await run("other just below");

      expect(result).toMatchObject({ status: "no_clear_match", emergency_first: false, results: [] });
    });

    it("does not set it for an emergency provider below the emergency-only threshold (0.24 against 0.25)", async () => {
      expect((await run("em too low")).result).toMatchObject({ status: "no_clear_match", emergency_first: false });
    });

    it("looks at the top 3 of a leg: an emergency provider fourth at 0.27 does not set it", async () => {
      expect((await run("em fourth")).result).toMatchObject({ status: "no_clear_match", emergency_first: false, results: [] });
    });

    it("holds when the translated leg alone qualifies (the direct leg finds nothing)", async () => {
      const words = fakeTranslator({ answer: () => "I need an ambulance" });

      const { result } = await run(PASHTO, { translator: words.translator });

      expect(result).toEqual({ v: 1, release_v: 3, query_lang: "ps", status: "no_clear_match", emergency_first: true, results: [] });
    });

    it("holds when the direct leg alone qualifies (the translated leg failed)", async () => {
      const { result } = await run("em just below", { translator: fakeTranslator({ fail: true }).translator });

      expect(result).toMatchObject({ status: "no_clear_match", emergency_first: true });
    });

    it("only turns the flag on: an emergency result that qualifies keeps it on though fourth in its leg", async () => {
      const { result } = await run("em fourth and clear");

      expect(result).toMatchObject({ status: "ok", emergency_first: true });
      expect((result as { results: { provider_id: string }[] }).results.map((h) => h.provider_id)).toContain("P2");
    });

    it("leaves emergency_first off for an ordinary result with no emergency provider near the top", async () => {
      expect((await run("I need a lawyer")).result).toMatchObject({ status: "ok", emergency_first: false });
    });

    it("takes the emergency-only threshold from config, and never uses one above the release's threshold", async () => {
      expect((await run("em too low", { emergencyThreshold: 0.2 })).result).toMatchObject({ emergency_first: true });
      expect((await run("em just below", { emergencyThreshold: 0.28 })).result).toMatchObject({ emergency_first: false });
      // A misconfigured 0.9 is held to the release's 0.3: 0.27 stays below it.
      expect((await run("em just below", { emergencyThreshold: 0.9 })).result).toMatchObject({ emergency_first: false });
    });
  });
});

// The request's deadline over the snapshot read (the database read of the current release, and the release's data, loaded
// or joined) and over the writes: whatever never answers, the search ends at the request's own deadline, and a load another
// request started is only waited for until then (it runs on for the searches after it). The read is the real one, over a
// fake database and a fake store (test/helpers/searchRelease.ts); time is vitest's fake clock.
describe("the request's deadline over the snapshot read and the writes", () => {
  let notes: SearchFailureNote[];
  let deferred: Promise<unknown>[];
  let embedCalls: number;

  beforeEach(() => {
    vi.useFakeTimers();
    notes = [];
    deferred = [];
    embedCalls = 0;
  });
  afterEach(() => vi.useRealTimers());

  /** The question's embedding: provider M001's axis after 100 ms; cancelled by its signal. */
  const embedder: QueryEmbedder = {
    embedQuery({ signal }) {
      embedCalls += 1;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ vector: [1, 0], tokens: 4 }), 100);
        signal.addEventListener("abort", () => (clearTimeout(timer), reject(new Error("aborted"))));
      });
    },
  };

  function service(parts: { db?: ReturnType<typeof releaseDb>; store?: ReturnType<typeof releaseStore>; writer?: SearchWriter; snapshotLoadTimeoutMs?: number; snapshotFailureTtlMs?: number }) {
    const db = parts.db ?? releaseDb();
    const store = parts.store ?? releaseStore();
    return createSearch({
      db: () => db.db,
      storage: () => store.storage,
      embedder,
      writer: parts.writer ?? { log: async () => undefined, spend: async () => undefined },
      defer: (work) => void deferred.push(work),
      onFailure: async (note) => void notes.push(note),
      snapshotLoadTimeoutMs: parts.snapshotLoadTimeoutMs,
      snapshotFailureTtlMs: parts.snapshotFailureTtlMs,
      clock: () => Date.now(),
    });
  }

  /** Starts a search now, on fake time, without moving the clock; `took` is when it settled, from its own start. */
  function start(search: SearchService, startedAgoMs = 0) {
    const started = Date.now() - startedAgoMs;
    let took = -1;
    let outcome: unknown;
    void search.search({ q: "lawyer", lang: "en", v: RELEASE_V }, started).then(
      (body) => ((outcome = body), (took = Date.now() - started)),
      (error: unknown) => ((outcome = error), (took = Date.now() - started)),
    );
    return { took: () => took, outcome: () => outcome };
  }

  const unavailable = { name: "SearchFailure", code: "search_unavailable" };

  it.each([
    ["never makes the connection", { connect: "never" as const }],
    ["never answers the read", { read: "never" as const }],
  ])("answers search_unavailable at 2.2 s when the database %s of the current release, calls no model and tells ops timed_out", async (_, behaviour) => {
    const store = releaseStore();
    const search = start(service({ db: releaseDb(behaviour), store }));

    await vi.advanceTimersByTimeAsync(10_000);

    expect(search.outcome()).toMatchObject(unavailable);
    expect(search.took()).toBe(DEFAULT_LEG_TIMEOUT_MS);
    expect(store.gets).toEqual([]);
    expect(embedCalls).toBe(0);
    expect(notes).toMatchObject([{ reason: "timed_out", releaseV: null }]);
  });

  it("gives the read of the current release a statement timeout of the time left to the deadline, and reads nothing once it is spent", async () => {
    const db = releaseDb();
    const search = start(service({ db }), 500);
    const late = releaseDb();
    const tooLate = start(service({ db: late }), 2300);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(db.statements).toEqual(["set local statement_timeout = 1700", "select current release"]);
    expect(search.outcome()).toMatchObject({ status: "ok", release_v: RELEASE_V });
    expect(late.transactions()).toBe(0);
    expect(tooLate.outcome()).toMatchObject(unavailable);
  });

  it("answers at 2.2 s when the store never answers the download, and a second search joins that download instead of starting another", async () => {
    const store = releaseStore({ never: true });
    const search = service({ store });

    const first = start(search);
    await vi.advanceTimersByTimeAsync(1500);
    const second = start(search);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(first.outcome()).toMatchObject(unavailable);
    expect(second.outcome()).toMatchObject(unavailable);
    expect(first.took()).toBe(DEFAULT_LEG_TIMEOUT_MS);
    expect(second.took()).toBe(DEFAULT_LEG_TIMEOUT_MS);
    expect(store.gets).toEqual([VECTORS_PATH]);
    expect(notes.map((n) => n.reason)).toEqual(["timed_out", "timed_out"]);
  });

  it("stops waiting for a load it joined at its own deadline, though the load would finish later, and the load still completes for the searches after it", async () => {
    // Each file takes 2 s: the load that starts with the first search ends at about 4 s.
    const store = releaseStore({ ms: 2000 });
    const search = service({ store });

    const first = start(search); // its deadline: 2.2 s
    await vi.advanceTimersByTimeAsync(500);
    const lessTime = start(search, 1000); // a request that began 1 s before it got here: its deadline is at 1.7 s
    await vi.advanceTimersByTimeAsync(2500);
    const joining = start(search); // at 3 s: joins the load, which ends within its time
    await vi.advanceTimersByTimeAsync(2000);
    const later = start(search); // at 5 s: the data is in memory
    await vi.advanceTimersByTimeAsync(5000);

    expect(first.outcome()).toMatchObject(unavailable);
    expect(first.took()).toBe(DEFAULT_LEG_TIMEOUT_MS);
    expect(lessTime.outcome()).toMatchObject(unavailable);
    expect(lessTime.took()).toBe(DEFAULT_LEG_TIMEOUT_MS); // 1.2 s after it joined, not when the load ended
    expect(joining.outcome()).toMatchObject({ status: "ok", release_v: RELEASE_V, results: [{ provider_id: "M001" }] });
    expect(joining.took()).toBeLessThan(1200);
    expect(later.outcome()).toMatchObject({ status: "ok", results: [{ provider_id: "M001" }] });
    expect(later.took()).toBeLessThan(200);
    expect(store.gets).toEqual([VECTORS_PATH, LISTING_PATH]); // one load, shared
    expect(notes.map((n) => n.reason)).toEqual(["timed_out", "timed_out"]);
  });

  it("gives up a load that never settles after SNAPSHOT_LOAD_TIMEOUT_MS: the searches after it fail at once for the failure TTL, then a new load starts", async () => {
    // Above the store's own worst case (bucket check, bucket creation, vectors and listing, each with its own timeout).
    expect(SNAPSHOT_LOAD_TIMEOUT_MS).toBeGreaterThan(4 * DEFAULT_STORAGE_TIMEOUT_MS);
    const store = releaseStore({ never: true });
    const search = service({ store, snapshotLoadTimeoutMs: 5000, snapshotFailureTtlMs: 10_000 });

    const first = start(search);
    await vi.advanceTimersByTimeAsync(6000);
    const meanwhile = start(search); // the load was given up at about 5 s: it failed a moment ago
    await vi.advanceTimersByTimeAsync(10_000);
    const after = start(search); // past the failure TTL: tried again
    await vi.advanceTimersByTimeAsync(10_000);

    expect(first.took()).toBe(DEFAULT_LEG_TIMEOUT_MS);
    expect(meanwhile.outcome()).toMatchObject(unavailable);
    expect(meanwhile.took()).toBeLessThan(100);
    expect(after.outcome()).toMatchObject(unavailable);
    expect(store.gets).toEqual([VECTORS_PATH, VECTORS_PATH]);
    // The search that failed at once is not told again.
    expect(notes.map((n) => n.reason)).toEqual(["timed_out", "timed_out"]);
  });

  it("answers by 2.4 s when the writes never finish, ahead of the route's hard deadline, and hands them to defer", async () => {
    const search = start(service({ writer: { log: never, spend: never } }));

    await vi.advanceTimersByTimeAsync(10_000);

    expect(search.outcome()).toMatchObject({ status: "ok", results: [{ provider_id: "M001" }] });
    expect(search.took()).toBe(DEFAULT_TOTAL_BUDGET_MS - ANSWER_MARGIN_MS);
    expect(deferred).toHaveLength(1);
  });
});
