// How a question's similarities become results (S03.04; the "ranking sequence" of the E03 definitions). Pure.
//
//  (1) similarity of each provider in each completed leg (cosine);
//  (2) keep only qualifying providers: similarity at or above the release's threshold (the higher of the legs');
//  (3) with two completed legs, order the qualifying providers by reciprocal rank fusion (k = 60) of their ranks in each
//      leg's qualifying list, otherwise by similarity; an RRF score is never compared with the threshold;
//  (4) return the top 5. Providers below the threshold are never added to fill the list.
export const MAX_RESULTS = 5;
export const RRF_K = 60;

export interface SearchHit {
  provider_id: string;
  score: number;
}

/** A leg's similarities: one per provider of the release. */
export type LegSimilarities = ReadonlyMap<string, number>;

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
/** The score the client sees: the similarity, to six places. */
const rounded = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * The results for the legs that completed (one or two), at most MAX_RESULTS, each with its qualifying similarity. Empty
 * when no provider qualifies.
 */
export function rankLegs(legs: readonly LegSimilarities[], threshold: number): SearchHit[] {
  const qualifying = legs.map((leg) => [...leg].filter(([, similarity]) => similarity >= threshold).map(([id, score]) => ({ provider_id: id, score })).sort(byScoreThenId));
  const best = new Map<string, number>();
  for (const leg of qualifying) for (const hit of leg) best.set(hit.provider_id, Math.max(best.get(hit.provider_id) ?? -Infinity, hit.score));

  let ordered: SearchHit[];
  if (qualifying.length >= 2) {
    const fused = new Map<string, number>();
    for (const leg of qualifying.slice(0, 2)) leg.forEach((hit, index) => fused.set(hit.provider_id, (fused.get(hit.provider_id) ?? 0) + 1 / (RRF_K + index + 1)));
    ordered = [...fused].sort(([ia, a], [ib, b]) => b - a || ia.localeCompare(ib)).map(([id]) => ({ provider_id: id, score: best.get(id)! }));
  } else {
    ordered = [...best].map(([id, score]) => ({ provider_id: id, score })).sort(byScoreThenId);
  }
  return ordered.slice(0, MAX_RESULTS).map((hit) => ({ provider_id: hit.provider_id, score: rounded(hit.score) }));
}

/** True when any result is a provider of an emergency category. */
export function emergencyFirst(results: readonly SearchHit[], emergencyProviders: ReadonlySet<string>): boolean {
  return results.some((hit) => emergencyProviders.has(hit.provider_id));
}
