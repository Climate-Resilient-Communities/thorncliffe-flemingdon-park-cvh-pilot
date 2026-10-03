// scripts/search-test-set: asking the tuning questions of one leg setting through an engine, one at a time, and
// turning the answers into outcomes and a report (S03.07). The engine is production's search use case (productionEngine.ts);
// tests give it a fake. What this file adds to the generic runner (lib.ts `runQuestions`):
//
//  - Usage allowance: calls are paced (sequential, with a pause that keeps each vendor's calls under the trial key's per-minute
//    limits), counted against a call budget that is checked before each question with its worst case (its retry included), and the
//    run stops cleanly when the next question could pass it, or when the vendors keep refusing; the questions it did not ask are
//    `not_run` and the partial results are reported.
//  - A vendor failure is its own outcome. A question whose answer a vendor failure took a part of (a 429, any other failed call
//    that no fallback covered) is `rate_limited` or `vendor_error`, is left out of every rate, and is counted; it is never
//    scored as a miss.
//  - What each question saw (the similarity of every provider before the threshold) is kept, for the threshold's suggestion.
// Rows hold ids, scores and counts, never a question's text.
import type { SearchObservation } from "@/modules/directory";
import type { SearchV1, TestQuestion } from "@/contracts/searchTestSet";
import { SCORED_OUTCOMES, type LegReport, type TuningOutcome, type TuningRow, type VendorUsage } from "@/contracts/searchTuning";
import { measureSubset, type QuestionResult } from "./lib";
import type { QuestionPlan } from "./callPlan";
import { worstCalls } from "./callPlan";
import { maxSimilarity, suggestThreshold, type ThresholdInput } from "./threshold";
import type { QuestionTrace } from "./vendorMeter";

export type ReleaseFacts = { release: number; model: string; threshold: number };

/** What one question came to: the use case's answer (or the code it failed with), what it saw, and the vendor calls it made. */
export interface Asked {
  answer: SearchV1 | null;
  /** The code the search failed with (a SearchFailure code), never a message. */
  failure: string | null;
  observation: SearchObservation | null;
  trace: QuestionTrace;
  /** Milliseconds the use case took. */
  ms: number;
}

export interface TuningEngine {
  /** The current release this run measures: its number, the embedding model and the threshold it recorded. */
  facts: ReleaseFacts;
  /** Whether the release holds the provider. */
  has(id: string): Promise<boolean>;
  plan(question: TestQuestion): QuestionPlan;
  ask(question: TestQuestion): Promise<Asked>;
  /** The vendor calls so far, by kind and model. */
  usage(): VendorUsage;
  close(): Promise<void>;
}

/** The calls a run may make in all (every leg), checked before each question. */
export class CallBudget {
  private used = 0;
  constructor(readonly max: number) {}
  get made() {
    return this.used;
  }
  canAfford(calls: number) {
    return this.used + calls <= this.max;
  }
  spend(calls: number) {
    this.used += calls;
  }
}

/**
 * The default for --max-calls. The free trial key allows about 1,000 calls a month in all and live search shares it; a run of
 * both legs over the 155 tuning questions plans about 440 calls (embedding and translation together, 456 with every retry), so
 * this leaves the rest of the month to live search and is still enough for one full run of both. A run that needs more says so
 * in its plan, and stops at the cap.
 */
export const DEFAULT_MAX_CALLS = 500;

/**
 * The pause after a question, per call it made: Cohere's trial key allows 100 embedding calls and 20 chat calls a minute, so one
 * embedding every 0.7 s and one translation every 3.2 s stay under them with a margin. After a 429 the run waits a minute, for the
 * per-minute window to pass.
 */
export const DEFAULT_PACE = { embedGapMs: 700, translateGapMs: 3200, rateLimitBackoffMs: 60_000 } as const;
export type Pace = { embedGapMs: number; translateGapMs: number; rateLimitBackoffMs: number };

/** This many vendor failures in a row end the run (a monthly quota that is spent fails every call after it, and each call counts). */
export const MAX_CONSECUTIVE_VENDOR_FAILURES = 5;

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const round1 = (x: number) => Math.round(x * 10) / 10;
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * How the question came out. A vendor failure that took part of the answer away (any call that failed, except a call the search
 * cancelled at its own deadline, and except a translation that a fallback model then did) makes the question unscored.
 */
export function outcomeOf(question: Pick<TestQuestion, "expected">, asked: Asked): TuningOutcome {
  const failed = asked.trace.failures.filter((f) => f.class !== "aborted");
  const rescued = asked.observation?.translatedLeg === "used";
  const unrescued = rescued ? failed.filter((f) => f.kind !== "translation") : failed;
  if (unrescued.length > 0) return unrescued.some((f) => f.class === "limit") ? "rate_limited" : "vendor_error";
  const answer = asked.answer;
  if (!answer || answer.status === "unavailable") return "search_failed";
  if (answer.status === "no_clear_match") return "no_clear_match";
  return answer.results.some((r) => question.expected.includes(r.provider_id)) ? "hit" : "miss";
}

function rowOf(question: TestQuestion, outcome: TuningOutcome, asked: Asked | null): TuningRow {
  const seen = asked?.observation ?? null;
  const answer = asked?.answer ?? null;
  const expectedSimilarity: Record<string, number> = {};
  if (seen) {
    for (const id of question.expected) {
      const scores = seen.legs.flatMap((l) => (l.similarities.has(id) ? [l.similarities.get(id)!] : []));
      if (scores.length > 0) expectedSimilarity[id] = round6(Math.max(...scores));
    }
  }
  return {
    id: question.id,
    lang: question.lang,
    form: question.form,
    intent: question.intent,
    expected: [...question.expected],
    outcome,
    status: answer?.status ?? null,
    query_lang: answer?.query_lang ?? null,
    top: answer ? answer.results.map((r) => ({ provider_id: r.provider_id, score: r.score })) : [],
    legs_used: seen ? seen.legs.map((l) => l.leg) : [],
    translated_leg: seen?.translatedLeg ?? null,
    emergency_first: answer?.emergency_first ?? false,
    ms: asked ? round1(asked.ms) : null,
    max_similarity: seen && seen.legs.length > 0 ? round6(maxSimilarity(seen)) : null,
    expected_similarity: expectedSimilarity,
    calls: { embedding: asked?.trace.embedding ?? 0, translation: asked?.trace.translation ?? 0 },
    translation_models: asked?.trace.translationModels ?? [],
    failures: asked?.trace.failures ?? [],
  };
}

export interface LegRunOptions {
  budget: CallBudget;
  translatedLeg: boolean;
  sleep?: (ms: number) => Promise<void>;
  pace?: Partial<Pace>;
  /** Told after each question, for a progress line: the question's id and how it came out, never its text. */
  onQuestion?: (done: { id: string; outcome: TuningOutcome; index: number; of: number }) => void;
}

export interface LegRun {
  translatedLeg: boolean;
  rows: TuningRow[];
  /** The scored questions, as the generic report measures them. */
  scored: QuestionResult[];
  inputs: ThresholdInput[];
  stopped: "max_calls" | "vendor_failures" | null;
  usage: VendorUsage;
}

/** Asks the questions in order, one at a time. The caller passes the tuning questions only; this never looks at a split. */
export async function runLeg(questions: readonly TestQuestion[], engine: TuningEngine, options: LegRunOptions): Promise<LegRun> {
  const sleep = options.sleep ?? sleepFor;
  const pace: Pace = { ...DEFAULT_PACE, ...options.pace };
  const known = new Map<string, boolean>();
  for (const id of new Set(questions.flatMap((q) => q.expected))) known.set(id, await engine.has(id));

  const rows: TuningRow[] = [];
  const scored: QuestionResult[] = [];
  const inputs: ThresholdInput[] = [];
  let stopped: LegRun["stopped"] = null;
  let consecutiveFailures = 0;

  for (const [index, question] of questions.entries()) {
    const missing = question.expected.filter((id) => known.get(id) === false);
    const input = { id: question.id, intent: question.intent, expected: question.expected, unanswerable: question.intent !== "no_match" && missing.length === question.expected.length };
    if (stopped === null && !options.budget.canAfford(worstCalls(engine.plan(question)))) stopped = "max_calls";
    if (stopped !== null) {
      rows.push(rowOf(question, "not_run", null));
      inputs.push({ ...input, observation: null, answer: null });
      options.onQuestion?.({ id: question.id, outcome: "not_run", index, of: questions.length });
      continue;
    }

    const asked = await engine.ask(question);
    options.budget.spend(asked.trace.embedding + asked.trace.translation);
    const outcome = outcomeOf(question, asked);
    rows.push(rowOf(question, outcome, asked));
    const isScored = SCORED_OUTCOMES.includes(outcome);
    inputs.push({ ...input, observation: isScored ? asked.observation : null, answer: isScored ? asked.answer : null });
    if (isScored && asked.answer) {
      scored.push({ question, status: asked.answer.status, emergency_first: asked.answer.emergency_first, results: asked.answer.results, query_lang: asked.answer.query_lang, ms: asked.ms, missing });
    }
    options.onQuestion?.({ id: question.id, outcome, index, of: questions.length });

    const vendorFailure = outcome === "rate_limited" || outcome === "vendor_error";
    consecutiveFailures = vendorFailure ? consecutiveFailures + 1 : 0;
    if (consecutiveFailures >= MAX_CONSECUTIVE_VENDOR_FAILURES) {
      stopped = "vendor_failures";
      continue;
    }
    if (index < questions.length - 1) {
      const wait = outcome === "rate_limited" ? pace.rateLimitBackoffMs : Math.max(asked.trace.embedding * pace.embedGapMs, asked.trace.translation * pace.translateGapMs);
      if (wait > 0) await sleep(wait);
    }
  }
  return { translatedLeg: options.translatedLeg, rows, scored, inputs, stopped, usage: engine.usage() };
}

/** The report of one leg's run: counts by outcome, the aggregates over the scored questions, the usage and the threshold it suggests. */
export function legReport(run: LegRun, releaseThreshold: number): LegReport {
  const count = (outcome: TuningOutcome) => run.rows.filter((r) => r.outcome === outcome).length;
  const subset = measureSubset(run.scored);
  const leg = (name: "not_needed" | "used" | "failed" | "timed_out") => run.rows.filter((r) => r.translated_leg === name).length;
  return {
    translated_leg: run.translatedLeg,
    stopped: run.stopped,
    counts: {
      questions: run.rows.length,
      asked: run.rows.length - count("not_run"),
      scored: run.scored.length,
      hit: count("hit"),
      miss: count("miss"),
      no_clear_match: count("no_clear_match"),
      rate_limited: count("rate_limited"),
      vendor_error: count("vendor_error"),
      search_failed: count("search_failed"),
      not_run: count("not_run"),
    },
    translated_leg_counts: { not_needed: leg("not_needed"), used: leg("used"), failed: leg("failed"), timed_out: leg("timed_out") },
    fallback_translations: run.rows.filter((r) => r.translated_leg === "used" && r.translation_models.length > 1).length,
    aggregates: { overall: subset.overall, by_language: subset.by_language, by_language_kind: subset.by_language_kind },
    usage: run.usage,
    threshold_suggestion: suggestThreshold(run.inputs, releaseThreshold),
    rows: run.rows,
  };
}
