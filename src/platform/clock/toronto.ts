// Toronto wall-clock time (spine: Consistency Conventions, Time). Staff type times as `America/Toronto` wall-clock
// time; storage and payloads are UTC instants. Date arithmetic is done on the wall clock in this zone, never by adding
// milliseconds, because a day is 23, 24 or 25 hours long around the clock changes (8 March and 1 November 2026).
//
// Two wall-clock times are not one instant:
//  - a time that does not exist (the hour skipped when the clocks go forward: 02:00 to 03:00 on 8 March 2026) is
//    refused, never moved to a nearby time;
//  - a time that occurs twice (the hour repeated when the clocks go back: 01:00 to 02:00 on 1 November 2026) is
//    ambiguous, and the caller must say whether the person means the time before the change or after it.
//
// Pure: no clock is read (`now` comes from the caller) and there is no I/O. The offsets come from the platform's
// `Intl` time-zone data, so no zone rule is written here.

export const TORONTO_ZONE = "America/Toronto";

/** A date and time on the Toronto wall clock, as a person types it (minute precision). */
export interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** Which of the two instants a repeated wall-clock time means: the one before the clock change (EDT) or after it (EST). */
export type Fold = "before" | "after";

export type TorontoConversion =
  | { ok: true; instant: Date }
  | { ok: false; reason: "invalid" }
  /** The time does not exist: the clocks skipped it going forward. */
  | { ok: false; reason: "nonexistent" }
  /** The time occurs twice: `before` is the first, `after` the second. */
  | { ok: false; reason: "ambiguous"; before: Date; after: Date };

const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: TORONTO_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  calendar: "gregory",
  numberingSystem: "latn",
});

const MINUTE = 60_000;

function wallClockAt(ms: number): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const found: Record<string, number> = {};
  for (const part of parts.formatToParts(new Date(ms))) if (part.type !== "literal") found[part.type] = Number(part.value);
  return { year: found.year, month: found.month, day: found.day, hour: found.hour === 24 ? 0 : found.hour, minute: found.minute, second: found.second };
}

/** Minutes the Toronto wall clock is ahead of UTC at an instant (-300 in winter, -240 in summer). */
function offsetMinutesAt(ms: number): number {
  const wall = wallClockAt(ms);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / MINUTE);
}

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

function isValidLocal(local: LocalDateTime): boolean {
  const { year, month, day, hour, minute } = local;
  if (![year, month, day, hour, minute].every(Number.isInteger)) return false;
  if (year < 1970 || year > 9999 || month < 1 || month > 12 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

/** Every instant whose Toronto wall clock reads `local`: none (a skipped time), one, or two (a repeated time), earliest first. */
function instantsOf(local: LocalDateTime): number[] {
  const wall = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const offsets = new Set([offsetMinutesAt(wall - 24 * 60 * MINUTE), offsetMinutesAt(wall + 24 * 60 * MINUTE)]);
  const found = new Set<number>();
  for (const offset of offsets) {
    const instant = wall - offset * MINUTE;
    if (offsetMinutesAt(instant) === offset) found.add(instant);
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * Converts what staff typed (Toronto wall-clock time) to an instant. A time that does not exist is refused (`nonexistent`);
 * a time that occurs twice is `ambiguous` unless `fold` says which is meant. A `fold` given for a time that is not
 * repeated is ignored.
 */
export function fromToronto(local: LocalDateTime, fold?: Fold): TorontoConversion {
  if (!isValidLocal(local)) return { ok: false, reason: "invalid" };
  const instants = instantsOf(local);
  if (instants.length === 0) return { ok: false, reason: "nonexistent" };
  if (instants.length === 1) return { ok: true, instant: new Date(instants[0]) };
  const [before, after] = instants;
  if (fold === "before") return { ok: true, instant: new Date(before) };
  if (fold === "after") return { ok: true, instant: new Date(after) };
  return { ok: false, reason: "ambiguous", before: new Date(before), after: new Date(after) };
}

/** The Toronto wall-clock reading of an instant, to the minute. */
export function toTorontoLocal(instant: Date): LocalDateTime {
  const { year, month, day, hour, minute } = wallClockAt(instant.getTime());
  return { year, month, day, hour, minute };
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** `YYYY-MM-DD` and `HH:MM` of an instant on the Toronto wall clock: what a date and a time input hold. */
export function torontoFields(instant: Date): { date: string; time: string } {
  const local = toTorontoLocal(instant);
  return { date: `${pad(local.year, 4)}-${pad(local.month)}-${pad(local.day)}`, time: `${pad(local.hour)}:${pad(local.minute)}` };
}

/** Reads a date input's `YYYY-MM-DD` and a time input's `HH:MM` (seconds are refused); null when either is not one. */
export function parseLocalDateTime(date: string, time: string): LocalDateTime | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const t = /^(\d{2}):(\d{2})$/.exec(time.trim());
  if (!d || !t) return null;
  const local = { year: Number(d[1]), month: Number(d[2]), day: Number(d[3]), hour: Number(t[1]), minute: Number(t[2]) };
  return isValidLocal(local) ? local : null;
}

/**
 * The same Toronto wall-clock time `days` calendar days later (earlier for a negative count): 7 days after 12:00 on 30
 * October is 12:00 on 6 November, 169 hours later, because the clocks went back in between. Seconds are kept. A wall
 * time that does not exist on the day reached moves forward by the length of the gap; a repeated one is the second.
 */
export function addTorontoDays(instant: Date, days: number): Date {
  if (!Number.isInteger(days)) throw new RangeError("days must be a whole number");
  const wall = toTorontoLocal(instant);
  const target = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + days));
  const local = { year: target.getUTCFullYear(), month: target.getUTCMonth() + 1, day: target.getUTCDate(), hour: wall.hour, minute: wall.minute };
  const sub = instant.getTime() - Math.floor(instant.getTime() / MINUTE) * MINUTE;
  const found = instantsOf(local);
  if (found.length > 0) return new Date(found[found.length - 1] + sub);
  // In the skipped hour: use the offset from before the change, which lands the same distance past the skipped hour.
  const wallMs = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  return new Date(wallMs - offsetMinutesAt(wallMs - 24 * 60 * MINUTE) * MINUTE + sub);
}

/** "1:30 a.m. EDT": a time of day with its zone abbreviation, for saying which of a repeated hour's two times is meant. */
export function formatTorontoTime(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TORONTO_ZONE, hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short", numberingSystem: "latn" }).format(instant);
}

/** "Sunday, November 1, 2026 at 1:30 a.m. EDT": a whole instant, in Toronto time, for a message. */
export function formatTorontoDateTime(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TORONTO_ZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
    numberingSystem: "latn",
    calendar: "gregory",
  }).format(instant);
}

/** "November 1, 2026": the Toronto calendar date of an instant, for a message. */
export function formatTorontoDate(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TORONTO_ZONE, year: "numeric", month: "long", day: "numeric", numberingSystem: "latn", calendar: "gregory" }).format(instant);
}
