// The weekly reliability review (S09.04, NFR-N4, AR-21): the rows of the SQL view `weekly_review` (db/migrations/20261006030000_weekly_review.sql) as the
// export reads them, and the CSV they are written as. The view applies the small-number rule (E09) and holds no personal data; this file adds nothing to
// what is shown and writes only the view's own columns, in a fixed order, so a column that could carry a phone number, a subscriber id or a message body
// cannot be added by accident (a test lists them).

/** The sections of the review, in the order the export lists them. */
export const WEEKLY_SECTIONS = [
  "health_condition",
  "delivery_problem",
  "resend",
  "pause",
  "cap_overrun",
  "translation_fallback",
  "publish_failure",
  "entry_timing",
  "slow_delivery",
  "access_request_overdue",
  "search_below_bar",
] as const;
export type WeeklySection = (typeof WEEKLY_SECTIONS)[number];

/** What the view says in place of a count of 1 to 4 (E09 "Small-number rule"). */
export const FEWER_THAN_FIVE = "fewer than 5";

export interface WeeklyRow {
  /** The Monday of the week in America/Toronto, YYYY-MM-DD. */
  weekStart: string;
  section: WeeklySection;
  /** A drill is reported apart: nothing is counted across it. */
  isDrill: boolean;
  lang: string | null;
  reason: string | null;
  /** An alert entry's id (not personal data), on an `entry_timing` row. */
  entryId: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
  firstHandOffSeconds: number | null;
  ninetyPercentSeconds: number | null;
  /** `reached` or `not reached`, on an `entry_timing` row. */
  ninetyPercentStatus: string | null;
  deliveredSharePercent: number | null;
  amountCents: number | null;
  /** The count, null when the small-number rule hides it. */
  n: number | null;
  /** The count as it is shown: a number, or "fewer than 5". */
  nShown: string | null;
}

/** The CSV's columns: the view's, in this order. Nothing else is written. */
export const WEEKLY_CSV_COLUMNS = [
  "week_start",
  "section",
  "is_drill",
  "lang",
  "reason",
  "entry_id",
  "started_at",
  "ended_at",
  "duration_seconds",
  "first_hand_off_seconds",
  "ninety_percent_seconds",
  "ninety_percent_status",
  "delivered_share_percent",
  "amount_cents",
  "count",
] as const;

const WEEK = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether `week` is a real calendar date that is a Monday (a week starts on Monday). */
export function isWeekStart(week: string): boolean {
  const match = WEEK.exec(week);
  if (match === null) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === week && date.getUTCDay() === 1;
}

/** The Monday (Toronto) of the last complete week before `now`: what the review on Monday morning is about. */
export function lastFullWeek(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const today = new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
  const sinceMonday = (today.getUTCDay() + 6) % 7;
  return new Date(today.getTime() - (sinceMonday + 7) * 86_400_000).toISOString().slice(0, 10);
}

const order = (section: WeeklySection) => WEEKLY_SECTIONS.indexOf(section);
const time = (value: Date | null) => value?.getTime() ?? 0;

/** The rows in the order the review reads them: section, real before drill, time, reason, a language's total first, then language and entry. */
export function sortWeeklyRows(rows: readonly WeeklyRow[]): WeeklyRow[] {
  return [...rows].sort(
    (a, b) =>
      order(a.section) - order(b.section) ||
      Number(a.isDrill) - Number(b.isDrill) ||
      time(a.startedAt) - time(b.startedAt) ||
      (a.reason ?? "").localeCompare(b.reason ?? "") ||
      (a.lang ?? "").localeCompare(b.lang ?? "") ||
      (a.entryId ?? "").localeCompare(b.entryId ?? ""),
  );
}

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * A cell for a spreadsheet: quoted when needed, and a text that starts like a formula is made harmless. A cell that is
 * entirely a plain number ("-12.34", an over-budget remainder) is left as it is, so the spreadsheet still reads it as a
 * number: a minus sign, digits and an optional decimal part cannot form a formula. Anything else starting with `=`, `+`,
 * `-`, `@`, a tab or a carriage return gets a leading `'`.
 */
export function csvCell(value: string | number | boolean | null): string {
  if (value === null) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text) && !PLAIN_NUMBER.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The week's CSV: a header and one line per row, `\r\n` ended. The count column is what the small-number rule shows. */
export function weeklyReviewCsv(rows: readonly WeeklyRow[]): string {
  const lines = [WEEKLY_CSV_COLUMNS.join(",")];
  for (const row of sortWeeklyRows(rows)) {
    lines.push(
      [
        row.weekStart,
        row.section,
        row.isDrill,
        row.lang,
        row.reason,
        row.entryId,
        row.startedAt?.toISOString() ?? null,
        row.endedAt?.toISOString() ?? null,
        row.durationSeconds,
        row.firstHandOffSeconds,
        row.ninetyPercentSeconds,
        row.ninetyPercentStatus,
        row.deliveredSharePercent,
        row.amountCents,
        row.nShown,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}
