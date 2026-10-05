import { describe, expect, it } from "vitest";
import { WEEKLY_CSV_COLUMNS, csvCell, isWeekStart, lastFullWeek, sortWeeklyRows, weeklyReviewCsv, type WeeklyRow } from "./weeklyReview";

const row = (over: Partial<WeeklyRow> = {}): WeeklyRow => ({
  weekStart: "2026-10-05",
  section: "delivery_problem",
  isDrill: false,
  lang: "en",
  reason: "undelivered:30003",
  entryId: null,
  startedAt: null,
  endedAt: null,
  durationSeconds: null,
  firstHandOffSeconds: null,
  ninetyPercentSeconds: null,
  ninetyPercentStatus: null,
  deliveredSharePercent: null,
  amountCents: null,
  n: 6,
  nShown: "6",
  ...over,
});

describe("the week", () => {
  it("is given by its Monday, a real date", () => {
    expect(isWeekStart("2026-10-05")).toBe(true);
    expect(isWeekStart("2026-10-06")).toBe(false);
    expect(isWeekStart("2026-02-30")).toBe(false);
    expect(isWeekStart("10/05/2026")).toBe(false);
    expect(isWeekStart("")).toBe(false);
  });

  it("is, by default, the last complete week in Toronto", () => {
    // Monday 2026-10-12 00:30 in Toronto (04:30Z): the week that ended last night began on 2026-10-05.
    expect(lastFullWeek(new Date("2026-10-12T04:30:00Z"))).toBe("2026-10-05");
    // Sunday 2026-10-11 23:30 in Toronto (03:30Z on the 12th) is still that week: the last complete one began on 2026-09-28.
    expect(lastFullWeek(new Date("2026-10-12T03:30:00Z"))).toBe("2026-09-28");
    expect(lastFullWeek(new Date("2026-10-14T15:00:00Z"))).toBe("2026-10-05");
    expect(isWeekStart(lastFullWeek(new Date()))).toBe(true);
  });
});

describe("the CSV", () => {
  it("writes the header, then one line per row, with what the small-number rule shows in the count column", () => {
    const csv = weeklyReviewCsv([row({ lang: "ur", n: null, nShown: "fewer than 5" }), row()]);

    expect(csv.split("\r\n")).toEqual([
      WEEKLY_CSV_COLUMNS.join(","),
      "2026-10-05,delivery_problem,false,en,undelivered:30003,,,,,,,,,,6",
      "2026-10-05,delivery_problem,false,ur,undelivered:30003,,,,,,,,,,fewer than 5",
      "",
    ]);
  });

  it("holds no column that could carry a phone number, a subscriber id or a message body", () => {
    for (const column of WEEKLY_CSV_COLUMNS) expect(column).not.toMatch(/phone|number|body|text|recipient|subscriber|email|name|token|message/);
  });

  it("quotes what needs it and neutralises a cell that a spreadsheet would read as a formula", () => {
    expect(csvCell('say "hi", twice')).toBe('"say ""hi"", twice"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell(null)).toBe("");
    expect(csvCell(0)).toBe("0");
    expect(csvCell(false)).toBe("false");
  });

  it("lists the sections in the review's order, real before drill, a total before its languages", () => {
    const rows = sortWeeklyRows([
      row({ section: "slow_delivery", reason: null }),
      row({ lang: "ur" }),
      row({ lang: null }),
      row({ isDrill: true }),
      row({ section: "health_condition", lang: null, reason: "queue_stuck", startedAt: new Date("2026-10-06T13:00:00Z") }),
    ]);
    expect(rows.map((r) => [r.section, r.isDrill, r.lang])).toEqual([
      ["health_condition", false, null],
      ["delivery_problem", false, null],
      ["delivery_problem", false, "ur"],
      ["delivery_problem", true, "en"],
      ["slow_delivery", false, "en"],
    ]);
  });
});
