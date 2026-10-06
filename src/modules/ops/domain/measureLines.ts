// The pilot measures for the week-8 go / no-go review (S09.05, FR-M1 to FR-M5, D-8, NFR-N9, AD-4): every Section 9 measure as lines of one table, the one
// table the export writes as a CSV and as a printable page. Pure: the application reads the views and the files and hands their rows here.
//
// What this file guarantees, whatever it is given:
//  - the small-number rule (E09) on every count of people or of what they did and on every percentage made from one (./smallNumbers.ts): the figures that
//    arrive already judged by a view (S07.10's subscribers, correction reach and cost per alert; S09.04's delivery times by language) pass through as shown;
//  - drills apart: every line says whether it is about a drill, nothing is ever added across, and the page shows them in a section of their own;
//  - the alerts sent for a rehearsal (docs/procedures/rehearsals.md, S09.03's seam) left out of every measure about alerts (times, check-ins, translation
//    fallbacks, corrections and their reach, cost per alert); the money they cost stays in the total spend, since it was spent;
//  - spend and cost per alert only in the Admin and Director edition (AD-4: "See spend"); the Coordinator edition has no line of either;
//  - nothing personal: a line holds codes, counts, times, amounts, places and the ids of alerts and alert entries, never a phone number, a subscriber or
//    recipient id, a name or a message body (none of them is in any input type below).
// The rule protects people: it applies to counts of residents, subscribers, texts, installs, page views, searches, check-ins and survey answers, to alert
// entries counted by language (as S09.04's weekly review does), and to coverage counted by neighbourhood (a count "for a neighbourhood"). Counts of the Hub's
// own work that are not split that way (drills run, entries approved, corrections sent: each one is listed anyway) are written as they are.
import { englishText } from "../../../i18n/text";
import { isSmall, shownCount, shownPercent, shownSplit, NOT_SHOWN, type Shown } from "./smallNumbers";
import type { Survey } from "./measureFiles";

/** The sections, in the order the page reads them. `about` is the export's own lines (the date, the edition, what was left out). */
export const MEASURE_SECTIONS = [
  "about",
  "subscribers",
  "installs",
  "timing",
  "checkins",
  "directory_use",
  "search",
  "translation",
  "corrections",
  "drills",
  "cost_per_alert",
  "spend",
  "coverage",
] as const;
export type MeasureSection = (typeof MEASURE_SECTIONS)[number];

/** The sections only the Admin and Director edition has (AD-4). */
export const SPEND_SECTIONS: readonly MeasureSection[] = ["cost_per_alert", "spend"];

/** The two editions: the Admin and Director edition (with spend and cost per alert) and the Coordinator edition (without). */
export const MEASURE_EDITIONS = ["director", "coordinator"] as const;
export type MeasureEdition = (typeof MEASURE_EDITIONS)[number];

export type MeasureSplit = "total" | "language" | "neighbourhood" | "building" | "floor" | "entry" | "thread" | "month";
export type MeasureUnit = "count" | "percent" | "seconds" | "milliseconds" | "CAD" | "calls" | "tokens" | "date" | "text";

export interface MeasureLine {
  section: MeasureSection;
  isDrill: boolean;
  /** What is measured, a code (its words are the catalog's, `staff.measuresExport.measures.<code>`). */
  measure: string;
  /** A Toronto day (YYYY-MM-DD), `week YYYY-MM-DD` (the Monday), a month (YYYY-MM), `pilot to date`, or a range of days. */
  period: string;
  split: MeasureSplit;
  /** The language code, neighbourhood id, building number (rsn), `{rsn} {floor}` or month the line is for; null for a total, an entry or a thread. */
  key: string | null;
  /** The key in words: a language's name, a neighbourhood's, a building's address and a floor's label. */
  label: string | null;
  /** The alert (thread) the line is about: an id, not personal data. */
  alertId: string | null;
  /** The alert entry the line is about: an id, not personal data. */
  entryId: string | null;
  /** What is written: a number, "fewer than 5", "not shown", "not reached", "unknown", a date or a word. */
  value: string;
  unit: MeasureUnit;
  /** For money: actual, estimate, mixed, priced or price unknown; for a time or a share, a word on how it was read. */
  basis: string | null;
}

// --- the inputs ---------------------------------------------------------------------------------------------------------------
// Each is the shape of what another module or a view gives, declared here so the domain imports no other module (AD-2): the composition root (the script)
// passes subscriptions', spend's, messaging's, identity's and places' own readings, which have these shapes.

export interface SubscriberDayInput {
  day: string;
  measures: readonly { measure: string; total: Shown; byLanguage: readonly { lang: string; count: Shown }[]; byNeighbourhood: readonly { nbhd: string; count: Shown }[] }[];
}

/** A week's count of one usage event in one page language and neighbourhood ('' for a page about neither). */
export interface UsageRow {
  weekStart: string;
  evt: string;
  lang: string;
  nbhd: string;
  n: number;
}

/** The search log, by week (null: the pilot to date) and page language (null: every language). */
export interface SearchRow {
  weekStart: string | null;
  lang: string | null;
  searches: number;
  noClearMatch: number;
  failed: number;
  medianMs: number | null;
}

/** S04.07's `alert_approval_timing`: one per approved entry. */
export interface ApprovalTimingRow {
  entryId: string;
  alertId: string;
  kind: string;
  isDrill: boolean;
  approvedAt: Date;
  firstSaveToApprovalMs: number;
  /** Only on a thread's first approved acknowledgement. */
  reportedToFirstAckMs: number | null;
}

/** `alert_delivery_timing`: one per approved entry with texts handed off, every language together. */
export interface DeliveryTimingRow {
  entryId: string;
  alertId: string;
  isDrill: boolean;
  handedOff: number;
  delivered: number;
  firstHandOffSeconds: number | null;
  /** Null when delivered texts never reached 90% of those handed off. */
  ninetyPercentSeconds: number | null;
}

/** S09.04's `weekly_review` section `entry_timing`: per entry and language, the 90% time already judged by the view (hidden for 1 to 4 texts). */
export interface LanguageTimingRow {
  entryId: string;
  lang: string;
  isDrill: boolean;
  ninetyPercentSeconds: number | null;
  /** `reached`, `not reached`, or null where the view hid it. */
  status: string | null;
}

/** `checkin_round_count`: a closed thread's round tally at one place and status. */
export interface CheckinRow {
  alertId: string;
  closedAt: Date;
  rsn: string;
  nbhd: string;
  address: string;
  floorId: string;
  floorLabel: string | null;
  floorOrder: number | null;
  status: string;
  n: number;
}

/** `alert_translation_outcome`: one per approved entry and translated language. */
export interface TranslationRow {
  entryId: string;
  alertId: string;
  isDrill: boolean;
  lang: string;
  fellBack: boolean;
}

/** messaging's correction reach (S07.10, kept through the purge by S09.08): already judged by the view. */
export interface CorrectionRow {
  entryId: string;
  alertId: string;
  kind: string;
  approvedAt: Date | null;
  originalRecipients: Shown;
  attemptedReach: Shown;
  confirmedReach: Shown;
  attemptedPercent: number | null;
  confirmedPercent: number | null;
}

/** `drill_measure`: one per drill thread with an approved entry. */
export interface DrillRow {
  alertId: string;
  firstApprovedAt: Date;
  entriesApproved: number;
  handedOff: number;
  delivered: number;
  notDelivered: number;
  unknown: number;
  notSent: number;
}

/** spend's cost of one alert entry (S07.10): texts and amounts already judged by the view `alert_cost`. */
export interface AlertCostInput {
  entryId: string;
  alertId: string;
  kind: string;
  approvedAt: Date | null;
  total: AlertCostRowInput | null;
  languages: readonly AlertCostRowInput[];
  cohere: readonly { month: string; calls: number; tokens: number; tokenSharePercent: number | null; tokensEstimated: boolean; costCents: number | null }[];
}

export interface AlertCostRowInput {
  lang: string | null;
  texts: Shown;
  basis: string | null;
  countedMillicents: number | null;
}

/** spend's month of the vendor's usage (S07.10's `cohere_alert_share`). */
export interface CohereMonthInput {
  month: string;
  allCalls: number;
  alertCalls: number;
  drillCalls: number;
  alertTokenSharePercent: number | null;
  drillTokenSharePercent: number | null;
  tokensEstimated: boolean;
  allCostCents: number | null;
  alertCostCents: number | null;
  drillCostCents: number | null;
}

/** One period of S07.08's spend view (spend's PeriodSpend). */
export interface SpendPeriodInput {
  totalCents: number;
  incomplete: boolean;
  sms: {
    countedCents: number;
    actual: { cents: number; texts: number };
    unmatchedActuals: { cents: number; texts: number };
    unresolvedEstimates: { cents: number; texts: number };
    pendingMonths: readonly { month: string; reason: string; estimatedCents: number; texts: number }[];
  };
  cohere: {
    calls: number;
    tokens: number;
    tokensEstimated: boolean;
    priced: { calls: number; cents: number };
    unpriced: { calls: number; tokens: number; estimateCents: number | null };
  };
}

/** S07.08's spend view (spend's SpendOverview). */
export interface SpendInput {
  month: string;
  thisMonth: SpendPeriodInput;
  pilot: SpendPeriodInput;
  budgetCents: number;
  remainingCents: number;
  capCents: number | null;
}

/** Coverage in one neighbourhood (identity's `coversFloor` rule over places' buildings and floors). */
export interface CoverageInput {
  nbhd: string;
  name: string;
  buildings: number;
  /** Buildings with an ambassador on at least one floor. */
  buildingsCovered: number;
  /** Buildings with an ambassador on every floor. */
  buildingsFullyCovered: number;
  floors: number;
  floorsCovered: number;
}

/** Everything the lines are made from, read in one snapshot. Spend and cost are null in the Coordinator edition: they are not even read. */
export interface MeasuresInput {
  subscribers: SubscriberDayInput | null;
  usage: readonly UsageRow[];
  search: readonly SearchRow[];
  approvals: readonly ApprovalTimingRow[];
  deliveries: readonly DeliveryTimingRow[];
  languageTimings: readonly LanguageTimingRow[];
  checkins: readonly CheckinRow[];
  translations: readonly TranslationRow[];
  survey: Survey;
  corrections: { real: readonly CorrectionRow[]; drills: readonly CorrectionRow[] };
  drills: readonly DrillRow[];
  cost: { real: readonly AlertCostInput[]; drills: readonly AlertCostInput[]; cohere: readonly CohereMonthInput[] } | null;
  spend: SpendInput | null;
  coverage: readonly CoverageInput[];
}

/** What the export leaves out: the alerts sent for a rehearsal, found from the entry ids listed in docs/procedures/rehearsals.md. */
export interface LeftOut {
  /** The entry ids listed. */
  listed: number;
  /** Listed ids that name no approved entry in this database (a mistyped id, or another environment's). */
  notFound: number;
  /** The alerts (threads) left out, and every approved entry of them. */
  alertIds: ReadonlySet<string>;
  entryIds: ReadonlySet<string>;
}

export interface MeasuresContext {
  /** The day the export is as of (Toronto), YYYY-MM-DD. */
  asOf: string;
  edition: MeasureEdition;
  /** The Monday of the week read for directory, map and search use (Toronto), YYYY-MM-DD. */
  week: string;
  leftOut: LeftOut;
}

// --- helpers --------------------------------------------------------------------------------------------------------------------

const PILOT = "pilot to date";
const TORONTO_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" });

/** An instant's Toronto day, YYYY-MM-DD. */
export const torontoDay = (at: Date): string => TORONTO_DAY.format(at);

/** Cents CAD (which may have decimals) as dollars, two to five decimals: 1234 is "12.34", 10.5 is "0.105". */
export function dollars(cents: number): string {
  const text = (cents / 100).toFixed(5).replace(/0{1,3}$/, "");
  return text;
}

/** The words of a language code: the catalog's name ("Urdu", "Chinese (Traditional)"), English for `en`. */
export function languageName(lang: string): string {
  if (lang === "en") return "English";
  try {
    return englishText(`staff.compose.languageNames.${lang}`);
  } catch {
    return lang;
  }
}

/** The words of a neighbourhood id: the catalog's ("Thorncliffe Park"), or the given name, or "no neighbourhood" for a page about neither. */
export function neighbourhoodName(nbhd: string, given?: string): string {
  if (nbhd === "") return englishText("staff.measuresExport.noNeighbourhood");
  if (nbhd === "TP" || nbhd === "FP") return englishText(`staff.measures.nbhd.${nbhd}`);
  return given ?? nbhd;
}

/** The launch order of the languages (the order of LAUNCH_LANGUAGES with English last, then zh-Hant), then any other code. */
const LANG_ORDER = ["ur", "ps", "tl", "prs", "gu", "ta", "el", "sk", "bn", "hi", "pa", "zh", "zh-Hant", "es", "fr", "en"];
const langRank = (lang: string) => {
  const at = LANG_ORDER.indexOf(lang);
  return at === -1 ? LANG_ORDER.length : at;
};
const byLang = (a: string, b: string) => langRank(a) - langRank(b) || a.localeCompare(b);

type LineInput = Omit<MeasureLine, "isDrill" | "split" | "key" | "label" | "alertId" | "entryId" | "basis"> & Partial<MeasureLine>;

const line = (input: LineInput): MeasureLine => ({
  isDrill: false,
  split: "total",
  key: null,
  label: null,
  alertId: null,
  entryId: null,
  basis: null,
  ...input,
});

const countLine = (base: Omit<LineInput, "value" | "unit">, count: Shown): MeasureLine => line({ ...base, value: count.shown, unit: "count" });
const percentLine = (base: Omit<LineInput, "value" | "unit">, percent: number | null): MeasureLine => line({ ...base, value: percent === null ? NOT_SHOWN : String(percent), unit: "percent" });

/** A total and its split as lines: the total, then one line per cell, each judged by the rule. */
function splitLines(base: Omit<LineInput, "value" | "unit">, split: MeasureSplit, cells: readonly { key: string; label: string; n: number }[]): MeasureLine[] {
  const judged = shownSplit(cells.map((cell) => ({ key: cell, n: cell.n })));
  return [
    countLine(base, judged.total),
    ...judged.cells.map(({ key, count }) => countLine({ ...base, split, key: key.key, label: key.label }, count)),
  ];
}

/** Adds up rows by a key, in first-seen order. */
function sumBy<T>(rows: readonly T[], keyOf: (row: T) => string, value: (row: T) => number): Map<string, number> {
  const sums = new Map<string, number>();
  for (const row of rows) sums.set(keyOf(row), (sums.get(keyOf(row)) ?? 0) + value(row));
  return sums;
}

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};

const seconds = (ms: number) => Math.round(ms / 1000);

// --- the measures -------------------------------------------------------------------------------------------------------------

/** SMS subscribers (FR-M1): S07.10's latest day, as its view showed it. */
function subscriberLines(day: SubscriberDayInput | null): MeasureLine[] {
  if (day === null) return [line({ section: "subscribers", measure: "not_run", period: PILOT, value: englishText("staff.measuresExport.values.notRun"), unit: "text" })];
  return day.measures.flatMap((reading) => {
    const base = { section: "subscribers" as const, measure: reading.measure, period: day.day };
    return [
      countLine(base, reading.total),
      ...reading.byLanguage.map((cell) => countLine({ ...base, split: "language", key: cell.lang, label: languageName(cell.lang) }, cell.count)),
      ...reading.byNeighbourhood.map((cell) => countLine({ ...base, split: "neighbourhood", key: cell.nbhd, label: neighbourhoodName(cell.nbhd) }, cell.count)),
    ];
  });
}

/** The usage events the export reads, by section: installs (FR-M1) and directory and map use (FR-M3). */
export const INSTALL_EVENTS = ["install"] as const;
export const DIRECTORY_EVENTS = ["directory_view", "listing_view", "map_view", "guide_view", "numbers_view"] as const;

/** One usage event over a period: the total, by page language and by neighbourhood. */
function usageLines(section: MeasureSection, evt: string, period: string, rows: readonly UsageRow[]): MeasureLine[] {
  const mine = rows.filter((row) => row.evt === evt);
  const base = { section, measure: evt, period };
  const langs = sumBy(mine, (row) => row.lang, (row) => row.n);
  const nbhds = sumBy(mine, (row) => row.nbhd, (row) => row.n);
  return [
    ...splitLines(base, "language", [...langs.keys()].sort(byLang).map((lang) => ({ key: lang, label: languageName(lang), n: langs.get(lang) ?? 0 }))),
    ...splitLines(base, "neighbourhood", [...nbhds.keys()].sort().map((nbhd) => ({ key: nbhd, label: neighbourhoodName(nbhd), n: nbhds.get(nbhd) ?? 0 }))).slice(1),
  ];
}

function usageSection(section: MeasureSection, events: readonly string[], rows: readonly UsageRow[], week: string): MeasureLine[] {
  const ofWeek = rows.filter((row) => row.weekStart === week);
  return events.flatMap((evt) => [...usageLines(section, evt, `week ${week}`, ofWeek), ...usageLines(section, evt, PILOT, rows)]);
}

/** Search use (FR-M3): searches, no clear match and failed by page language, the no-match rate, and the median time of an answered question. */
function searchLines(rows: readonly SearchRow[], week: string): MeasureLine[] {
  const periods: [string | null, string][] = [
    [week, `week ${week}`],
    [null, PILOT],
  ];
  return periods.flatMap(([weekStart, period]) => {
    const total = rows.find((row) => row.weekStart === weekStart && row.lang === null);
    const langs = rows.filter((row) => row.weekStart === weekStart && row.lang !== null).sort((a, b) => byLang(a.lang ?? "", b.lang ?? ""));
    const base = { section: "search" as const, period };
    const counted = (measure: string, value: (row: SearchRow) => number) => {
      const split = shownSplit(langs.map((row) => ({ key: row.lang ?? "", n: value(row) })));
      return { measure, total: split.total, cells: split.cells };
    };
    const searches = counted("searches", (row) => row.searches);
    const noMatch = counted("no_clear_match", (row) => row.noClearMatch);
    const failed = counted("failed", (row) => row.failed);
    const lines: MeasureLine[] = [];
    for (const counts of [searches, noMatch, failed]) {
      lines.push(countLine({ ...base, measure: counts.measure }, counts.total));
      for (const cell of counts.cells) lines.push(countLine({ ...base, measure: counts.measure, split: "language", key: cell.key, label: languageName(cell.key) }, cell.count));
    }
    lines.push(percentLine({ ...base, measure: "no_clear_match_percent" }, shownPercent(noMatch.total, searches.total)));
    noMatch.cells.forEach((cell, index) =>
      lines.push(percentLine({ ...base, measure: "no_clear_match_percent", split: "language", key: cell.key, label: languageName(cell.key) }, shownPercent(cell.count, searches.cells[index].count))),
    );
    const time = (row: SearchRow | undefined) => (row?.medianMs === null || row?.medianMs === undefined ? englishText("staff.measuresExport.values.none") : String(row.medianMs));
    lines.push(line({ ...base, measure: "median_answer_ms", value: time(total), unit: "milliseconds" }));
    for (const row of langs) lines.push(line({ ...base, measure: "median_answer_ms", split: "language", key: row.lang, label: languageName(row.lang ?? ""), value: time(row), unit: "milliseconds" }));
    return lines;
  });
}

/** Times (FR-M2): per alert entry, then the medians, then the time to 90% delivered by language. Drills apart. */
function timingLines(input: MeasuresInput, isLeftOut: (alertId: string) => boolean, leftOutEntry: (entryId: string) => boolean): MeasureLine[] {
  const deliveries = new Map(input.deliveries.map((row) => [row.entryId, row]));
  const lines: MeasureLine[] = [];
  for (const drill of [false, true]) {
    const approvals = input.approvals.filter((row) => row.isDrill === drill && !isLeftOut(row.alertId)).sort((a, b) => a.approvedAt.getTime() - b.approvedAt.getTime() || a.entryId.localeCompare(b.entryId));
    const firstAck: number[] = [];
    const toApproval: number[] = [];
    const toHandOff: number[] = [];
    const toNinety: number[] = [];
    let notReached = 0;
    for (const row of approvals) {
      const base = { section: "timing" as const, isDrill: drill, period: torontoDay(row.approvedAt), split: "entry" as const, alertId: row.alertId, entryId: row.entryId };
      lines.push(line({ ...base, measure: "kind", value: row.kind, unit: "text" }));
      if (row.reportedToFirstAckMs !== null) {
        firstAck.push(seconds(row.reportedToFirstAckMs));
        lines.push(line({ ...base, measure: "reported_to_first_ack_seconds", value: String(seconds(row.reportedToFirstAckMs)), unit: "seconds" }));
      }
      toApproval.push(seconds(row.firstSaveToApprovalMs));
      lines.push(line({ ...base, measure: "first_save_to_approval_seconds", value: String(seconds(row.firstSaveToApprovalMs)), unit: "seconds" }));
      const sent = deliveries.get(row.entryId);
      if (sent === undefined) continue;
      const handedOff = shownCount(sent.handedOff);
      lines.push(countLine({ ...base, measure: "texts_handed_off" }, handedOff));
      if (sent.firstHandOffSeconds !== null) {
        toHandOff.push(sent.firstHandOffSeconds);
        lines.push(line({ ...base, measure: "approval_to_first_hand_off_seconds", value: String(sent.firstHandOffSeconds), unit: "seconds" }));
      }
      // The 90% reading is a share of the texts handed off: not shown when they are 1 to 4 (S09.04's rule).
      if (isSmall(sent.handedOff)) {
        lines.push(line({ ...base, measure: "approval_to_90_percent_delivered_seconds", value: NOT_SHOWN, unit: "seconds" }));
      } else if (sent.ninetyPercentSeconds !== null) {
        toNinety.push(sent.ninetyPercentSeconds);
        lines.push(line({ ...base, measure: "approval_to_90_percent_delivered_seconds", value: String(sent.ninetyPercentSeconds), unit: "seconds" }));
      } else {
        notReached += 1;
        lines.push(line({ ...base, measure: "approval_to_90_percent_delivered_seconds", value: englishText("staff.measuresExport.values.notReached"), unit: "seconds" }));
        lines.push(percentLine({ ...base, measure: "delivered_percent" }, shownPercent(shownCount(sent.delivered), handedOff)));
      }
    }
    const base = { section: "timing" as const, isDrill: drill, period: PILOT, basis: "median" };
    const medianLine = (measure: string, values: number[]) => {
      const value = median(values);
      return [
        line({ ...base, measure, value: value === null ? englishText("staff.measuresExport.values.none") : String(value), unit: "seconds" }),
        line({ ...base, measure: `${measure}_entries`, value: String(values.length), unit: "count", basis: null }),
      ];
    };
    lines.push(...medianLine("reported_to_first_ack_seconds", firstAck));
    lines.push(...medianLine("first_save_to_approval_seconds", toApproval));
    lines.push(...medianLine("approval_to_first_hand_off_seconds", toHandOff));
    lines.push(...medianLine("approval_to_90_percent_delivered_seconds", toNinety));
    lines.push(line({ ...base, measure: "ninety_percent_not_reached_entries", value: String(notReached), unit: "count", basis: null }));
    // By language: S09.04's per-language readings (already judged), their median over the entries where the 90% time is shown.
    const byLanguage = new Map<string, number[]>();
    for (const row of input.languageTimings) {
      if (row.isDrill !== drill || leftOutEntry(row.entryId)) continue;
      const list = byLanguage.get(row.lang) ?? [];
      if (row.status === "reached" && row.ninetyPercentSeconds !== null) list.push(row.ninetyPercentSeconds);
      byLanguage.set(row.lang, list);
    }
    for (const lang of [...byLanguage.keys()].sort(byLang)) {
      const value = median(byLanguage.get(lang) ?? []);
      lines.push(
        line({
          ...base,
          measure: "approval_to_90_percent_delivered_seconds",
          split: "language",
          key: lang,
          label: languageName(lang),
          value: value === null ? englishText("staff.measuresExport.values.none") : String(value),
          unit: "seconds",
        }),
      );
    }
  }
  return lines;
}

/** The round statuses, in the order the page lists them: what was asked for, then the outcomes (E08 "Round tally"). */
export const CHECKIN_STATUSES = ["requested", "done", "not_reached", "needs_help", "withdrawn", "unmarked"] as const;

/** Check-in counts (E3, FR-M4's "data apart from drills"): per closed thread by building and floor, and the pilot's by neighbourhood. No drill has a round. */
function checkinLines(rows: readonly CheckinRow[]): MeasureLine[] {
  const lines: MeasureLine[] = [];
  const threads = [...new Map(rows.map((row) => [row.alertId, row.closedAt])).entries()].sort((a, b) => a[1].getTime() - b[1].getTime() || a[0].localeCompare(b[0]));
  const floorKey = (row: CheckinRow) => `${row.rsn} ${row.floorLabel ?? row.floorId}`;
  for (const [alertId, closedAt] of threads) {
    const mine = rows.filter((row) => row.alertId === alertId);
    for (const status of CHECKIN_STATUSES) {
      const ofStatus = mine.filter((row) => row.status === status);
      const base = { section: "checkins" as const, measure: status, period: torontoDay(closedAt), alertId };
      const buildings = sumBy(ofStatus, (row) => row.rsn, (row) => row.n);
      const addresses = new Map(mine.map((row) => [row.rsn, row.address]));
      const allBuildings = [...new Set(mine.map((row) => row.rsn))].sort();
      const byBuilding = splitLines({ ...base }, "building", allBuildings.map((rsn) => ({ key: rsn, label: addresses.get(rsn) ?? rsn, n: buildings.get(rsn) ?? 0 })));
      byBuilding[0] = { ...byBuilding[0], split: "thread" };
      const floors = sumBy(ofStatus, floorKey, (row) => row.n);
      const places = [...new Map(mine.map((row) => [floorKey(row), row])).values()].sort(
        (a, b) => a.rsn.localeCompare(b.rsn) || (a.floorOrder ?? Number.MAX_SAFE_INTEGER) - (b.floorOrder ?? Number.MAX_SAFE_INTEGER) || floorKey(a).localeCompare(floorKey(b)),
      );
      const floorLabel = (row: CheckinRow) =>
        `${row.address}, ${row.floorLabel === null ? englishText("staff.measuresExport.floorGone") : englishText("staff.measuresExport.floor", { floor: row.floorLabel })}`;
      const byFloor = splitLines({ ...base }, "floor", places.map((row) => ({ key: floorKey(row), label: floorLabel(row), n: floors.get(floorKey(row)) ?? 0 }))).slice(1);
      lines.push(...byBuilding, ...byFloor);
    }
  }
  // The pilot to date: every closed thread, by neighbourhood.
  for (const status of CHECKIN_STATUSES) {
    const ofStatus = rows.filter((row) => row.status === status);
    const nbhds = sumBy(ofStatus, (row) => row.nbhd, (row) => row.n);
    const all = [...new Set(rows.map((row) => row.nbhd))].sort();
    lines.push(...splitLines({ section: "checkins", measure: status, period: PILOT }, "neighbourhood", all.map((nbhd) => ({ key: nbhd, label: neighbourhoodName(nbhd), n: nbhds.get(nbhd) ?? 0 }))));
  }
  lines.push(line({ section: "checkins", measure: "rounds_closed", period: PILOT, value: String(threads.length), unit: "count" }));
  return lines;
}

/** Translation (FR-M2's machine translation measure): the fallback rate by language (drills apart), and the survey of who understood. */
function translationLines(rows: readonly TranslationRow[], survey: Survey): MeasureLine[] {
  const lines: MeasureLine[] = [];
  for (const drill of [false, true]) {
    const mine = rows.filter((row) => row.isDrill === drill);
    if (drill && mine.length === 0) continue;
    const langs = [...new Set(mine.map((row) => row.lang))].sort(byLang);
    const base = { section: "translation" as const, isDrill: drill, period: PILOT };
    const translated = shownSplit(langs.map((lang) => ({ key: lang, n: mine.filter((row) => row.lang === lang).length })));
    const fellBack = shownSplit(langs.map((lang) => ({ key: lang, n: mine.filter((row) => row.lang === lang && row.fellBack).length })));
    lines.push(countLine({ ...base, measure: "entries_translated" }, translated.total));
    lines.push(countLine({ ...base, measure: "fell_back" }, fellBack.total));
    lines.push(percentLine({ ...base, measure: "fallback_percent" }, shownPercent(fellBack.total, translated.total)));
    langs.forEach((lang, index) => {
      const where = { ...base, split: "language" as const, key: lang, label: languageName(lang) };
      lines.push(countLine({ ...where, measure: "entries_translated" }, translated.cells[index].count));
      lines.push(countLine({ ...where, measure: "fell_back" }, fellBack.cells[index].count));
      lines.push(percentLine({ ...where, measure: "fallback_percent" }, shownPercent(fellBack.cells[index].count, translated.cells[index].count)));
    });
  }
  const period = survey.from === null ? PILOT : survey.from === survey.to ? survey.from : `${survey.from} to ${survey.to}`;
  const base = { section: "translation" as const, period };
  if (survey.byLanguage.length === 0) {
    lines.push(line({ ...base, measure: "survey", value: englishText("staff.measuresExport.values.noSurvey"), unit: "text" }));
    return lines;
  }
  const asked = shownSplit(survey.byLanguage.map((row) => ({ key: row.lang, n: row.asked })));
  const understood = shownSplit(survey.byLanguage.map((row) => ({ key: row.lang, n: row.understood })));
  lines.push(countLine({ ...base, measure: "survey_asked" }, asked.total));
  lines.push(countLine({ ...base, measure: "survey_understood" }, understood.total));
  lines.push(percentLine({ ...base, measure: "survey_understood_percent" }, shownPercent(understood.total, asked.total)));
  survey.byLanguage.forEach((row, index) => {
    const where = { ...base, split: "language" as const, key: row.lang, label: languageName(row.lang) };
    lines.push(countLine({ ...where, measure: "survey_asked" }, asked.cells[index].count));
    lines.push(countLine({ ...where, measure: "survey_understood" }, understood.cells[index].count));
    lines.push(percentLine({ ...where, measure: "survey_understood_percent" }, shownPercent(understood.cells[index].count, asked.cells[index].count)));
  });
  return lines;
}

/** Corrections, withdrawals and finals sent and their reach (FR-M4), as S07.10's view (and S09.08's kept copy) judged them. Drills apart. */
function correctionLines(rows: { real: readonly CorrectionRow[]; drills: readonly CorrectionRow[] }, isLeftOut: (alertId: string) => boolean): MeasureLine[] {
  const lines: MeasureLine[] = [];
  for (const [drill, list] of [
    [false, rows.real],
    [true, rows.drills],
  ] as const) {
    const mine = list.filter((row) => !isLeftOut(row.alertId)).sort((a, b) => (a.approvedAt?.getTime() ?? 0) - (b.approvedAt?.getTime() ?? 0) || a.entryId.localeCompare(b.entryId));
    for (const kind of ["correction", "withdrawal", "final"]) {
      lines.push(line({ section: "corrections", isDrill: drill, measure: `${kind}s_sent`, period: PILOT, value: String(mine.filter((row) => row.kind === kind).length), unit: "count" }));
    }
    for (const row of mine) {
      const base = { section: "corrections" as const, isDrill: drill, period: row.approvedAt ? torontoDay(row.approvedAt) : PILOT, split: "entry" as const, alertId: row.alertId, entryId: row.entryId };
      lines.push(line({ ...base, measure: "kind", value: row.kind, unit: "text" }));
      lines.push(countLine({ ...base, measure: "original_recipients" }, row.originalRecipients));
      lines.push(countLine({ ...base, measure: "attempted_reach" }, row.attemptedReach));
      lines.push(countLine({ ...base, measure: "confirmed_reach" }, row.confirmedReach));
      lines.push(percentLine({ ...base, measure: "attempted_percent" }, row.attemptedPercent));
      lines.push(percentLine({ ...base, measure: "confirmed_percent" }, row.confirmedPercent));
    }
  }
  return lines;
}

/** Drills run (FR-M4): each drill thread with its texts to the drill roster. Always apart. */
function drillLines(rows: readonly DrillRow[]): MeasureLine[] {
  const lines: MeasureLine[] = [line({ section: "drills", isDrill: true, measure: "drills_run", period: PILOT, value: String(rows.length), unit: "count" })];
  for (const row of [...rows].sort((a, b) => a.firstApprovedAt.getTime() - b.firstApprovedAt.getTime() || a.alertId.localeCompare(b.alertId))) {
    const base = { section: "drills" as const, isDrill: true, period: torontoDay(row.firstApprovedAt), split: "thread" as const, alertId: row.alertId };
    lines.push(line({ ...base, measure: "entries_approved", value: String(row.entriesApproved), unit: "count" }));
    // The texts handed off and what became of them: a total and its parts, so the rule hides a second part when one would be revealed.
    const inFlight = Math.max(0, row.handedOff - row.delivered - row.notDelivered - row.unknown);
    const outcomes = shownSplit([
      { key: "delivered", n: row.delivered },
      { key: "not_delivered", n: row.notDelivered },
      { key: "unknown", n: row.unknown },
      { key: "in_flight", n: inFlight },
    ]);
    lines.push(countLine({ ...base, measure: "texts_handed_off" }, outcomes.total));
    for (const cell of outcomes.cells) lines.push(countLine({ ...base, measure: `texts_${cell.key}` }, cell.count));
    lines.push(countLine({ ...base, measure: "texts_not_sent" }, shownCount(row.notSent)));
  }
  return lines;
}

/** Cost per alert (FR-M5): text messages by language (actual where reported, a labelled estimate otherwise) and each alert's share of the vendor's use. */
function costLines(cost: NonNullable<MeasuresInput["cost"]>, isLeftOut: (alertId: string) => boolean): MeasureLine[] {
  const lines: MeasureLine[] = [];
  const amountLine = (base: Omit<LineInput, "value" | "unit" | "measure">, row: AlertCostRowInput) =>
    line({
      ...base,
      measure: "text_cost",
      value: row.countedMillicents === null ? NOT_SHOWN : dollars(row.countedMillicents / 1000),
      unit: "CAD",
      basis: row.basis,
    });
  for (const [drill, list] of [
    [false, cost.real],
    [true, cost.drills],
  ] as const) {
    const mine = list.filter((entry) => !isLeftOut(entry.alertId)).sort((a, b) => (a.approvedAt?.getTime() ?? 0) - (b.approvedAt?.getTime() ?? 0) || a.entryId.localeCompare(b.entryId));
    for (const entry of mine) {
      const base = { section: "cost_per_alert" as const, isDrill: drill, period: entry.approvedAt ? torontoDay(entry.approvedAt) : PILOT, split: "entry" as const, alertId: entry.alertId, entryId: entry.entryId };
      lines.push(line({ ...base, measure: "kind", value: entry.kind, unit: "text" }));
      if (entry.total !== null) {
        lines.push(countLine({ ...base, measure: "texts" }, entry.total.texts));
        lines.push(amountLine(base, entry.total));
      }
      for (const row of entry.languages) {
        const where = { ...base, split: "language" as const, key: row.lang, label: languageName(row.lang ?? "") };
        lines.push(countLine({ ...where, measure: "texts" }, row.texts));
        lines.push(amountLine(where, row));
      }
      for (const month of entry.cohere) {
        const where = { ...base, period: month.month };
        lines.push(line({ ...where, measure: "translation_calls", value: String(month.calls), unit: "calls" }));
        lines.push(line({ ...where, measure: "translation_token_share_percent", value: month.tokenSharePercent === null ? NOT_SHOWN : String(month.tokenSharePercent), unit: "percent", basis: month.tokensEstimated ? "estimated tokens" : null }));
        lines.push(
          line({
            ...where,
            measure: "translation_cost",
            value: month.costCents === null ? englishText("staff.measuresExport.values.unknown") : dollars(month.costCents),
            unit: "CAD",
            basis: month.costCents === null ? "price unknown" : "priced",
          }),
        );
      }
    }
  }
  // The vendor's months: real alerts' share and drills' share of every billed token. A rehearsal's translation is counted here, as it was billed.
  for (const month of cost.cohere) {
    const base = { section: "cost_per_alert" as const, period: month.month, split: "month" as const, key: month.month };
    const estimated = month.tokensEstimated ? "estimated tokens" : null;
    lines.push(line({ ...base, measure: "translation_calls_all", value: String(month.allCalls), unit: "calls" }));
    lines.push(line({ ...base, measure: "translation_calls_alerts", value: String(month.alertCalls), unit: "calls" }));
    lines.push(line({ ...base, measure: "translation_token_share_percent", value: month.alertTokenSharePercent === null ? NOT_SHOWN : String(month.alertTokenSharePercent), unit: "percent", basis: estimated }));
    const amount = (cents: number | null) => (cents === null ? englishText("staff.measuresExport.values.unknown") : dollars(cents));
    lines.push(line({ ...base, measure: "translation_cost_alerts", value: amount(month.alertCostCents), unit: "CAD", basis: month.alertCostCents === null ? "price unknown" : "priced" }));
    lines.push(line({ ...base, measure: "translation_cost_all", value: amount(month.allCostCents), unit: "CAD", basis: month.allCostCents === null ? "price unknown" : "priced" }));
    if (month.drillCalls > 0) {
      const drill = { ...base, isDrill: true };
      lines.push(line({ ...drill, measure: "translation_calls_alerts", value: String(month.drillCalls), unit: "calls" }));
      lines.push(line({ ...drill, measure: "translation_token_share_percent", value: month.drillTokenSharePercent === null ? NOT_SHOWN : String(month.drillTokenSharePercent), unit: "percent", basis: estimated }));
      lines.push(line({ ...drill, measure: "translation_cost_alerts", value: amount(month.drillCostCents), unit: "CAD", basis: month.drillCostCents === null ? "price unknown" : "priced" }));
    }
  }
  return lines;
}

/** Total spend (FR-M5, NFR-N9): S07.08's spend view for the pilot to date and this month, against the budget. */
function spendLines(spend: SpendInput): MeasureLine[] {
  const lines: MeasureLine[] = [];
  const period = (key: "pilot" | "thisMonth") => (key === "pilot" ? PILOT : spend.month);
  for (const key of ["pilot", "thisMonth"] as const) {
    const figures = spend[key];
    const base = { section: "spend" as const, period: period(key), unit: "CAD" as const };
    const texts = (n: number) => shownCount(n).shown;
    lines.push(line({ ...base, measure: "total_counted", value: dollars(figures.totalCents), basis: figures.incomplete ? "incomplete: leaves out use whose price is unknown" : "actual and estimate" }));
    lines.push(line({ ...base, measure: "sms_counted", value: dollars(figures.sms.countedCents), basis: "actual and estimate" }));
    lines.push(line({ ...base, measure: "sms_actual", value: dollars(figures.sms.actual.cents), basis: "actual" }));
    lines.push(line({ ...base, measure: "sms_actual_texts", value: texts(figures.sms.actual.texts), unit: "count" }));
    lines.push(line({ ...base, measure: "sms_unmatched_actuals", value: dollars(figures.sms.unmatchedActuals.cents), basis: "actual" }));
    lines.push(line({ ...base, measure: "sms_unresolved_estimates", value: dollars(figures.sms.unresolvedEstimates.cents), basis: "estimate" }));
    for (const month of figures.sms.pendingMonths) {
      lines.push(line({ ...base, measure: "sms_pending_reconciliation", split: "month", key: month.month, value: dollars(month.estimatedCents), basis: `estimate (${month.reason})` }));
    }
    lines.push(line({ ...base, measure: "translation_priced", value: dollars(figures.cohere.priced.cents), basis: "priced" }));
    const unpriced = figures.cohere.unpriced;
    if (unpriced.calls > 0 || unpriced.tokens > 0) {
      lines.push(
        line({
          ...base,
          measure: "translation_price_unknown",
          value: unpriced.estimateCents === null ? englishText("staff.measuresExport.values.unknown") : dollars(unpriced.estimateCents),
          basis: unpriced.estimateCents === null ? "price unknown" : "estimate",
        }),
      );
      lines.push(line({ ...base, measure: "translation_price_unknown_calls", value: String(unpriced.calls), unit: "calls" }));
      lines.push(line({ ...base, measure: "translation_price_unknown_tokens", value: String(unpriced.tokens), unit: "tokens", basis: figures.cohere.tokensEstimated ? "estimated tokens" : null }));
    }
  }
  const base = { section: "spend" as const, period: PILOT, unit: "CAD" as const };
  lines.push(line({ ...base, measure: "budget", value: dollars(spend.budgetCents) }));
  lines.push(line({ ...base, measure: "budget_remaining", value: dollars(spend.remainingCents), basis: spend.pilot.incomplete ? "incomplete: leaves out use whose price is unknown" : null }));
  lines.push(line({ ...base, measure: "monthly_cap", period: spend.month, value: spend.capCents === null ? englishText("staff.measuresExport.values.notSet") : dollars(spend.capCents) }));
  return lines;
}

/** Coverage (the E5 coverage view's measure): buildings and floors with an ambassador, by neighbourhood. */
function coverageLines(rows: readonly CoverageInput[]): MeasureLine[] {
  const sorted = [...rows].sort((a, b) => a.nbhd.localeCompare(b.nbhd));
  const base = { section: "coverage" as const, period: PILOT };
  const lines: MeasureLine[] = [];
  const splits = new Map<string, ReturnType<typeof shownSplit<string>>>();
  for (const measure of ["buildings", "buildings_covered", "buildings_fully_covered", "floors", "floors_covered"] as const) {
    const value = (row: CoverageInput) =>
      ({ buildings: row.buildings, buildings_covered: row.buildingsCovered, buildings_fully_covered: row.buildingsFullyCovered, floors: row.floors, floors_covered: row.floorsCovered })[measure];
    const split = shownSplit(sorted.map((row) => ({ key: row.nbhd, n: value(row) })));
    splits.set(measure, split);
    lines.push(countLine({ ...base, measure }, split.total));
    split.cells.forEach((cell, index) => lines.push(countLine({ ...base, measure, split: "neighbourhood", key: cell.key, label: neighbourhoodName(cell.key, sorted[index].name) }, cell.count)));
  }
  const floors = splits.get("floors")!;
  const covered = splits.get("floors_covered")!;
  lines.push(percentLine({ ...base, measure: "floors_covered_percent" }, shownPercent(covered.total, floors.total)));
  sorted.forEach((row, index) =>
    lines.push(percentLine({ ...base, measure: "floors_covered_percent", split: "neighbourhood", key: row.nbhd, label: neighbourhoodName(row.nbhd, row.name) }, shownPercent(covered.cells[index].count, floors.cells[index].count))),
  );
  return lines;
}

/** The export's own lines: the day, the edition, the week read, and how many rehearsal alerts were left out. */
function aboutLines(context: MeasuresContext): MeasureLine[] {
  const base = { section: "about" as const, period: context.asOf };
  return [
    line({ ...base, measure: "as_of", value: context.asOf, unit: "date" }),
    line({ ...base, measure: "edition", value: context.edition, unit: "text" }),
    line({ ...base, measure: "week", value: context.week, unit: "date" }),
    line({ ...base, measure: "rehearsal_entries_listed", value: String(context.leftOut.listed), unit: "count" }),
    line({ ...base, measure: "rehearsal_entries_not_found", value: String(context.leftOut.notFound), unit: "count" }),
    line({ ...base, measure: "rehearsal_alerts_left_out", value: String(context.leftOut.alertIds.size), unit: "count" }),
    line({ ...base, measure: "rehearsal_entries_left_out", value: String(context.leftOut.entryIds.size), unit: "count" }),
  ];
}

const sectionRank = (section: MeasureSection) => MEASURE_SECTIONS.indexOf(section);

/**
 * Every line of the export, real measures before drills and in section order (a stable sort keeps each section's own order). The Coordinator edition has no
 * line of spend or cost per alert, whatever it was given.
 */
export function measureLines(input: MeasuresInput, context: MeasuresContext): MeasureLine[] {
  const isLeftOut = (alertId: string) => context.leftOut.alertIds.has(alertId);
  const leftOutEntry = (entryId: string) => context.leftOut.entryIds.has(entryId);
  const lines = [
    ...aboutLines(context),
    ...subscriberLines(input.subscribers),
    ...usageSection("installs", INSTALL_EVENTS, input.usage, context.week),
    ...timingLines(input, isLeftOut, leftOutEntry),
    ...checkinLines(input.checkins.filter((row) => !isLeftOut(row.alertId))),
    ...usageSection("directory_use", DIRECTORY_EVENTS, input.usage, context.week),
    ...searchLines(input.search, context.week),
    ...translationLines(
      input.translations.filter((row) => !isLeftOut(row.alertId)),
      input.survey,
    ),
    ...correctionLines(input.corrections, isLeftOut),
    ...drillLines(input.drills),
    ...(context.edition === "director" && input.cost !== null ? costLines(input.cost, isLeftOut) : []),
    ...(context.edition === "director" && input.spend !== null ? spendLines(input.spend) : []),
    ...coverageLines(input.coverage),
  ];
  return lines
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => Number(a.entry.isDrill) - Number(b.entry.isDrill) || sectionRank(a.entry.section) - sectionRank(b.entry.section) || a.index - b.index)
    .map(({ entry }) => entry);
}

/** Whether an edition has the spend sections (AD-4). */
export const editionHasSpend = (edition: MeasureEdition): boolean => edition === "director";

/** The measures whose count the rule never hides: the Hub's own work, not split by language, neighbourhood, building or floor. */
export const UNPROTECTED_COUNTS: readonly string[] = [
  "rehearsal_entries_listed",
  "rehearsal_entries_not_found",
  "rehearsal_alerts_left_out",
  "rehearsal_entries_left_out",
  "rounds_closed",
  "drills_run",
  "entries_approved",
  "corrections_sent",
  "withdrawals_sent",
  "finals_sent",
  "reported_to_first_ack_seconds_entries",
  "first_save_to_approval_seconds_entries",
  "approval_to_first_hand_off_seconds_entries",
  "approval_to_90_percent_delivered_seconds_entries",
  "ninety_percent_not_reached_entries",
];
