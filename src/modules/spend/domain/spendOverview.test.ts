import { describe, expect, it } from "vitest";
import { buildMonthReport, type MonthFigures } from "./smsReport";
import { monthInterval } from "./reconciliation";
import { buildCohereSpend, buildOverview, buildPeriod, summariseSms } from "./spendOverview";

const complete = (month: string, over: Partial<MonthFigures> = {}) =>
  buildMonthReport({
    interval: monthInterval(month),
    reconciliation: { state: "complete", pendingReason: null, attempts: 1, lastAttemptAt: null, usdToCadRate: 1.4, completedAt: null, messages: 3, imported: 3 },
    actuals: { count: 3, millicents: 5_000 },
    matched: { count: 2, actualMillicents: 3_000, estimateCents: 4 },
    unresolved: { count: 1, cents: 2 },
    ...over,
  });
const pending = (month: string, cents: number, count: number) =>
  buildMonthReport({
    interval: monthInterval(month),
    reconciliation: { state: "pending", pendingReason: "message_without_price", attempts: 2, lastAttemptAt: null, usdToCadRate: null, completedAt: null, messages: null, imported: null },
    actuals: { count: 0, millicents: 0 },
    matched: { count: 0, actualMillicents: 0, estimateCents: 0 },
    unresolved: { count, cents },
  });

describe("text message spend over months", () => {
  it("shows a complete month's actual with its unmatched actuals and unresolved estimates apart, and counts the actual plus the unresolved estimates", () => {
    const summary = summariseSms([complete("2026-09")]);
    expect(summary.actual).toEqual({ cents: 5, texts: 3 });
    expect(summary.unmatchedActuals).toEqual({ cents: 2, texts: 1 });
    expect(summary.unresolvedEstimates).toEqual({ cents: 2, texts: 1 });
    expect(summary.mayOverlap).toBe(true);
    expect(summary.countedCents).toBe(7);
    expect(summary.pendingMonths).toEqual([]);
  });

  it("labels a month that is not reconciled as pending, with its estimates counted, and keeps them out of the unresolved line", () => {
    const summary = summariseSms([complete("2026-09"), pending("2026-10", 120, 80)]);
    expect(summary.pendingMonths).toEqual([{ month: "2026-10", reason: "message_without_price", estimatedCents: 120, texts: 80 }]);
    expect(summary.unresolvedEstimates).toEqual({ cents: 2, texts: 1 });
    expect(summary.countedCents).toBe(7 + 120);
  });

  it("says a month that was never reconciled was not run, and still counts its estimates", () => {
    const never = buildMonthReport({ interval: monthInterval("2026-08"), reconciliation: null, actuals: { count: 0, millicents: 0 }, matched: { count: 0, actualMillicents: 0, estimateCents: 0 }, unresolved: { count: 4, cents: 8 } });
    expect(summariseSms([never])).toMatchObject({ countedCents: 8, pendingMonths: [{ month: "2026-08", reason: "not_run", estimatedCents: 8, texts: 4 }] });
  });

  it("is zero only for a pilot that has sent nothing", () => {
    expect(summariseSms([pending("2026-10", 0, 0)]).countedCents).toBe(0);
  });
});

describe("Cohere spend", () => {
  const figures = { calls: 10, tokens: 5_000_000, tokensEstimated: false, pricedCalls: 4, pricedMicroCad: 2_000_000, unpricedCalls: 6, unpricedTokens: 3_000_000 };

  it("prices what has a price (rounded up to a cent) and shows the rest as price unknown with its units, never as zero", () => {
    const cohere = buildCohereSpend(figures, null);
    expect(cohere.priced).toEqual({ calls: 4, cents: 200 });
    expect(cohere.unpriced).toEqual({ calls: 6, tokens: 3_000_000, estimateCents: null, label: "price unknown" });
  });

  it("shows it as a labelled estimate when an estimate rate is configured", () => {
    // 3 million tokens at CAD 0.50 per million is CAD 1.50.
    expect(buildCohereSpend(figures, 0.5).unpriced).toEqual({ calls: 6, tokens: 3_000_000, estimateCents: 150, label: "estimate" });
  });

  it("has no unpriced line to estimate when everything was priced", () => {
    expect(buildCohereSpend({ ...figures, unpricedCalls: 0, unpricedTokens: 0 }, 0.5).unpriced).toMatchObject({ calls: 0, estimateCents: null });
  });

  it("rounds a price up to the next cent, not to the nearest", () => {
    expect(buildCohereSpend({ ...figures, pricedMicroCad: 10_001 }, null).priced.cents).toBe(2);
    expect(buildCohereSpend({ ...figures, pricedMicroCad: 10_000 }, null).priced.cents).toBe(1);
  });
});

describe("a period and the overview", () => {
  const sms = summariseSms([complete("2026-09")]);

  it("adds texts, Cohere at a known price and Cohere at its estimate; with no estimate rate it says the total is a floor", () => {
    const base = { calls: 10, tokens: 5_000_000, tokensEstimated: false, pricedCalls: 4, pricedMicroCad: 2_000_000, unpricedCalls: 6, unpricedTokens: 3_000_000 };
    const floor = buildPeriod(sms, buildCohereSpend(base, null));
    expect(floor).toMatchObject({ totalCents: 7 + 200, incomplete: true });
    const estimated = buildPeriod(sms, buildCohereSpend(base, 0.5));
    expect(estimated).toMatchObject({ totalCents: 7 + 200 + 150, incomplete: false });
  });

  it("is complete when every Cohere call had a price", () => {
    const priced = buildPeriod(sms, buildCohereSpend({ calls: 1, tokens: 10, tokensEstimated: false, pricedCalls: 1, pricedMicroCad: 10_000, unpricedCalls: 0, unpricedTokens: 0 }, null));
    expect(priced.incomplete).toBe(false);
  });

  it("sets the pilot's spending against the budget, and the month's texts against the cap", () => {
    const cohere = buildCohereSpend({ calls: 0, tokens: 0, tokensEstimated: false, pricedCalls: 0, pricedMicroCad: 0, unpricedCalls: 0, unpricedTokens: 0 }, null);
    const month = buildPeriod(summariseSms([pending("2026-10", 500, 10)]), cohere);
    const pilot = buildPeriod(summariseSms([complete("2026-09"), pending("2026-10", 500, 10)]), cohere);
    const overview = buildOverview({ month: "2026-10", thisMonth: month, pilot, budgetCents: 100_000, capCents: 1_000 });
    expect(overview.remainingCents).toBe(100_000 - 507);
    expect(overview.capUsedPercent).toBe(50);
    expect(buildOverview({ month: "2026-10", thisMonth: month, pilot, budgetCents: 400, capCents: null })).toMatchObject({ remainingCents: -107, capUsedPercent: null });
  });
});
