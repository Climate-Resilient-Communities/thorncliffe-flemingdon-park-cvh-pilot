// The translated-question leg of search (S03.05), with fakes for the snapshot, the embedding model, the translation model
// and the rows: which questions get the leg, the ranking over both legs, every way the leg can fail, and the 2.2 s / 2.5 s
// time limits, the translation starting with the request (not after the snapshot), the vendor failures told to ops, and the
// emergency fail-safe. Time is vitest's fake clock: nothing here waits for real, so no timing here can be flaky. The database
// side (search_log.translated_leg, spend_event, the privacy marker) is in test/db/search.db.test.ts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQuestionTranslator, type QuestionRoute, type Translator } from "@/modules/translation";
import type { SpendEventInput } from "@/modules/spend";
import { detect } from "../domain/questionLanguage";
import type { QueryEmbedder } from "./ports";
import { SearchFailure, createSearch, questionSourceOf, type SearchDeps, type SearchFailureNote, type SearchLogRow, type SearchSnapshot } from "./search";

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
    onFailure?: SearchDeps["onFailure"];
    snapshotMs?: number;
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
      translator: parts.translator ? createQuestionTranslator({ translator: parts.translator, route: parts.route ?? ROUTE }) : null,
      snapshot: async () => {
        if (parts.snapshotMs) await new Promise<void>((resolve) => setTimeout(resolve, parts.snapshotMs));
        return SNAPSHOT;
      },
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
        { reason: "translate_failed", releaseV: 3, ms: 2200, answered: true },
        { reason: "timed_out", releaseV: 3, ms: 2200 },
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
      expect(notes).toEqual([{ reason: "translate_failed", releaseV: 3, ms: expect.any(Number), answered: true }]);
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
      expect(notes).toEqual([{ reason: "embed_failed", releaseV: 3, ms: expect.any(Number), answered: true }]);
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
