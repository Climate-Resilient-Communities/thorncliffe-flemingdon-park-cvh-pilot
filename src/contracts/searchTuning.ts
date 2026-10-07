// The report of a tuning run of the search test set against production's search use case (S03.07, FR-D2-Q, AR-15): what was
// asked, how each question came out, the vendor calls it took and the no-match threshold its scores suggest. Question ids,
// provider ids, scores and counts only: never a question's text (AD-3). The runner that writes it is scripts/search-test-set
// (production.ts); S03.08 and the follow-up that commits a run's report read it. Only zod is imported.
import { z } from "zod";
import { LangCodeSchema } from "./lang";
import { MetricsSchema, QUESTION_FORMS, QUESTION_INTENTS } from "./searchTestSet";

/**
 * How a question came out. `hit`, `miss` and `no_clear_match` are scored: the use case answered and, where the translated-question
 * leg was needed, it was not cut short by a vendor failure. A vendor failure is its own outcome and is never scored as a miss:
 * `rate_limited` (HTTP 429, a quota or a rate limit), `vendor_error` (any other failure of a vendor call), `search_failed` (the
 * use case could not answer and no vendor call failed: a deadline, a snapshot that did not load). `not_run` is a question the run
 * stopped before (the call cap, or repeated vendor failures).
 *
 * `hit`: an expected provider is among the results; `no_clear_match`: the use case answered that (the right answer to a
 * no_match question, a threshold loss on any other); `miss`: it answered with results that hold no expected provider, or with
 * results to a no_match question.
 */
export const TUNING_OUTCOMES = ["hit", "miss", "no_clear_match", "rate_limited", "vendor_error", "search_failed", "not_run"] as const;
export type TuningOutcome = (typeof TUNING_OUTCOMES)[number];
export const SCORED_OUTCOMES: readonly TuningOutcome[] = ["hit", "miss", "no_clear_match"];

const Count = z.number().int().min(0);

/** One call to a vendor that failed, as a class and the model it was made with: never the vendor's words. */
export const VendorFailureSchema = z.strictObject({
  kind: z.enum(["embedding", "translation"]),
  model: z.string().min(1),
  /**
   * `limit`: HTTP 429 that says it is transient (a per-minute limit); `quota`: HTTP 429 past the vendor's limit for the model, in
   * practice the month's, or one that does not say it is transient (the translation module's own classification, `classifyCohereError`);
   * `error`: any other failure; `aborted`: cancelled by the search's own deadline (not a vendor failure).
   */
  class: z.enum(["limit", "quota", "error", "aborted"]),
});
export type VendorFailure = z.infer<typeof VendorFailureSchema>;

export const TuningRowSchema = z.strictObject({
  id: z.string().min(1),
  lang: LangCodeSchema,
  form: z.enum(QUESTION_FORMS),
  intent: z.enum(QUESTION_INTENTS),
  /** The provider ids that answer the question (none for no_match). */
  expected: z.array(z.string().min(1)),
  outcome: z.enum(TUNING_OUTCOMES),
  /** The use case's answer; null when it did not answer. */
  status: z.enum(["ok", "no_clear_match", "unavailable"]).nullable(),
  query_lang: LangCodeSchema.nullable(),
  /** The results the use case returned (at the release's threshold), best first, each with its similarity. */
  top: z.array(z.strictObject({ provider_id: z.string().min(1), score: z.number() })),
  /** Which legs completed and fed the ranking. */
  legs_used: z.array(z.enum(["direct", "translated"])),
  /** What the translated-question leg did (`search_log.translated_leg`); null when the use case did not answer. */
  translated_leg: z.enum(["not_needed", "used", "failed", "timed_out"]).nullable(),
  emergency_first: z.boolean(),
  /** Milliseconds the use case took to answer (the runner's own pacing is not in it); null for a question that was not run. */
  ms: z.number().min(0).nullable(),
  /** The highest similarity of any provider in any leg, before the threshold; null when the use case did not answer. */
  max_similarity: z.number().nullable(),
  /** For each expected provider, its best similarity in any leg, before the threshold. */
  expected_similarity: z.record(z.string(), z.number()),
  /** The vendor calls this question made. */
  calls: z.strictObject({ embedding: Count, translation: Count }),
  /** The model of each translation call, in order (the routed model, then the fallback model when it was tried), so a run shows which model translated. */
  translation_models: z.array(z.string().min(1)),
  failures: z.array(VendorFailureSchema),
});
export type TuningRow = z.infer<typeof TuningRowSchema>;

const ModelUsageSchema = z.strictObject({
  /** Calls made, whatever came of them. */
  calls: Count,
  /** Of them: refused with HTTP 429 (a rate limit or the quota), failed otherwise, cancelled by the search's deadline (it may still have been billed). */
  rate_limited: Count,
  failed: Count,
  aborted: Count,
  /** Input (and, for a translation, output) tokens the vendor reported on the calls that answered, and the answered calls it did not report them for. */
  tokens: Count,
  unreported_calls: Count,
});
export type ModelUsage = z.infer<typeof ModelUsageSchema>;

const KindUsageSchema = ModelUsageSchema.extend({ by_model: z.record(z.string(), ModelUsageSchema) });
export type KindUsage = z.infer<typeof KindUsageSchema>;

/** The vendor calls of a run, as the vendor client saw them (so a call the search cancelled or a vendor refused is in it too). */
export const VendorUsageSchema = z.strictObject({ embedding: KindUsageSchema, translation: KindUsageSchema });
export type VendorUsage = z.infer<typeof VendorUsageSchema>;

/** What a threshold does to the tuning questions: the hits it keeps, the no-match questions it clears, the emergency flags it keeps. */
export const ThresholdEffectSchema = z.strictObject({
  threshold: z.number(),
  /** Hits (an expected provider among the results) kept, the hits lost against no threshold at all, and which questions they are. */
  hits_kept: Count,
  hits_lost: Count,
  lost_ids: z.array(z.string()),
  /** No-match questions answered `no_clear_match`. */
  no_match_clear: Count,
  /** Emergency questions with `emergency_first` on. */
  emergency_on: Count,
});
export type ThresholdEffect = z.infer<typeof ThresholdEffectSchema>;

/**
 * The threshold the scores suggest (S03.07's rule): the value that keeps every tuning no-match question below it while losing
 * the fewest hits. It suggests; it sets nothing. `threshold` is null, with the reason, when the scores cannot give one.
 *
 * Every value above the highest no-match similarity keeps the no-match questions below it, and the fewest hits are not always lost
 * by the lowest of them: with the translated-question leg on, raising the threshold can take a competing provider out of one leg,
 * which lowers its fused score and lets the expected provider back into the top five. So the suggestion is the best of the values
 * above it at which a question's top five can change: the fewest hits lost, then the most hits kept, then the lowest value. It is
 * `lowest_clearing` when nothing does better.
 */
export const ThresholdSuggestionSchema = z.strictObject({
  threshold: z.number().nullable(),
  reason: z.string().nullable(),
  no_match_questions: Count,
  /** The highest similarity of any provider to any no-match question: the suggestion is above it. */
  highest_no_match: z.number().nullable(),
  /** The lowest value, to four places, that keeps every no-match question below it: just above `highest_no_match`. */
  lowest_clearing: z.number().nullable(),
  /** The similarity of the weakest hit the suggestion keeps; null when it keeps none. */
  lowest_kept_hit: z.number().nullable(),
  /** `lowest_kept_hit` minus `highest_no_match`: how far the weakest kept hit stands above the highest no-match question. */
  hit_margin: z.number().nullable(),
  /** Questions that are not no_match and are answerable, and those of them that are a hit with no threshold at all. */
  answerable_questions: Count,
  hits_without_threshold: Count,
  at_suggested: ThresholdEffectSchema.nullable(),
  /** What `lowest_clearing` does, to compare with the suggestion (the same as `at_suggested` when they are the same value). */
  at_lowest_clearing: ThresholdEffectSchema.nullable(),
  at_release: ThresholdEffectSchema,
  /** Questions where ranking at the release's threshold again, with the use case's own function, gave another answer than the use case did. Always 0 unless something is wrong. */
  replay_mismatches: Count,
});
export type ThresholdSuggestion = z.infer<typeof ThresholdSuggestionSchema>;

export const LegReportSchema = z.strictObject({
  /** The translated-question leg setting this run used. */
  translated_leg: z.boolean(),
  /**
   * Why the run stopped before its last question; null when it asked them all. `max_calls`: the next question could pass the cap;
   * `quota`: a vendor refused a call as past its monthly limit; `vendor_failures`: calls kept being refused or failing, in a row;
   * `search_failures`: the search itself kept failing, in a row (a deadline, the database, the bucket).
   */
  stopped: z.enum(["max_calls", "quota", "vendor_failures", "search_failures"]).nullable(),
  counts: z.strictObject({
    questions: Count,
    asked: Count,
    scored: Count,
    hit: Count,
    miss: Count,
    no_clear_match: Count,
    rate_limited: Count,
    vendor_error: Count,
    search_failed: Count,
    not_run: Count,
  }),
  /** What the translated-question leg did for the questions that were answered. */
  translated_leg_counts: z.strictObject({ not_needed: Count, used: Count, failed: Count, timed_out: Count }),
  /** Of the questions the translated leg was used for, those a fallback model translated after the routed model was refused (SEARCH_QUESTION_FALLBACK, as production does). */
  fallback_translations: Count,
  /** Hit rates, no-match and emergency accuracy and the time per question, over the scored questions only. */
  aggregates: z.strictObject({
    overall: MetricsSchema,
    by_language: z.record(z.string(), MetricsSchema),
    by_language_kind: z.record(z.string(), MetricsSchema),
  }),
  /**
   * The time per question over every question that was asked, scored or not. The questions that failed at the search's deadline are
   * the slowest, and the aggregates above leave them out. `search_failed` counts the asked questions that ended with that outcome.
   */
  time_asked: z.strictObject({ questions: Count, p50: z.number().min(0).nullable(), p95: z.number().min(0).nullable(), search_failed: Count }),
  usage: VendorUsageSchema,
  threshold_suggestion: ThresholdSuggestionSchema,
  rows: z.array(TuningRowSchema),
});
export type LegReport = z.infer<typeof LegReportSchema>;

const RouteSchema = z.record(z.string(), z.string().nullable());

export const TuningReportSchema = z.strictObject({
  v: z.literal(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  split: z.literal("tuning"),
  release: z.number().int().min(0),
  model: z.string().min(1),
  /** The no-match threshold the release recorded: the one the run measured (the suggestion is a different value). */
  release_threshold: z.number(),
  /** sha256 (hex) of data/search-test-set/questions.jsonl as it was run. */
  questions_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** The search settings of the run, as production resolves them from the same variables. */
  settings: z.strictObject({
    question_route: RouteSchema,
    question_fallback: RouteSchema,
    fallback_min_budget_ms: z.number().int().min(0),
    emergency_threshold: z.number(),
    /** The ranking's search-time settings (interim tuning, 2026-10-07); absent from reports made before it. */
    emergency_top_threshold: z.number().optional(),
    keyword_weight: z.number().optional(),
    direct_floor: z.number().optional(),
    direct_gap: z.number().optional(),
  }),
  max_calls: z.number().int().min(1),
  /** Vendor calls made, over all legs. */
  calls_made: Count,
  legs: z.strictObject({ off: LegReportSchema.nullable(), on: LegReportSchema.nullable() }),
});
export type TuningReport = z.infer<typeof TuningReportSchema>;
