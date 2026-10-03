// Suggesting the no-match threshold (S03.07). Pure: it reads the scores a run measured and says which value the team could
// choose; it sets nothing (the threshold is recorded on a release when the directory is published, SEARCH_THRESHOLD).
//
// The rule: the value that keeps every no-match question of the run below it while losing the fewest hits. A question is
// "kept below" when its top similarity is under the threshold, so it gets "no clear match". A hit is lost when the best
// expected provider of the question has a similarity under the threshold (a provider outside the top 5 was never a hit).
// Losing hits only grows as the threshold rises, so the best value is the lowest one that is strictly above the highest
// no-match top score, rounded up to four places.
import type { QuestionIntent } from "@/contracts/searchTestSet";

export type ThresholdRow = {
  id: string;
  intent: QuestionIntent;
  /** The highest similarity of any provider to the question, before any threshold; null when the engine did not answer. */
  topScore: number | null;
  /** The highest similarity among the question's expected providers that are in the top 5; null when none is (a miss at any threshold). */
  expectedScore: number | null;
};

export type HitCount = { hits: number; of: number; lost: number; lostIds: string[] };

export type ThresholdSuggestion = {
  /** The suggested threshold; null when the rows cannot give one (see `reason`). */
  threshold: number | null;
  reason: string | null;
  noMatchQuestions: number;
  /** The highest top score among the no-match questions; null when there is none. */
  highestNoMatch: number | null;
  /** The hits that would remain at the suggested threshold, and those it would lose. */
  atSuggested: HitCount | null;
  /** The same count at the release's own threshold, for comparison; null when it is not given. */
  atCurrent: (HitCount & { threshold: number }) | null;
};

const PLACES = 1e4;

/**
 * The hits at `threshold`: questions (not no-match) with an expected provider in the top 5 and at or above it. `lost` counts
 * those that were in the top 5 but fall below it: what raising the threshold costs. A question whose expected providers
 * never reached the top 5 was never a hit and is not counted as lost.
 */
export function hitsAt(rows: readonly ThresholdRow[], threshold: number): HitCount {
  const answerable = rows.filter((r) => r.intent !== "no_match");
  const lost = answerable.filter((r) => r.expectedScore !== null && r.expectedScore < threshold);
  const hits = answerable.filter((r) => r.expectedScore !== null && r.expectedScore >= threshold).length;
  return { hits, of: answerable.length, lost: lost.length, lostIds: lost.map((r) => r.id) };
}

/** The smallest value to four places that is strictly above `score`. */
export function justAbove(score: number): number {
  const up = Math.ceil(score * PLACES) / PLACES;
  return up > score ? up : (Math.round(score * PLACES) + 1) / PLACES;
}

/**
 * The threshold the rows suggest. `current` is the threshold the release being measured has, shown for comparison. Returns a
 * null threshold with a reason when there is no no-match question, or a no-match question the engine did not answer (its
 * score is unknown, so nothing can be promised about it).
 */
export function suggestThreshold(rows: readonly ThresholdRow[], current?: number): ThresholdSuggestion {
  const noMatch = rows.filter((r) => r.intent === "no_match");
  const withScore = noMatch.filter((r) => r.topScore !== null);
  const atCurrent = current === undefined ? null : { threshold: current, ...hitsAt(rows, current) };
  const none = (reason: string): ThresholdSuggestion => ({
    threshold: null,
    reason,
    noMatchQuestions: noMatch.length,
    highestNoMatch: withScore.length === 0 ? null : Math.max(...withScore.map((r) => r.topScore as number)),
    atSuggested: null,
    atCurrent,
  });
  if (noMatch.length === 0) return none("the run has no no-match question");
  if (withScore.length < noMatch.length) return none(`${noMatch.length - withScore.length} no-match question(s) were not answered, so their scores are unknown`);
  const highest = Math.max(...withScore.map((r) => r.topScore as number));
  const threshold = justAbove(highest);
  return { threshold, reason: null, noMatchQuestions: noMatch.length, highestNoMatch: highest, atSuggested: hitsAt(rows, threshold), atCurrent };
}
