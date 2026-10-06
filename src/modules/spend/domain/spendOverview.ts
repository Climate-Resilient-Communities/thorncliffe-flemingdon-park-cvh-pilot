// What the spend view says (S07.08, FR-G6, AD-4 "See spend"): text message and Cohere spend for a month and for the pilot to date, against the pilot
// budget. Pure; the application reads the figures and this puts them together.
//
// The rules the view keeps:
//  - a text message month is shown the way S06.08's report counts it: the actual where its reconciliation is complete, with the unmatched actuals and
//    the unresolved estimates labelled and shown apart, and a month whose reconciliation is not complete labelled "pending reconciliation" with its
//    estimates still counted; none of them is ever shown as zero or folded into another;
//  - Cohere usage whose price is unknown is shown as "price unknown" with its units (calls and tokens), or as a labelled estimate when an estimate rate
//    is configured, and never as zero; usage with a price is shown at that price;
//  - a total that leaves out usage whose price is unknown says so (`incomplete`), because it is then a floor and not the whole.
// Amounts are whole cents CAD (a price per million tokens times tokens is rounded up to a cent).
import type { SmsMonthReport } from "./smsReport";
import type { MonthKey, PendingReason } from "./reconciliation";

/** The pilot's budget in cents when none is configured: CAD 1,000. */
export const DEFAULT_PILOT_BUDGET_CENTS = 100_000;

/** The words the view labels Cohere figures with (the screen translates them; the codes are what other code reads). */
export const COHERE_SPEND_LABELS = { priceUnknown: "price unknown", estimate: "estimate" } as const;

/** What the database adds up for Cohere usage over a period. `pricedMicroCad` is tokens x price per million tokens CAD, summed over the events with a price. */
export interface CohereFigures {
  calls: number;
  tokens: number;
  tokensEstimated: boolean;
  pricedCalls: number;
  pricedMicroCad: number;
  unpricedCalls: number;
  unpricedTokens: number;
}

export interface CohereSpend {
  calls: number;
  tokens: number;
  /** Whether any of the tokens counted are an estimate of the vendor's. */
  tokensEstimated: boolean;
  /** Usage with a known price, at that price (rounded up to a cent). */
  priced: { calls: number; cents: number };
  /** Usage whose price is unknown: its units, and an estimate in cents only when an estimate rate is configured (null otherwise: never zero). */
  unpriced: { calls: number; tokens: number; estimateCents: number | null; label: string };
}

/** Cents are micro-dollars / 10,000, rounded up. */
const centsOfMicroCad = (micro: number): number => Math.ceil(micro / 10_000 - 1e-9);

export function buildCohereSpend(figures: CohereFigures, estimateCadPerMillionTokens: number | null): CohereSpend {
  const unknown = figures.unpricedCalls > 0 || figures.unpricedTokens > 0;
  const estimateCents =
    unknown && estimateCadPerMillionTokens !== null ? centsOfMicroCad(figures.unpricedTokens * estimateCadPerMillionTokens) : null;
  return {
    calls: figures.calls,
    tokens: figures.tokens,
    tokensEstimated: figures.tokensEstimated,
    priced: { calls: figures.pricedCalls, cents: centsOfMicroCad(figures.pricedMicroCad) },
    unpriced: {
      calls: figures.unpricedCalls,
      tokens: figures.unpricedTokens,
      estimateCents,
      label: estimateCents === null ? COHERE_SPEND_LABELS.priceUnknown : COHERE_SPEND_LABELS.estimate,
    },
  };
}

/** A month whose reconciliation is not complete: its estimates are counted and the month is labelled. */
export interface PendingMonth {
  month: MonthKey;
  reason: PendingReason | "not_run";
  estimatedCents: number;
  texts: number;
}

/** Text message spend over one or more months. */
export interface SmsSpendSummary {
  /** What is counted: the actual of every complete month, the unresolved estimates beside it, and the estimates of every pending month. */
  countedCents: number;
  /** The actual price of the texts the provider billed in complete months (matched or not). */
  actual: { cents: number; texts: number };
  /** Billed texts that no estimate answers for, counted at their actual price and also inside `actual`. */
  unmatchedActuals: { cents: number; texts: number };
  /** Estimates that no imported actual has retired, in complete months, counted at their estimate. */
  unresolvedEstimates: { cents: number; texts: number };
  /** The months with no complete reconciliation, each with the estimates counted for it. */
  pendingMonths: PendingMonth[];
  /** Whether an unresolved estimate and an unmatched actual may be the same text, counted in both lines. */
  mayOverlap: boolean;
}

export function summariseSms(reports: readonly SmsMonthReport[]): SmsSpendSummary {
  const summary: SmsSpendSummary = {
    countedCents: 0,
    actual: { cents: 0, texts: 0 },
    unmatchedActuals: { cents: 0, texts: 0 },
    unresolvedEstimates: { cents: 0, texts: 0 },
    pendingMonths: [],
    mayOverlap: false,
  };
  for (const report of reports) {
    summary.countedCents += report.countedCents;
    if (report.status === "pending") {
      summary.pendingMonths.push({
        month: report.month,
        reason: report.pending?.reason ?? "not_run",
        estimatedCents: report.unresolvedEstimates.cents,
        texts: report.unresolvedEstimates.count,
      });
      continue;
    }
    summary.actual.cents += report.actual?.cents ?? 0;
    summary.actual.texts += report.actual?.count ?? 0;
    summary.unmatchedActuals.cents += report.unmatchedActuals?.cents ?? 0;
    summary.unmatchedActuals.texts += report.unmatchedActuals?.count ?? 0;
    summary.unresolvedEstimates.cents += report.unresolvedEstimates.cents;
    summary.unresolvedEstimates.texts += report.unresolvedEstimates.count;
    summary.mayOverlap ||= report.sideBySide.mayOverlap;
  }
  return summary;
}

/** One period of the view: a month, or the pilot to date. */
export interface PeriodSpend {
  sms: SmsSpendSummary;
  cohere: CohereSpend;
  /** Everything counted: texts, Cohere usage at a known price, and Cohere usage at its estimate when an estimate rate is set. */
  totalCents: number;
  /** True when Cohere usage with an unknown price (and no estimate rate) is left out of `totalCents`: the total is then a floor. */
  incomplete: boolean;
}

export function buildPeriod(sms: SmsSpendSummary, cohere: CohereSpend): PeriodSpend {
  return {
    sms,
    cohere,
    totalCents: sms.countedCents + cohere.priced.cents + (cohere.unpriced.estimateCents ?? 0),
    incomplete: (cohere.unpriced.calls > 0 || cohere.unpriced.tokens > 0) && cohere.unpriced.estimateCents === null,
  };
}

export interface SpendOverview {
  /** The month shown as "this month" (Toronto), `YYYY-MM`. */
  month: MonthKey;
  thisMonth: PeriodSpend;
  pilot: PeriodSpend;
  /** The pilot's budget in cents CAD, and what is left of it (negative once it is passed). */
  budgetCents: number;
  remainingCents: number;
  /** The monthly cap in cents, or null while none is set. */
  capCents: number | null;
  /** When the cap was set, read with the cap; null while none is set. */
  capSetAt: Date | null;
  /** How much of the cap this month's text message spending has used, in whole percent (null with no cap); may pass 100. The cap is on texts. */
  capUsedPercent: number | null;
}

export function buildOverview(input: { month: MonthKey; thisMonth: PeriodSpend; pilot: PeriodSpend; budgetCents: number; capCents: number | null; capSetAt?: Date | null }): SpendOverview {
  return {
    month: input.month,
    thisMonth: input.thisMonth,
    pilot: input.pilot,
    budgetCents: input.budgetCents,
    remainingCents: input.budgetCents - input.pilot.totalCents,
    capCents: input.capCents,
    capSetAt: input.capSetAt ?? null,
    capUsedPercent: input.capCents === null ? null : Math.floor((input.thisMonth.sms.countedCents / input.capCents) * 100),
  };
}
