// scripts/search-test-set: suggesting the no-match threshold (S03.07). It reads what the search use case saw for each tuning
// question (the similarity of every provider in each leg that completed, handed over by the use case's `observe`) and says
// which value the team could choose; it sets nothing (the threshold is recorded on a release when the directory is published,
// SEARCH_THRESHOLD, and stays provisional until S03.08's evaluation run).
//
// The rule (the story's): the value that keeps every tuning no-match question below it while losing the fewest hits. A
// question is below the threshold when no provider reaches it in any leg, which is when the use case answers `no_clear_match`
// (a provider qualifies at or above the threshold). Raising the threshold never brings a hit back, so the fewest hits are lost
// by the lowest value that is strictly above the highest no-match similarity, rounded up to four places.
//
// Nothing here ranks: what a threshold does to a question (its results, whether it is a hit, no-match or emergency) is asked
// of the use case's own pure functions, `rankLegs`, `emergencyFirst` and `emergencyInTop`, applied to the similarities the use
// case computed. And the same call at the release's own threshold is compared with what the use case answered, so a drift
// between the two would show up as `replay_mismatches`.
import { emergencyFirst, emergencyInTop, rankLegs, type SearchObservation } from "@/modules/directory";
import type { QuestionIntent, SearchV1 } from "@/contracts/searchTestSet";
import type { ThresholdEffect, ThresholdSuggestion } from "@/contracts/searchTuning";

export interface ThresholdInput {
  id: string;
  intent: QuestionIntent;
  expected: readonly string[];
  /** Every expected provider is missing from the release: the question can never be a hit and is left out of the hits. */
  unanswerable: boolean;
  /** What the use case saw; null when the question was not scored (a vendor failure, a stopped run). */
  observation: SearchObservation | null;
  /** What the use case answered, to compare the replay with. */
  answer: Pick<SearchV1, "results" | "emergency_first"> | null;
}

const PLACES = 1e4;
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** The smallest value to four places that is strictly above `score`. */
export function justAbove(score: number): number {
  const up = Math.ceil(score * PLACES) / PLACES;
  return up > score ? up : (Math.round(score * PLACES) + 1) / PLACES;
}

const legsOf = (o: SearchObservation) => o.legs.map((l) => l.similarities);

/** The highest similarity of any provider in any leg. */
export function maxSimilarity(o: SearchObservation): number {
  let max = -Infinity;
  for (const leg of o.legs) for (const score of leg.similarities.values()) if (score > max) max = score;
  return max;
}

/** What the use case would answer for the observation at `threshold`, by its own functions. */
function replay(o: SearchObservation, threshold: number) {
  const legs = legsOf(o);
  const results = rankLegs(legs, threshold);
  const emergency = emergencyFirst(results, o.emergencyProviders) || emergencyInTop(legs, o.emergencyProviders, Math.min(o.emergencyThreshold, threshold));
  return { results, emergency };
}

const isHit = (results: readonly { provider_id: string }[], expected: readonly string[]) => results.some((r) => expected.includes(r.provider_id));

/** The effect of a threshold on the scored questions; `baseline` are the hits there are with no threshold at all. */
function effectAt(inputs: readonly ThresholdInput[], threshold: number, baseline: ReadonlySet<string>): { effect: ThresholdEffect; lowestKeptHit: number | null } {
  let hitsKept = 0;
  let noMatchClear = 0;
  let emergencyOn = 0;
  let lowest: number | null = null;
  const lost: string[] = [];
  for (const input of inputs) {
    const o = input.observation;
    if (!o) continue;
    const { results, emergency } = replay(o, threshold);
    if (input.intent === "no_match") {
      if (results.length === 0) noMatchClear += 1;
      continue;
    }
    if (input.intent === "emergency" && emergency) emergencyOn += 1;
    if (input.unanswerable) continue;
    if (isHit(results, input.expected)) {
      hitsKept += 1;
      const best = Math.max(...results.filter((r) => input.expected.includes(r.provider_id)).map((r) => r.score));
      lowest = lowest === null ? best : Math.min(lowest, best);
    } else if (baseline.has(input.id)) {
      lost.push(input.id);
    }
  }
  return { effect: { threshold, hits_kept: hitsKept, hits_lost: lost.length, lost_ids: lost, no_match_clear: noMatchClear, emergency_on: emergencyOn }, lowestKeptHit: lowest };
}

/**
 * The threshold the scored questions suggest, and what it and the release's own threshold do to them. The threshold is null,
 * with the reason, when the run has no no-match question, when one of them was not scored (its similarity is unknown, so
 * nothing can be promised about it), or when no value up to 1 is above the highest of them.
 */
export function suggestThreshold(inputs: readonly ThresholdInput[], releaseThreshold: number): ThresholdSuggestion {
  const scored = inputs.filter((i) => i.observation !== null);
  const answerable = scored.filter((i) => i.intent !== "no_match" && !i.unanswerable);
  const baseline = new Set(answerable.filter((i) => isHit(rankLegs(legsOf(i.observation!), -Infinity), i.expected)).map((i) => i.id));
  const atRelease = effectAt(inputs, releaseThreshold, baseline).effect;

  let mismatches = 0;
  for (const input of scored) {
    if (!input.answer) continue;
    const again = replay(input.observation!, input.observation!.threshold);
    const same = again.results.length === input.answer.results.length && again.results.every((r, i) => r.provider_id === input.answer!.results[i]!.provider_id && r.score === input.answer!.results[i]!.score);
    if (!same || again.emergency !== input.answer.emergency_first) mismatches += 1;
  }

  const noMatch = inputs.filter((i) => i.intent === "no_match");
  const scoredNoMatch = noMatch.filter((i) => i.observation !== null);
  const highest = scoredNoMatch.length === 0 ? null : Math.max(...scoredNoMatch.map((i) => maxSimilarity(i.observation!)));
  const base = {
    no_match_questions: noMatch.length,
    highest_no_match: highest === null ? null : round6(highest),
    lowest_kept_hit: null,
    hit_margin: null,
    answerable_questions: answerable.length,
    hits_without_threshold: baseline.size,
    at_suggested: null,
    at_release: atRelease,
    replay_mismatches: mismatches,
  } as const;
  const none = (reason: string): ThresholdSuggestion => ({ threshold: null, reason, ...base });

  if (noMatch.length === 0) return none("the run has no no-match question");
  if (scoredNoMatch.length < noMatch.length) {
    return none(`${noMatch.length - scoredNoMatch.length} of ${noMatch.length} no-match questions were not scored (a vendor failure or a run that stopped), so their similarities are unknown`);
  }
  const threshold = justAbove(highest as number);
  if (threshold > 1) return none(`the highest no-match similarity is ${round6(highest as number)}: no threshold up to 1 is above it`);

  const { effect: suggested, lowestKeptHit } = effectAt(inputs, threshold, baseline);
  return {
    threshold,
    reason: null,
    ...base,
    lowest_kept_hit: lowestKeptHit === null ? null : round6(lowestKeptHit),
    hit_margin: lowestKeptHit === null ? null : round6(lowestKeptHit - (highest as number)),
    at_suggested: suggested,
  };
}
