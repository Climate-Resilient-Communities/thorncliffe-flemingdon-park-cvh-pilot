import { describe, expect, it } from "vitest";
import { monthInterval } from "./reconciliation";
import { SMS_SPEND_LABELS, buildMonthReport, type MonthFigures } from "./smsReport";

const interval = monthInterval("2026-10");
const complete = { state: "complete", pendingReason: null, attempts: 1, lastAttemptAt: new Date("2026-11-02T11:00:00Z"), usdToCadRate: 1.4, completedAt: new Date("2026-11-02T11:00:00Z"), messages: 5, imported: 5 } as const;
const none = { count: 0, cents: 0 };

const figures = (over: Partial<MonthFigures> = {}): MonthFigures => ({
  interval,
  reconciliation: complete,
  actuals: { count: 0, millicents: 0 },
  matched: { count: 0, actualMillicents: 0, estimateCents: 0 },
  unresolved: none,
  ...over,
});

describe("the month's report of text message spend (S06.08)", () => {
  it("says the interval in UTC, and uses the words the story names", () => {
    expect(SMS_SPEND_LABELS.unresolvedEstimate).toBe("unresolved estimate");
    expect(SMS_SPEND_LABELS.unmatchedActual).toBe("unmatched actual");
    expect(SMS_SPEND_LABELS.pendingReconciliation).toBe("pending reconciliation");
    expect(buildMonthReport(figures()).interval).toEqual({ id: "month:2026-10", startUtc: "2026-10-01T04:00:00.000Z", endUtc: "2026-11-01T04:00:00.000Z" });
  });

  it("for a complete month: the actual total, the estimates its actuals retired, the difference, the unmatched actuals and the unresolved estimates", () => {
    // Five messages billed: three answer for estimates (their actuals 1106 + 1106 + 2212 = 4424 thousandths of a cent, the estimates 2 + 2 + 3 = 7 cents),
    // two answer for none (1106 + 3318 = 4424 thousandths); and two estimates (2 + 2 cents) no actual has retired.
    const report = buildMonthReport(
      figures({
        actuals: { count: 5, millicents: 8848 },
        matched: { count: 3, actualMillicents: 4424, estimateCents: 7 },
        unresolved: { count: 2, cents: 4 },
      }),
    );
    expect(report).toMatchObject({
      month: "2026-10",
      status: "complete",
      pending: null,
      actual: { cents: 8.848, count: 5, usdToCadRate: 1.4, label: "actual" },
      retiredEstimates: { cents: 7, count: 3, differenceCents: -2.576 },
      unmatchedActuals: { cents: 4.424, count: 2, label: "unmatched actual" },
      unresolvedEstimates: { cents: 4, count: 2, label: "unresolved estimate" },
      sideBySide: { unresolvedEstimateCents: 4, unmatchedActualCents: 4.424, mayOverlap: true },
      countedCents: 12.848,
    });
  });

  it("shows the unresolved estimates and the unmatched actuals side by side, and flags that one send may be in both only when both exist", () => {
    const onlyUnresolved = buildMonthReport(figures({ unresolved: { count: 1, cents: 2 } }));
    expect(onlyUnresolved.sideBySide).toEqual({ unresolvedEstimateCents: 2, unmatchedActualCents: 0, mayOverlap: false });
    const onlyUnmatched = buildMonthReport(figures({ actuals: { count: 1, millicents: 1106 } }));
    expect(onlyUnmatched.sideBySide).toEqual({ unresolvedEstimateCents: 0, unmatchedActualCents: 1.106, mayOverlap: false });
  });

  it("for a month with no reconciliation: pending reconciliation, its estimates still counted, never zero", () => {
    const report = buildMonthReport(figures({ reconciliation: null, unresolved: { count: 3, cents: 6 } }));
    expect(report).toMatchObject({
      status: "pending",
      statusLabel: "pending reconciliation",
      pending: { reason: "not_run", attempts: 0, lastAttemptAt: null },
      actual: null,
      retiredEstimates: null,
      unmatchedActuals: null,
      unresolvedEstimates: { cents: 6, count: 3, label: "unresolved estimate" },
      sideBySide: { unresolvedEstimateCents: 6, unmatchedActualCents: null, mayOverlap: false },
      countedCents: 6,
    });
  });

  it("for a pending reconciliation: why and how often it was tried, and nothing of the actuals", () => {
    const pending = { ...complete, state: "pending", pendingReason: "message_without_price", attempts: 3, completedAt: null, messages: null, imported: null, usdToCadRate: null } as const;
    const report = buildMonthReport(figures({ reconciliation: pending, unresolved: { count: 1, cents: 2 } }));
    expect(report).toMatchObject({ status: "pending", pending: { reason: "message_without_price", attempts: 3, lastAttemptAt: "2026-11-02T11:00:00.000Z" }, actual: null, countedCents: 2 });
  });

  it("is exact in thousandths of a cent: amounts are added as integers before they become cents", () => {
    const report = buildMonthReport(figures({ actuals: { count: 3, millicents: 3 * 1106 }, unresolved: { count: 1, cents: 2 } }));
    expect(report.actual?.cents).toBe(3.318);
    expect(report.countedCents).toBe(5.318);
  });
});
