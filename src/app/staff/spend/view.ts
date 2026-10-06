import { englishText } from "@/i18n/text";
import type { CohereSpend, PeriodSpend, SpendOverview } from "@/modules/spend";

/** The spend page (S07.08). */
export const SPEND_PAGE = "/staff/spend";

type Text = (key: string, values?: Record<string, string | number>) => string;
const catalog: Text = (key, values) => englishText(`staff.spend.${key}`, values);

/** Whole cents as the page writes money: 100000 is "CAD 1,000.00". */
export function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}CAD ${(Math.abs(cents) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const whole = (n: number): string => n.toLocaleString("en-CA");

/** `2026-10` as "October 2026". */
export function monthName(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1, 1)).toLocaleDateString("en-CA", { month: "long", year: "numeric", timeZone: "UTC" });
}

export interface SpendLine {
  /** What the line is, for the tests and the layout. */
  id: string;
  text: string;
}

export interface PeriodView {
  id: "month" | "pilot";
  heading: string;
  /** "Counted: CAD 12.00" */
  total: string;
  /** Said when the total leaves out usage whose price is unknown. */
  incomplete: string | null;
  sms: { heading: string; lines: SpendLine[]; overlap: string | null };
  cohere: { heading: string; lines: SpendLine[] };
}

export interface SpendScreen {
  title: string;
  lead: string;
  budget: { heading: string; line: string; incomplete: string | null; over: boolean };
  periods: PeriodView[];
  cap: { heading: string; state: string; setOn: string | null; rule: string };
}

const plural = (n: number, one: string, many: string, t: Text, values: Record<string, string | number>) => t(n === 1 ? one : many, values);

function smsLines(period: PeriodSpend, t: Text): { lines: SpendLine[]; overlap: string | null } {
  const sms = period.sms;
  const lines: SpendLine[] = [{ id: "counted", text: t("sms.counted", { amount: formatMoney(sms.countedCents) }) }];
  if (sms.actual.texts > 0) {
    lines.push({ id: "actual", text: plural(sms.actual.texts, "sms.actualOne", "sms.actual", t, { n: whole(sms.actual.texts), amount: formatMoney(sms.actual.cents) }) });
  }
  if (sms.unmatchedActuals.texts > 0) {
    lines.push({
      id: "unmatched",
      text: plural(sms.unmatchedActuals.texts, "sms.unmatchedOne", "sms.unmatched", t, { n: whole(sms.unmatchedActuals.texts), amount: formatMoney(sms.unmatchedActuals.cents) }),
    });
  }
  if (sms.unresolvedEstimates.texts > 0) {
    lines.push({
      id: "unresolved",
      text: plural(sms.unresolvedEstimates.texts, "sms.unresolvedOne", "sms.unresolved", t, { n: whole(sms.unresolvedEstimates.texts), amount: formatMoney(sms.unresolvedEstimates.cents) }),
    });
  }
  for (const pending of sms.pendingMonths) {
    if (pending.texts === 0) continue;
    lines.push({
      id: `pending-${pending.month}`,
      text: plural(pending.texts, "sms.pendingOne", "sms.pending", t, {
        month: monthName(pending.month),
        n: whole(pending.texts),
        amount: formatMoney(pending.estimatedCents),
        reason: t(`sms.reasons.${pending.reason}`),
      }),
    });
  }
  if (lines.length === 1 && sms.countedCents === 0) lines[0] = { id: "none", text: t("sms.none") };
  return { lines, overlap: sms.mayOverlap && sms.unresolvedEstimates.texts > 0 && sms.unmatchedActuals.texts > 0 ? t("sms.overlap") : null };
}

function cohereLines(cohere: CohereSpend, t: Text): SpendLine[] {
  const lines: SpendLine[] = [];
  if (cohere.priced.calls > 0) {
    lines.push({ id: "priced", text: plural(cohere.priced.calls, "cohere.pricedOne", "cohere.priced", t, { amount: formatMoney(cohere.priced.cents), calls: whole(cohere.priced.calls) }) });
  }
  if (cohere.unpriced.calls > 0 || cohere.unpriced.tokens > 0) {
    const values = { calls: whole(cohere.unpriced.calls), tokens: whole(cohere.unpriced.tokens) };
    lines.push(
      cohere.unpriced.estimateCents === null
        ? { id: "unknown", text: plural(cohere.unpriced.calls, "cohere.unknownOne", "cohere.unknown", t, values) }
        : { id: "estimate", text: plural(cohere.unpriced.calls, "cohere.estimateOne", "cohere.estimate", t, { ...values, amount: formatMoney(cohere.unpriced.estimateCents) }) },
    );
  }
  if (lines.length === 0) return [{ id: "none", text: t("cohere.none") }];
  if (cohere.tokensEstimated) lines.push({ id: "tokens-estimated", text: t("cohere.tokensEstimated") });
  return lines;
}

function periodView(id: PeriodView["id"], heading: string, period: PeriodSpend, t: Text): PeriodView {
  const sms = smsLines(period, t);
  return {
    id,
    heading,
    total: t("period.total", { amount: formatMoney(period.totalCents) }),
    incomplete: period.incomplete ? t("budget.incomplete") : null,
    sms: { heading: t("sms.heading"), lines: sms.lines, overlap: sms.overlap },
    cohere: { heading: t("cohere.heading"), lines: cohereLines(period.cohere, t) },
  };
}

/** The page as words: the budget, this month and the pilot to date (text messages and Cohere, each figure labelled), and the cap. */
export function spendScreen(overview: SpendOverview, options: { setOn: Date | null; text?: Text } = { setOn: null }): SpendScreen {
  const t = options.text ?? catalog;
  const remaining = overview.remainingCents;
  const over = remaining < 0;
  return {
    title: t("title"),
    lead: t("lead"),
    budget: {
      heading: t("budget.heading"),
      line: t("budget.line", {
        budget: formatMoney(overview.budgetCents),
        spent: formatMoney(overview.pilot.totalCents),
        left: over ? t("budget.over", { amount: formatMoney(-remaining) }) : t("budget.left", { amount: formatMoney(remaining) }),
      }),
      incomplete: overview.pilot.incomplete ? t("budget.incomplete") : null,
      over,
    },
    periods: [
      periodView("month", t("period.thisMonth", { month: monthName(overview.month) }), overview.thisMonth, t),
      periodView("pilot", t("period.pilot"), overview.pilot, t),
    ],
    cap: {
      heading: t("cap.heading"),
      state: overview.capCents === null ? t("cap.none") : t("cap.current", { amount: formatMoney(overview.capCents), percent: overview.capUsedPercent ?? 0 }),
      setOn: overview.capCents !== null && options.setOn ? t("cap.setOn", { when: options.setOn.toLocaleDateString("en-CA", { dateStyle: "long", timeZone: "America/Toronto" }) }) : null,
      rule: t("cap.rule"),
    },
  };
}

/** The line after the cap was set: the first one, or a change from another amount. */
export function capDoneLine(capCents: number, previousCents: number | null, t: Text = catalog): string {
  return previousCents === null ? t("cap.done.set", { amount: formatMoney(capCents) }) : t("cap.done.changed", { previous: formatMoney(previousCents), amount: formatMoney(capCents) });
}
