import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { clockPhrase, torontoDay, torontoDaysBetween, validUntilLine, type Translate } from "./times";

// The catalog's words, as a translator would give them (src/i18n/messages/en.json).
const WORDS: Record<string, string> = {
  "R07.validLine": "Valid {until}",
  "time.until": "until {t}",
  "R29.todayAt": "today at {time}",
  "R29.dayAt": "{day} at {time}",
  "time.tomorrow": "Tomorrow",
  "time.days7.mon": "Monday",
  "time.days7.tue": "Tuesday",
  "time.days7.wed": "Wednesday",
  "time.days7.thu": "Thursday",
  "time.days7.fri": "Friday",
  "time.days7.sat": "Saturday",
  "time.days7.sun": "Sunday",
};
const t: Translate = (key, values = {}) => (WORDS[key] ?? `?${key}`).replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));

// Toronto is UTC-4 until 1 November 2026 02:00 and UTC-5 after it.
// ICU writes "3:00 PM" with a narrow no-break space before the period of the day; the tests compare it as a plain space.
const line = (validUntil: string, now: string, locale = "en") => validUntilLine(new Date(validUntil), new Date(now), locale, t)?.replace(/[  ]/g, " ") ?? null;

describe("a Toronto day", () => {
  it("is the day on a Toronto wall clock, not in UTC", () => {
    // 01:30 UTC on 2 October is 21:30 on 1 October in Toronto.
    expect(torontoDay(new Date("2026-10-02T01:30:00Z"))).toMatchObject({ year: 2026, month: 10, day: 1, weekday: 4 });
    expect(torontoDay(new Date("2026-10-02T04:00:00Z"))).toMatchObject({ month: 10, day: 2, weekday: 5 });
  });

  it("counts whole Toronto days between two instants", () => {
    expect(torontoDaysBetween(new Date("2026-10-01T15:00:00Z"), new Date("2026-10-01T23:59:00Z"))).toBe(0);
    expect(torontoDaysBetween(new Date("2026-10-01T15:00:00Z"), new Date("2026-10-02T04:30:00Z"))).toBe(1);
    expect(torontoDaysBetween(new Date("2026-10-01T15:00:00Z"), new Date("2026-10-08T15:00:00Z"))).toBe(7);
  });

  it("counts the day of the clock change as one day, not 25 hours", () => {
    // 31 October 2026 at noon to 1 November at noon, and 1 November at noon to 2 November at noon: one day each.
    expect(torontoDaysBetween(new Date("2026-10-31T16:00:00Z"), new Date("2026-11-01T17:00:00Z"))).toBe(1);
    expect(torontoDaysBetween(new Date("2026-11-01T17:00:00Z"), new Date("2026-11-02T17:00:00Z"))).toBe(1);
  });
});

describe("the valid-until line", () => {
  it("says today when the alert ends on the Toronto day of the feed's clock", () => {
    // 15:00 UTC is 11:00 in Toronto; the alert ends at 19:00 UTC, 15:00 in Toronto.
    expect(line("2026-10-01T19:00:00Z", "2026-10-01T15:00:00Z")).toBe("Valid until today at 3:00 PM");
  });

  it("measures today against the feed's clock in Toronto, not in UTC: 22:00 in Toronto on the 1st is already the 2nd in UTC", () => {
    expect(line("2026-10-02T03:00:00Z", "2026-10-02T02:00:00Z")).toBe("Valid until today at 11:00 PM");
  });

  it("says tomorrow for the next Toronto day", () => {
    expect(line("2026-10-02T13:00:00Z", "2026-10-01T15:00:00Z")).toBe("Valid until Tomorrow at 9:00 AM");
  });

  it("names the weekday after that, up to the 7 days an alert may run", () => {
    // 1 October 2026 is a Thursday: the 3rd is a Saturday, the 8th the next Thursday.
    expect(line("2026-10-03T22:00:00Z", "2026-10-01T15:00:00Z")).toBe("Valid until Saturday at 6:00 PM");
    expect(line("2026-10-08T22:00:00Z", "2026-10-01T15:00:00Z")).toBe("Valid until Thursday at 6:00 PM");
  });

  it("writes the time in Toronto time on both sides of the clock change on 1 November 2026", () => {
    // 22:00 UTC on 31 October is 18:00 EDT; 22:00 UTC on 1 November is 17:00 EST.
    expect(line("2026-10-31T22:00:00Z", "2026-10-31T15:00:00Z")).toBe("Valid until today at 6:00 PM");
    expect(line("2026-11-01T22:00:00Z", "2026-11-01T15:00:00Z")).toBe("Valid until today at 5:00 PM");
  });

  it("is null once the time has passed, or is now: the page says that in its own words", () => {
    expect(line("2026-10-01T15:00:00Z", "2026-10-01T15:00:00Z")).toBeNull();
    expect(line("2026-10-01T14:59:59Z", "2026-10-01T15:00:00Z")).toBeNull();
  });

  it("is written in the language's own way: its tag decides the digits and the day period", () => {
    expect(line("2026-10-01T19:00:00Z", "2026-10-01T15:00:00Z", "fr")).toMatch(/^Valid until today at 15:00$/);
  });
});

describe("a clock time for a message (S05.08)", () => {
  const phrase = (at: string, now: string, locale = "en") => clockPhrase(new Date(at), new Date(now), locale, t).replace(/[  ]/g, " ");

  it("says 'today at' for the Toronto day of the feed's clock, in Toronto time", () => {
    expect(phrase("2026-10-01T14:40:00Z", "2026-10-01T15:00:00Z")).toBe("today at 10:40 AM");
    // 01:30 UTC on the 2nd is 9:30 PM on the 1st in Toronto: still the same day as 11:00 PM that evening.
    expect(phrase("2026-10-02T01:30:00Z", "2026-10-02T02:00:00Z")).toBe("today at 9:30 PM");
  });

  it("names the weekday for the days before, up to a week", () => {
    // 1 October 2026 is a Thursday.
    expect(phrase("2026-09-30T14:00:00Z", "2026-10-01T15:00:00Z")).toBe("Wednesday at 10:00 AM");
    expect(phrase("2026-09-25T14:00:00Z", "2026-10-01T15:00:00Z")).toBe("Friday at 10:00 AM");
  });

  it("gives the date for something a week old or more, so a weekday is never ambiguous", () => {
    expect(phrase("2026-09-24T14:00:00Z", "2026-10-01T15:00:00Z")).toBe("Sep 24, 2026 at 10:00 AM");
  });

  it("reads a time that is ahead of the clock as today, never a day that has not come", () => {
    expect(phrase("2026-10-01T16:00:00Z", "2026-10-01T15:00:00Z")).toBe("today at 12:00 PM");
  });

  it("is written in the language's own way", () => {
    expect(phrase("2026-10-01T14:40:00Z", "2026-10-01T15:00:00Z", "fr")).toBe("today at 10:40");
  });
});

// Production UAT, 2026-10-08: the Urdu alert page read "… تک تک لاگو" because R07.validLine said "until" again around time.until.
describe("the valid-until line in every language's own words", () => {
  const dir = path.join(__dirname, "..", "..", "i18n", "messages");
  const catalogs = Object.fromEntries(readdirSync(dir).filter((file) => file.endsWith(".json")).map((file) => [file, JSON.parse(readFileSync(path.join(dir, file), "utf8")) as Record<string, unknown>]));
  const lookup = (catalog: Record<string, unknown>, key: string) => key.split(".").reduce<unknown>((at, part) => (at as Record<string, unknown> | undefined)?.[part], catalog);

  it.each(Object.entries(catalogs).map(([file, catalog]) => [file.replace(/\.json$/, ""), catalog] as const))("%s never says a word twice in a row", (lang, catalog) => {
    const words: Translate = (key, values = {}) => String(lookup(catalog, key)).replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));
    const tag = lang === "prs" ? "fa-AF" : lang === "pa" ? "pa-Guru" : lang === "zh" ? "zh-Hans" : lang;
    for (const until of ["2026-10-01T19:00:00Z", "2026-10-02T13:00:00Z", "2026-10-04T13:00:00Z"]) {
      const text = validUntilLine(new Date(until), new Date("2026-10-01T15:00:00Z"), tag, words)!;
      const tokens = text.split(/[\s ]+/u).filter((token) => /\p{L}/u.test(token));
      const doubled = tokens.filter((token, at) => at > 0 && token === tokens[at - 1]);
      expect(doubled, `${lang}: ${text}`).toEqual([]);
    }
  });
});
