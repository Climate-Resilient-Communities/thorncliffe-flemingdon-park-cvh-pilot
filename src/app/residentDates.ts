// How the resident pages write a day (S02.08, S02.10): shared by the building page and the guide and numbers pages.
// A plain module with no framework import, so a unit test can call it with a translator.
import { isEnglishFallback } from "@/ui/text/resident-text";

/** The catalog of one language as next-intl hands it: a message with its placeholders filled, or the message as written. */
export interface Translate {
  (key: string, values?: Record<string, string | number>): string;
  raw(key: string): unknown;
}

/**
 * A day as a resident reads it: the day in Toronto, in the language's own way of writing dates, always on the
 * Gregorian calendar. Without `calendar`, Pashto (ps) and Dari (fa-AF) write the day on the Persian one, so
 * October 1, 2026 would read as 9 Mizan 1405, a date nobody here would recognise.
 */
export const formatDay = (date: Date, locale: string): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "America/Toronto", calendar: "gregory" }).format(date);

/** A calendar date the Hub recorded (YYYY-MM-DD, no time) as an instant that falls on that same day in Toronto. */
export const dayOf = (isoDate: string): Date => new Date(`${isoDate}T12:00:00Z`);

/**
 * A message with a date in it. A message that fell back to English reads as English, so its date is written the
 * English way too: "[EN] Last updated October 1, 2026", never English words around a date in another script.
 */
export function withDate(t: Translate, key: string, date: Date, locale: string): string {
  const raw = t.raw(key);
  const english = typeof raw === "string" && isEnglishFallback(raw);
  return t(key, { date: formatDay(date, english ? "en-CA" : locale) });
}
