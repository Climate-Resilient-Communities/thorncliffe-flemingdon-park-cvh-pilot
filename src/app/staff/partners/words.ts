// The words of the Hub and partner space (2026-11-07), from the English catalog: the Hub is English only. The prototype's own screen strings
// (P01 to P16) are used wherever they say what the screen says; `staff.partners.*` holds what the prototype had no words for (a space's status
// and purpose on the Hub's board, the screens' headings, a form's refusals). Times are written as the prototype writes them: "20 minutes ago",
// and a clock time or a day in Toronto.
import { englishText } from "@/i18n/text";

/** A `staff.partners.*` string. */
export const pw = (key: string, values?: Record<string, string | number>): string => englishText(`staff.partners.${key}`, values);

/** A prototype screen string (`P02.comPending`, `P11.modes.during`). */
export const ps = (key: string, values?: Record<string, string | number>): string => englishText(key, values);

/** "20 minutes", "3 hours", "2 days" (the resident app's time words, which the Hub shares). Under a minute is "1 minute". */
export function duration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return minutes === 1 ? englishText("time.minute") : englishText("time.minutes", { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 48) return hours === 1 ? englishText("time.hour") : englishText("time.hours", { n: hours });
  return englishText("time.days", { n: Math.round(hours / 24) });
}

/** "just now" under a minute, otherwise "20 minutes ago". */
export function ago(at: Date, now: Date): string {
  const ms = now.getTime() - at.getTime();
  return ms < 60_000 ? englishText("time.justNow") : englishText("time.ago", { t: duration(ms) });
}

/** A clock time in Toronto ("7:05 p.m."). */
export const clock = (at: Date): string => new Intl.DateTimeFormat("en-CA", { timeStyle: "short", timeZone: "America/Toronto" }).format(at);

/** A day "YYYY-MM-DD" as staff read it ("Nov 26, 2026"), read at noon UTC so no time zone moves it to another day. */
export const day = (iso: string): string => new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: "America/Toronto" }).format(new Date(`${iso}T12:00:00Z`));

/** A month "YYYY-MM" as staff read it ("Feb 2026"). */
export const month = (period: string): string =>
  new Intl.DateTimeFormat("en-CA", { month: "short", year: "numeric", timeZone: "America/Toronto" }).format(new Date(`${period}-15T12:00:00Z`));

/** Today in Toronto as "YYYY-MM-DD". */
export const torontoToday = (now: Date): string => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(now);

/** The words of a disruption type (staff.partners.hazard.*: the resident catalog's hazards.* has no winter, water or other). */
export const hazardWord = (hazard: string): string => pw(`hazard.${hazard}`);
