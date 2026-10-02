import { describe, expect, it } from "vitest";
import { dayOf, formatDay } from "./residentDates";

/** The calendar day an instant falls on in Toronto, as YYYY-MM-DD. */
const torontoDay = (date: Date): string => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", dateStyle: "short" }).format(date);

describe("dayOf", () => {
  // The days around the clock changes (2026-03-08 spring forward, 2026-11-01 fall back), the turn of the year and midsummer:
  // the Hub's date (no time) must be the same day in Toronto, whatever the offset that day (-5 h, -4 h).
  it.each(["2026-03-08", "2026-11-01", "2026-01-01", "2026-12-31", "2026-07-01"])("%s is that same day in Toronto", (day) => {
    expect(torontoDay(dayOf(day))).toBe(day);
  });

  it.each([
    ["2026-03-08", "March 8, 2026"],
    ["2026-11-01", "November 1, 2026"],
    ["2026-01-01", "January 1, 2026"],
    ["2026-12-31", "December 31, 2026"],
    ["2026-07-01", "July 1, 2026"],
  ])("%s is written %s", (day, written) => {
    expect(formatDay(dayOf(day), "en")).toBe(written);
  });
});
