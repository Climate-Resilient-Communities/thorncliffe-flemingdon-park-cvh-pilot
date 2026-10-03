import { describe, expect, it } from "vitest";
import { addTorontoDays, formatTorontoDate, formatTorontoDateTime, formatTorontoTime, fromToronto, parseLocalDateTime, toTorontoLocal, torontoFields } from "./toronto";

const at = (year: number, month: number, day: number, hour: number, minute = 0) => ({ year, month, day, hour, minute });
const iso = (conversion: ReturnType<typeof fromToronto>) => (conversion.ok ? conversion.instant.toISOString() : conversion);

describe("fromToronto", () => {
  it("converts a winter time (EST, UTC-5) and a summer time (EDT, UTC-4)", () => {
    expect(iso(fromToronto(at(2026, 1, 15, 9, 30)))).toBe("2026-01-15T14:30:00.000Z");
    expect(iso(fromToronto(at(2026, 7, 15, 9, 30)))).toBe("2026-07-15T13:30:00.000Z");
  });

  it("refuses the hour skipped when the clocks go forward (02:00 to 03:00 on 8 March 2026), and only that hour", () => {
    for (const minute of [0, 1, 30, 59]) expect(fromToronto(at(2026, 3, 8, 2, minute))).toEqual({ ok: false, reason: "nonexistent" });
    expect(iso(fromToronto(at(2026, 3, 8, 1, 59)))).toBe("2026-03-08T06:59:00.000Z");
    expect(iso(fromToronto(at(2026, 3, 8, 3, 0)))).toBe("2026-03-08T07:00:00.000Z");
    // The same wall-clock time on the day before and after exists.
    expect(fromToronto(at(2026, 3, 7, 2, 30)).ok).toBe(true);
    expect(fromToronto(at(2026, 3, 9, 2, 30)).ok).toBe(true);
  });

  it("also refuses the skipped hour of 2027 (14 March), so the rule is the zone's and not a date written here", () => {
    expect(fromToronto(at(2027, 3, 14, 2, 15))).toEqual({ ok: false, reason: "nonexistent" });
  });

  it("asks which time is meant in the hour repeated when the clocks go back (01:00 to 02:00 on 1 November 2026)", () => {
    for (const minute of [0, 1, 30, 59]) {
      const result = fromToronto(at(2026, 11, 1, 1, minute));
      expect(result.ok).toBe(false);
      if (!result.ok && result.reason === "ambiguous") {
        // Before the change it is EDT (UTC-4), after it EST (UTC-5): an hour apart.
        expect(result.after.getTime() - result.before.getTime()).toBe(60 * 60 * 1000);
        expect(result.before.toISOString()).toBe(`2026-11-01T05:${String(minute).padStart(2, "0")}:00.000Z`);
      } else {
        throw new Error("expected an ambiguous time");
      }
    }
  });

  it("takes the answer to the question: before the clock change is EDT, after it is EST", () => {
    expect(iso(fromToronto(at(2026, 11, 1, 1, 30), "before"))).toBe("2026-11-01T05:30:00.000Z");
    expect(iso(fromToronto(at(2026, 11, 1, 1, 30), "after"))).toBe("2026-11-01T06:30:00.000Z");
  });

  it("has no question for the hours around the repeated one, and ignores a fold given for them", () => {
    expect(iso(fromToronto(at(2026, 11, 1, 0, 59)))).toBe("2026-11-01T04:59:00.000Z");
    expect(iso(fromToronto(at(2026, 11, 1, 2, 0)))).toBe("2026-11-01T07:00:00.000Z");
    expect(iso(fromToronto(at(2026, 11, 1, 2, 0), "before"))).toBe("2026-11-01T07:00:00.000Z");
    expect(iso(fromToronto(at(2026, 6, 1, 1, 30), "after"))).toBe("2026-06-01T05:30:00.000Z");
  });

  it("refuses a date or time that is not one", () => {
    for (const bad of [at(2026, 2, 30, 9), at(2026, 13, 1, 9), at(2026, 1, 1, 24), at(2026, 1, 1, 9, 60), at(2026, 0, 1, 9), at(1969, 1, 1, 9), { ...at(2026, 1, 1, 9), minute: 1.5 }]) {
      expect(fromToronto(bad)).toEqual({ ok: false, reason: "invalid" });
    }
    expect(fromToronto(at(2028, 2, 29, 9)).ok).toBe(true);
    expect(fromToronto(at(2026, 2, 29, 9))).toEqual({ ok: false, reason: "invalid" });
  });

  it("round-trips every minute of the days around both changes, except the skipped and repeated hours", () => {
    for (const day of [at(2026, 3, 8, 0), at(2026, 11, 1, 0)]) {
      for (let minutes = -24 * 60; minutes < 48 * 60; minutes += 1) {
        const start = new Date(Date.UTC(day.year, day.month - 1, day.day) + minutes * 60_000);
        const local = toTorontoLocal(start);
        const back = fromToronto(local, "before");
        expect(back.ok, `${start.toISOString()} reads ${JSON.stringify(local)}`).toBe(true);
        if (back.ok) {
          const sameWall = JSON.stringify(toTorontoLocal(back.instant)) === JSON.stringify(local);
          expect(sameWall).toBe(true);
        }
      }
    }
  });
});

describe("the fields of a date and a time input", () => {
  it("writes an instant as Toronto wall-clock fields and reads them back", () => {
    expect(torontoFields(new Date("2026-10-03T04:05:00Z"))).toEqual({ date: "2026-10-03", time: "00:05" });
    expect(torontoFields(new Date("2026-01-01T04:59:00Z"))).toEqual({ date: "2025-12-31", time: "23:59" });
    expect(parseLocalDateTime("2026-10-03", "00:05")).toEqual(at(2026, 10, 3, 0, 5));
  });

  it("reads nothing that is not a date and a time", () => {
    for (const [date, time] of [["", "09:00"], ["2026-10-03", ""], ["2026-10-3", "09:00"], ["2026-10-03", "9:00"], ["2026-10-03", "09:00:30"], ["2026-02-30", "09:00"], ["2026-10-03", "25:00"], ["03/10/2026", "09:00"]]) {
      expect(parseLocalDateTime(date, time), `${date} ${time}`).toBeNull();
    }
  });
});

describe("addTorontoDays", () => {
  it("adds calendar days on the wall clock, not 24 hours: 7 days after noon on 30 October is noon on 6 November", () => {
    const start = fromToronto(at(2026, 10, 30, 12));
    if (!start.ok) throw new Error("expected an instant");
    const later = addTorontoDays(start.instant, 7);
    expect(torontoFields(later)).toEqual({ date: "2026-11-06", time: "12:00" });
    expect((later.getTime() - start.instant.getTime()) / 3_600_000).toBe(169);
  });

  it("is 167 hours across the spring change", () => {
    const start = fromToronto(at(2026, 3, 4, 12));
    if (!start.ok) throw new Error("expected an instant");
    expect((addTorontoDays(start.instant, 7).getTime() - start.instant.getTime()) / 3_600_000).toBe(167);
  });

  it("is 168 hours when no change is crossed, keeps the seconds and counts backwards", () => {
    const start = new Date("2026-06-10T15:20:42.500Z");
    expect(addTorontoDays(start, 7).getTime() - start.getTime()).toBe(168 * 3_600_000);
    expect(addTorontoDays(start, 0).getTime()).toBe(start.getTime());
    expect(addTorontoDays(start, -7).getTime() - start.getTime()).toBe(-168 * 3_600_000);
  });

  it("lands past the gap when the wall time does not exist on the day reached, and on the second of a repeated time", () => {
    const early = fromToronto(at(2026, 3, 1, 2, 30));
    if (!early.ok) throw new Error("expected an instant");
    // 8 March 02:30 does not exist: it becomes 03:30.
    expect(torontoFields(addTorontoDays(early.instant, 7))).toEqual({ date: "2026-03-08", time: "03:30" });
    const repeated = fromToronto(at(2026, 10, 25, 1, 30));
    if (!repeated.ok) throw new Error("expected an instant");
    // 1 November 01:30 occurs twice: the second (EST) is taken.
    expect(addTorontoDays(repeated.instant, 7).toISOString()).toBe("2026-11-01T06:30:00.000Z");
  });

  it("refuses a fraction of a day", () => {
    expect(() => addTorontoDays(new Date(), 0.5)).toThrow(RangeError);
  });
});

describe("how a time is said in a message", () => {
  it("names the zone, so the two readings of the repeated hour differ in words", () => {
    expect(formatTorontoTime(new Date("2026-11-01T05:30:00Z"))).toMatch(/1:30\s*a\.m\.\s*EDT/);
    expect(formatTorontoTime(new Date("2026-11-01T06:30:00Z"))).toMatch(/1:30\s*a\.m\.\s*EST/);
    expect(formatTorontoDateTime(new Date("2026-11-01T06:30:00Z"))).toMatch(/Sunday, November 1, 2026/);
    expect(formatTorontoDate(new Date("2026-11-01T06:30:00Z"))).toBe("November 1, 2026");
    expect(formatTorontoDate(new Date("2026-11-02T04:30:00Z"))).toBe("November 1, 2026");
  });
});
