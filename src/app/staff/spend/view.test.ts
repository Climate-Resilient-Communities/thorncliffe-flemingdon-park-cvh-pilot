import { describe, expect, it } from "vitest";
import { buildCohereSpend, buildMonthReport, buildOverview, buildPeriod, monthInterval, summariseSms, type CohereFigures, type SpendOverview } from "@/modules/spend";
import { capDoneLine, formatMoney, monthName, spendScreen } from "./view";

const NO_COHERE: CohereFigures = { calls: 0, tokens: 0, tokensEstimated: false, pricedCalls: 0, pricedMicroCad: 0, unpricedCalls: 0, unpricedTokens: 0 };
const UNKNOWN_COHERE: CohereFigures = { calls: 3, tokens: 1_200_000, tokensEstimated: true, pricedCalls: 0, pricedMicroCad: 0, unpricedCalls: 3, unpricedTokens: 1_200_000 };

const complete = buildMonthReport({
  interval: monthInterval("2026-09"),
  reconciliation: { state: "complete", pendingReason: null, attempts: 1, lastAttemptAt: null, usdToCadRate: 1.4, completedAt: null, messages: 4, imported: 4 },
  actuals: { count: 4, millicents: 123_456 },
  matched: { count: 3, actualMillicents: 100_000, estimateCents: 120 },
  unresolved: { count: 2, cents: 4 },
});
const pending = (month: string, cents: number, count: number, reason: "message_without_price" | null = "message_without_price") =>
  buildMonthReport({
    interval: monthInterval(month),
    reconciliation: reason ? { state: "pending", pendingReason: reason, attempts: 1, lastAttemptAt: null, usdToCadRate: null, completedAt: null, messages: null, imported: null } : null,
    actuals: { count: 0, millicents: 0 },
    matched: { count: 0, actualMillicents: 0, estimateCents: 0 },
    unresolved: { count, cents },
  });

function overview(options: { cohere?: CohereFigures; rate?: number | null; capCents?: number | null; budgetCents?: number } = {}): SpendOverview {
  const cohere = buildCohereSpend(options.cohere ?? NO_COHERE, options.rate ?? null);
  const thisMonth = buildPeriod(summariseSms([pending("2026-10", 4_250, 300)]), cohere);
  const pilot = buildPeriod(summariseSms([complete, pending("2026-10", 4_250, 300)]), cohere);
  return buildOverview({ month: "2026-10", thisMonth, pilot, budgetCents: options.budgetCents ?? 100_000, capCents: options.capCents === undefined ? null : options.capCents });
}

describe("how the page writes money and months", () => {
  it("writes whole cents as CAD with thousands separators and two decimals", () => {
    expect(formatMoney(0)).toBe("CAD 0.00");
    expect(formatMoney(5)).toBe("CAD 0.05");
    expect(formatMoney(100_000)).toBe("CAD 1,000.00");
    expect(formatMoney(-107)).toBe("-CAD 1.07");
  });

  it("names a month in words", () => {
    expect(monthName("2026-10")).toBe("October 2026");
    expect(monthName("2027-01")).toBe("January 2027");
  });
});

describe("the spend page as words", () => {
  it("sets the pilot's counted spending against the CAD 1,000 budget", () => {
    const screen = spendScreen(overview());
    expect(screen.budget.line).toBe("Budget: CAD 1,000.00. Counted so far: CAD 43.77. CAD 956.23 left.");
    expect(screen.budget).toMatchObject({ over: false, incomplete: null });
  });

  it("says how far over the budget the pilot is once it is", () => {
    const screen = spendScreen(overview({ budgetCents: 4_000 }));
    expect(screen.budget.line).toBe("Budget: CAD 40.00. Counted so far: CAD 43.77. CAD 3.77 over the budget.");
    expect(screen.budget.over).toBe(true);
  });

  it("labels every text message figure apart: the actual, the unmatched actuals, the unresolved estimates and the month pending reconciliation", () => {
    const [month, pilot] = spendScreen(overview()).periods;
    expect(month.heading).toBe("This month (October 2026)");
    expect(month.sms.lines.map((line) => line.text)).toEqual([
      "Counted: CAD 42.50",
      "Pending reconciliation, October 2026: CAD 42.50 estimated for 300 texts (the provider has not priced every text yet)",
    ]);
    expect(pilot.heading).toBe("The pilot to date");
    expect(pilot.sms.lines.map((line) => line.id)).toEqual(["counted", "actual", "unmatched", "unresolved", "pending-2026-10"]);
    expect(pilot.sms.lines[1].text).toBe("Actual price of 4 texts the provider billed: CAD 1.23");
    expect(pilot.sms.lines[2].text).toBe("Unmatched actuals: CAD 0.23 for 1 billed text that no estimate answers for (counted at its actual price, inside the line above)");
    expect(pilot.sms.lines[3].text).toBe("Unresolved estimates: CAD 0.04 for 2 texts, counted at their estimate until the provider's price is matched to them");
    expect(pilot.sms.overlap).toContain("may count it twice");
  });

  it("says a month that was never reconciled was not run", () => {
    const never = buildPeriod(summariseSms([pending("2026-08", 8, 4, null)]), buildCohereSpend(NO_COHERE, null));
    const screen = spendScreen(buildOverview({ month: "2026-08", thisMonth: never, pilot: never, budgetCents: 100_000, capCents: null }));
    expect(screen.periods[0].sms.lines[1].text).toContain("the month has not been reconciled yet");
  });

  it("shows Cohere usage without a price as 'price unknown' with its calls and tokens, never as zero, and says the total leaves it out", () => {
    const screen = spendScreen(overview({ cohere: UNKNOWN_COHERE }));
    expect(screen.periods[0].cohere.lines.map((line) => line.text)).toEqual(["Price unknown: 3 calls, 1,200,000 tokens", "Some token counts are estimates of the provider's."]);
    expect(screen.periods[0].incomplete).toBe("This leaves out Cohere usage whose price is unknown, so the real total is higher.");
    expect(screen.budget.incomplete).not.toBeNull();
  });

  it("shows it as a labelled estimate, and counts it, when an estimate rate is configured", () => {
    const screen = spendScreen(overview({ cohere: UNKNOWN_COHERE, rate: 0.5 }));
    expect(screen.periods[0].cohere.lines[0]).toEqual({ id: "estimate", text: "Estimate: CAD 0.60 for 3 calls and 1,200,000 tokens whose price is unknown" });
    expect(screen.periods[0].incomplete).toBeNull();
  });

  it("shows Cohere usage at a known price, and says when there is none", () => {
    const priced = overview({ cohere: { calls: 1, tokens: 1_000_000, tokensEstimated: false, pricedCalls: 1, pricedMicroCad: 250_000, unpricedCalls: 0, unpricedTokens: 0 } });
    expect(spendScreen(priced).periods[0].cohere.lines).toEqual([{ id: "priced", text: "At a known price: CAD 0.25 for 1 call" }]);
    expect(spendScreen(overview()).periods[0].cohere.lines).toEqual([{ id: "none", text: "No Cohere usage has been recorded yet." }]);
  });

  it("says no texts have been counted for a month with none", () => {
    const empty = buildPeriod(summariseSms([pending("2026-10", 0, 0)]), buildCohereSpend(NO_COHERE, null));
    const screen = spendScreen(buildOverview({ month: "2026-10", thisMonth: empty, pilot: empty, budgetCents: 100_000, capCents: null }));
    expect(screen.periods[0].sms.lines).toEqual([{ id: "none", text: "No texts have been counted yet." }]);
  });

  it("says no cap is set, or what the cap is and how much of it is used, with the rule that it only warns", () => {
    expect(spendScreen(overview()).cap.state).toBe("No cap is set. Set one to be warned before a month's texts pass it.");
    const capped = spendScreen(overview({ capCents: 8_500 }), { setOn: new Date("2026-10-04T15:00:00Z") });
    expect(capped.cap.state).toBe("The monthly cap is CAD 85.00. 50% of it is used this month.");
    expect(capped.cap.setOn).toBe("Last set on October 4, 2026.");
    expect(capped.cap.rule).toContain("The cap warns and never blocks.");
    expect(capped.cap.rule).toContain("replies to STOP are never held back");
  });

  it("words the line after the cap was set or changed", () => {
    expect(capDoneLine(25_000, null)).toBe("The monthly cap is now CAD 250.00.");
    expect(capDoneLine(30_000, 25_000)).toBe("The monthly cap changed from CAD 250.00 to CAD 300.00.");
  });
});
