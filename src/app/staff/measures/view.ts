// What the Hub's pilot measures page shows (S07.10, FR-M1 subscribers, FR-M4 correction reach, FR-M5 cost per alert): the view model, with every text already
// resolved from the English catalog so the components that draw it know none of it and the layout tests can put the longest label in every place. Pure: no I/O.
// It is counts, languages, neighbourhoods, kinds and amounts: never a phone number, a subscriber or recipient id, or a message body. The small-number rule has been
// applied by the SQL views (a count of 1 to 4 arrives as "fewer than 5" and no number); this file prints it as "Fewer than 5" and adds nothing to what is shown.
// Drills are in sections of their own and are never added to real alerts.
import { englishText } from "@/i18n/text";
import type { CorrectionReachReport, CorrectionReachRow } from "@/modules/messaging";
import type { AlertCost, AlertCostReport, AlertCostRow, CohereEntryShare, CohereShare } from "@/modules/spend";
import { SUBSCRIBER_NOT_SHOWN, type ShownCount, type SubscriberMeasuresDay } from "@/modules/subscriptions";
import { formatTorontoDate } from "@/platform/clock";
import { languageLabel } from "../alerts/sending/view";
import type { ProcedureLinkView } from "../procedures";

/** The Hub's pilot measures page. */
export const MEASURES_PAGE = "/staff/measures";

export type Text = (key: string, values?: Record<string, string | number>) => string;

/** The words of this page: `staff.measures.<key>` of the catalog. */
export const measuresText: Text = (key, values) => englishText(`staff.measures.${key}`, values);

/** Whether a figure was hidden only to protect another (it may be 5 or more), rather than because it is under 5. */
const protectsAnother = (count: { n: number | null; shown?: string }): boolean => count.n === null && count.shown === SUBSCRIBER_NOT_SHOWN;

/** A count as printed: the number, "Fewer than 5" where the rule hides it, or "Not shown" where it is hidden to protect another figure. */
export function countText(count: { n: number | null; shown?: string }, t: Text = measuresText): string {
  if (count.n !== null) return String(count.n);
  return protectsAnother(count) ? t("notShown") : t("fewer");
}

/** A Toronto day (YYYY-MM-DD) in words. */
export function dayText(day: string): string {
  return formatTorontoDate(new Date(`${day}T17:00:00Z`));
}

/** Thousandths of a cent CAD as dollars, with two to three decimals ($0.44, $0.105). */
export function millicentsText(millicents: number): string {
  const dollars = (millicents / 100_000).toFixed(3);
  return `$${dollars.endsWith("0") ? dollars.slice(0, -1) : dollars}`;
}

/** Cents CAD (which may have decimals) as dollars. */
export const centsText = (cents: number): string => millicentsText(Math.round(cents * 1000));

// --- subscribers ----------------------------------------------------------------------------------------------------------

export interface SubscriberMeasureView {
  id: string;
  name: string;
  total: string;
  byLanguage: string;
  byNeighbourhood: string;
}

export interface SubscribersView {
  heading: string;
  /** The line naming the day, or the reason there is none yet. */
  lead: string;
  measures: SubscriberMeasureView[];
}

const neighbourhoodLabel = (nbhd: string, t: Text): string => (nbhd === "TP" || nbhd === "FP" ? t(`nbhd.${nbhd}`) : nbhd);

export function subscribersView(day: SubscriberMeasuresDay | null, t: Text = measuresText): SubscribersView {
  const heading = t("subscribers.heading");
  if (day === null || day.measures.length === 0) return { heading, lead: t("subscribers.neverRun"), measures: [] };
  const cells = (label: string, items: { name: string; count: ShownCount }[]) =>
    `${label}: ${items.map((item) => t("subscribers.cell", { name: item.name, n: countText(item.count, t) })).join("; ")}`;
  return {
    heading,
    lead: t("subscribers.lead", { day: dayText(day.day) }),
    measures: day.measures.map((reading) => ({
      id: reading.measure,
      name: t(`subscribers.measures.${reading.measure}`),
      total: t("subscribers.total", { n: countText(reading.total, t) }),
      byLanguage: cells(
        t("subscribers.byLanguage"),
        reading.byLanguage.map((cell) => ({ name: languageLabel(cell.lang), count: cell.count })),
      ),
      byNeighbourhood: cells(
        t("subscribers.byNbhd"),
        reading.byNeighbourhood.map((cell) => ({ name: neighbourhoodLabel(cell.nbhd, t), count: cell.count })),
      ),
    })),
  };
}

// --- correction reach -------------------------------------------------------------------------------------------------------

export interface ReachEntryView {
  id: string;
  title: string;
  lines: string[];
}

export interface ReachView {
  heading: string;
  lead: string;
  real: ReachEntryView[];
  realEmpty: string;
  drillsHeading: string;
  drills: ReachEntryView[];
  drillsEmpty: string;
}

function reachEntry(row: CorrectionReachRow, t: Text): ReachEntryView {
  return {
    id: row.entryId,
    title: [t(`reach.kinds.${row.kind}`), row.approvedAt ? t("reach.approved", { when: formatTorontoDate(row.approvedAt) }) : null].filter(Boolean).join(", "),
    lines: [
      t("reach.original", { n: countText(row.originalRecipients, t) }),
      t("reach.attempted", { n: countText(row.attemptedReach, t) }),
      t("reach.confirmed", { n: countText(row.confirmedReach, t) }),
      row.attemptedPercent !== null && row.confirmedPercent !== null
        ? t("reach.percent", { attempted: row.attemptedPercent, confirmed: row.confirmedPercent })
        : t("reach.noPercent"),
    ],
  };
}

export function reachView(report: CorrectionReachReport, t: Text = measuresText): ReachView {
  return {
    heading: t("reach.heading"),
    lead: t("reach.lead"),
    real: report.real.map((row) => reachEntry(row, t)),
    realEmpty: t("reach.empty"),
    drillsHeading: t("reach.drillsHeading"),
    drills: report.drills.map((row) => reachEntry(row, t)),
    drillsEmpty: t("reach.drillsEmpty"),
  };
}

// --- cost per alert ---------------------------------------------------------------------------------------------------------

export interface CostEntryView {
  id: string;
  title: string;
  /** The entry's total, then one line per language. */
  lines: string[];
}

export interface CohereView {
  heading: string;
  lead: string;
  empty: string;
  lines: string[];
}

export interface CostView {
  heading: string;
  lead: string;
  real: CostEntryView[];
  realEmpty: string;
  drillsHeading: string;
  drills: CostEntryView[];
  drillsEmpty: string;
  cohere: CohereView;
}

function costLine(label: string, row: AlertCostRow, t: Text): string {
  const texts = protectsAnother(row.texts) ? t("cost.textsNotShown") : t("cost.texts", { n: countText(row.texts, t) });
  if (row.countedMillicents === null || row.basis === null) return `${label}: ${texts}. ${t("cost.noAmount")}`;
  return `${label}: ${texts}. ${t("cost.amount", { amount: millicentsText(row.countedMillicents), basis: t(`cost.basis.${row.basis}`) })}`;
}

function costEntry(entry: AlertCost, t: Text): CostEntryView {
  const kind = ["ack", "update", "correction", "withdrawal", "final"].includes(entry.kind) ? t(`cost.kinds.${entry.kind}`) : entry.kind;
  return {
    id: entry.entryId,
    title: [kind, entry.approvedAt ? t("reach.approved", { when: formatTorontoDate(entry.approvedAt) }) : null].filter(Boolean).join(", "),
    lines: [
      entry.total === null ? t("cost.noTexts") : costLine(t("allLanguages"), entry.total, t),
      ...entry.languages.map((row) => costLine(languageLabel(row.lang ?? ""), row, t)),
      ...entry.cohere.flatMap((month) => entryCohereLines(month, t)),
    ],
  };
}

/** One alert entry's share of the translation vendor's use in a month (FR-M5). An unknown price is unknown, never zero. */
function entryCohereLines(month: CohereEntryShare, t: Text): string[] {
  const where = { month: month.month, calls: month.calls };
  return [
    month.tokenSharePercent === null ? t("cost.cohere.entryNoShare", where) : t("cost.cohere.entry", { ...where, share: `${month.tokenSharePercent}%` }),
    month.costCents === null ? t("cost.cohere.entryCostUnknown") : t("cost.cohere.entryCost", { amount: centsText(month.costCents) }),
    ...(month.tokensEstimated ? [t("cost.cohere.entryEstimated")] : []),
  ];
}

function cohereLines(months: readonly CohereShare[], t: Text): string[] {
  return months.flatMap((month) => {
    const where = { month: month.month, alertCalls: month.alertCalls, allCalls: month.allCalls };
    const share = month.alertTokenSharePercent === null ? t("cost.cohere.noShare", where) : t("cost.cohere.line", { ...where, share: `${month.alertTokenSharePercent}%` });
    const cost =
      month.alertCostCents === null || month.allCostCents === null
        ? t("cost.cohere.costUnknown")
        : t("cost.cohere.cost", { amount: centsText(month.alertCostCents), all: centsText(month.allCostCents) });
    const drillWhere = { month: month.month, drillCalls: month.drillCalls, allCalls: month.allCalls };
    const drills =
      month.drillCalls === 0
        ? []
        : [
            month.drillTokenSharePercent === null ? t("cost.cohere.noShare", { month: month.month, alertCalls: month.drillCalls, allCalls: month.allCalls }) : t("cost.cohere.drillLine", { ...drillWhere, share: `${month.drillTokenSharePercent}%` }),
            ...(month.drillCostCents === null ? [] : [t("cost.cohere.drillCost", { amount: centsText(month.drillCostCents) })]),
          ];
    return [share, cost, ...drills, ...(month.tokensEstimated ? [t("cost.cohere.estimated")] : [])];
  });
}

export function costView(report: AlertCostReport, cohere: readonly CohereShare[], t: Text = measuresText): CostView {
  return {
    heading: t("cost.heading"),
    lead: t("cost.lead"),
    real: report.real.map((entry) => costEntry(entry, t)),
    realEmpty: t("cost.empty"),
    drillsHeading: t("cost.drillsHeading"),
    drills: report.drills.map((entry) => costEntry(entry, t)),
    drillsEmpty: t("cost.drillsEmpty"),
    cohere: { heading: t("cost.cohere.heading"), lead: t("cost.cohere.lead"), empty: t("cost.cohere.empty"), lines: cohereLines(cohere, t) },
  };
}

// --- the page ---------------------------------------------------------------------------------------------------------------

export interface MeasuresView {
  title: string;
  lead: string;
  privacy: string;
  /** S09.05: where the full set of measures is (the export an Admin writes, in two editions), and that nobody changes a measure. */
  exportNote: string;
  /** S09.05: the procedure for writing the export, docs/procedures/export-measures.md (S09.03's link). */
  procedure: ProcedureLinkView;
  subscribers: SubscribersView;
  reach: ReachView;
  /** Null for a role that does not see spend (AD-4): a Coordinator. */
  cost: CostView | null;
}
