import { describe, expect, it } from "vitest";
import en from "../../../i18n/messages/en.json";
import { MEASURE_CSV_COLUMNS, SmallNumberLeak, assertSmallNumbersHidden, escapeHtml, measuresCsv, measuresHtml, secondsText, valueText } from "./measureExport";
import { MEASURE_SECTIONS, measureLines, type LeftOut, type MeasureEdition, type MeasureLine } from "./measureLines";
import { REHEARSAL, REHEARSAL_ENTRY, sampleInput } from "./measuresFixtures";

// The export's two files (S09.05): the CSV of every line with the date and edition, and the printable page with the same lines, drills in a section of their
// own, spend only in the Admin and Director edition (AD-4), every text escaped, and nothing written that the small-number rule should have hidden.

const leftOut: LeftOut = { listed: 2, notFound: 1, alertIds: new Set([REHEARSAL]), entryIds: new Set([REHEARSAL_ENTRY]) };
const linesFor = (edition: MeasureEdition) => measureLines(sampleInput(), { asOf: "2026-10-06", edition, week: "2026-09-28", leftOut });
const WRITTEN = new Date("2026-10-06T13:05:00Z");
const page = (edition: MeasureEdition) => measuresHtml(linesFor(edition), { asOf: "2026-10-06", edition, writtenAt: WRITTEN });

const line = (over: Partial<MeasureLine>): MeasureLine => ({
  section: "installs",
  isDrill: false,
  measure: "install",
  period: "pilot to date",
  split: "total",
  key: null,
  label: null,
  alertId: null,
  entryId: null,
  value: "12",
  unit: "count",
  basis: null,
  ...over,
});

describe("the CSV", () => {
  it("writes exactly its columns, the day and the edition on every line, and one line per measure", () => {
    const lines = linesFor("director");
    const csv = measuresCsv(lines, { asOf: "2026-10-06", edition: "director" });
    const rows = csv.trimEnd().split("\r\n");
    expect(rows[0]).toBe(MEASURE_CSV_COLUMNS.join(","));
    expect(MEASURE_CSV_COLUMNS).toEqual(["as_of", "edition", "section", "is_drill", "measure", "period", "split", "key", "label", "alert_id", "entry_id", "value", "unit", "basis"]);
    expect(rows).toHaveLength(lines.length + 1);
    expect(rows.slice(1).every((row) => row.startsWith("2026-10-06,director,"))).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("quotes a cell with a comma and makes a cell that starts like a formula harmless", () => {
    const csv = measuresCsv([line({ section: "checkins", split: "building", key: "1000001", label: "1 Leaside Park Dr, Unit 2", value: "0" }), line({ label: "=HYPERLINK(1)", split: "language", key: "x", value: "0" })], { asOf: "2026-10-06", edition: "coordinator" });
    expect(csv).toContain(',"1 Leaside Park Dr, Unit 2",');
    expect(csv).toContain(",'=HYPERLINK(1),");
  });

  it("writes an over-budget remainder as a negative number a spreadsheet reads, not as text", () => {
    const input = sampleInput();
    const over = { ...input, spend: input.spend && { ...input.spend, remainingCents: -1_234 } };
    const lines = measureLines(over, { asOf: "2026-10-06", edition: "director", week: "2026-09-28", leftOut });
    const remaining = measuresCsv(lines, { asOf: "2026-10-06", edition: "director" })
      .split("\r\n")
      .find((row) => row.includes(",budget_remaining,"));
    expect(remaining).toContain(",-12.34,CAD,");
    expect(remaining).not.toContain("'-12.34");
  });
});

describe("the page", () => {
  it("has the date, the edition and when it was written, and is one file with no script and nothing fetched", () => {
    const html = page("director");
    expect(html).toContain("<title>CVH pilot measures, 2026-10-06</title>");
    expect(html).toContain("As of 2026-10-06 (Toronto). Written 2026-10-06 13:05 UTC.");
    expect(html).toContain("Admin and Director edition: includes spend and cost per alert.");
    expect(html).not.toMatch(/<script|<link|<img|src=|url\(|@import/i);
    expect(html).not.toMatch(/https?:/);
  });

  it("says what the small-number rule does and how many rehearsal alerts were left out", () => {
    const html = page("director");
    expect(html).toContain("A count of 1 to 4 reads &quot;fewer than 5&quot;");
    expect(html).toContain("Alerts left out: 1. Entries listed in docs/procedures/rehearsals.md: 2, of which not found: 1.");
  });

  it("puts every real section in order, then the drills in a section of their own at the end", () => {
    const html = page("director");
    const titles = MEASURE_SECTIONS.filter((name) => name !== "about" && name !== "drills").map((name) => html.indexOf(`<section class="measure" id="${name}">`));
    expect(titles.every((at) => at > 0)).toBe(true);
    expect([...titles].sort((a, b) => a - b)).toEqual(titles);
    const drills = html.indexOf("<h2>Drills, reported apart</h2>");
    expect(drills).toBeGreaterThan(titles.at(-1) ?? 0);
    expect(html.indexOf('id="drill-drills"')).toBeGreaterThan(drills);
    expect(html.indexOf('id="drill-timing"')).toBeGreaterThan(drills);
  });

  it("has spend and cost per alert in the Admin and Director edition only", () => {
    expect(page("director")).toContain('<section class="measure" id="spend">');
    expect(page("director")).toContain('<section class="measure" id="cost_per_alert">');
    const coordinator = page("coordinator");
    expect(coordinator).toContain("Coordinator edition: spend and cost per alert are left out.");
    expect(coordinator).not.toContain('id="spend"');
    expect(coordinator).not.toContain('id="cost_per_alert"');
    expect(coordinator).not.toContain("CAD");
  });

  it("escapes every text it writes", () => {
    const html = measuresHtml([line({ split: "building", key: "1", label: '<b onclick="x">&</b>', value: "0" })], { asOf: "2026-10-06", edition: "coordinator", writtenAt: WRITTEN });
    expect(html).toContain("&lt;b onclick=&quot;x&quot;&gt;&amp;&lt;/b&gt;");
    expect(html).not.toContain("<b onclick");
    expect(escapeHtml(`'"<>&`)).toBe("&#39;&quot;&lt;&gt;&amp;");
  });

  it("writes values in words: times, shares, money, entry kinds", () => {
    expect(secondsText(45)).toBe("45 s");
    expect(secondsText(754)).toBe("12 min 34 s");
    expect(secondsText(3900)).toBe("1 h 5 min");
    expect(valueText(line({ unit: "percent", value: "25" }))).toBe("25%");
    expect(valueText(line({ unit: "CAD", value: "12.34" }))).toBe("CAD 12.34");
    expect(valueText(line({ unit: "seconds", value: "not reached" }))).toBe("not reached");
    expect(valueText(line({ measure: "kind", unit: "text", value: "withdrawal" }))).toBe("Withdrawal");
    expect(valueText(line({ unit: "count", value: "fewer than 5" }))).toBe("fewer than 5");
  });

  it("has words in the catalog for every section and every measure it writes", () => {
    const words = en.staff.measuresExport as { measures: Record<string, string>; sections: Record<string, { title: string; lead: string }> };
    for (const edition of ["director", "coordinator"] as const) {
      for (const entry of linesFor(edition)) expect(words.measures[entry.measure], entry.measure).toBeTypeOf("string");
    }
    for (const name of MEASURE_SECTIONS) expect(words.sections[name]?.title, name).toBeTypeOf("string");
  });
});

describe("the last check before writing", () => {
  it("refuses a count of 1 to 4 that should have been hidden, in either file", () => {
    const leak = [line({ split: "language", key: "ur", value: "3" })];
    expect(() => assertSmallNumbersHidden(leak)).toThrow(SmallNumberLeak);
    expect(() => measuresCsv(leak, { asOf: "2026-10-06", edition: "coordinator" })).toThrow(/small-number rule was not applied/);
    expect(() => measuresHtml(leak, { asOf: "2026-10-06", edition: "coordinator", writtenAt: WRITTEN })).toThrow(SmallNumberLeak);
  });

  it("lets the Hub's own work be small: drills run, rounds closed, entries counted", () => {
    expect(() => assertSmallNumbersHidden([line({ section: "drills", isDrill: true, measure: "drills_run", value: "2" }), line({ section: "checkins", measure: "rounds_closed", value: "1" })])).not.toThrow();
  });
});
