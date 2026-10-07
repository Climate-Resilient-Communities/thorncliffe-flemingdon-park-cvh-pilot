import { describe, expect, it } from "vitest";
import {
  DEFAULT_DIRECT_FLOOR,
  DEFAULT_DIRECT_GAP,
  DEFAULT_EMERGENCY_THRESHOLD,
  DEFAULT_EMERGENCY_TOP_THRESHOLD,
  EMERGENCY_TOP_K,
  MAX_RESULTS,
  cosine,
  emergencyFirst,
  emergencyInTop,
  emergencyOnTop,
  rankLegs,
  rankingScores,
  type RankingSettings,
} from "./searchRanking";

const leg = (entries: Record<string, number>) => new Map(Object.entries(entries));
const boosts = (entries: Record<string, number>) => new Map(Object.entries(entries));
const SETTINGS: RankingSettings = {
  threshold: 0.27,
  directFloor: DEFAULT_DIRECT_FLOOR,
  directGap: DEFAULT_DIRECT_GAP,
  emergencyThreshold: DEFAULT_EMERGENCY_THRESHOLD,
  emergencyTopThreshold: DEFAULT_EMERGENCY_TOP_THRESHOLD,
};
const at = (threshold: number) => ({ ...SETTINGS, threshold });

describe("cosine", () => {
  it("is 1 for the same direction, 0 for orthogonal vectors, and 0 for a vector with no length", () => {
    expect(cosine([1, 2], [2, 4])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe("the defaults (interim tuning, 2026-10-07)", () => {
  it("are the measured setting: direct floor 0.24, gap 0.10, emergency top 0.14, top-3 fail-safe 0.25", () => {
    expect([DEFAULT_DIRECT_FLOOR, DEFAULT_DIRECT_GAP, DEFAULT_EMERGENCY_TOP_THRESHOLD, DEFAULT_EMERGENCY_THRESHOLD]).toEqual([0.24, 0.1, 0.14, 0.25]);
  });
});

describe("the hybrid route (English, or the translated leg answered)", () => {
  it("keeps only providers whose score reaches the threshold, best first, never padding the list", () => {
    expect(rankLegs([leg({ A: 0.31, B: 0.27, C: 0.269, D: 0.9 })], "hybrid", undefined, SETTINGS)).toEqual([
      { provider_id: "D", score: 0.9 },
      { provider_id: "A", score: 0.31 },
      { provider_id: "B", score: 0.27 },
    ]);
  });

  it("scores a provider as its similarity plus its keyword boost, and the boost can lift it over the threshold and up the list", () => {
    const results = rankLegs([leg({ A: 0.29, B: 0.26, C: 0.2 })], "hybrid", boosts({ B: 0.06, C: 0.05 }), SETTINGS);

    // B: 0.26 + 0.06 = 0.32 passes A; C: 0.2 + 0.05 = 0.25 stays below 0.27.
    expect(results).toEqual([
      { provider_id: "B", score: 0.32 },
      { provider_id: "A", score: 0.29 },
    ]);
  });

  it("is empty when nothing reaches the threshold, and with no leg", () => {
    expect(rankLegs([leg({ A: 0.1 })], "hybrid", boosts({ A: 0.1 }), SETTINGS)).toEqual([]);
    expect(rankLegs([], "hybrid", undefined, SETTINGS)).toEqual([]);
  });

  it("returns at most five", () => {
    const many = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`P${i}`, 0.9 - i * 0.01]));

    const results = rankLegs([leg(many)], "hybrid", undefined, SETTINGS);

    expect(results).toHaveLength(MAX_RESULTS);
    expect(results.map((r) => r.provider_id)).toEqual(["P0", "P1", "P2", "P3", "P4"]);
  });

  it("breaks a tie by provider id, so the order does not depend on the file's order", () => {
    expect(rankLegs([leg({ B: 0.5, A: 0.5 })], "hybrid", undefined, SETTINGS).map((r) => r.provider_id)).toEqual(["A", "B"]);
  });

  it("with two completed legs ranks each provider by its best similarity over them (no rank fusion)", () => {
    // Leg 1 ranks A, B, C; leg 2 ranks C, B: C's 0.95 in the translated leg puts it first.
    const results = rankLegs([leg({ A: 0.9, B: 0.8, C: 0.7 }), leg({ C: 0.95, B: 0.6, A: 0.1 })], "hybrid", undefined, SETTINGS);

    expect(results).toEqual([
      { provider_id: "C", score: 0.95 },
      { provider_id: "A", score: 0.9 },
      { provider_id: "B", score: 0.8 },
    ]);
  });

  it("rounds the score to six places (the ranking uses the full value)", () => {
    expect(rankLegs([leg({ A: 0.123456789 })], "hybrid", undefined, at(0.1))).toEqual([{ provider_id: "A", score: 0.123457 }]);
    expect(rankingScores([leg({ A: 0.2 })], "hybrid", boosts({ A: 0.0123456789 }))[0]!.score).toBeCloseTo(0.2123456789, 10);
  });
});

describe("the direct route (another language with no translated leg)", () => {
  it("shows the top five when the best similarity reaches the floor, less those more than the gap below it", () => {
    const results = rankLegs([leg({ A: 0.3, B: 0.25, C: 0.2, D: 0.199, E: 0.1 })], "direct", undefined, SETTINGS);

    // 0.3 - 0.10 = 0.2: C (exactly the gap below) stays, D and E go.
    expect(results.map((r) => r.provider_id)).toEqual(["A", "B", "C"]);
  });

  it("shows nothing when the best similarity is below the floor, whatever the release's threshold", () => {
    expect(rankLegs([leg({ A: 0.239, B: 0.2 })], "direct", undefined, at(0.1))).toEqual([]);
    expect(rankLegs([leg({ A: 0.24 })], "direct", undefined, at(0.9))).toEqual([{ provider_id: "A", score: 0.24 }]);
  });

  it("ignores keyword boosts: there are no English words to match", () => {
    expect(rankLegs([leg({ A: 0.3, B: 0.29 })], "direct", boosts({ B: 0.15 }), SETTINGS)).toEqual([
      { provider_id: "A", score: 0.3 },
      { provider_id: "B", score: 0.29 },
    ]);
  });

  it("returns at most five", () => {
    const close = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`P${i}`, 0.3 - i * 0.001]));
    expect(rankLegs([leg(close)], "direct", undefined, SETTINGS)).toHaveLength(MAX_RESULTS);
  });
});

describe("emergencyOnTop", () => {
  const emergency = new Set(["E"]);

  it("is true when the best match of a leg is an emergency provider at the emergency top threshold or above", () => {
    expect(emergencyOnTop([leg({ E: 0.14, A: 0.13 })], emergency, 0.14)).toBe(true);
    expect(emergencyOnTop([leg({ E: 0.139, A: 0.13 })], emergency, 0.14)).toBe(false);
  });

  it("is false when an emergency provider is second, and true when it tops either leg", () => {
    expect(emergencyOnTop([leg({ A: 0.3, E: 0.29 })], emergency, 0.14)).toBe(false);
    expect(emergencyOnTop([leg({ A: 0.3, E: 0.29 }), leg({ E: 0.2, A: 0.1 })], emergency, 0.14)).toBe(true);
    expect(emergencyOnTop([], emergency, 0.14)).toBe(false);
  });

  it("breaks a tie at the top by id, as the ranking does", () => {
    expect(emergencyOnTop([leg({ E: 0.3, A: 0.3 })], emergency, 0.14)).toBe(false);
    expect(emergencyOnTop([leg({ E: 0.3, Z: 0.3 })], emergency, 0.14)).toBe(true);
  });
});

describe("emergencyInTop (the emergency fail-safe, owner decision 41)", () => {
  const emergency = new Set(["E"]);

  it("is true for an emergency provider in a leg's top three at or above the emergency threshold, even below the release's threshold", () => {
    expect(emergencyInTop([leg({ A: 0.2, B: 0.1, E: 0.27 })], emergency, 0.25)).toBe(true);
    expect(emergencyInTop([leg({ E: 0.25 })], emergency, 0.25)).toBe(true); // at the threshold
  });

  it("is false below the emergency threshold, and for a provider that is not an emergency one", () => {
    expect(emergencyInTop([leg({ E: 0.24 })], emergency, 0.25)).toBe(false);
    expect(emergencyInTop([leg({ A: 0.27, E: 0.1 })], emergency, 0.25)).toBe(false);
    expect(emergencyInTop([leg({ A: 0.9 })], new Set(), 0.25)).toBe(false);
  });

  it(`looks only at the top ${EMERGENCY_TOP_K} of a leg: a fourth place is not enough`, () => {
    expect(emergencyInTop([leg({ A: 0.9, B: 0.8, C: 0.7, E: 0.6 })], emergency, 0.25)).toBe(false);
    expect(emergencyInTop([leg({ A: 0.9, B: 0.8, E: 0.7, C: 0.6 })], emergency, 0.25)).toBe(true);
  });

  it("holds when either leg qualifies, the second one alone included, and is false with no leg", () => {
    expect(emergencyInTop([leg({ A: 0.9, E: 0.01 }), leg({ E: 0.5, A: 0.1 })], emergency, 0.25)).toBe(true);
    expect(emergencyInTop([], emergency, 0.25)).toBe(false);
  });
});

describe("emergencyFirst", () => {
  const emergency = new Set(["E", "S"]);

  it("is true for an emergency provider that tops a leg at 0.14, or is in a leg's top three at the emergency-only threshold", () => {
    expect(emergencyFirst([leg({ E: 0.15, A: 0.1 })], emergency, SETTINGS)).toBe(true);
    expect(emergencyFirst([leg({ A: 0.4, B: 0.3, E: 0.26 })], emergency, SETTINGS)).toBe(true);
    expect(emergencyFirst([leg({ A: 0.4, B: 0.3, E: 0.24 })], emergency, SETTINGS)).toBe(false);
  });

  it("is not turned on by an emergency-category provider among the results: a shelter listed under a question about food", () => {
    const legs = [leg({ F: 0.3, G: 0.29, H: 0.28, I: 0.27, S: 0.265 })];

    // S (a shelter, in the emergency category) is shown fifth, with the keyword boost; the flag stays off.
    expect(rankLegs(legs, "hybrid", boosts({ S: 0.06 }), SETTINGS).map((r) => r.provider_id)).toContain("S");
    expect(emergencyFirst(legs, emergency, SETTINGS)).toBe(false);
  });

  it("uses the emergency-only threshold at most as high as the release's threshold", () => {
    expect(emergencyFirst([leg({ A: 0.4, B: 0.3, E: 0.22 })], emergency, { ...SETTINGS, threshold: 0.22 })).toBe(true);
  });
});
