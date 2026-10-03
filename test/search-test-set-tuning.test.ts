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
import { DEFAULT_LIVE_RESERVE, DEFAULT_MONTHLY_ALLOWANCE, checkAllowance, formatAllowance, resolveAllowance } from "../scripts/search-test-set/allowance";
import { formatPlan, planLeg, planQuestion, planningTranslator, worstCalls, type QuestionPlan } from "../scripts/search-test-set/callPlan";import { percentile } from "../scripts/search-test-set/lib";
import { EVALUATION_REFUSAL, checkSplit, parseProductionOptions, resolveProductionEnv, resolveSearchSettings, runProduction, type ProductionRunDeps } from "../scripts/search-test-set/production";
import { justAbove, suggestThreshold, type ThresholdInput } from "../scripts/search-test-set/threshold";
import { formatSuggestion, markdownSummary } from "../scripts/search-test-set/tuningSummary";
import {
  CallBudget,
  DEFAULT_MAX_CALLS,
  DEFAULT_PACE,
  MAX_CONSECUTIVE_SEARCH_FAILURES,
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

  // Raising the threshold is not always harmless to a hit once two legs are fused by rank: a value above one leg's similarity for
  // a competing provider drops that provider from that leg only, which halves its fused score and can let the expected provider
  // back into the top five. The expected provider here is Z. A leg's list is its providers' similarities.
  const DIRECT = { A: 0.95, B: 0.94, C: 0.93, Z: 0.925, D: 0.92, P: 0.6 };
  const TRANSLATED = { A: 0.9, B: 0.89, C: 0.88, D: 0.87, P: 0.55, Z: 0.45 };
  const twoLegHit = () => input("h1", "normal", DIRECT, ["Z"], { translated: TRANSLATED });
  const twoLegNoMatch = (highest = 0.49) => input("n1", "no_match", { A: highest, B: 0.1 }, [], { translated: { A: 0.2, B: 0.1 } });

  it("with two legs, loses fewer hits at a higher value than at the lowest one that clears the no-match questions, and suggests that one (the lowest value above the highest no-match similarity loses the hit, this ranking is not monotone)", () => {
    // The real ranking, as the use case does it, for the three values in question.
    const top5 = (t: number) => rankLegs([new Map(Object.entries(DIRECT)), new Map(Object.entries(TRANSLATED))], t).map((r) => r.provider_id);
    expect(top5(0.4901)).toEqual(["A", "B", "C", "D", "P"]); // Z lost: P keeps both its legs, Z only the direct one
    expect(top5(0.5501)).toEqual(["A", "B", "C", "D", "Z"]); // P's translated similarity (0.55) is out: its fused score halves
    expect(top5(0.56)).toEqual(["A", "B", "C", "D", "Z"]);
    expect(top5(0.5)).toEqual(["A", "B", "C", "D", "P"]);

    const s = suggestThreshold([twoLegNoMatch(), twoLegHit()], 0.3);

    expect(s.hits_without_threshold).toBe(1);
    expect(s.highest_no_match).toBe(0.49);
    expect(s.lowest_clearing).toBe(0.4901);
    expect(s.at_lowest_clearing).toMatchObject({ threshold: 0.4901, hits_kept: 0, hits_lost: 1, lost_ids: ["h1"], no_match_clear: 1 });
    expect(s.threshold).toBe(0.5501);
    expect(s.at_suggested).toMatchObject({ threshold: 0.5501, hits_kept: 1, hits_lost: 0, lost_ids: [], no_match_clear: 1 });
    expect(s.lowest_kept_hit).toBe(0.925);
    expect(s.hit_margin).toBe(0.435);
    expect(ThresholdSuggestionSchema.safeParse(s).success).toBe(true);
  });

  it("says in words when the suggestion is above the lowest value that clears the no-match questions and what that lower value would lose, and makes no claim that the values in between lose alike", () => {
    const high = formatSuggestion(suggestThreshold([twoLegNoMatch(), twoLegHit()], 0.3), true, true).join("\n");

    expect(high).toContain("Suggested threshold: 0.5501 (above the highest no-match similarity 0.4900, over 1 no-match questions; the lowest value that clears them, 0.4901, loses more hits)");
    expect(high).toContain("at 0.5501: 1 hits kept, 0 lost of 1");
    expect(high).toContain("at the lowest value that clears the no-match questions 0.4901: 0 hits kept, 1 lost of 1 (h1)");
    expect(high).toContain("margin: 0.4350 between the highest no-match similarity and the weakest hit it keeps (0.9250)");

    const plain = formatSuggestion(suggestThreshold([none("n1", 0.4), hit("h1", 0.9)], 0.3), true, true).join("\n");
    expect(plain).toContain("Suggested threshold: 0.4001 (just above the highest no-match similarity 0.4000, over 1 no-match questions)");
    expect(plain).not.toContain("at the lowest value that clears");
    for (const text of [high, plain]) expect(text).not.toMatch(/same hits|any value/);
  });

  it("still suggests the lowest value that clears the no-match questions when nothing does better, and then says what that value does once (the same effect for both)", () => {
    const s = suggestThreshold([none("n1", 0.4), hit("h1", 0.9), hit("h2", 0.8)], 0.3);

    expect(s.threshold).toBe(0.4001);
    expect(s.lowest_clearing).toBe(0.4001);
    expect(s.at_lowest_clearing).toEqual(s.at_suggested);
  });

  it("breaks a tie in the hits lost by the most hits kept: a value that lets an expected provider into the top five that the ranking without a threshold keeps out is preferred, and among equals the lowest wins", () => {
    // Z ties with P at no threshold (P wins on id), so it is out of the top five; with P's translated similarity (0.55) below the
    // threshold, P's fused score halves and Z is in. Nothing is lost at either value (Z was not a hit to begin with).
    const direct = { A: 0.95, B: 0.94, C: 0.93, D: 0.92, P: 0.91, Z: 0.9 };
    const translated = { A: 0.9, B: 0.89, C: 0.88, D: 0.87, Z: 0.6, P: 0.55 };
    const legs = [new Map(Object.entries(direct)), new Map(Object.entries(translated))];
    expect(rankLegs(legs, -Infinity).map((r) => r.provider_id)).toEqual(["A", "B", "C", "D", "P"]);
    expect(rankLegs(legs, 0.5501).map((r) => r.provider_id)).toEqual(["A", "B", "C", "D", "Z"]);
    expect(rankLegs(legs, 0.6001).map((r) => r.provider_id)).toEqual(["A", "B", "C", "D", "P"]);

    const s = suggestThreshold([none("n1", 0.3), input("h1", "normal", direct, ["Z"], { translated }), hit("h2", 0.9)], 0.2);

    expect(s.lowest_clearing).toBe(0.3001);
    expect(s.at_lowest_clearing).toMatchObject({ hits_kept: 1, hits_lost: 0 });
    expect(s.threshold).toBe(0.5501);
    expect(s.at_suggested).toMatchObject({ hits_kept: 2, hits_lost: 0 });
  });

  it("looks for the best value among every similarity of the answerable questions at or above the highest no-match one, whatever the scores: against every value that clears the no-match questions, on seeded random runs with two legs and several providers", () => {
    let seed = 20261004;
    const random = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const providers = ["P1", "P2", "P3", "P4", "P5", "P6", "P7"];
    const leg = (low: number, high: number) => Object.fromEntries(providers.map((id) => [id, Math.round((low + random() * (high - low)) * 1000) / 1000]));
    let beatsLowest = 0;
    for (let run = 0; run < 30; run++) {
      const inputs: ThresholdInput[] = [];
      for (let i = 0; i < 4; i++) inputs.push(input(`n${i}`, "no_match", leg(0, 0.4), [], { translated: leg(0, 0.4) }));
      for (let i = 0; i < 8; i++) inputs.push(input(`h${i}`, "normal", leg(0.1, 1), [providers[Math.floor(random() * providers.length)]!], { translated: leg(0.1, 1) }));
      const s = suggestThreshold(inputs, 0.3);
      expect(s.threshold, `run ${run}`).not.toBeNull();

      // The oracle: every plateau of the ranking (the first four-place value above each three-place similarity), by the use case's rankLegs.
      const legsOf = (i: ThresholdInput) => i.observation!.legs.map((l) => l.similarities);
      const baseline = new Set(inputs.filter((i) => i.intent !== "no_match" && rankLegs(legsOf(i), -Infinity).some((r) => i.expected.includes(r.provider_id))).map((i) => i.id));
      let best: { t: number; lost: number; kept: number } | null = null;
      for (let x = 0; x < 1000; x++) {
        const t = Math.round((x / 1000 + 0.0001) * 1e4) / 1e4;
        if (!inputs.filter((i) => i.intent === "no_match").every((i) => rankLegs(legsOf(i), t).length === 0)) continue;
        let lost = 0;
        let kept = 0;
        for (const i of inputs.filter((i) => i.intent !== "no_match")) {
          if (rankLegs(legsOf(i), t).some((r) => i.expected.includes(r.provider_id))) kept += 1;
          else if (baseline.has(i.id)) lost += 1;
        }
        if (best === null || lost < best.lost || (lost === best.lost && kept > best.kept)) best = { t, lost, kept };
      }
      expect(s.threshold, `run ${run}`).toBe(best!.t);
      expect(s.at_suggested, `run ${run}`).toMatchObject({ hits_lost: best!.lost, hits_kept: best!.kept });
      // It never loses more hits than the lowest value that clears the no-match questions, and clears them all.
      expect(s.at_suggested!.hits_lost).toBeLessThanOrEqual(s.at_lowest_clearing!.hits_lost);
      expect(s.at_suggested!.no_match_clear).toBe(4);
      if (s.threshold !== s.lowest_clearing) beatsLowest += 1;
    }
    // The runs do include ones where the lowest value is not the best, or this would only repeat the one-leg test.
    expect(beatsLowest).toBeGreaterThan(0);
  });

  it("gives no threshold when a no-match question lost its translated-question leg (timed out or failed): its similarities are the direct leg's only, and production would see more", () => {
    const lostLeg: ThresholdInput = { ...none("n2", 0.2), translatedLegLost: true };
    const s = suggestThreshold([none("n1", 0.4), lostLeg, hit("h1", 0.9)], 0.3);

    expect(s.threshold).toBeNull();
    expect(s.reason).toMatch(/1 of 2 no-match questions lost their translated-question leg/);
    expect(s.highest_no_match).toBe(0.4);
    expect(s.lowest_clearing).toBeNull();
    expect(s.at_release).toMatchObject({ hits_kept: 1 });
    // A hit question that lost its leg is still a hit or a miss as production answered it; it does not stop the suggestion.
    const lostHit: ThresholdInput = { ...hit("h2", 0.9), translatedLegLost: true };
    expect(suggestThreshold([none("n1", 0.4), lostHit], 0.3).threshold).toBe(0.4001);
  });

  it("says both reasons when no-match questions were not scored and others lost their leg", () => {
    const missing: ThresholdInput = { id: "n3", intent: "no_match", expected: [], unanswerable: false, observation: null, answer: null };
    const lostLeg: ThresholdInput = { ...none("n2", 0.2), translatedLegLost: true };

    const s = suggestThreshold([none("n1", 0.4), lostLeg, missing], 0.3);

    expect(s.reason).toMatch(/1 of 3 no-match questions were not scored.*; 1 of 3 no-match questions lost their translated-question leg/);
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
const quota = (kind: VendorFailure["kind"] = "embedding"): VendorFailure => ({ kind, model: "m", class: "quota" });
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

  it("stops at once when a vendor says its monthly quota is spent: no wait, no more questions, the partial results kept (a quota that is spent fails every call after it, and each counts)", async () => {
    const sleeps: number[] = [];
    const engine = fakeEngine((_question, n) => (n === 1 ? failed([quota()]) : asked({ M001: 0.9 })));
    const questions = Array.from({ length: 6 }, (_, i) => q(`en-${i}`));

    const run = await runLeg(questions, engine, { budget: budget(), translatedLeg: false, sleep: async (ms) => void sleeps.push(ms) });

    expect(engine.log).toEqual(["en-0", "en-1"]);
    expect(run.stopped).toBe("quota");
    expect(run.rows.map((r) => r.outcome)).toEqual(["hit", "rate_limited", "not_run", "not_run", "not_run", "not_run"]);
    expect(sleeps).toEqual([700]); // the pause after the first question only
    expect(legReport(run, 0.3).stopped).toBe("quota");
  });

  it("stops after a question whose routed model was past its quota even when the fallback model answered it: that question is scored, and it is the last", async () => {
    const rescued = asked({ M001: 0.1, M003: 0.05 }, { translated: { M001: 0.9, M003: 0.05 }, calls: { embedding: 2, translation: 2, translationModels: ["north", "command-a"], failures: [quota("translation")] } });
    const engine = fakeEngine((_question, n) => (n === 0 ? asked({ M001: 0.9 }) : rescued));

    const run = await runLeg([q("a"), q("ps-01", { lang: "ps" }), q("c"), q("d")], engine, { budget: budget(), translatedLeg: true, sleep: noSleep });

    expect(engine.log).toEqual(["a", "ps-01"]);
    expect(run.rows.map((r) => r.outcome)).toEqual(["hit", "hit", "not_run", "not_run"]);
    expect(run.stopped).toBe("quota");
  });

  it("counts a quota refusal as a refusal (rate_limited), as it does a rate limit, and never as a miss", () => {
    const answer = asked({ M001: 0.9 }, { calls: { embedding: 1, translation: 0, failures: [quota()] } });

    expect(outcomeOf(q("a"), answer)).toBe("rate_limited");
  });

  it("waits for the per-minute window after a 429 that a fallback model covered as well, not only after one that left the question unscored", async () => {
    const sleeps: number[] = [];
    const rescued = asked({ M001: 0.1, M003: 0.05 }, { translated: { M001: 0.9, M003: 0.05 }, calls: { embedding: 2, translation: 2, translationModels: ["north", "command-a"], failures: [limit("translation")] } });
    const engine = fakeEngine((_question, n) => (n === 0 ? rescued : asked({ M001: 0.9 })));

    const run = await runLeg([q("ps-01", { lang: "ps" }), q("b"), q("c")], engine, { budget: budget(), translatedLeg: true, sleep: async (ms) => void sleeps.push(ms) });

    expect(run.rows[0]!.outcome).toBe("hit"); // scored: the fallback did the leg
    expect(sleeps).toEqual([60_000, 700]);
    expect(run.stopped).toBeNull();
  });

  it("stops after repeated searches that could not answer (the database or the bucket is down, or the deadline is never met), and starts counting again after an answer", async () => {
    const sleeps: number[] = [];
    const engine = fakeEngine(() => failed([]));
    const questions = Array.from({ length: 9 }, (_, i) => q(`en-${i}`));

    const run = await runLeg(questions, engine, { budget: budget(), translatedLeg: false, sleep: async (ms) => void sleeps.push(ms) });

    expect(MAX_CONSECUTIVE_SEARCH_FAILURES).toBe(5);
    expect(engine.log).toHaveLength(5);
    expect(run.stopped).toBe("search_failures");
    expect(run.rows.map((r) => r.outcome)).toEqual(["search_failed", "search_failed", "search_failed", "search_failed", "search_failed", "not_run", "not_run", "not_run", "not_run"]);
    expect(legReport(run, 0.3).stopped).toBe("search_failures");

    const answers = ["fail", "fail", "ok", "fail", "fail", "fail", "fail", "ok", "fail", "fail"];
    const sporadic = fakeEngine((_question, n) => (answers[n] === "fail" ? failed([]) : asked({ M001: 0.9 })));
    const again = await runLeg(answers.map((_, i) => q(`en-${i}`)), sporadic, { budget: budget(), translatedLeg: false, sleep: noSleep });
    expect(again.stopped).toBeNull();
  });

  it("does not count a vendor failure and a search failure together: each needs its own run of five", async () => {
    const engine = fakeEngine((_question, n) => (n % 2 === 0 ? failed([limit()]) : failed([])));

    const run = await runLeg(Array.from({ length: 12 }, (_, i) => q(`en-${i}`)), engine, { budget: budget(), translatedLeg: false, sleep: noSleep });

    expect(run.stopped).toBeNull();
  });

  it("hands each asked question's row over as soon as it is made, and none for the questions it did not ask", async () => {
    const handed: string[] = [];
    const engine = fakeEngine((_question, n) => (n === 1 ? failed([quota()]) : asked({ M001: 0.9 })));

    const run = await runLeg([q("a"), q("b"), q("c")], engine, { budget: budget(), translatedLeg: false, sleep: noSleep, onRow: (row) => void handed.push(`${row.id}:${row.outcome}`) });

    expect(handed).toEqual(["a:hit", "b:rate_limited"]);
    expect(run.rows).toHaveLength(3);
  });

  it("reports the time per question over every question asked, those that failed included, next to the figures over the scored ones", async () => {
    const answers: Asked[] = [asked({ M001: 0.9 }, { ms: 100 }), asked({ M001: 0.9 }, { ms: 200 }), { ...failed([]), ms: 2500 }, { ...failed([limit()]), ms: 50 }, asked({ M001: 0.9 }, { ms: 300 })];
    const engine = fakeEngine((_question, n) => answers[n]!);

    const report = legReport(await runLeg(["a", "b", "c", "d", "e"].map((id) => q(id)), engine, { budget: budget(), translatedLeg: false, sleep: noSleep }), 0.3);

    expect(report.counts).toMatchObject({ asked: 5, scored: 3, search_failed: 1, rate_limited: 1 });
    expect(report.time_asked).toEqual({ questions: 5, p50: 200, p95: 2500, search_failed: 1 }); // nearest rank over 50, 100, 200, 300 and 2500 ms
    expect(report.aggregates.overall.time_ms).toEqual({ p50: 200, p95: 300 }); // the scored figures leave the slow failure out
  });

  it("reports no time over a run that asked nothing", async () => {
    const report = legReport(await runLeg([], fakeEngine(() => asked({})), { budget: budget(), translatedLeg: false, sleep: noSleep }), 0.3);

    expect(report.time_asked).toEqual({ questions: 0, p50: null, p95: null, search_failed: 0 });
  });

  it("leaves a no-match question whose translated-question leg was cut at the deadline out of what the suggestion rests on: no value, and the reason says why", async () => {
    const cut = asked({ M001: 0.2, M003: 0.05 }, { calls: { embedding: 1, translation: 1, failures: [{ kind: "translation", model: "m", class: "aborted" }] } });
    const timedOut = { ...cut, observation: { ...cut.observation!, translatedLeg: "timed_out" as const } };
    const failedLeg = { ...cut, observation: { ...cut.observation!, translatedLeg: "failed" as const } };
    const script: Record<string, Asked> = { n1: asked({ M001: 0.4, M003: 0.05 }), n2: timedOut, h1: asked({ M001: 0.9, M003: 0.05 }) };
    const questions = [noMatch("n1"), noMatch("n2"), q("h1")];

    const run = await runLeg(questions, fakeEngine((question) => script[question.id]!), { budget: budget(), translatedLeg: true, sleep: noSleep });
    const report = legReport(run, 0.3);

    expect(run.rows[1]!.outcome).toBe("no_clear_match"); // scored: the answer is what production gave
    expect(run.inputs.map((i) => i.translatedLegLost)).toEqual([false, true, false]);
    expect(report.threshold_suggestion.threshold).toBeNull();
    expect(report.threshold_suggestion.reason).toMatch(/1 of 2 no-match questions lost their translated-question leg/);

    // A leg that failed without a vendor failure (a translation a check refused) is the same; one that was used, or not needed, is not.
    const refused = await runLeg([noMatch("n1"), noMatch("n2")], fakeEngine((question) => (question.id === "n1" ? script.n1! : failedLeg)), { budget: budget(), translatedLeg: true, sleep: noSleep });
    expect(refused.inputs.map((i) => i.translatedLegLost)).toEqual([false, true]);
    const used = asked({ M001: 0.2, M003: 0.05 }, { translated: { M001: 0.3, M003: 0.05 } });
    const fine = await runLeg([noMatch("n1")], fakeEngine(() => used), { budget: budget(), translatedLeg: true, sleep: noSleep });
    expect(fine.inputs[0]!.translatedLegLost).toBe(false);
    expect(legReport(fine, 0.3).threshold_suggestion.threshold).toBe(0.3001);
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

describe("the month's allowance on the shared key", () => {
  const fresh = { monthly: DEFAULT_MONTHLY_ALLOWANCE, reserve: DEFAULT_LIVE_RESERVE };

  it("is the trial key's 1,000 calls a month with 200 kept for live search, unless the owner says otherwise", () => {
    expect(resolveAllowance({})).toEqual({ ok: true, allowance: { monthly: 1000, reserve: 200 } });
    expect(resolveAllowance({ SEARCH_TEST_MONTHLY_CALLS: "", SEARCH_TEST_RESERVE_CALLS: "  " })).toEqual({ ok: true, allowance: { monthly: 1000, reserve: 200 } });
    expect(resolveAllowance({ SEARCH_TEST_MONTHLY_CALLS: " 5000 ", SEARCH_TEST_RESERVE_CALLS: "0" })).toEqual({ ok: true, allowance: { monthly: 5000, reserve: 0 } });
    expect(formatAllowance(fresh)).toContain("1000 calls a month on the key, 200 kept for live search");
  });

  it("names the variable and the rule, never the value, for what is not a whole number or leaves no room", () => {
    expect(resolveAllowance({ SEARCH_TEST_MONTHLY_CALLS: "1e3" })).toEqual({ ok: false, problems: ["SEARCH_TEST_MONTHLY_CALLS: must be a whole number of at least 1"] });
    expect(resolveAllowance({ SEARCH_TEST_RESERVE_CALLS: "1000" })).toEqual({ ok: false, problems: ["SEARCH_TEST_RESERVE_CALLS: must be less than SEARCH_TEST_MONTHLY_CALLS, or no run could ever be made"] });
    const both = resolveAllowance({ SEARCH_TEST_MONTHLY_CALLS: "x", SEARCH_TEST_RESERVE_CALLS: "y" });
    expect(both).toMatchObject({ ok: false });
    expect(both.ok === false && both.problems).toHaveLength(2);
  });

  it("fits a run up to the allowance less the reserve, to the call, and refuses one call more", () => {
    // 1000 less 200 is 800 usable. 440 used + 360 is 800.
    expect(checkAllowance(fresh, 440, 360, 500, "2026-10").refusal).toBeNull();
    const over = checkAllowance(fresh, 440, 361, 500, "2026-10");
    expect(over.refusal).toContain("440 calls used + at most 361 for this run is 801, past 800 (the allowance 1000 less the 200 kept for live search)");
    expect(over.refusal).toContain("pass --max-calls 360 or less");
    expect(over.room).toBe(360);
  });

  it("takes the run's worst case as its plan with every retry, and never more than its cap", () => {
    // The default plan: about 456 with every retry, which a cap of 500 does not lower; 300 used leaves 500 usable, which it fits.
    expect(checkAllowance(fresh, 300, 456, 500, "2026-10")).toMatchObject({ refusal: null, worst: 456, room: 500 });
    expect(checkAllowance(fresh, 400, 456, 500, "2026-10").refusal).toContain("past 800");
    // A cap of 400 lowers what the run can make: 400 + 400 fits.
    expect(checkAllowance(fresh, 400, 456, 400, "2026-10")).toMatchObject({ refusal: null, worst: 400 });
  });

  it("says there is nothing to use when the month has already used what a run may, and what the numbers are", () => {
    const check = checkAllowance(fresh, 900, 10, 500, "2026-10");

    expect(check.room).toBe(0);
    expect(check.refusal).toContain("Wait for the month to turn");
    expect(check.refusal).not.toContain("--max-calls");
    expect(check.summary).toBe("Cohere calls this month (2026-10, America/Toronto), every purpose, from spend_event: 900. Allowance 1000, 200 kept for live search, so a run may use 0 more; this run makes at most 10.");
  });
});

describe("the evaluation subset", () => {
  const base =["run", "--engine", "production", "--model", "embed-v4.0", "--translated-leg", "off"];

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

    const code = await runProduction([...base, "--yes", "--split", "evaluation", "--final"], goodEnv, tempDir(), { loadQuestions, makeEngine, monthCalls: vi.fn(), usage: "usage" });

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
    monthCalls: async () => 0,
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

  it("prints the plan with the month's allowance, and with --plan-only stops there with exit 0: no connection, no month count, no engine, no call, no file, and no secret needed", async () => {
    const dir = tempDir();
    const makeEngine = vi.fn();
    const monthCalls = vi.fn();

    const code = await withCli(["--translated-leg", "both", "--plan-only"], { dir, env: {}, deps: { makeEngine, monthCalls } });

    expect(code).toBe(0);
    expect(makeEngine).not.toHaveBeenCalled();
    expect(monthCalls).not.toHaveBeenCalled();
    expect(files(dir)).toEqual([]);
    const out = logs.join("\n");
    expect(out).toContain("Planned vendor calls");
    expect(out).toContain("allowance: 1000 calls a month on the key, 200 kept for live search (SEARCH_TEST_MONTHLY_CALLS, SEARCH_TEST_RESERVE_CALLS)");
    expect(out).toContain("with --yes the run first reads this month's calls from spend_event");
    expect(errs.join("\n")).not.toContain("Add --yes");
  });

  it("takes --plan-only or --yes, not both", async () => {
    expect(await withCli(["--translated-leg", "off", "--plan-only", "--yes"])).toBe(2);
    expect(errs.join("\n")).toContain("--plan-only prints the plan and stops");
    expect(parseProductionOptions(["run", "--engine", "production", "--model", "m", "--translated-leg", "on", "--plan-only"])).toMatchObject({ ok: true, options: { planOnly: true, yes: false } });
  });

  it("reads this month's Cohere calls once it is told to go (--yes), prints them with what is left, and runs when the run fits", async () => {
    const given: unknown[] = [];
    const monthCalls = vi.fn(async (env: unknown) => {
      given.push(env);
      return 300;
    });

    const code = await withCli(["--yes", "--translated-leg", "both", "--date", "2026-10-04"], { deps: { monthCalls } });

    expect(code).toBe(0);
    expect(monthCalls).toHaveBeenCalledTimes(1);
    expect(given[0]).toMatchObject({ databaseUrl: SECRETS.SEARCH_TEST_DATABASE_URL, cohereApiKey: "cohere-key-value-123" });
    expect(logs.join("\n")).toMatch(/Cohere calls this month \(\d{4}-\d{2}, America\/Toronto\), every purpose, from spend_event: 300\. Allowance 1000, 200 kept for live search, so a run may use 500 more; this run makes at most 4\./);
  });

  it("refuses to start when the month's calls and the run's worst case would pass the allowance less the live-search reserve, names the numbers and what to do, and calls nothing", async () => {
    const dir = tempDir();
    const makeEngine = vi.fn();
    // Two English questions, both legs: at most 4 calls. 797 + 4 is 801, past 1000 - 200.
    const code = await withCli(["--yes", "--translated-leg", "both", "--date", "2026-10-04"], { dir, deps: { makeEngine, monthCalls: async () => 797 } });

    expect(code).toBe(1);
    expect(makeEngine).not.toHaveBeenCalled();
    expect(files(dir)).toEqual([]);
    const out = errs.join("\n");
    expect(out).toContain("797 calls used + at most 4 for this run is 801, past 800 (the allowance 1000 less the 200 kept for live search)");
    expect(out).toContain("Run one leg, or pass --max-calls 3 or less, or wait for the month to turn");
    expect(out).toContain("SEARCH_TEST_MONTHLY_CALLS");
  });

  it("fits a run that stays within what is left, to the call: the cap counts when it is lower than the plan", async () => {
    expect(await withCli(["--yes", "--translated-leg", "both", "--date", "2026-10-04"], { deps: { monthCalls: async () => 796 } })).toBe(0);
    errs.length = 0;
    const dir = tempDir();
    // 797 + 4 does not fit, but the cap of 3 means the run makes at most 3: 800, which does.
    expect(await withCli(["--yes", "--translated-leg", "both", "--max-calls", "3", "--date", "2026-10-04"], { dir, deps: { monthCalls: async () => 797 } })).toBe(1);
    expect(errs.join("\n")).not.toContain("Not enough of the month's calls left");
    expect(errs.join("\n")).toContain("Partial results"); // the cap stopped the run, as it should: 4 planned, 3 allowed
  });

  it("takes the allowance and the reserve from SEARCH_TEST_MONTHLY_CALLS and SEARCH_TEST_RESERVE_CALLS (blank is the default), and refuses values that are not whole numbers or a reserve that leaves nothing, naming the variable and not its value", async () => {
    const roomy = { ...goodEnv, SEARCH_TEST_MONTHLY_CALLS: "3000", SEARCH_TEST_RESERVE_CALLS: "0" };
    expect(await withCli(["--yes", "--translated-leg", "off", "--date", "2026-10-04"], { env: roomy, deps: { monthCalls: async () => 2990 } })).toBe(0);
    expect(logs.join("\n")).toContain("Allowance 3000, 0 kept for live search, so a run may use 10 more");

    expect(await withCli(["--yes", "--translated-leg", "off", "--date", "2026-10-05"], { env: { ...goodEnv, SEARCH_TEST_MONTHLY_CALLS: "", SEARCH_TEST_RESERVE_CALLS: " " }, deps: { monthCalls: async () => 0 } })).toBe(0);

    for (const [monthly, reserve, problem] of [
      ["lots", undefined, "SEARCH_TEST_MONTHLY_CALLS: must be a whole number of at least 1"],
      ["0", undefined, "SEARCH_TEST_MONTHLY_CALLS: must be a whole number of at least 1"],
      [undefined, "-5", "SEARCH_TEST_RESERVE_CALLS: must be a whole number of at least 0"],
      [undefined, "10.5", "SEARCH_TEST_RESERVE_CALLS: must be a whole number of at least 0"],
      ["500", "500", "SEARCH_TEST_RESERVE_CALLS: must be less than SEARCH_TEST_MONTHLY_CALLS"],
    ] as const) {
      errs.length = 0;
      const makeEngine = vi.fn();
      const code = await withCli(["--yes", "--translated-leg", "off"], { env: { ...goodEnv, SEARCH_TEST_MONTHLY_CALLS: monthly, SEARCH_TEST_RESERVE_CALLS: reserve }, deps: { makeEngine } });
      expect(code, problem).toBe(1);
      expect(errs.join("\n")).toContain(problem);
      expect(errs.join("\n")).not.toContain("lots");
      expect(makeEngine).not.toHaveBeenCalled();
    }
  });

  it("does not run when it cannot read this month's calls: it says so (by the error's code, never its words) and calls nothing", async () => {
    const makeEngine = vi.fn();
    const failedRead = Object.assign(new Error(`connection to ${SECRETS.SEARCH_TEST_DATABASE_URL} refused`), { code: "ECONNREFUSED" });

    const code = await withCli(["--yes", "--translated-leg", "off"], { deps: { makeEngine, monthCalls: async () => Promise.reject(failedRead) } });

    expect(code).toBe(1);
    expect(makeEngine).not.toHaveBeenCalled();
    expect(errs.join("\n")).toContain("could not read this month's Cohere calls from spend_event (ECONNREFUSED)");
    expect(errs.join("\n")).not.toContain("db-password-value");
  });

  it("does not read the month's calls for a run that is refused before it (a missing setting, a report that exists)", async () => {
    const monthCalls = vi.fn(async () => 0);
    const dir = tempDir();

    expect(await withCli(["--yes", "--translated-leg", "off"], { env: { ...SECRETS, COHERE_API_KEY: undefined }, deps: { monthCalls } })).toBe(1);
    expect(await withCli(["--yes", "--translated-leg", "off", "--date", "2026-10-04"], { dir })).toBe(0);
    expect(await withCli(["--yes", "--translated-leg", "off", "--date", "2026-10-04"], { dir, deps: { monthCalls } })).toBe(1);
    expect(monthCalls).not.toHaveBeenCalled();
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
    expect(errs.join("\n")).toContain("off: max_calls (the next question could pass --max-calls)");
    expect(logs.join("\n")).toContain("PARTIAL RESULTS");
  });

  it("does not run the next leg once a leg has stopped: no engine, no calls, no report for it, and the message says so", async () => {
    const dir = tempDir();
    const questions = ["a", "b", "c"].map((id) => q(id));

    // The cap stops the first leg after one question: the second would stop at its first.
    const code = await withCli(["--yes", "--translated-leg", "both", "--max-calls", "1", "--date", "2026-10-04"], { dir, questions });

    expect(code).toBe(1);
    expect(madeLegs).toEqual([false]);
    expect(files(dir)).toEqual(["2026-10-04-embed-v4.0-leg-off-tuning.json", "2026-10-04-embed-v4.0-production-tuning.json"]);
    const report = TuningReportSchema.parse(JSON.parse(read(dir, "2026-10-04-embed-v4.0-production-tuning.json")));
    expect(report.legs.off).toMatchObject({ stopped: "max_calls", counts: { asked: 1, not_run: 2 } });
    expect(report.legs.on).toBeNull();
    expect(errs.join("\n")).toContain("the translated-question leg on was not run after it");
    expect(logs.join("\n")).toContain("Reports written to");
    expect(logs.join("\n")).not.toContain("leg-on-tuning.json");
  });

  it("does not run the next leg after a vendor's quota stopped the first, and says that is why", async () => {
    const dir = tempDir();
    const engine = fakeEngine((_question, n) => (n === 1 ? failed([quota()]) : asked({ M001: 0.9, M003: 0.05 })));

    const code = await withCli(["--yes", "--translated-leg", "both", "--date", "2026-10-04"], { dir, questions: ["a", "b", "c"].map((id) => q(id)), engine });

    expect(code).toBe(1);
    expect(madeLegs).toEqual([false]);
    expect(engine.log).toEqual(["a", "b"]);
    expect(errs.join("\n")).toContain("off: quota (a vendor refused a call as past its monthly limit)");
    expect(logs.join("\n")).toContain("PARTIAL RESULTS: the run stopped (a vendor refused a call as past its monthly limit)");
    const summary = markdownSummary(TuningReportSchema.parse(JSON.parse(read(dir, "2026-10-04-embed-v4.0-production-tuning.json"))));
    expect(summary.join("\n")).toContain("**Partial results:** the run stopped (a vendor refused a call as past its monthly limit)");
  });

  it("keeps each question's row as it is asked, in a progress file that is gone once the reports are written", async () => {
    const dir = tempDir();
    const progress = "2026-10-04-embed-v4.0-production-tuning-progress.jsonl";
    let during: string[] = [];
    const engine = fakeEngine((question) => {
      during = files(dir);
      return question.intent === "no_match" ? asked({ M001: 0.1, M003: 0.05 }) : asked({ M001: 0.9, M003: 0.05 });
    });

    expect(await withCli(["--yes", "--translated-leg", "off", "--date", "2026-10-04"], { dir, engine })).toBe(0);

    expect(files(dir)).toEqual(["2026-10-04-embed-v4.0-leg-off-tuning.json", "2026-10-04-embed-v4.0-production-tuning.json"]);
    expect(during).toEqual([progress]); // there while the questions were asked (after the first one's row)
  });

  it("leaves what a run that failed half way paid for: the rows so far, the calls made, and where they are", async () => {
    const dir = tempDir();
    const secretText = "zq4-text-of-a-question-nobody-may-see";
    const questions = [q("a", { q: `${secretText} a` }), q("b", { q: `${secretText} b` }), q("c", { q: `${secretText} c` })];
    const engine = fakeEngine((_question, n) => {
      if (n === 2) throw new Error("the current release changed during the run");
      return asked({ M001: 0.9, M003: 0.05 }, { ms: 80 + n });
    });

    expect(await withCli(["--yes", "--translated-leg", "off", "--date", "2026-10-04"], { dir, questions, engine })).toBe(1);

    expect(files(dir)).toEqual(["2026-10-04-embed-v4.0-production-tuning-progress.jsonl"]);
    const rows = read(dir, "2026-10-04-embed-v4.0-production-tuning-progress.jsonl").trim().split("\n").map((line) => JSON.parse(line) as { leg: string; id: string; outcome: string; ms: number });
    expect(rows.map((r) => [r.leg, r.id, r.outcome, r.ms])).toEqual([["off", "a", "hit", 80], ["off", "b", "hit", 81]]);
    expect(errs.join("\n")).toContain("The run failed: the current release changed during the run");
    expect(errs.join("\n")).toContain("Vendor calls made before it failed: 2.");
    expect(errs.join("\n")).toContain("2026-10-04-embed-v4.0-production-tuning-progress.jsonl");
    expect(files(dir).map((f) => read(dir, f)).join("\n")).not.toContain(secretText);
    expect(engine.closed()).toBe(true);
  });

  it("does not start over a progress file an earlier run left (it is what that run paid for) without --force", async () => {
    const dir = tempDir();
    const questions = [q("a"), q("b")];
    const failing = fakeEngine((_question, n) => {
      if (n === 1) throw new Error("boom");
      return asked({ M001: 0.9, M003: 0.05 });
    });
    const args = ["--yes", "--translated-leg", "off", "--date", "2026-10-04"];
    expect(await withCli(args, { dir, questions, engine: failing })).toBe(1);
    const makeEngine = vi.fn();

    expect(await withCli(args, { dir, questions, deps: { makeEngine } })).toBe(1);
    expect(errs.join("\n")).toContain("production-tuning-progress.jsonl already exists");
    expect(makeEngine).not.toHaveBeenCalled();

    expect(await withCli([...args, "--force"], { dir, questions })).toBe(0);
    expect(files(dir)).toEqual(["2026-10-04-embed-v4.0-leg-off-tuning.json", "2026-10-04-embed-v4.0-production-tuning.json"]);
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
    // The first leg's report, and the progress file that holds its rows too: the combined report is not written.
    expect(files(dir)).toEqual(["2026-10-04-embed-v4.0-leg-off-tuning.json", "2026-10-04-embed-v4.0-production-tuning-progress.jsonl"]);
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
    expect(text).toMatch(/time per question over all 2 asked, those that failed included: p50 \d+(\.\d)? ms, p95 \d+(\.\d)? ms; 0 of them ended without an answer/);
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
