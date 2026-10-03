import { describe, expect, it } from "vitest";
import { PENDING_REASONS, monthInterval, monthOf, monthReconciliationId, parseReconciliationId, previousMonth } from "./reconciliation";

describe("a reconciliation's id and its exact interval (S06.08)", () => {
  it("names a month as month:{YYYY-MM} and reads the same id back", () => {
    expect(monthReconciliationId("2026-10")).toBe("month:2026-10");
    expect(parseReconciliationId("month:2026-10")).toEqual(monthInterval("2026-10"));
    expect(monthInterval("2026-10").id).toBe("month:2026-10");
  });

  it("refuses anything that is not a month", () => {
    for (const bad of ["2026-13", "2026-00", "26-10", "2026-1", "month:2026-10", "", "2026-10-01"]) {
      expect(() => monthReconciliationId(bad), bad).toThrow(RangeError);
      expect(() => monthInterval(bad), bad).toThrow(RangeError);
    }
    for (const bad of ["2026-10", "month:2026-13", "month:2026-10 ", "Month:2026-10", "month:2026-10-01", "week:2026-10", ""]) {
      expect(parseReconciliationId(bad), bad).toBeNull();
    }
  });

  it("runs from the first instant of the month in Toronto to the first instant of the next, in UTC (daylight time: UTC-4)", () => {
    const october = monthInterval("2026-10");
    expect(october.startUtc.toISOString()).toBe("2026-10-01T04:00:00.000Z");
    expect(october.endUtc.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    // The 1st of November 2026 is the day the clocks go back (at 2 a.m.), so midnight that day is still daylight time.
    const november = monthInterval("2026-11");
    expect(november.startUtc.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    // After the change Toronto is five hours behind UTC.
    expect(november.endUtc.toISOString()).toBe("2026-12-01T05:00:00.000Z");
  });

  it("follows the clocks: a month with the spring change is an hour short, one with the autumn change an hour long", () => {
    const hours = (month: string) => {
      const { startUtc, endUtc } = monthInterval(month);
      return (endUtc.getTime() - startUtc.getTime()) / 3_600_000;
    };
    expect(hours("2026-03")).toBe(31 * 24 - 1);
    expect(hours("2026-04")).toBe(30 * 24);
    expect(hours("2026-10")).toBe(31 * 24);
    expect(hours("2026-11")).toBe(30 * 24 + 1);
    expect(hours("2027-02")).toBe(28 * 24);
  });

  it("makes consecutive months meet exactly, across a year end and a leap year", () => {
    const months = ["2026-12", "2027-01", "2027-02", "2027-03", "2028-02", "2028-03"];
    for (let at = 0; at + 1 < months.length; at += 1) {
      const [month, next] = [months[at], months[at + 1]];
      if (previousMonth(next) === month) expect(monthInterval(month).endUtc.getTime(), month).toBe(monthInterval(next).startUtc.getTime());
    }
    expect((monthInterval("2028-03").startUtc.getTime() - monthInterval("2028-02").startUtc.getTime()) / 86_400_000).toBe(29);
  });

  it("puts 23:59:59 on the last day of a month in that month and 00:00:01 on the first of the next in the next, whatever the clocks do", () => {
    // Toronto wall-clock times (EDT, UTC-4, until 2026-11-01 02:00).
    const lastSecond = new Date("2026-11-01T03:59:59Z"); // 23:59:59 on 31 October
    const firstSecond = new Date("2026-11-01T04:00:01Z"); // 00:00:01 on 1 November
    expect(monthOf(lastSecond)).toBe("2026-10");
    expect(monthOf(firstSecond)).toBe("2026-11");
    expect(lastSecond < monthInterval("2026-10").endUtc && lastSecond >= monthInterval("2026-10").startUtc).toBe(true);
    expect(firstSecond >= monthInterval("2026-11").startUtc && firstSecond < monthInterval("2026-11").endUtc).toBe(true);
    // The end of the interval itself belongs to the next month.
    expect(monthOf(monthInterval("2026-10").endUtc)).toBe("2026-11");
    expect(monthOf(new Date(monthInterval("2026-10").endUtc.getTime() - 1))).toBe("2026-10");
    // A month that ends in standard time (UTC-5): 23:59:59 on 30 November is 04:59:59Z on 1 December.
    expect(monthOf(new Date("2026-12-01T04:59:59Z"))).toBe("2026-11");
    expect(monthOf(new Date("2026-12-01T05:00:00Z"))).toBe("2026-12");
  });

  it("finds the month before, across a year", () => {
    expect(previousMonth("2026-10")).toBe("2026-09");
    expect(previousMonth("2027-01")).toBe("2026-12");
    expect(() => previousMonth("2027-1")).toThrow(RangeError);
  });

  it("knows why a reconciliation can be pending", () => {
    expect([...PENDING_REASONS]).toEqual(["listing_failed", "cut_short", "message_without_price", "price_unusable", "message_malformed"]);
  });
});
