// The tuning run of the search test set against production's search use case (S03.07), with a fake engine in place of the
// use case: the threshold rule, the aggregates and percentiles, the usage allowance (the call plan, --yes, the cap, the pace),
// vendor failures as their own outcome, the evaluation subset's refusal, and the command line end to end (reports written,
// nothing of a question's text in any of them, secrets never printed). The production engine itself, over the real use case,
// is test/search-test-set-engine.test.ts.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emergencyFirst, emergencyInTop, rankLegs, type SearchObservation } from "@/modules/directory";
import { TestSetReportSchema, type SearchV1, type TestQuestion } from "@/contracts/searchTestSet";
import { TuningReportSchema, ThresholdSuggestionSchema, type VendorFailure, type VendorUsage } from "@/contracts/searchTuning";
import { DEFAULT_SEARCH_SETTINGS } from "@/platform/config/env";
import { formatPlan, planLeg, planQuestion, planningTranslator, worstCalls, type QuestionPlan } from "../scripts/search-test-set/callPlan";
import { percentile } from "../scripts/search-test-set/lib";
import { EVALUATION_REFUSAL, checkSplit, parseProductionOptions, resolveProductionEnv, resolveSearchSettings, runProduction, type ProductionRunDeps } from "../scripts/search-test-set/production";
import { justAbove, suggestThreshold, type ThresholdInput } from "../scripts/search-test-set/threshold";
import { markdownSummary } from "../scripts/search-test-set/tuningSummary";
import {
  CallBudget,
  DEFAULT_MAX_CALLS,
  DEFAULT_PACE,
  MAX_CONSECUTIVE_VENDOR_FAILURES,
  legReport,
  outcomeOf,
  runLeg,
  type Asked,
  type TuningEngine,
} from "../scripts/search-test-set/tuningRun";

const temp: string[] = [];
afterAll(() => {
  for (const dir of temp) rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cvh-tuning-"));
  temp.push(dir);
  return dir;
};

// --- fakes -----------------------------------------------------------------------------------------

const NO_CALLS = { embedding: 1, translation: 0, translationModels: [] as string[], failures: [] as VendorFailure[] };
const emptyKind = () => ({ calls: 0, rate_limited: 0, failed: 0, aborted: 0, tokens: 0, unreported_calls: 0, by_model: {} });
const EMPTY_USAGE: VendorUsage = { embedding: emptyKind(), translation: emptyKind() };

/** What the use case would have seen and answered for a question whose direct leg (and translated leg) have these similarities. */
function seen(sims: Record<string, number>, o: { translated?: Record<string, number>; threshold?: number; emergency?: string[]; emergencyThreshold?: number } = {}) {
  const threshold = o.threshold ?? 0.3;
  const emergencyThreshold = o.emergencyThreshold ?? 0.25;
  const emergencyProviders = new Set(o.emergency ?? ["M002"]);
  const legs: SearchObservation["legs"] = [{ leg: "direct", similarities: new Map(Object.entries(sims)) }];
  if (o.translated) legs.push({ leg: "translated", similarities: new Map(Object.entries(o.translated)) });
  const maps = legs.map((l) => l.similarities);
  const results = rankLegs(maps, threshold);
  const emergency = emergencyFirst(results, emergencyProviders) || emergencyInTop(maps, emergencyProviders, Math.min(emergencyThreshold, threshold));
  const answer: SearchV1 = { v: 1, release_v: 7, query_lang: "en", status: results.length === 0 ? "no_clear_match" : "ok", emergency_first: emergency, results };
  const observation: SearchObservation = { releaseV: 7, threshold, emergencyThreshold, emergencyProviders, translatedLeg: o.translated ? "used" : "not_needed", legs };
  return { answer, observation };
}

function asked(sims: Record<string, number>, o: Parameters<typeof seen>[1] & { ms?: number; calls?: Partial<Asked["trace"]> } = {}): Asked {
  const { ms, calls, ...rest } = o;
  return { ...seen(sims, rest), failure: null, trace: { ...NO_CALLS, ...calls }, ms: ms ?? 100 };
}

/** A search that failed: no answer, and the vendor calls that failed. */
const failed = (failures: VendorFailure[], calls: Partial<Asked["trace"]> = {}): Asked => ({
  answer: null,
  failure: "search_unavailable",
  observation: null,
  trace: { ...NO_CALLS, failures, ...calls },
  ms: 50,
});

const PLAN: QuestionPlan = { embeddings: 1, translations: 0, retries: 0, model: null, fallbackModel: null };

function q(id: string, over: Partial<TestQuestion> = {}): TestQuestion {
  return { id, lang: "en", q: `text of ${id}`, form: "native", intent: "normal", expected: ["M001"], split: "tuning", author: "dev-agent", added: "2026-10-02", checked_by: null, checked_on: null, ...over };
}
const noMatch = (id: string, over: Partial<TestQuestion> = {}) => q(id, { intent: "no_match", expected: [], ...over });

function fakeEngine(script: (question: TestQuestion, n: number) => Asked, over: Partial<TuningEngine> = {}) {
  const log: string[] = [];
  let closed = false;
  const engine: TuningEngine & { log: string[]; closed: () => boolean } = {
    facts: { release: 7, model: "embed-v4.0", threshold: 0.3 },
    has: async () => true,
    plan: () => PLAN,
    ask: async (question) => {
      log.push(question.id);
      return script(question, log.length - 1);
    },
    usage: () => EMPTY_USAGE,
    close: async () => void (closed = true),
    ...over,
    log,
    closed: () => closed,
  };
  return engine;
}

const noSleep = async () => undefined;
const budget = (max = 1000) => new CallBudget(max);

// --- the threshold rule ----------------------------------------------------------------------------

/** A scored question for the rule, as the run builds it. */
function input(id: string, intent: ThresholdInput["intent"], sims: Record<string, number>, expected: string[] = [], over: { unanswerable?: boolean; translated?: Record<string, number>; threshold?: number } = {}): ThresholdInput {
  const { answer, observation } = seen(sims, { translated: over.translated, threshold: over.threshold });
  return { id, intent, expected, unanswerable: over.unanswerable ?? false, observation, answer };
}
const hit = (id: string, score: number, others: Record<string, number> = {}) => input(id, "normal", { M001: score, M003: 0.05, ...others }, ["M001"]);
const none = (id: string, score: number) => input(id, "no_match", { M001: score, M003: 0.05 });

describe("the threshold rule", () => {
  it("keeps every no-match question below it and loses the fewest hits: the lowest value, to four places, strictly above the highest no-match similarity", () => {
    const s = suggestThreshold([none("n1", 0.4), none("n2", 0.35), hit("h1", 0.9), hit("h2", 0.8), hit("h3", 0.5), hit("h4", 0.38)], 0.3);

    expect(s.threshold).toBe(0.4001);
    expect(s.reason).toBeNull();
    expect(s.no_match_questions).toBe(2);
    expect(s.highest_no_match).toBe(0.4);
    expect(s.answerable_questions).toBe(4);
    expect(s.hits_without_threshold).toBe(4);
    expect(s.at_suggested).toEqual({ threshold: 0.4001, hits_kept: 3, hits_lost: 1, lost_ids: ["h4"], no_match_clear: 2, emergency_on: 0 });
  });

  it("reports the margin: the room between the highest no-match similarity and the weakest hit the suggestion keeps", () => {
    const s = suggestThreshold([none("n1", 0.4), hit("h1", 0.9), hit("h3", 0.5), hit("h4", 0.38)], 0.3);

    expect(s.lowest_kept_hit).toBe(0.5);
    expect(s.hit_margin).toBe(0.1);
  });

  it("says what the release's own threshold does to the same questions, to compare", () => {
    const s = suggestThreshold([none("n1", 0.4), none("n2", 0.1), hit("h1", 0.9), hit("h4", 0.38)], 0.3);

    // At 0.3 the no-match question at 0.4 is answered (not cleared), the one at 0.1 is cleared, both hits are kept.
    expect(s.at_release).toEqual({ threshold: 0.3, hits_kept: 2, hits_lost: 0, lost_ids: [], no_match_clear: 1, emergency_on: 0 });
    expect(s.at_suggested).toMatchObject({ hits_kept: 1, hits_lost: 1, lost_ids: ["h4"], no_match_clear: 2 });
  });

  it("handles ties: several no-match questions at the same highest similarity count once, and a hit that ties with that similarity is lost, because a provider qualifies at the threshold and the value is above it", () => {
    const s = suggestThreshold([none("n1", 0.4), none("n2", 0.4), none("n3", 0.2), hit("tie", 0.4), hit("h1", 0.7), hit("h2", 0.7)], 0.3);

    expect(s.threshold).toBe(0.4001);
    expect(s.highest_no_match).toBe(0.4);
    expect(s.at_suggested).toMatchObject({ hits_kept: 2, hits_lost: 1, lost_ids: ["tie"], no_match_clear: 3 });
  });

  it("rounds up to four places and never to the highest value itself", () => {
    expect(justAbove(0.4)).toBe(0.4001);
    expect(justAbove(0.40004)).toBe(0.4001);
    expect(justAbove(0.39999)).toBe(0.4);
    expect(justAbove(0.3)).toBe(0.3001);
    expect(justAbove(0)).toBe(0.0001);
    for (const x of [0.123456, 0.5, 0.99995, 0.2999999999]) expect(justAbove(x)).toBeGreaterThan(x);
  });

  it("gives no threshold, and says why, when the run has no no-match question (the hits at the release's threshold are still counted)", () => {
    const s = suggestThreshold([hit("h1", 0.9), hit("h2", 0.2)], 0.3);

    expect(s).toMatchObject({ threshold: null, reason: "the run has no no-match question", no_match_questions: 0, highest_no_match: null, at_suggested: null, hit_margin: null });
    expect(s.at_release).toMatchObject({ hits_kept: 1, hits_lost: 1, lost_ids: ["h2"] });
  });

  it("gives no threshold when a no-match question was not scored (a vendor failure, a stopped run): its similarity is unknown, so nothing can be promised", () => {
    const missing: ThresholdInput = { id: "n2", intent: "no_match", expected: [], unanswerable: false, observation: null, answer: null };
    const s = suggestThreshold([none("n1", 0.4), missing, hit("h1", 0.9)], 0.3);

    expect(s.threshold).toBeNull();
    expect(s.reason).toMatch(/1 of 2 no-match questions were not scored/);
    expect(s.highest_no_match).toBe(0.4);
  });

  it("still gives a threshold when it is the answerable questions that were not scored: they are left out, not counted as lost hits", () => {
    const missing: ThresholdInput = { id: "h9", intent: "normal", expected: ["M001"], unanswerable: false, observation: null, answer: null };
    const s = suggestThreshold([none("n1", 0.4), missing, hit("h1", 0.9)], 0.3);

    expect(s.threshold).toBe(0.4001);
    expect(s.answerable_questions).toBe(1);
    expect(s.at_suggested).toMatchObject({ hits_kept: 1, hits_lost: 0 });
  });

  it("says so, and keeps no hit, when every hit is below the highest no-match similarity (all hits below it)", () => {
    const s = suggestThreshold([none("n1", 0.6), hit("h1", 0.5), hit("h2", 0.4), hit("h3", 0.31)], 0.3);

    expect(s.threshold).toBe(0.6001);
    expect(s.at_suggested).toMatchObject({ hits_kept: 0, hits_lost: 3, lost_ids: ["h1", "h2", "h3"], no_match_clear: 1 });
    expect(s.lowest_kept_hit).toBeNull();
    expect(s.hit_margin).toBeNull();
  });

  it("gives no threshold when no value up to 1 is above the highest no-match similarity", () => {
    const s = suggestThreshold([input("n1", "no_match", { M001: 1, M003: 0 }), hit("h1", 0.9)], 0.3);

    expect(s.threshold).toBeNull();
    expect(s.reason).toMatch(/no threshold up to 1 is above it/);
  });

  it("looks at a question's best similarity over both legs, and ranks with the use case's own function (RRF over the qualifying providers)", () => {
    // The translated leg finds what the direct one does not: the no-match question scores 0.45 there.
    const twoLegs = input("n1", "no_match", { M001: 0.1, M003: 0.05 }, [], { translated: { M001: 0.45, M003: 0.05 } });
    const s = suggestThreshold([twoLegs, hit("h1", 0.9)], 0.3);

    expect(s.highest_no_match).toBe(0.45);
    expect(s.threshold).toBe(0.4501);
  });

  it("leaves a question whose expected providers are all missing from the release out of the hits (it can never be one)", () => {
    const s = suggestThreshold([none("n1", 0.4), input("gone", "normal", { M001: 0.1 }, ["M999"], { unanswerable: true }), hit("h1", 0.9)], 0.3);

    expect(s.answerable_questions).toBe(1);
    expect(s.hits_without_threshold).toBe(1);
    expect(s.at_suggested!.lost_ids).toEqual([]);
  });

  it("counts the emergency flags that stay on: the fail-safe holds an emergency provider in a leg's top three at the emergency-only threshold even when the threshold rises", () => {
    const strong = input("e1", "emergency", { M002: 0.9, M001: 0.1, M003: 0.05 }, ["M002"]);
    const weak = input("e2", "emergency", { M002: 0.27, M001: 0.1, M003: 0.05 }, ["M002"]); // below the release's 0.3, above the emergency-only 0.25
    const lost = input("e3", "emergency", { M002: 0.2, M001: 0.1, M003: 0.05 }, ["M002"]); // below both: never flagged
    const s = suggestThreshold([none("n1", 0.5), strong, weak, lost], 0.3);

    expect(s.at_release.emergency_on).toBe(2);
    expect(s.at_suggested!.emergency_on).toBe(2);
  });

  it("replays the use case's ranking at the release's threshold and counts the questions where it does not give the use case's answer", () => {
    const good = hit("h1", 0.9);
    const drifted: ThresholdInput = { ...hit("h2", 0.9), answer: { results: [{ provider_id: "M003", score: 0.9 }], emergency_first: false } };
    const flagged: ThresholdInput = { ...hit("h3", 0.9), answer: { ...hit("h3", 0.9).answer!, emergency_first: true } };

    expect(suggestThreshold([none("n1", 0.4), good], 0.3).replay_mismatches).toBe(0);
    expect(suggestThreshold([none("n1", 0.4), good, drifted, flagged], 0.3).replay_mismatches).toBe(2);
  });

  it("is a valid ThresholdSuggestion whatever it says", () => {
    for (const inputs of [[none("n1", 0.4), hit("h1", 0.9)], [hit("h1", 0.9)], []]) {
      expect(ThresholdSuggestionSchema.safeParse(suggestThreshold(inputs, 0.3)).success).toBe(true);
    }
  });

  it("is minimal and loses the fewest hits, whatever the scores (checked against every four-place value, on seeded random runs)", () => {
    let seed = 20261003;
    const random = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const level = () => Math.round(random() * 1000) / 1000;
    for (let run = 0; run < 40; run++) {
      const inputs: ThresholdInput[] = [];
      for (let i = 0; i < 6; i++) inputs.push(none(`n${i}`, level()));
      for (let i = 0; i < 10; i++) inputs.push(hit(`h${i}`, level()));
      const s = suggestThreshold(inputs, 0.3);
      expect(s.threshold).not.toBeNull();
      const t = s.threshold!;
      const effect = (value: number) => suggestThreshold(inputs, value).at_release;
      // No lower value clears every no-match question: the hundredths below it, and the three four-place values just under it ...
      const lower = [...Array.from({ length: Math.floor(t * 100) }, (_, i) => i / 100), t - 0.0001, t - 0.0002, t - 0.0003].map((c) => Math.round(c * 1e4) / 1e4).filter((c) => c >= 0 && c < t);
      for (const c of lower) expect(effect(c).no_match_clear, `run ${run} at ${c}`).toBeLessThan(6);
      // ... and no value that does clear them loses fewer hits.
      expect(effect(t).no_match_clear).toBe(6);
      for (let c = t; c <= 1; c = Math.round((c + 0.01) * 1e4) / 1e4) {
        expect(effect(c).hits_lost, `run ${run} at ${c}`).toBeGreaterThanOrEqual(effect(t).hits_lost);
      }
      expect(effect(t).hits_lost).toBe(s.at_suggested!.hits_lost);
    }
  });
});

// --- the outcomes, the aggregates, the percentiles ---------------------------------------------------

describe("outcomes and aggregates", () => {
  it("scores a question a hit when an expected provider is among the results, no_clear_match when the use case says so, and miss otherwise (a no_match question answered with results is a miss)", () => {
    expect(outcomeOf(q("a"), asked({ M001: 0.9, M003: 0.05 }))).toBe("hit");
    expect(outcomeOf(q("b"), asked({ M001: 0.1, M003: 0.05 }))).toBe("no_clear_match");
    expect(outcomeOf(q("c"), asked({ M001: 0.1, M003: 0.9 }))).toBe("miss");
    expect(outcomeOf(noMatch("d"), asked({ M001: 0.9 }))).toBe("miss");
    expect(outcomeOf(noMatch("e"), asked({ M001: 0.1 }))).toBe("no_clear_match");
  });

  it("builds the per-question rows: id, language, form, expected providers, the top results with scores, outcome, emergency_first, the legs, the time", async () => {
    const questions = [q("en-01", { lang: "en", form: "native" }), q("ur-01", { lang: "ur", form: "romanized", expected: ["M002"], intent: "emergency" })];
    const engine = fakeEngine((question) =>
      question.id === "en-01" ? asked({ M001: 0.9, M003: 0.05 }, { ms: 120.44 }) : asked({ M002: 0.1, M001: 0.1 }, { translated: { M002: 0.8, M001: 0.1 }, ms: 640, calls: { embedding: 2, translation: 1 } }),
    );

    const run = await runLeg(questions, engine, { budget: budget(), translatedLeg: true, sleep: noSleep });

    expect(run.rows[0]).toEqual({
      id: "en-01",
      lang: "en",
      form: "native",
      intent: "normal",
      expected: ["M001"],
      outcome: "hit",
      status: "ok",
      query_lang: "en",
      top: [{ provider_id: "M001", score: 0.9 }],
      legs_used: ["direct"],
      translated_leg: "not_needed",
      emergency_first: false,
      ms: 120.4,
      max_similarity: 0.9,
      expected_similarity: { M001: 0.9 },
      calls: { embedding: 1, translation: 0 },
      translation_models: [],
      failures: [],
    });
    expect(run.rows[1]).toMatchObject({ id: "ur-01", form: "romanized", outcome: "hit", emergency_first: true, legs_used: ["direct", "translated"], translated_leg: "used", ms: 640, calls: { embedding: 2, translation: 1 } });
    expect(run.rows[1]!.top).toEqual([{ provider_id: "M002", score: 0.8 }]);
    expect(run.rows[1]!.expected_similarity).toEqual({ M002: 0.8 });
  });

  it("reports hit rate per language, no-match accuracy, emergency accuracy, and p50 and p95 per question, over the questions that were scored", async () => {
    const questions: TestQuestion[] = [];
    const answers = new Map<string, Asked>();
    // Twenty English questions of 10, 20 ... 200 ms: 18 hits, one miss, one no_clear_match.
    for (let i = 1; i <= 20; i++) {
      const id = `en-${String(i).padStart(2, "0")}`;
      questions.push(q(id));
      answers.set(id, i === 19 ? asked({ M001: 0.1, M003: 0.9 }, { ms: i * 10 }) : i === 20 ? asked({ M001: 0.1, M003: 0.05 }, { ms: i * 10 }) : asked({ M001: 0.9, M003: 0.05 }, { ms: i * 10 }));
    }
    // Two Urdu questions: one hit, one no-match answered right; one emergency question flagged, one not.
    questions.push(q("ur-01", { lang: "ur" }), noMatch("ur-02", { lang: "ur" }), q("ur-03", { lang: "ur", intent: "emergency", expected: ["M002"] }), q("ur-04", { lang: "ur", intent: "emergency", expected: ["M002"] }));
    answers.set("ur-01", asked({ M001: 0.7, M003: 0.05 }, { ms: 5 }));
    answers.set("ur-02", asked({ M001: 0.1, M003: 0.05 }, { ms: 6 }));
    answers.set("ur-03", asked({ M002: 0.9, M001: 0.1 }, { ms: 7 }));
    answers.set("ur-04", asked({ M002: 0.1, M001: 0.1 }, { ms: 8 }));
    // A question refused with a 429, and slow: it is in no rate and no time.
    questions.push(q("en-21"));
    answers.set("en-21", failed([{ kind: "embedding", model: "embed-v4.0", class: "limit" }]));
    const engine = fakeEngine((question) => answers.get(question.id)!);

    const report = legReport(await runLeg(questions, engine, { budget: budget(), translatedLeg: false, sleep: noSleep }), 0.3);

    expect(report.counts).toEqual({ questions: 25, asked: 25, scored: 24, hit: 20, miss: 1, no_clear_match: 3, rate_limited: 1, vendor_error: 0, search_failed: 0, not_run: 0 });
    const en = report.aggregates.by_language.en!;
    expect(en.questions).toBe(20);
    expect(en.top3).toEqual({ hits: 18, of: 20, rate: 0.9 });
    expect(en.top5).toEqual({ hits: 18, of: 20, rate: 0.9 });
    expect(en.time_ms).toEqual({ p50: 100, p95: 190 }); // nearest rank over 10..200 ms
    const ur = report.aggregates.by_language.ur!;
    expect(ur.top3).toEqual({ hits: 2, of: 3, rate: 0.6667 }); // ur-01, ur-03 and ur-04 are scored for hits; ur-04's 0.1 is below the threshold
    expect(report.aggregates.overall.no_match).toEqual({ hits: 1, of: 1, rate: 1 });
    expect(report.aggregates.overall.emergency).toEqual({ hits: 1, of: 2, rate: 0.5 });
    expect(report.aggregates.overall.questions).toBe(24);
  });

  it("takes nearest-rank percentiles (the runner's own, not an interpolation)", () => {
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(percentile([10, 20, 30, 40], 95)).toBe(40);
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([], 50)).toBeNull();
    expect(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 95)).toBe(95);
  });

  it("counts what the translated-question leg did for the questions that were answered", async () => {
    const answers = [asked({ M001: 0.9 }), asked({ M001: 0.9 }, { translated: { M001: 0.9 } }), { ...asked({ M001: 0.9 }), observation: { ...asked({ M001: 0.9 }).observation!, translatedLeg: "timed_out" as const } }];
    const engine = fakeEngine((_question, n) => answers[n]!);

    const report = legReport(await runLeg([q("a"), q("b"), q("c")], engine, { budget: budget(), translatedLeg: true, sleep: noSleep }), 0.3);

    expect(report.translated_leg_counts).toEqual({ not_needed: 1, used: 1, failed: 0, timed_out: 1 });
  });

  it("reports the vendor usage by model, as the engine counted it, and a report that is valid whatever the run was", async () => {
    const usage: VendorUsage = {
      embedding: { calls: 3, rate_limited: 0, failed: 0, aborted: 0, tokens: 21, unreported_calls: 0, by_model: { "embed-v4.0": { calls: 3, rate_limited: 0, failed: 0, aborted: 0, tokens: 21, unreported_calls: 0 } } },
      translation: { calls: 1, rate_limited: 1, failed: 0, aborted: 0, tokens: 0, unreported_calls: 0, by_model: { "north-small-translate-09-2026": { calls: 1, rate_limited: 1, failed: 0, aborted: 0, tokens: 0, unreported_calls: 0 } } },
    };
    const engine = fakeEngine(() => asked({ M001: 0.9 }), { usage: () => usage });

    const report = legReport(await runLeg([q("a")], engine, { budget: budget(), translatedLeg: true, sleep: noSleep }), 0.3);

    expect(report.usage).toEqual(usage);
  });

  it("measures an empty run without failing: no question was scored, so no rate", async () => {
    const report = legReport(await runLeg([], fakeEngine(() => asked({})), { budget: budget(), translatedLeg: false, sleep: noSleep }), 0.3);

    expect(report.counts.questions).toBe(0);
    expect(report.aggregates.overall.top3.rate).toBeNull();
    expect(report.threshold_suggestion.threshold).toBeNull();
  });
});

// --- a vendor failure is its own outcome --------------------------------------------------------------

const limit = (kind: VendorFailure["kind"] = "embedding"): VendorFailure => ({ kind, model: "m", class: "limit" });
const broken = (kind: VendorFailure["kind"] = "embedding"): VendorFailure => ({ kind, model: "m", class: "error" });

describe("a 429 or a vendor error", () => {
  it("is reported as its own outcome and counted, never scored as a miss: out of every rate, and the hits and the misses are only the questions that were answered", async () => {
    const script: Record<string, Asked> = {
      a: asked({ M001: 0.9 }),
      b: failed([limit()]),
      c: failed([broken()]),
      d: asked({ M001: 0.1 }), // an answer: no_clear_match
      e: failed([]), // the search failed and no vendor call did: a deadline, a snapshot that did not load
    };
    const engine = fakeEngine((question) => script[question.id]!);

    const run = await runLeg(Object.keys(script).map((id) => q(id)), engine, { budget: budget(), translatedLeg: false, sleep: noSleep });
    const report = legReport(run, 0.3);

    expect(run.rows.map((r) => r.outcome)).toEqual(["hit", "rate_limited", "vendor_error", "no_clear_match", "search_failed"]);
    expect(report.counts).toMatchObject({ scored: 2, hit: 1, miss: 0, no_clear_match: 1, rate_limited: 1, vendor_error: 1, search_failed: 1 });
    expect(report.aggregates.overall.top3).toEqual({ hits: 1, of: 2, rate: 0.5 });
    expect(report.aggregates.overall.error_count).toBe(0);
  });

  it("makes a question whose translation was refused unscored even though the direct leg answered: its answer is the leg-off answer, which would look like a miss", () => {
    const question = q("ps-01", { lang: "ps" });
    const answer = asked({ M001: 0.1, M003: 0.05 }, { calls: { embedding: 1, translation: 1, failures: [limit("translation")] } });
    const withFailedLeg = { ...answer, observation: { ...answer.observation!, translatedLeg: "failed" as const } };

    expect(outcomeOf(question, withFailedLeg)).toBe("rate_limited");
  });

  it("scores a question whose routed model was refused but whose fallback model did the leg, and counts the 429", async () => {
    const question = q("ps-01", { lang: "ps" });
    const rescued = asked({ M001: 0.1, M003: 0.05 }, { translated: { M001: 0.9, M003: 0.05 }, calls: { embedding: 2, translation: 2, translationModels: ["north", "command-a"], failures: [limit("translation")] } });
    const engine = fakeEngine(() => rescued, { usage: () => ({ ...EMPTY_USAGE }) });

    const run = await runLeg([question], engine, { budget: budget(), translatedLeg: true, sleep: noSleep });

    expect(run.rows[0]).toMatchObject({ outcome: "hit", translated_leg: "used", failures: [limit("translation")] });
    expect(run.scored).toHaveLength(1);
    expect(legReport(run, 0.3).fallback_translations).toBe(1);
  });

  it("does not take a failure of an embedding as rescued by a translation that worked: the answer came from one leg only", () => {
    const answer = asked({ M001: 0.9 }, { translated: { M001: 0.9 }, calls: { embedding: 2, translation: 1, failures: [limit("embedding")] } });

    expect(outcomeOf(q("a"), answer)).toBe("rate_limited");
  });

  it("does not take a call the search cancelled at its own deadline for a vendor failure: that is the leg timing out, which production does too", () => {
    const answer = asked({ M001: 0.9 }, { calls: { embedding: 1, translation: 1, failures: [{ kind: "translation", model: "m", class: "aborted" }] } });
    const timedOut = { ...answer, observation: { ...answer.observation!, translatedLeg: "timed_out" as const } };

    expect(outcomeOf(q("a"), timedOut)).toBe("hit");
  });

  it("waits longer after a 429, for the per-minute window, and stops the run after repeated vendor failures, keeping the partial results and not asking the rest", async () => {
    const sleeps: number[] = [];
    const engine = fakeEngine(() => failed([limit()]));
    const questions = Array.from({ length: 9 }, (_, i) => q(`en-${i}`));

    const run = await runLeg(questions, engine, { budget: budget(), translatedLeg: false, sleep: async (ms) => void sleeps.push(ms) });

    expect(MAX_CONSECUTIVE_VENDOR_FAILURES).toBe(5);
    expect(engine.log).toEqual(["en-0", "en-1", "en-2", "en-3", "en-4"]);
    expect(run.stopped).toBe("vendor_failures");
    expect(run.rows.map((r) => r.outcome)).toEqual(["rate_limited", "rate_limited", "rate_limited", "rate_limited", "rate_limited", "not_run", "not_run", "not_run", "not_run"]);
    expect(sleeps).toEqual([60_000, 60_000, 60_000, 60_000]);
  });

  it("starts counting again after an answer: failures that are not in a row do not stop the run", async () => {
    const answers = ["limit", "ok", "limit", "limit", "ok", "limit", "limit", "limit", "limit", "ok"];
    const engine = fakeEngine((_question, n) => (answers[n] === "limit" ? failed([limit()]) : asked({ M001: 0.9 })));

    const run = await runLeg(answers.map((_, i) => q(`en-${i}`)), engine, { budget: budget(), translatedLeg: false, sleep: noSleep });

    expect(run.stopped).toBeNull();
    expect(run.rows.filter((r) => r.outcome === "not_run")).toEqual([]);
  });
});

// --- the usage allowance: the plan, the cap, the pace -------------------------------------------------

const PASHTO = "زه وړیا حقوقي مشوره غواړم";
const URDU = "مجھے وکیل چاہیے";

describe("the call plan", () => {
  const translator = planningTranslator(DEFAULT_SEARCH_SETTINGS);

  it("counts one embedding per question with the leg off, and a translation and a second embedding for each question the leg is for with it on, by routed model", () => {
    const questions = [{ q: PASHTO, lang: "ps" as const }, { q: URDU, lang: "ur" as const }, { q: "free legal help", lang: "en" as const }, { q: "mujhe madad chahiye", lang: "en" as const }];

    const off = planLeg(questions, null);
    const on = planLeg(questions, translator);

    expect(off).toEqual({ questions: 4, embeddings: 4, translations: 0, translationsByModel: {}, retriesByModel: {}, worst: 4 });
    expect(on).toEqual({
      questions: 4,
      embeddings: 7,
      translations: 3,
      translationsByModel: { "north-small-translate-09-2026": 2, "command-a-translate-08-2025": 1 },
      // Urdu falls back to Command A; Pashto has no fallback by default; the romanized question's route is already Command A.
      retriesByModel: { "command-a-translate-08-2025": 1 },
      worst: 11,
    });
  });

  it("asks the question as the use case is asked it: the page language, not the question's, when the question has one", () => {
    expect(planQuestion({ q: "free legal help", lang: "ur", page_lang: "en" }, translator)).toMatchObject({ translations: 0 });
    expect(planQuestion({ q: PASHTO, lang: "ps", page_lang: "en" }, translator)).toMatchObject({ embeddings: 2, translations: 1, model: "north-small-translate-09-2026" });
  });

  it("follows SEARCH_QUESTION_ROUTE and SEARCH_QUESTION_FALLBACK: a kind switched off costs one embedding, a retry is only planned where a fallback model is named", () => {
    const settings = resolveSearchSettings({ SEARCH_QUESTION_ROUTE: "ps=off,ur=command-a-translate-08-2025", SEARCH_QUESTION_FALLBACK: "off" });
    expect(settings.ok).toBe(true);
    const planner = planningTranslator((settings as { ok: true; settings: typeof DEFAULT_SEARCH_SETTINGS }).settings);

    expect(planQuestion({ q: PASHTO, lang: "ps" }, planner)).toEqual({ embeddings: 1, translations: 0, retries: 0, model: null, fallbackModel: null });
    expect(planQuestion({ q: URDU, lang: "ur" }, planner)).toEqual({ embeddings: 2, translations: 1, retries: 0, model: "command-a-translate-08-2025", fallbackModel: null });
    expect(worstCalls(planQuestion({ q: URDU, lang: "ur" }, translator))).toBe(4);
  });

  it("is printed per leg with the cap, and says when the run will stop at it", () => {
    const questions = [{ q: PASHTO, lang: "ps" as const }, { q: URDU, lang: "ur" as const }];
    const lines = formatPlan("embed-v4.0", [{ leg: "off", plan: planLeg(questions, null) }, { leg: "on", plan: planLeg(questions, translator) }], 5);

    expect(lines.join("\n")).toContain("leg off: 2 questions, at most 2 embedding calls (embed-v4.0), no translation calls");
    expect(lines.join("\n")).toContain("leg on: 2 questions, at most 4 embedding calls (embed-v4.0), 2 translation calls (2 with north-small-translate-09-2026)");
    expect(lines.join("\n")).toContain("1 retries with a fallback model");
    expect(lines.at(-1)).toContain("--max-calls is 5: the run will stop at it and report partial results");
    expect(formatPlan("embed-v4.0", [{ leg: "off", plan: planLeg(questions, null) }], 500).at(-1)).not.toContain("will stop");
  });
});

describe("the cap and the pace", () => {
  it("has a default cap well under the trial key's month, and room for one run of both legs of the tuning set", () => {
    expect(DEFAULT_MAX_CALLS).toBeGreaterThan(0);
    expect(DEFAULT_MAX_CALLS).toBeLessThan(1000);
  });

  it("stops cleanly when the next question could pass the cap: the questions before it are scored, the rest are not_run, and the calls never pass the cap", async () => {
    const engine = fakeEngine(() => asked({ M001: 0.9 }, { calls: { embedding: 1, translation: 1 } }), { plan: () => ({ ...PLAN, embeddings: 1, translations: 1 }) });
    const callBudget = budget(5);

    const run = await runLeg(["a", "b", "c", "d"].map((id) => q(id)), engine, { budget: callBudget, translatedLeg: true, sleep: noSleep });

    expect(engine.log).toEqual(["a", "b"]);
    expect(callBudget.made).toBe(4);
    expect(run.stopped).toBe("max_calls");
    expect(run.rows.map((r) => r.outcome)).toEqual(["hit", "hit", "not_run", "not_run"]);
    const report = legReport(run, 0.3);
    expect(report.counts).toMatchObject({ questions: 4, asked: 2, scored: 2, not_run: 2 });
    expect(report.stopped).toBe("max_calls");
  });

  it("reserves a question's retry before asking it, so that even the worst case stays under the cap", async () => {
    const withRetry: QuestionPlan = { embeddings: 2, translations: 1, retries: 1, model: "m", fallbackModel: "f" };
    const engine = fakeEngine(() => asked({ M001: 0.9 }, { calls: { embedding: 2, translation: 2 } }), { plan: () => withRetry });
    const callBudget = budget(8);

    const run = await runLeg(["a", "b", "c"].map((id) => q(id)), engine, { budget: callBudget, translatedLeg: true, sleep: noSleep });

    // 4 calls of worst case each: the second question may still make it to 8, the third would pass it.
    expect(engine.log).toEqual(["a", "b"]);
    expect(callBudget.made).toBeLessThanOrEqual(8);
    expect(run.stopped).toBe("max_calls");
  });

  it("shares one budget across legs: what the first leg used is not there for the second", async () => {
    const callBudget = budget(3);
    const engine = () => fakeEngine(() => asked({ M001: 0.9 }));

    const off = await runLeg(["a", "b"].map((id) => q(id)), engine(), { budget: callBudget, translatedLeg: false, sleep: noSleep });
    const on = await runLeg(["a", "b"].map((id) => q(id)), engine(), { budget: callBudget, translatedLeg: true, sleep: noSleep });

    expect(off.stopped).toBeNull();
    expect(on.stopped).toBe("max_calls");
    expect(on.rows.map((r) => r.outcome)).toEqual(["hit", "not_run"]);
  });

  it("paces the calls: sequential, a pause after each question of 0.7 s per embedding and 3.2 s per translation (the trial key's per-minute limits), none after the last", async () => {
    const sleeps: number[] = [];
    const answers = [asked({ M001: 0.9 }), asked({ M001: 0.9 }, { calls: { embedding: 2, translation: 1 } }), asked({ M001: 0.9 }, { calls: { embedding: 2, translation: 2 } }), asked({ M001: 0.9 })];
    let inFlight = 0;
    let overlapped = false;
    const engine = fakeEngine(() => asked({}), {
      ask: async () => {
        inFlight += 1;
        overlapped ||= inFlight > 1;
        await Promise.resolve();
        inFlight -= 1;
        return answers[engine.log.push("x") - 1]!;
      },
    });

    await runLeg(["a", "b", "c", "d"].map((id) => q(id)), engine, { budget: budget(), translatedLeg: true, sleep: async (ms) => void sleeps.push(ms) });

    expect(DEFAULT_PACE).toEqual({ embedGapMs: 700, translateGapMs: 3200, rateLimitBackoffMs: 60_000 });
    expect(sleeps).toEqual([700, 3200, 6400]);
    expect(overlapped).toBe(false);
  });
});

// --- the evaluation subset --------------------------------------------------------------------------

describe("the evaluation subset", () => {
  const base = ["run", "--engine", "production", "--model", "embed-v4.0", "--translated-leg", "off"];

  it("is refused by the command line, whatever the flag: --split evaluation, --split all, --final, the old escape flag, and any other split", () => {
    for (const extra of [["--split", "evaluation"], ["--split", "all"], ["--split", "evaluation", "--final"], ["--split", "all", "--s03-08-evaluation", "--final"], ["--final"], ["--s03-08-evaluation"], ["--split", "dev"], ["--split"]]) {
      const parsed = parseProductionOptions([...base, "--yes", ...extra]);
      expect(parsed.ok, extra.join(" ")).toBe(false);
      if (!parsed.ok) expect(parsed.error, extra.join(" ")).toContain("S03.08");
    }
    expect(parseProductionOptions([...base, "--yes", "--split", "tuning"]).ok).toBe(true);
    expect(parseProductionOptions([...base, "--yes"]).ok).toBe(true);
    expect(checkSplit(["--split", "evaluation"])).toEqual({ ok: false, error: expect.stringContaining(EVALUATION_REFUSAL) });
  });

  it("is refused before anything else happens: exit 2, no question file read, no engine made, no call", async () => {
    const loadQuestions = vi.fn();
    const makeEngine = vi.fn();
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const code = await runProduction([...base, "--yes", "--split", "evaluation", "--final"], goodEnv, tempDir(), { loadQuestions, makeEngine, usage: "usage" });

    expect(code).toBe(2);
    expect(loadQuestions).not.toHaveBeenCalled();
    expect(makeEngine).not.toHaveBeenCalled();
    expect(errors.mock.calls.flat().join("\n")).toContain("evaluation subset");
    errors.mockRestore();
  });

  it("never reaches the engine even when the questions file holds evaluation questions: only the tuning subset is asked", async () => {
    const questions = [q("t1"), q("e1", { split: "evaluation" }), q("t2"), q("e2", { split: "evaluation" })];
    const engine = fakeEngine(() => asked({ M001: 0.9 }));

    const code = await withCli(["--yes", "--translated-leg", "off"], { questions, engine });

    expect(code).toBe(0);
    expect(engine.log).toEqual(["t1", "t2"]);
  });
});

// --- the command line, end to end, with a fake engine ---------------------------------------------------

const SECRETS = {
  SEARCH_TEST_DATABASE_URL: "postgres://postgres:db-password-value@db.example.com:5432/postgres",
  COHERE_API_KEY: "cohere-key-value-123",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "supabase-secret-value-456",
};
const goodEnv: Record<string, string | undefined> = { ...SECRETS };

let logs: string[];
let errs: string[];
/** The leg settings the last command made an engine for, in order. */
let madeLegs: boolean[] = [];
beforeEach(() => {
  logs = [];
  errs = [];
  vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
  vi.spyOn(console, "warn").mockImplementation((...a) => void errs.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a) => void errs.push(a.join(" ")));
});
afterEach(() => vi.restoreAllMocks());

/** Runs the production command with a fake engine (or one engine per leg) over the given questions. */
async function withCli(
  args: string[],
  over: { questions?: TestQuestion[]; engine?: ReturnType<typeof fakeEngine>; engines?: Record<string, ReturnType<typeof fakeEngine>>; env?: Record<string, string | undefined>; dir?: string; deps?: Partial<ProductionRunDeps> } = {},
) {
  const dir = over.dir ?? tempDir();
  const questions = over.questions ?? [q("en-01"), noMatch("en-02")];
  const made: boolean[] = [];
  const deps: ProductionRunDeps = {
    loadQuestions: () => ({ questions: questions.map((x, i) => ({ ...x, line: i + 1 })), errors: [], sha256: "a".repeat(64) }),
    makeEngine: async (_env, options) => {
      made.push(options.translatedLeg);
      return over.engines?.[options.translatedLeg ? "on" : "off"] ?? over.engine ?? fakeEngine((question) => (question.intent === "no_match" ? asked({ M001: 0.1, M003: 0.05 }) : asked({ M001: 0.9, M003: 0.05 })));
    },
    usage: "USAGE",
    sleep: noSleep,
    ...over.deps,
  };
  const code = await runProduction(["run", "--engine", "production", "--model", "embed-v4.0", "--out-dir", dir, ...args], over.env ?? goodEnv, dir, deps);
  madeLegs = made;
  return code;
}

const read = (dir: string, name: string) => readFileSync(path.join(dir, name), "utf8");
const files = (dir: string) => readdirSync(dir).sort();

describe("the production command", () => {
  it("prints the planned calls per leg and, without --yes, does nothing more: no connection, no engine, no call, no file", async () => {
    const dir = tempDir();
    const makeEngine = vi.fn();

    const code = await withCli(["--translated-leg", "both"], { dir, deps: { makeEngine } });

    expect(code).toBe(2);
    expect(makeEngine).not.toHaveBeenCalled();
    expect(files(dir)).toEqual([]);
    expect(logs.join("\n")).toContain("Planned vendor calls");
    expect(logs.join("\n")).toContain("translated-question leg off: 2 questions, at most 2 embedding calls");
    expect(logs.join("\n")).toContain("translated-question leg on: 2 questions");
    expect(errs.join("\n")).toContain("Add --yes to run it");
  });

  it("needs no secret to print the plan, so the plan can be seen before they are set", async () => {
    const code = await withCli(["--translated-leg", "off"], { env: {} });

    expect(code).toBe(2);
    expect(logs.join("\n")).toContain("Planned vendor calls");
  });

  it("names every missing setting, never a value, and calls nothing", async () => {
    const makeEngine = vi.fn();
    const env = { ...SECRETS, COHERE_API_KEY: "", SUPABASE_SECRET_KEY: undefined };

    const code = await withCli(["--yes", "--translated-leg", "off"], { env, deps: { makeEngine } });

    expect(code).toBe(1);
    expect(makeEngine).not.toHaveBeenCalled();
    const out = errs.join("\n");
    expect(out).toContain("COHERE_API_KEY");
    expect(out).toContain("SUPABASE_SECRET_KEY");
    expect(out).not.toContain("NEXT_PUBLIC_SUPABASE_URL is not set");
    for (const value of ["db-password-value", "project.supabase.co"]) expect(out + logs.join("\n")).not.toContain(value);
  });

  it("takes the database through either pooler (the app's own login uses the transaction pooler), refuses what is not a postgres URL without printing it, and a Supabase URL that is not https", () => {
    const transaction = resolveProductionEnv({ ...SECRETS, SEARCH_TEST_DATABASE_URL: "postgres://cvh_app_login.abc:db-password-value@aws-0.pooler.supabase.com:6543/postgres" }, DEFAULT_SEARCH_SETTINGS);
    const notPostgres = resolveProductionEnv({ ...SECRETS, SEARCH_TEST_DATABASE_URL: "https://user:db-password-value@db.example.com/postgres" }, DEFAULT_SEARCH_SETTINGS);
    const garbage = resolveProductionEnv({ ...SECRETS, SEARCH_TEST_DATABASE_URL: "db-password-value" }, DEFAULT_SEARCH_SETTINGS);
    const http = resolveProductionEnv({ ...SECRETS, NEXT_PUBLIC_SUPABASE_URL: "http://project.supabase.co" }, DEFAULT_SEARCH_SETTINGS);

    expect(transaction.ok).toBe(true);
    expect(notPostgres).toEqual({ ok: false, missing: [], problems: ["SEARCH_TEST_DATABASE_URL must be a postgres:// URL"] });
    expect(garbage).toEqual({ ok: false, missing: [], problems: ["SEARCH_TEST_DATABASE_URL is not a valid URL"] });
    expect(http).toEqual({ ok: false, missing: [], problems: ["NEXT_PUBLIC_SUPABASE_URL must be an https URL"] });
    expect(JSON.stringify([notPostgres, garbage])).not.toContain("db-password-value");
  });

  it("refuses unusable SEARCH_* settings with the app's own rules, naming the variable and not its value", async () => {
    const code = await withCli(["--yes", "--translated-leg", "on"], { env: { ...goodEnv, SEARCH_QUESTION_ROUTE: "ps=a bad model" } });

    expect(code).toBe(1);
    expect(errs.join("\n")).toMatch(/SEARCH_QUESTION_ROUTE:/);
    expect(errs.join("\n")).not.toContain("a bad model");
  });

  it("refuses --threshold (it suggests a value, it sets nothing), unknown flags and bad options, with the usage", async () => {
    const dir = tempDir();
    expect(await withCli(["--yes", "--translated-leg", "off", "--threshold", "0.4"], { dir })).toBe(2);
    expect(errs.join("\n")).toContain("--threshold is not used");
    errs.length = 0;
    for (const args of [["--yes", "--translated-leg", "maybe"], ["--yes"], ["--yes", "--translated-leg", "off", "--max-calls", "0"], ["--yes", "--translated-leg", "off", "--max-calls", "lots"], ["--yes", "--translated-leg", "off", "--max-call", "5"], ["--yes", "--translated-leg", "off", "--release", "x"]]) {
      expect(await withCli(args, { dir }), args.join(" ")).toBe(2);
    }
    expect(errs.join("\n")).toContain("USAGE");
    expect(files(dir)).toEqual([]);
  });

  it("runs the leg, writes the report (valid, per question and aggregates) and the generic report for --compare, and names them", async () => {
    const dir = tempDir();

    const code = await withCli(["--yes", "--translated-leg", "off", "--date", "2026-10-04"], { dir });

    expect(code).toBe(0);
    expect(files(dir)).toEqual(["2026-10-04-embed-v4.0-leg-off-tuning.json", "2026-10-04-embed-v4.0-production-tuning.json"]);
    const report = TuningReportSchema.parse(JSON.parse(read(dir, "2026-10-04-embed-v4.0-production-tuning.json")));
    expect(report).toMatchObject({ release: 7, model: "embed-v4.0", release_threshold: 0.3, split: "tuning", questions_sha256: "a".repeat(64), max_calls: DEFAULT_MAX_CALLS, calls_made: 2 });
    expect(report.legs.on).toBeNull();
    expect(report.legs.off!.counts).toMatchObject({ questions: 2, scored: 2, hit: 1, no_clear_match: 1 });
    expect(report.legs.off!.threshold_suggestion.threshold).toBe(0.1001);
    expect(report.settings).toEqual({
      question_route: DEFAULT_SEARCH_SETTINGS.questionRoute,
      question_fallback: DEFAULT_SEARCH_SETTINGS.questionFallback,
      fallback_min_budget_ms: 800,
      emergency_threshold: 0.25,
    });
    const generic = TestSetReportSchema.parse(JSON.parse(read(dir, "2026-10-04-embed-v4.0-leg-off-tuning.json")));
    expect(generic).toMatchObject({ release: "7", translated_leg: false, question_count: 2, subsets: { evaluation: null } });
    expect(logs.join("\n")).toContain("Suggested threshold: 0.1001");
  });

  it("runs both legs, off then on, one engine each and one shared budget, and shows the leg's effect per language", async () => {
    const dir = tempDir();
    const off = fakeEngine(() => asked({ M001: 0.1, M003: 0.05 }));
    const on = fakeEngine(() => asked({ M001: 0.1, M003: 0.05 }, { translated: { M001: 0.9, M003: 0.05 }, calls: { embedding: 2, translation: 1 } }));

    const code = await withCli(["--yes", "--translated-leg", "both", "--date", "2026-10-04"], { dir, questions: [q("ps-01", { lang: "ps" })], engines: { off, on } });

    expect(code).toBe(0);
    expect(madeLegs).toEqual([false, true]);
    expect(files(dir)).toEqual(["2026-10-04-embed-v4.0-leg-off-tuning.json", "2026-10-04-embed-v4.0-leg-on-tuning.json", "2026-10-04-embed-v4.0-production-tuning.json"]);
    const report = TuningReportSchema.parse(JSON.parse(read(dir, "2026-10-04-embed-v4.0-production-tuning.json")));
    expect(report.legs.off!.counts.no_clear_match).toBe(1);
    expect(report.legs.on!.counts.hit).toBe(1);
    expect(report.calls_made).toBe(4);
    expect(logs.join("\n")).toContain("effect, off (A) to on (B)");
    expect(logs.join("\n")).toMatch(/ps\s+.*0->100/);
    expect(off.closed()).toBe(true);
    expect(on.closed()).toBe(true);
  });

  it("stops at --max-calls, writes the partial results, says so, and exits 1", async () => {
    const dir = tempDir();
    const questions = ["a", "b", "c", "d"].map((id) => q(id));

    const code = await withCli(["--yes", "--translated-leg", "off", "--max-calls", "2", "--date", "2026-10-04"], { dir, questions });

    expect(code).toBe(1);
    const report = TuningReportSchema.parse(JSON.parse(read(dir, "2026-10-04-embed-v4.0-production-tuning.json")));
    expect(report.legs.off).toMatchObject({ stopped: "max_calls", counts: { asked: 2, scored: 2, not_run: 2 } });
    expect(report.calls_made).toBe(2);
    expect(report.max_calls).toBe(2);
    expect(errs.join("\n")).toContain("Partial results");
    expect(logs.join("\n")).toContain("PARTIAL RESULTS");
  });

  it("reports questions that got no usable answer without scoring them, warns, and exits 0 when the run itself finished", async () => {
    const dir = tempDir();
    const engine = fakeEngine((question) => (question.id === "en-02" ? failed([limit()]) : asked({ M001: 0.9, M003: 0.05 })));

    const code = await withCli(["--yes", "--translated-leg", "off", "--date", "2026-10-04"], { dir, engine });

    expect(code).toBe(0);
    const report = TuningReportSchema.parse(JSON.parse(read(dir, "2026-10-04-embed-v4.0-production-tuning.json")));
    expect(report.legs.off!.counts).toMatchObject({ scored: 1, rate_limited: 1, miss: 0 });
    expect(errs.join("\n")).toContain("1 question(s) got no usable answer");
    expect(logs.join("\n")).toContain("left out of every rate");
  });

  it("refuses to run against a release embedded with another model, or another release than --release, before asking anything", async () => {
    const engine = fakeEngine(() => asked({ M001: 0.9 }), { facts: { release: 7, model: "embed-multilingual-v3.0", threshold: 0.3 } });

    expect(await withCli(["--yes", "--translated-leg", "off"], { engine })).toBe(1);
    expect(errs.join("\n")).toContain("embedded with embed-multilingual-v3.0, not embed-v4.0");
    expect(engine.log).toEqual([]);

    errs.length = 0;
    const other = fakeEngine(() => asked({ M001: 0.9 }));
    expect(await withCli(["--yes", "--translated-leg", "off", "--release", "8"], { engine: other })).toBe(1);
    expect(errs.join("\n")).toContain("--release is 8, but the current release is 7");
    expect(other.log).toEqual([]);
    expect(other.closed()).toBe(true);
  });

  it("fails when the release changes between the legs, with the first leg's files kept", async () => {
    const dir = tempDir();
    const off = fakeEngine(() => asked({ M001: 0.9 }));
    const on = fakeEngine(() => asked({ M001: 0.9 }), { facts: { release: 8, model: "embed-v4.0", threshold: 0.3 } });

    expect(await withCli(["--yes", "--translated-leg", "both", "--date", "2026-10-04"], { dir, engines: { off, on } })).toBe(1);
    expect(errs.join("\n")).toContain("changed during the run, from 7 to 8");
    expect(files(dir)).toEqual(["2026-10-04-embed-v4.0-leg-off-tuning.json"]);
  });

  it("does not overwrite an earlier report without --force, and does not call anything before it says so", async () => {
    const dir = tempDir();
    const args = ["--yes", "--translated-leg", "off", "--date", "2026-10-04"];
    expect(await withCli(args, { dir })).toBe(0);
    const makeEngine = vi.fn();

    expect(await withCli(args, { dir, deps: { makeEngine } })).toBe(1);
    expect(errs.join("\n")).toContain("already exists");
    expect(makeEngine).not.toHaveBeenCalled();
    expect(await withCli([...args, "--force"], { dir })).toBe(0);
  });

  it("says the run failed, with the message, when the engine throws (the release changed, say), and still closes the engine", async () => {
    const engine = fakeEngine(() => {
      throw new Error("the current release changed during the run");
    });

    expect(await withCli(["--yes", "--translated-leg", "off"], { engine })).toBe(1);
    expect(errs.join("\n")).toContain("The run failed: the current release changed during the run");
    expect(engine.closed()).toBe(true);
  });

  it("holds nothing of a question's text in any report, summary or line it prints, and no secret", async () => {
    const dir = tempDir();
    const secretText = "zq3-the-text-of-a-question-nobody-may-see";
    const questions = [q("en-01", { q: `${secretText} one` }), noMatch("en-02", { q: `${secretText} two` })];
    const engine = fakeEngine(() => asked({ M001: 0.9, M003: 0.05 }));
    const summary = path.join(dir, "summary.md");

    const code = await withCli(["--yes", "--translated-leg", "off", "--scores", "--summary-file", summary, "--date", "2026-10-04"], { dir, questions, engine });

    expect(code).toBe(0);
    const everything = [...files(dir).map((f) => read(dir, f)), ...logs, ...errs].join("\n");
    expect(everything).not.toContain(secretText);
    for (const value of Object.values(SECRETS)) expect(everything).not.toContain(value);
    expect(logs.join("\n")).toContain("en-01"); // ids are there
  });

  it("writes a summary of aggregates only: rates, counts, usage and the suggested threshold, no question or provider id", async () => {
    const dir = tempDir();
    const summary = path.join(dir, "out", "summary.md");

    await withCli(["--yes", "--translated-leg", "off", "--summary-file", summary, "--date", "2026-10-04"], { dir });

    const text = readFileSync(summary, "utf8");
    expect(text).toContain("### Translated-question leg off");
    expect(text).toContain("| Language | Questions | Hit top 3 | Hit top 5 | No match | Emergency | p50 ms | p95 ms |");
    expect(text).toContain("Suggested threshold: 0.1001");
    expect(text).not.toMatch(/en-0[12]|M00[123]/);
  });

  it("builds the summary from the report alone", () => {
    const lines = markdownSummary({
      v: 1,
      date: "2026-10-04",
      split: "tuning",
      release: 7,
      model: "embed-v4.0",
      release_threshold: 0.3,
      questions_sha256: "a".repeat(64),
      settings: { question_route: {}, question_fallback: {}, fallback_min_budget_ms: 800, emergency_threshold: 0.25 },
      max_calls: 500,
      calls_made: 0,
      legs: { off: null, on: null },
    });
    expect(lines[0]).toContain("Release 7");
  });
});
