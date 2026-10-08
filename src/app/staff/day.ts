// A date as the Hub's staff read it: the day in Toronto, written "Oct 2, 2026". Free of the catalog, so a client component can use it.

/** A moment as its day in Toronto. */
export const formatDay = (date: Date): string => new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: "America/Toronto" }).format(date);

/** A day "YYYY-MM-DD" (a provider's last-confirmed date), read at noon UTC so no time zone moves it to another day. */
export const formatIsoDay = (day: string): string => formatDay(new Date(`${day}T12:00:00Z`));
