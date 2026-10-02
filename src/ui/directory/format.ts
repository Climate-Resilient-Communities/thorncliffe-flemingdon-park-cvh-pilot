// Dates and times as a resident reads them: in Toronto, in the language's own way of writing, always on the Gregorian
// calendar (without `calendar`, Pashto and Dari write the Persian one, so October 1, 2026 would read as 9 Mizan 1405).

/** A day "YYYY-MM-DD" (the Hub's last-confirmed date) as a long date. Read at noon UTC so no time zone moves it to another day. */
export function formatDayText(day: string, locale: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "America/Toronto", calendar: "gregory" }).format(date);
}

/** A moment (ISO 8601) as a long date and a short time, in Toronto. */
export function formatMoment(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone: "America/Toronto", calendar: "gregory" }).format(new Date(iso));
}
