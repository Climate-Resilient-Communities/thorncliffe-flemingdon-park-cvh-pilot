// The two files the pilot measures export reads besides the database (S09.05), read strictly so a mistake stops the export instead of changing a measure
// quietly. Pure: the script reads the files and hands their text here.
//
//  - docs/procedures/rehearsals.md, its table "Alerts sent for a rehearsal" (S09.03's seam): the alert entry ids of real (non-drill) alerts sent only to
//    rehearse, such as the resend rehearsal's before launch. The measures leave the alerts (threads) of those entries out. A row whose first cell is empty is
//    the table's blank row; any other first cell must be an entry id, or the export refuses.
//  - docs/procedures/survey-results.csv, the translation-understood survey: one line per batch a Coordinator recorded, `date,lang,asked,understood` (a Toronto
//    date, a language code, how many residents or ambassadors were asked and how many understood the alert in that language). Counts only: a file with any
//    other column, a name or a free word anywhere is refused, so nothing about a person can reach the export through it.
import { LAUNCH_CODES } from "../../../i18n/languages";

/** The heading of the table of rehearsal alerts in docs/procedures/rehearsals.md. */
export const REHEARSAL_ALERTS_HEADING = "## Alerts sent for a rehearsal";

/** The survey file's header, exactly. */
export const SURVEY_HEADER = "date,lang,asked,understood";

/** The languages a survey line may name: the 15 launch languages and the converted Traditional Chinese text (S04.02). */
export const SURVEY_LANGS: readonly string[] = [...LAUNCH_CODES, "zh-Hant"];

/** The most a survey line may count: far above the pilot's reach, so a typing slip (an extra digit or two) is refused. */
export const SURVEY_MAX = 10_000;

export class MeasureFileError extends Error {
  constructor(
    readonly file: "rehearsals" | "survey",
    readonly line: number | null,
    message: string,
  ) {
    super(line === null ? message : `line ${line}: ${message}`);
    this.name = "MeasureFileError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The alert entry ids listed under "Alerts sent for a rehearsal", lower case, each once, in the order listed. */
export function parseRehearsalAlerts(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === REHEARSAL_ALERTS_HEADING);
  if (start === -1) throw new MeasureFileError("rehearsals", null, `no "${REHEARSAL_ALERTS_HEADING}" section: the export cannot tell which alerts to leave out`);
  const ids: string[] = [];
  let rows = 0;
  for (let index = start + 1; index < lines.length && !lines[index].startsWith("## "); index += 1) {
    const line = lines[index].trim();
    if (!line.startsWith("|")) continue;
    rows += 1;
    // The table's header and its separator.
    if (rows <= 2) continue;
    const first = line.split("|")[1]?.trim().replaceAll("`", "") ?? "";
    if (first === "") continue;
    if (!UUID.test(first)) throw new MeasureFileError("rehearsals", index + 1, `"${first.slice(0, 40)}" is not an alert entry id (a uuid)`);
    const id = first.toLowerCase();
    if (!ids.includes(id)) ids.push(id);
  }
  if (rows < 2) throw new MeasureFileError("rehearsals", null, `the "${REHEARSAL_ALERTS_HEADING}" section has no table`);
  return ids;
}

/** The survey's counts for one language, added up over its lines. */
export interface SurveyCounts {
  lang: string;
  asked: number;
  understood: number;
}

export interface Survey {
  /** One per language with a line, in the launch order. */
  byLanguage: SurveyCounts[];
  /** The first and last dates recorded (YYYY-MM-DD); null when the file has no line yet. */
  from: string | null;
  to: string | null;
}

const isDate = (text: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
};

const count = (text: string, line: number, name: string): number => {
  if (!/^\d{1,5}$/.test(text) || Number(text) > SURVEY_MAX) throw new MeasureFileError("survey", line, `${name} must be a whole number from 0 to ${SURVEY_MAX}`);
  return Number(text);
};

/** The survey file's counts per language. Blank lines are skipped; anything else that is not a line of four plain fields is refused with its line number. */
export function parseSurvey(csv: string): Survey {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/);
  if ((lines[0] ?? "").trim() !== SURVEY_HEADER) throw new MeasureFileError("survey", 1, `the first line must be "${SURVEY_HEADER}"`);
  const totals = new Map<string, SurveyCounts>();
  const dates: string[] = [];
  lines.slice(1).forEach((raw, offset) => {
    const line = offset + 2;
    if (raw.trim() === "") return;
    const fields = raw.split(",").map((field) => field.trim());
    if (fields.length !== 4) throw new MeasureFileError("survey", line, `expected 4 fields (${SURVEY_HEADER}), found ${fields.length}`);
    const [date, lang, askedText, understoodText] = fields;
    if (!isDate(date)) throw new MeasureFileError("survey", line, "date must be a day written YYYY-MM-DD");
    if (!SURVEY_LANGS.includes(lang)) throw new MeasureFileError("survey", line, `lang must be one of ${SURVEY_LANGS.join(", ")}`);
    const asked = count(askedText, line, "asked");
    const understood = count(understoodText, line, "understood");
    if (understood > asked) throw new MeasureFileError("survey", line, "understood cannot be more than asked");
    const sum = totals.get(lang) ?? { lang, asked: 0, understood: 0 };
    totals.set(lang, { lang, asked: sum.asked + asked, understood: sum.understood + understood });
    dates.push(date);
  });
  dates.sort();
  return {
    byLanguage: SURVEY_LANGS.flatMap((lang) => totals.get(lang) ?? []),
    from: dates[0] ?? null,
    to: dates.at(-1) ?? null,
  };
}
