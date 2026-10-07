// How a question's similarities become results (S03.04; the "ranking sequence" of the E03 definitions, as changed by the
// interim tuning of 2026-10-07, data/search-test-set/reports/2026-10-07-interim-tuning.md). Pure.
//
//  (1) similarity of each provider in each completed leg (cosine), and a provider's best similarity over the legs;
//  (2) the route:
//      - `hybrid`, for a question in English and for one the translated-question leg answered (there is English text to match
//        words against): each provider's score is its best similarity plus its keyword boost (searchKeywords.ts:
//        weight × bm25 / (bm25 + 4) over the question and its English translation); the top 5 with a score at or above the
//        release's threshold are the results;
//      - `direct`, for any other question (another language in its own script, or one whose translated leg did not complete):
//        the score is the similarity; when the best one reaches the direct floor, the top 5 that are no more than the direct gap
//        below it are the results, otherwise there are none (cross-lingual similarities run lower, and words cannot be matched);
//      - the direct route reranked (arm R2, application/search.ts decides when): the 20 most similar providers, ordered by a
//        reranker's relevance, the top 5 at or above SEARCH_RERANK_MIN (`rerankCandidates`, `rerankedResults`);
//  (3) never more than 5, and nothing below the bar is added to fill the list.
// The score a result carries is the score it was ranked by (similarity plus boost on the hybrid route), to six places; on the
// reranked direct route it is the similarity, which is not what the results are ordered by there.
export const MAX_RESULTS = 5;
/** The emergency-only threshold of the top-3 fail-safe when none is configured (SEARCH_EMERGENCY_THRESHOLD, owner decision 41). */
export const DEFAULT_EMERGENCY_THRESHOLD = 0.25;
/** SEARCH_KEYWORD_WEIGHT: the most the keyword match can add to a similarity. */
export const DEFAULT_KEYWORD_WEIGHT = 0.15;
/** SEARCH_DIRECT_FLOOR: the best similarity a direct-route question needs for any result. */
export const DEFAULT_DIRECT_FLOOR = 0.24;
/** SEARCH_DIRECT_GAP: on the direct route, a provider further than this below the best similarity is not shown. */
export const DEFAULT_DIRECT_GAP = 0.1;
/** SEARCH_EMERGENCY_TOP_THRESHOLD: the similarity at which an emergency provider that is the best match of a leg turns `emergency_first` on. */
export const DEFAULT_EMERGENCY_TOP_THRESHOLD = 0.14;

export interface SearchHit {
  provider_id: string;
  score: number;
}

/** A leg's similarities: one per provider of the release. */
export type LegSimilarities = ReadonlyMap<string, number>;

/** `hybrid`: similarity plus keyword boost, against the release's threshold. `direct`: similarity alone, floor and gap. */
export type RankingRoute = "hybrid" | "direct";

/** The values the ranking and the emergency flag are decided with. */
export interface RankingSettings {
  /** The release's threshold (SEARCH_THRESHOLD, recorded on the release): the least score a result has on the hybrid route. */
  threshold: number;
  /** The least best similarity for any result on the direct route. */
  directFloor: number;
  /** On the direct route, the furthest below the best similarity a result may be. */
  directGap: number;
  /** The top-3 fail-safe's similarity (applied at most as high as `threshold`). */
  emergencyThreshold: number;
  /** The similarity at which an emergency provider that is a leg's best match sets the flag. */
  emergencyTopThreshold: number;
}

/** Cosine similarity of two vectors of the same length; 0 when either has no length. */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

const byScoreThenId = (a: SearchHit, b: SearchHit) => b.score - a.score || a.provider_id.localeCompare(b.provider_id);
/** The score the client sees, to six places. */
const rounded = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * Every provider of the completed legs with the score it is ranked by, best first (ties by id), not rounded: its best
 * similarity over the legs, plus its keyword boost on the hybrid route.
 */
export function rankingScores(legs: readonly LegSimilarities[], route: RankingRoute, boosts: ReadonlyMap<string, number> = new Map()): SearchHit[] {
  const best = new Map<string, number>();
  for (const leg of legs) for (const [id, similarity] of leg) best.set(id, Math.max(best.get(id) ?? -Infinity, similarity));
  return [...best]
    .map(([id, similarity]) => ({ provider_id: id, score: route === "hybrid" ? similarity + (boosts.get(id) ?? 0) : similarity }))
    .sort(byScoreThenId);
}

/** The results from scores ranked by `rankingScores`: at most MAX_RESULTS, by the route's rule, not rounded. */
export function resultsOf(scores: readonly SearchHit[], route: RankingRoute, settings: Pick<RankingSettings, "threshold" | "directFloor" | "directGap">): SearchHit[] {
  if (route === "hybrid") return scores.filter((hit) => hit.score >= settings.threshold).slice(0, MAX_RESULTS);
  const top = scores[0];
  if (!top || top.score < settings.directFloor) return [];
  return scores.slice(0, MAX_RESULTS).filter((hit) => hit.score >= top.score - settings.directGap);
}

/**
 * The results for the legs that completed (one or two), at most MAX_RESULTS, each with the score it was ranked by. Empty when
 * nothing reaches the route's bar.
 */
export function rankLegs(
  legs: readonly LegSimilarities[],
  route: RankingRoute,
  boosts: ReadonlyMap<string, number> | undefined,
  settings: Pick<RankingSettings, "threshold" | "directFloor" | "directGap">,
): SearchHit[] {
  return resultsOf(rankingScores(legs, route, boosts), route, settings).map((hit) => ({ provider_id: hit.provider_id, score: rounded(hit.score) }));
}

/** How many of a leg's best providers the emergency fail-safe looks at (owner decision 41). */
export const EMERGENCY_TOP_K = 3;

const sortedLeg = (leg: LegSimilarities) => [...leg].map(([id, score]) => ({ provider_id: id, score })).sort(byScoreThenId);

/**
 * The emergency fail-safe (owner decision 41): true when a provider of an emergency category is among the top
 * EMERGENCY_TOP_K of any completed leg (by similarity, ties by id) and its similarity there is at least `threshold`, the
 * emergency-only threshold. It looks at the legs, not at the results, so it holds when nothing is shown.
 */
export function emergencyInTop(legs: readonly LegSimilarities[], emergencyProviders: ReadonlySet<string>, threshold: number): boolean {
  return legs.some((leg) =>
    sortedLeg(leg)
      .slice(0, EMERGENCY_TOP_K)
      .some((hit) => hit.score >= threshold && emergencyProviders.has(hit.provider_id)),
  );
}

/**
 * True when the best match (by similarity, ties by id) of any completed leg is a provider of an emergency category with a
 * similarity of at least `threshold`. An emergency provider is often the single best match of an emergency question at a
 * low similarity (0.14 to 0.26 in the test set), and it is never the best match of the other questions there.
 */
export function emergencyOnTop(legs: readonly LegSimilarities[], emergencyProviders: ReadonlySet<string>, threshold: number): boolean {
  return legs.some((leg) => {
    const top = sortedLeg(leg)[0];
    return top !== undefined && top.score >= threshold && emergencyProviders.has(top.provider_id);
  });
}

/**
 * `emergency_first`: an emergency provider is the best match of a leg at `emergencyTopThreshold` or more, or is in a leg's top 3
 * at the emergency-only threshold (never used above the release's threshold). Decided on the legs' similarities, not on what is
 * shown: an emergency-category result alone no longer turns it on (the category holds the shelters, which a question about food
 * also lists).
 */
export function emergencyFirst(
  legs: readonly LegSimilarities[],
  emergencyProviders: ReadonlySet<string>,
  settings: Pick<RankingSettings, "threshold" | "emergencyThreshold" | "emergencyTopThreshold">,
): boolean {
  return (
    emergencyOnTop(legs, emergencyProviders, settings.emergencyTopThreshold) ||
    emergencyInTop(legs, emergencyProviders, Math.min(settings.emergencyThreshold, settings.threshold))
  );
}

// ---------------------------------------------------------------- the reranked direct route (arm R2 of the interim tuning)
/** How many of the direct leg's best providers the reranker is asked to order (the experiment's top 20). */
export const RERANK_CANDIDATES = 20;
/** SEARCH_RERANK_MIN: the least relevance (0 to 1, the reranker's own scale) a reranked provider needs to be a result. */
export const DEFAULT_RERANK_MIN = 0.05;

/** The providers the reranker is asked about: the best RERANK_CANDIDATES by similarity over the completed legs (ties by id), not rounded. */
export function rerankCandidates(legs: readonly LegSimilarities[]): SearchHit[] {
  return rankingScores(legs, "direct").slice(0, RERANK_CANDIDATES);
}

/**
 * The results of the reranked direct route: the candidates whose relevance is at least `minRelevance`, best relevance first (ties
 * by id), at most MAX_RESULTS; nothing below the bar is added to fill the list (none at all when no candidate reaches it). Each
 * result keeps the `score` of the direct route, its similarity (to six places): the relevance only orders and filters, so a
 * result's `score` means the same on every route, and may be lower than the next result's on this one.
 */
export function rerankedResults(candidates: readonly SearchHit[], relevance: ReadonlyMap<string, number>, minRelevance: number): SearchHit[] {
  return candidates
    .flatMap((hit) => {
      const r = relevance.get(hit.provider_id);
      return r !== undefined && r >= minRelevance ? [{ hit, r }] : [];
    })
    .sort((a, b) => b.r - a.r || a.hit.provider_id.localeCompare(b.hit.provider_id))
    .slice(0, MAX_RESULTS)
    .map(({ hit }) => ({ provider_id: hit.provider_id, score: rounded(hit.score) }));
}
