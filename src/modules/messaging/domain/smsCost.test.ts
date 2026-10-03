import { describe, expect, it } from "vitest";
import { estimateSmsCost, priceInThousandthsOfCent } from "./smsCost";

const price = 1.5;

describe("estimateSmsCost", () => {
  it("is segments x recipients x the price, in whole cents, and says it is an estimate", () => {
    const estimate = estimateSmsCost({
      segmentsByLanguage: { en: 2, ur: 5 },
      recipientsByLanguage: { en: 100, ur: 40 },
      pricePerSegmentCents: price,
      basis: "preview",
    });

    // (2 x 100 + 5 x 40) segments = 400 segments, at 1.5 cents = 600 cents.
    expect(estimate).toEqual({
      estimate: true,
      basis: "preview",
      cents: 600,
      segments: 400,
      byLanguage: { en: { recipients: 100, segmentsEach: 2, segments: 200 }, ur: { recipients: 40, segmentsEach: 5, segments: 200 } },
    });
    expect(Number.isInteger(estimate.cents)).toBe(true);
  });

  it("rounds up to the next whole cent, so an estimate never understates", () => {
    const of = (segments: number, cents: number) => estimateSmsCost({ segmentsByLanguage: { en: 1 }, recipientsByLanguage: { en: segments }, pricePerSegmentCents: cents, basis: "snapshot" }).cents;

    expect(of(1, 1.5)).toBe(2); // 1.5 cents -> 2
    expect(of(2, 1.5)).toBe(3); // exactly 3.0 -> 3
    expect(of(3, 1.5)).toBe(5); // 4.5 -> 5
    expect(of(1, 0.001)).toBe(1); // a fraction of a cent is a cent
    expect(of(1000, 0.001)).toBe(1); // exactly 1.000 cent
    expect(of(1001, 0.001)).toBe(2); // 1.001 cents
    expect(of(7, 1.234)).toBe(9); // 8.638 -> 9
  });

  it("does the sum exactly in thousandths of a cent: no floating point error rounds a whole number of cents up", () => {
    // 0.1 + 0.2 style errors: 3 x 1.1 = 3.3000000000000003 in floating point; the true value is 3.3 cents -> 4.
    expect(estimateSmsCost({ segmentsByLanguage: { en: 3 }, recipientsByLanguage: { en: 1 }, pricePerSegmentCents: 1.1, basis: "preview" }).cents).toBe(4);
    // 10 x 0.3 = 3 exactly (floating point says 3.0000000000000004 in some orders), so 3 cents, not 4.
    expect(estimateSmsCost({ segmentsByLanguage: { en: 10 }, recipientsByLanguage: { en: 1 }, pricePerSegmentCents: 0.3, basis: "preview" }).cents).toBe(3);
    expect(estimateSmsCost({ segmentsByLanguage: { en: 1 }, recipientsByLanguage: { en: 3 }, pricePerSegmentCents: 0.1, basis: "preview" }).cents).toBe(1);
  });

  it("uses the preview count at submit and the snapshot count at approval, and says which", () => {
    const at = (basis: "preview" | "snapshot", recipients: number) =>
      estimateSmsCost({ segmentsByLanguage: { en: 2 }, recipientsByLanguage: { en: recipients }, pricePerSegmentCents: price, basis });

    expect(at("preview", 100)).toMatchObject({ basis: "preview", cents: 300, estimate: true });
    expect(at("snapshot", 90)).toMatchObject({ basis: "snapshot", cents: 270, estimate: true });
  });

  it("costs nothing for no recipients, and ignores a language with segments but no recipients", () => {
    expect(estimateSmsCost({ segmentsByLanguage: { en: 2, ur: 5 }, recipientsByLanguage: {}, pricePerSegmentCents: price, basis: "preview" })).toMatchObject({ cents: 0, segments: 0 });
    expect(estimateSmsCost({ segmentsByLanguage: { en: 2, ur: 5 }, recipientsByLanguage: { en: 10 }, pricePerSegmentCents: price, basis: "preview" })).toMatchObject({ cents: 30, segments: 20 });
  });

  it("refuses a language that has recipients but no frozen body, and bad counts", () => {
    const input = { segmentsByLanguage: { en: 2 }, pricePerSegmentCents: price, basis: "preview" as const };

    expect(() => estimateSmsCost({ ...input, recipientsByLanguage: { ur: 3 } })).toThrow(/No segment count for "ur"/);
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => estimateSmsCost({ ...input, recipientsByLanguage: { en: bad } })).toThrow(RangeError);
    }
    expect(() => estimateSmsCost({ ...input, segmentsByLanguage: { en: -2 }, recipientsByLanguage: { en: 1 } })).toThrow(RangeError);
  });

  it("refuses an estimate too large to count exactly", () => {
    expect(() => estimateSmsCost({ segmentsByLanguage: { en: 10 }, recipientsByLanguage: { en: Math.floor(Number.MAX_SAFE_INTEGER / 100) }, pricePerSegmentCents: 100, basis: "preview" })).toThrow(/too large/);
  });
});

describe("priceInThousandthsOfCent", () => {
  it.each([
    [1.5, 1500],
    [1, 1000],
    [0.001, 1],
    [1.234, 1234],
    [100, 100000],
    [0.015, 15],
  ])("%s cents is %s thousandths", (cents, thousandths) => {
    expect(priceInThousandthsOfCent(cents)).toBe(thousandths);
  });

  it.each([0, -1, 1.2345, 0.0001, Number.NaN, Number.POSITIVE_INFINITY])("refuses %s", (cents) => {
    expect(() => priceInThousandthsOfCent(cents)).toThrow(RangeError);
  });
});
