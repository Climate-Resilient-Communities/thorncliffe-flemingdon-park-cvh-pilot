import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MeasureFileError, SURVEY_HEADER, parseRehearsalAlerts, parseSurvey } from "./measureFiles";

// The two files the pilot measures export reads (S09.05): the rehearsal log's "Alerts sent for a rehearsal" (S09.03's seam) and the translation survey. Both
// are read strictly: a mistake stops the export rather than change a measure quietly, and the survey can hold counts only.

const ROOT = path.join(__dirname, "..", "..", "..", "..");
const A = "0192f3a4-1111-7aaa-8bbb-000000000001";
const B = "0192F3A4-2222-7AAA-8BBB-000000000002";

const log = (rows: string[]) =>
  [
    "# Rehearsal log",
    "",
    "## Alerts sent for a rehearsal",
    "",
    "Some words.",
    "",
    "| Alert entry id | Date | Rehearsal |",
    "| --- | --- | --- |",
    ...rows,
    "",
    "## Log",
    "",
    "| Procedure | Date | Who | What was rehearsed | Outcome |",
    "| --- | --- | --- | --- | --- |",
    "| [x](x.md) | | | | |",
  ].join("\n");

describe("the alerts sent for a rehearsal", () => {
  it("reads the entry ids listed, lower case and once each, skipping the blank row and leaving the other tables alone", () => {
    expect(parseRehearsalAlerts(log([`| ${A} | 2026-10-10 | resend |`, "| | | |", `| \`${B}\` | 2026-10-11 | resend again |`, `| ${A} | 2026-10-12 | listed twice |`]))).toEqual([
      A,
      B.toLowerCase(),
    ]);
  });

  it("reads none from the log as it is in the repository (its table has only the blank row until a rehearsal is recorded)", () => {
    const ids = parseRehearsalAlerts(readFileSync(path.join(ROOT, "docs", "procedures", "rehearsals.md"), "utf8"));
    expect(Array.isArray(ids)).toBe(true);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("refuses a first cell that is not an entry id, with its line, and a log without the section or its table", () => {
    expect(() => parseRehearsalAlerts(log(["| the resend one | 2026-10-10 | resend |"]))).toThrow(/line 9: "the resend one" is not an alert entry id/);
    // A rehearsal recorded without its id would leave its alert in the measures: refused, not skipped as the blank row is.
    expect(() => parseRehearsalAlerts(log(["| | 2026-10-10 | resend |"]))).toThrow(/line 9: a rehearsal is recorded without its alert entry id/);
    expect(() => parseRehearsalAlerts(log(["|  |  | resend"]))).toThrow(/line 9: a rehearsal is recorded without its alert entry id/);
    expect(parseRehearsalAlerts(log(["|  |  |  |", "| | | |"]))).toEqual([]);
    expect(() => parseRehearsalAlerts("# Rehearsal log\n\n## Log\n")).toThrow(MeasureFileError);
    expect(() => parseRehearsalAlerts("## Alerts sent for a rehearsal\n\nNo table.\n## Log\n")).toThrow(/has no table/);
  });
});

describe("the translation survey", () => {
  it("adds up each language's lines, in launch order, with the first and last dates", () => {
    const survey = parseSurvey([SURVEY_HEADER, "2026-10-20,ur,12,9", "", "2026-10-14,fr,6,6", "2026-10-21,ur,8,8", "2026-10-21,zh-Hant,5,4"].join("\r\n"));
    expect(survey).toEqual({
      byLanguage: [
        { lang: "ur", asked: 20, understood: 17 },
        { lang: "fr", asked: 6, understood: 6 },
        { lang: "zh-Hant", asked: 5, understood: 4 },
      ],
      from: "2026-10-14",
      to: "2026-10-21",
    });
  });

  it("reads the file as it is in the repository: its header and no line yet, or lines that pass", () => {
    const survey = parseSurvey(readFileSync(path.join(ROOT, "docs", "procedures", "survey-results.csv"), "utf8"));
    expect(survey.byLanguage.every((row) => row.understood <= row.asked)).toBe(true);
  });

  it("refuses anything that is not four plain fields of counts: another header, a name or a note, a language it does not know, a slip of the keyboard", () => {
    const refusals: [string, RegExp][] = [
      ["date,lang,asked,understood,name", /line 1: the first line must be/],
      [`${SURVEY_HEADER}\n2026-10-20,ur,12,9,Asma`, /line 2: expected 4 fields/],
      [`${SURVEY_HEADER}\n2026-10-20,Urdu,12,9`, /line 2: lang must be one of/],
      [`${SURVEY_HEADER}\n2026-10-20,ur,twelve,9`, /line 2: asked must be a whole number/],
      [`${SURVEY_HEADER}\n2026-10-20,ur,12,13`, /line 2: understood cannot be more than asked/],
      [`${SURVEY_HEADER}\n2026-02-30,ur,12,9`, /line 2: date must be a day/],
      [`${SURVEY_HEADER}\n2026-10-20,ur,120000,9`, /line 2: asked must be a whole number from 0 to 10000/],
      [`${SURVEY_HEADER}\n2026-10-20,ur,-1,0`, /line 2: asked must be a whole number/],
    ];
    for (const [text, message] of refusals) expect(() => parseSurvey(text), text).toThrow(message);
  });

  it("reads a header with a byte order mark, as a spreadsheet may save it", () => {
    expect(parseSurvey(`﻿${SURVEY_HEADER}\n2026-10-20,es,5,5\n`).byLanguage).toEqual([{ lang: "es", asked: 5, understood: 5 }]);
  });
});
