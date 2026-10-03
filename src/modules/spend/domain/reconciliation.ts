// The rules of a reconciliation (S06.08, AD-8): its stable id, its exact interval, and why one can stay pending. Pure.
//
// A reconciliation of a month is identified by `month:{YYYY-MM}`, and its interval is exact: from the first instant of that calendar month
// in `America/Toronto` up to (not including) the first instant of the next, converted to UTC. The same month the rest of the app counts by
// (`inCalendarMonth` in application/spend.ts, and the check on `sms_reconciliation`, which recomputes the interval from the id in SQL).

/** The time zone of every month the pilot counts by (AD-8: spend and the cap are by Toronto calendar month). */
export const TORONTO = "America/Toronto";

/** A month, `YYYY-MM`. */
export type MonthKey = string;

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const RECONCILIATION_ID = /^month:(\d{4}-(?:0[1-9]|1[0-2]))$/;

export interface ReconciliationInterval {
  /** The reconciliation's id, `month:{YYYY-MM}`. */
  id: string;
  month: MonthKey;
  /** The first instant of the month in Toronto, as a UTC instant. Included. */
  startUtc: Date;
  /** The first instant of the next month in Toronto, as a UTC instant. Not included. */
  endUtc: Date;
}

const toronto = new Intl.DateTimeFormat("en-CA", {
  timeZone: TORONTO,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Toronto's offset from UTC at an instant, in milliseconds (negative: Toronto is behind UTC). */
function offsetMs(instantMs: number): number {
  const second = Math.floor(instantMs / 1000) * 1000;
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(toronto.formatToParts(new Date(second)).find((p) => p.type === type)?.value);
  const local = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
  return local - second;
}

/** The UTC instant at which Toronto's clock reads midnight at the start of the first day of a month. (Toronto changes its clocks at 2 a.m., never at midnight.) */
function firstInstantOfMonth(year: number, month: number): Date {
  const wall = Date.UTC(year, month - 1, 1, 0, 0, 0);
  // The offset in force at the answer, found from the offset at the wall time and checked once more at the candidate.
  const candidate = wall - offsetMs(wall);
  return new Date(wall - offsetMs(candidate));
}

/** The reconciliation id of a month: `month:{YYYY-MM}`. */
export function monthReconciliationId(month: MonthKey): string {
  if (!MONTH.test(month)) throw new RangeError(`"${month}" is not a month (YYYY-MM)`);
  return `month:${month}`;
}

/** The month, interval and id a reconciliation id names; null for an id that is not `month:{YYYY-MM}`. */
export function parseReconciliationId(id: string): ReconciliationInterval | null {
  const month = RECONCILIATION_ID.exec(id)?.[1];
  return month === undefined ? null : monthInterval(month);
}

/** The exact interval of a Toronto calendar month, in UTC. */
export function monthInterval(month: MonthKey): ReconciliationInterval {
  const match = MONTH.exec(month);
  if (!match) throw new RangeError(`"${month}" is not a month (YYYY-MM)`);
  const year = Number(match[1]);
  const number = Number(match[2]);
  const next = number === 12 ? { year: year + 1, month: 1 } : { year, month: number + 1 };
  return { id: `month:${month}`, month, startUtc: firstInstantOfMonth(year, number), endUtc: firstInstantOfMonth(next.year, next.month) };
}

/** The Toronto calendar month an instant falls in. */
export function monthOf(instant: Date): MonthKey {
  const parts = toronto.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}`;
}

/** The month before `month`. */
export function previousMonth(month: MonthKey): MonthKey {
  const match = MONTH.exec(month);
  if (!match) throw new RangeError(`"${month}" is not a month (YYYY-MM)`);
  const year = Number(match[1]);
  const number = Number(match[2]);
  return number === 1 ? `${year - 1}-12` : `${year}-${String(number - 1).padStart(2, "0")}`;
}

/**
 * Why a reconciliation is pending, each with nothing recorded from it:
 *  - `listing_failed`: the provider's listing failed (an error, a refusal, an answer that cannot be read, a next page that never ends);
 *  - `cut_short`: the listing was stopped before `next_page_uri` ran out (the page limit or the time limit of one run);
 *  - `message_without_price`: a message in the interval has no price yet (the provider fills it in some time after the send);
 *  - `price_unusable`: a message has a price this app cannot convert (an unreadable amount, or a currency it has no rate for);
 *  - `message_malformed`: a message in the listing lacks what an import needs (its id or the instant it was sent).
 */
export const PENDING_REASONS = ["listing_failed", "cut_short", "message_without_price", "price_unusable", "message_malformed"] as const;
export type PendingReason = (typeof PENDING_REASONS)[number];
