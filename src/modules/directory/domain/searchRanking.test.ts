import { describe, expect, it } from "vitest";
import { MAX_RESULTS, RRF_K, cosine, emergencyFirst, rankLegs } from "./searchRanking";

const leg = (entries: Record<string, number>) => new Map(Object.entries(entries));

describe("cosine", () => {
  it("is 1 for the same direction, 0 for orthogonal vectors, and 0 for a vector with no length", () => {
    expect(cosine([1, 2], [2, 4])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe("the ranking sequence", () => {
  it("keeps only providers at or above the threshold, best first, never padding the list", () => {
    expect(rankLegs([leg({ A: 0.31, B: 0.3, C: 0.29, D: 0.9 })], 0.3)).toEqual([
      { provider_id: "D", score: 0.9 },
      { provider_id: "A", score: 0.31 },
      { provider_id: "B", score: 0.3 },
    ]);
  });

  it("is empty when nothing qualifies", () => {
    expect(rankLegs([leg({ A: 0.1 })], 0.3)).toEqual([]);
    expect(rankLegs([], 0.3)).toEqual([]);
  });

  it("returns at most five", () => {
    const many = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`P${i}`, 0.9 - i * 0.01]));

    const results = rankLegs([leg(many)], 0.3);

    expect(results).toHaveLength(MAX_RESULTS);
    expect(results.map((r) => r.provider_id)).toEqual(["P0", "P1", "P2", "P3", "P4"]);
  });

  it("breaks a tie by provider id, so the order does not depend on the file's order", () => {
    expect(rankLegs([leg({ B: 0.5, A: 0.5 })], 0.3).map((r) => r.provider_id)).toEqual(["A", "B"]);
  });

  it("with two completed legs orders qualifying providers by reciprocal rank fusion and scores them with their best similarity, never with the fused score", () => {
    // Leg 1 ranks A, B, C; leg 2 ranks C, B (A is below the threshold there): C and B are in both lists.
    const results = rankLegs([leg({ A: 0.9, B: 0.8, C: 0.7 }), leg({ C: 0.95, B: 0.6, A: 0.1 })], 0.3);

    // fused: A = 1/61, B = 1/62 + 1/62, C = 1/63 + 1/61
    expect(RRF_K).toBe(60);
    expect(results.map((r) => r.provider_id)).toEqual(["C", "B", "A"]);
    expect(results.map((r) => r.score)).toEqual([0.95, 0.8, 0.9]);
  });

  it("rounds the score to six places", () => {
    expect(rankLegs([leg({ A: 0.123456789 })], 0.1)).toEqual([{ provider_id: "A", score: 0.123457 }]);
  });
});

describe("emergencyFirst", () => {
  it("is true when any result is an emergency provider", () => {
    const results = [{ provider_id: "A", score: 1 }, { provider_id: "B", score: 0.5 }];

    expect(emergencyFirst(results, new Set(["B"]))).toBe(true);
    expect(emergencyFirst(results, new Set(["Z"]))).toBe(false);
    expect(emergencyFirst([], new Set(["B"]))).toBe(false);
  });
});
