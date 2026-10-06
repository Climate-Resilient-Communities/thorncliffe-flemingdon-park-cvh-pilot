import { describe, expect, it } from "vitest";
import { SUBSCRIBER_LANGS, SUBSCRIBER_MEASURES, isSubscriberMeasure, readingsOf, type MeasureViewRow } from "./subscriberMeasures";

const row = (measure: string, split: string, key: string | null, n: number | null, nShown?: string): MeasureViewRow => ({
  day: "2026-10-04",
  measure,
  split,
  key,
  n,
  nShown: nShown ?? (n === null ? "fewer than 5" : String(n)),
});

describe("the subscriber measures", () => {
  it("name six counts, and only those", () => {
    expect(SUBSCRIBER_MEASURES).toEqual(["receiving_active", "receiving_reconsent_pending", "receiving_retained", "pending_signups", "confirmations", "deletions"]);
    expect(isSubscriberMeasure("deletions")).toBe(true);
    expect(isSubscriberMeasure("phone")).toBe(false);
  });

  it("are counted for the fifteen launch languages, not the text variant zh-Hant", () => {
    expect(SUBSCRIBER_LANGS).toHaveLength(15);
    expect(SUBSCRIBER_LANGS).not.toContain("zh-Hant");
  });

  it("are read as one reading per measure, in measure order, languages in launch order and neighbourhoods by id", () => {
    const readings = readingsOf([
      row("deletions", "language", null, 2),
      row("receiving_active", "language", "ur", 30),
      row("receiving_active", "language", "en", null),
      row("receiving_active", "language", null, 62),
      row("receiving_active", "neighbourhood", "TP", 40),
      row("receiving_active", "neighbourhood", "FP", 22),
      row("receiving_active", "neighbourhood", null, 62),
      row("deletions", "neighbourhood", null, 2),
    ]);
    expect(readings.map((reading) => reading.measure)).toEqual(["receiving_active", "deletions"]);
    expect(readings[0]).toEqual({
      measure: "receiving_active",
      total: { n: 62, shown: "62" },
      byLanguage: [
        { lang: "en", count: { n: null, shown: "fewer than 5" } },
        { lang: "ur", count: { n: 30, shown: "30" } },
      ],
      byNeighbourhood: [
        { nbhd: "FP", count: { n: 22, shown: "22" } },
        { nbhd: "TP", count: { n: 40, shown: "40" } },
      ],
    });
  });

  it("leaves out a measure that has no total row", () => {
    expect(readingsOf([row("confirmations", "language", "en", 7)])).toEqual([]);
  });
});
