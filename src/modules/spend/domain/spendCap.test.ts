import { describe, expect, it } from "vitest";
import { SPEND_CAP_MAX_CENTS, assessCap, parseCapAmount } from "./spendCap";

describe("the cap an Admin types (dollars, as whole cents)", () => {
  it.each([
    ["250", 25_000],
    ["250.5", 25_050],
    ["250.50", 25_050],
    ["$250", 25_000],
    ["  1,250  ", 125_000],
    ["1,250.05", 125_005],
    ["0.01", 1],
    ["100000", SPEND_CAP_MAX_CENTS],
    ["100,000.00", SPEND_CAP_MAX_CENTS],
    ["0250", 25_000],
  ])("reads %j as %i cents", (raw, cents) => {
    expect(parseCapAmount(raw)).toEqual({ ok: true, cents });
  });

  it.each([
    [undefined, "missing"],
    [null, "missing"],
    ["", "missing"],
    ["   ", "missing"],
    [250, "missing"],
    ["abc", "not_a_number"],
    ["12.345", "not_a_number"],
    ["1,25", "not_a_number"],
    ["-5", "not_a_number"],
    ["1e3", "not_a_number"],
    ["250 dollars", "not_a_number"],
    ["0", "too_small"],
    ["0.00", "too_small"],
    ["100000.01", "too_large"],
    ["99999999999", "too_large"],
  ])("refuses %j as %s, and guesses nothing", (raw, problem) => {
    expect(parseCapAmount(raw)).toEqual({ ok: false, problem });
  });
});

describe("what an approval is told about the cap", () => {
  const base = { capCents: 10_000, spentCents: 9_000, queuedCents: 0 };

  it("is 0 over when the month ends just under the cap", () => {
    expect(assessCap({ ...base, estimateCents: 999 })).toMatchObject({ projectedCents: 9_999, overCents: 0 });
  });

  it("is 0 over when the month ends exactly at the cap: reaching it is within it", () => {
    expect(assessCap({ ...base, estimateCents: 1_000 })).toMatchObject({ projectedCents: 10_000, overCents: 0 });
  });

  it("is the shortfall when the month ends just over the cap", () => {
    expect(assessCap({ ...base, estimateCents: 1_001 })).toMatchObject({ projectedCents: 10_001, overCents: 1 });
  });

  it("counts the texts still waiting to be sent with the month's spending", () => {
    expect(assessCap({ ...base, queuedCents: 500, estimateCents: 600 })).toMatchObject({ projectedCents: 10_100, overCents: 100 });
  });

  it("is never over while no cap is set, however large the estimate", () => {
    expect(assessCap({ capCents: null, spentCents: 1_000_000, queuedCents: 5, estimateCents: 1_000_000 })).toMatchObject({ overCents: 0 });
  });

  it("is over by the whole estimate when the month is already past the cap", () => {
    expect(assessCap({ capCents: 10_000, spentCents: 12_000, queuedCents: 0, estimateCents: 300 })).toMatchObject({ overCents: 2_300 });
  });
});
