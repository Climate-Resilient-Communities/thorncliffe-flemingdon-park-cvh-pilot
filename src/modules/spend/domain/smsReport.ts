// What the spend report says about a month of text messages (S06.08, AD-8), assembled from the figures the database adds up. Pure.
//
// The rules the report keeps:
//  - a month whose reconciliation is complete shows its ACTUAL total (every message the provider billed in the month, converted to CAD
//    and labelled with the rate), the ESTIMATES those actuals retired (an estimate is retired by the actual with its delivery's provider id,
//    whatever month either falls in), the difference, and the UNMATCHED ACTUALS (messages no delivery's estimate answers for: counted at
//    their actual price, never dropped);
//  - an estimate that no imported actual has retired stays counted at its estimate, labelled "unresolved estimate" and shown apart from
//    the actuals, never as zero and never silently dropped: its delivery has no provider id, or its MessageSid has not been imported by a
//    complete reconciliation;
//  - a month whose reconciliation is not complete (never run, listing failed, cut short, a message with no price yet) is labelled
//    "pending reconciliation", with its estimates still counted;
//  - the unresolved-estimate and unmatched-actual totals are shown side by side, because an ambiguous send with no recorded provider id
//    may be in both (the text was counted when its outcome became `unknown`, and the provider billed it too).
// Amounts are cents CAD: an estimate is a whole number of cents, an actual may have up to three decimals.
import { centsOf } from "./smsPrice";
import type { MonthKey, PendingReason, ReconciliationInterval } from "./reconciliation";

/** The words the report is labelled with (the screens translate them; the codes are what other code reads). */
export const SMS_SPEND_LABELS = {
  estimate: "estimate",
  actual: "actual",
  unresolvedEstimate: "unresolved estimate",
  unmatchedActual: "unmatched actual",
  pendingReconciliation: "pending reconciliation",
} as const;

/** What the database adds up for one month. Amounts in thousandths of a cent CAD, except the estimates, which are whole cents. */
export interface MonthFigures {
  interval: ReconciliationInterval;
  reconciliation: null | {
    state: "pending" | "complete";
    pendingReason: PendingReason | null;
    attempts: number;
    lastAttemptAt: Date | null;
    usdToCadRate: number | null;
    completedAt: Date | null;
    messages: number | null;
    imported: number | null;
  };
  /** Every actual this month's reconciliation imported. */
  actuals: { count: number; millicents: number };
  /** Those that retired an estimate: their price, and the cents of the estimates they retired. */
  matched: { count: number; actualMillicents: number; estimateCents: number };
  /** The estimates recorded in the month (by when they were made) that no actual has retired. */
  unresolved: { count: number; cents: number };
}

export interface SmsMonthReport {
  month: MonthKey;
  interval: { id: string; startUtc: string; endUtc: string };
  /** `complete`, or `pending` (labelled "pending reconciliation": the estimates below are what is counted). */
  status: "complete" | "pending";
  statusLabel: string;
  /** Why a pending month is pending, and how often it was tried; null for a complete month. */
  pending: null | { reason: PendingReason | "not_run"; attempts: number; lastAttemptAt: string | null };
  /** The month's actual total, for a complete reconciliation; null while pending (nothing is recorded from a pending one). */
  actual: null | { cents: number; count: number; usdToCadRate: number; label: string };
  /** The estimates this month's actuals retired, and how far the actuals were from them: for a complete month only. */
  retiredEstimates: null | { cents: number; count: number; differenceCents: number };
  /** Messages the provider billed in the month that no estimate answers for, counted at their actual price. */
  unmatchedActuals: null | { cents: number; count: number; label: string };
  /** Estimates of the month no actual has retired, counted at their estimate. */
  unresolvedEstimates: { cents: number; count: number; label: string };
  /** The two figures that may overlap, side by side. */
  sideBySide: { unresolvedEstimateCents: number; unmatchedActualCents: number | null; mayOverlap: boolean };
  /** What the month is counted as: the actual total plus the unresolved estimates (for a pending month, the estimates alone), never zero for a month with texts. */
  countedCents: number;
}

/** Assembles the month's report from its figures. */
export function buildMonthReport(figures: MonthFigures): SmsMonthReport {
  const { interval, reconciliation } = figures;
  const complete = reconciliation?.state === "complete";
  const unresolved = { cents: figures.unresolved.cents, count: figures.unresolved.count, label: SMS_SPEND_LABELS.unresolvedEstimate };
  const unmatchedMillicents = figures.actuals.millicents - figures.matched.actualMillicents;
  const unmatchedCount = figures.actuals.count - figures.matched.count;

  const base = {
    month: interval.month,
    interval: { id: interval.id, startUtc: interval.startUtc.toISOString(), endUtc: interval.endUtc.toISOString() },
    unresolvedEstimates: unresolved,
  };

  if (!complete) {
    return {
      ...base,
      status: "pending",
      statusLabel: SMS_SPEND_LABELS.pendingReconciliation,
      pending: {
        reason: reconciliation?.pendingReason ?? "not_run",
        attempts: reconciliation?.attempts ?? 0,
        lastAttemptAt: reconciliation?.lastAttemptAt?.toISOString() ?? null,
      },
      actual: null,
      retiredEstimates: null,
      unmatchedActuals: null,
      sideBySide: { unresolvedEstimateCents: unresolved.cents, unmatchedActualCents: null, mayOverlap: false },
      countedCents: unresolved.cents,
    };
  }

  const unmatched = { cents: centsOf(unmatchedMillicents), count: unmatchedCount, label: SMS_SPEND_LABELS.unmatchedActual };
  return {
    ...base,
    status: "complete",
    statusLabel: "complete",
    pending: null,
    actual: { cents: centsOf(figures.actuals.millicents), count: figures.actuals.count, usdToCadRate: reconciliation.usdToCadRate ?? 0, label: SMS_SPEND_LABELS.actual },
    retiredEstimates: {
      cents: figures.matched.estimateCents,
      count: figures.matched.count,
      differenceCents: centsOf(figures.matched.actualMillicents - figures.matched.estimateCents * 1000),
    },
    unmatchedActuals: unmatched,
    sideBySide: { unresolvedEstimateCents: unresolved.cents, unmatchedActualCents: unmatched.cents, mayOverlap: unresolved.count > 0 && unmatched.count > 0 },
    countedCents: centsOf(figures.actuals.millicents + unresolved.cents * 1000),
  };
}
