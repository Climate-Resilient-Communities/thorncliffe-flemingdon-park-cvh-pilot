// How an alert's valid-until is written for a resident (R-07, prototype R07 `validLine`): "Valid until today at 3:00 p.m.",
// "Valid until tomorrow at 9:00 a.m.", "Valid until Friday at 9:00 p.m.". The day is the Toronto day (the Hub's staff entered the time in Toronto
// time, and the pilot is in Toronto), always on the Gregorian calendar, and "today" and "tomorrow" are Toronto days of the feed's `server_now`,
// never of the phone's clock (spine, Consistency Conventions: "ago" and every comparison use the feed's own time). An alert is at most 7 days
// ahead (AD-5), so the weekday is never ambiguous. Pure: it reads no clock; the catalog's words come in through `t`.

export type Translate = (key: string, values?: Record<string, string | number>) => string;

const TORONTO = "America/Toronto";
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DAY_MS = 86_400_000;

/** The Toronto calendar day of an instant, and its weekday (0 is Sunday). */
export function torontoDay(date: Date): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TORONTO, year: "numeric", month: "numeric", day: "numeric", weekday: "short" }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = WEEKDAYS.findIndex((name) => name === get("weekday").slice(0, 3).toLowerCase());
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")), weekday };
}

/** Whole Toronto calendar days from `from` to `to` (0: the same day, 1: the next). */
export function torontoDaysBetween(from: Date, to: Date): number {
  const a = torontoDay(from);
  const b = torontoDay(to);
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY_MS);
}

/**
 * The line that says how long an alert stays valid, or null when its time has passed at `now` (the page says that in its own words).
 * `locale` is the language's BCP-47 tag; the catalog's `R07.validLine`, `time.until`, `R29.todayAt` and `R29.dayAt` and the weekday and
 * "tomorrow" words of `time` carry the language.
 */
export function validUntilLine(validUntil: Date, now: Date, locale: string, t: Translate): string | null {
  if (validUntil.getTime() <= now.getTime()) return null;
  const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: TORONTO, calendar: "gregory" }).format(validUntil);
  const days = torontoDaysBetween(now, validUntil);
  const when =
    days <= 0
      ? t("R29.todayAt", { time })
      : t("R29.dayAt", { day: days === 1 ? t("time.tomorrow") : t(`time.days7.${WEEKDAYS[torontoDay(validUntil).weekday]}`), time });
  return t("R07.validLine", { until: t("time.until", { t: when }) });
}

/**
 * When something happened, as a clock time a message can carry (the shared message and the link's preview are read later, so "5 minutes ago" would be wrong
 * by then): "today at 3:00 p.m.", "Thursday at 9:00 p.m.", or the date for something older than a week, all in Toronto time and on the Gregorian calendar, with
 * "today" the Toronto day of `now` (the feed's `server_now`, never a phone's clock). A time ahead of `now` reads as today. The words come from the catalog's
 * `R29.todayAt` and `R29.dayAt` and the weekday words of `time`.
 */
export function clockPhrase(at: Date, now: Date, locale: string, t: Translate): string {
  const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: TORONTO, calendar: "gregory" }).format(at);
  const back = torontoDaysBetween(at, now);
  if (back <= 0) return t("R29.todayAt", { time });
  if (back < 7) return t("R29.dayAt", { day: t(`time.days7.${WEEKDAYS[torontoDay(at).weekday]}`), time });
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: TORONTO, calendar: "gregory" }).format(at);
  return t("R29.dayAt", { day, time });
}
