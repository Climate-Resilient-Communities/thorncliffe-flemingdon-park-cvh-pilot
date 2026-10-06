// The pilot measures export's two files (S09.05): a CSV of every line, and a printable HTML page of the same lines with the date, for the week-8 review.
// Pure. Both write only the lines' own fields, in a fixed order, so a column that could carry a phone number, a subscriber id or a message body cannot be
// added by accident (a test lists them), and every text is escaped (the HTML) or made harmless to a spreadsheet (the CSV: csvCell). The page is one
// self-contained file: no script, no font, image or stylesheet from anywhere, so it opens and prints the same offline, and it says on every printed page
// which edition it is. The words are the catalog's (`staff.measuresExport`): IT's scripts are in English in the pilot, from the catalog.
import { englishText } from "../../../i18n/text";
import { MEASURE_SECTIONS, SPEND_SECTIONS, UNPROTECTED_COUNTS, type MeasureEdition, type MeasureLine, type MeasureSection } from "./measureLines";
import { revealsSmallCount } from "./smallNumbers";
import { csvCell } from "./weeklyReview";

/** The CSV's columns, in this order. Nothing else is written. */
export const MEASURE_CSV_COLUMNS = [
  "as_of",
  "edition",
  "section",
  "is_drill",
  "measure",
  "period",
  "split",
  "key",
  "label",
  "alert_id",
  "entry_id",
  "value",
  "unit",
  "basis",
] as const;

export class SmallNumberLeak extends Error {
  constructor(readonly line: MeasureLine) {
    super(`the small-number rule was not applied: ${line.section} ${line.measure} ${line.split} ${line.key ?? ""} reads ${line.value}`);
    this.name = "SmallNumberLeak";
  }
}

/**
 * Refuses lines that would write a count of 1 to 4: the last check before anything is written, whatever the views or the builders did. The counts of the Hub's
 * own work that are not split by language, neighbourhood, building or floor (UNPROTECTED_COUNTS) are the only counts allowed to be small.
 */
export function assertSmallNumbersHidden(lines: readonly MeasureLine[]): void {
  for (const line of lines) {
    if (line.unit === "count" && !UNPROTECTED_COUNTS.includes(line.measure) && revealsSmallCount(line.value)) throw new SmallNumberLeak(line);
  }
}

/** The CSV: a header and one line per measure line, `\r\n` ended. */
export function measuresCsv(lines: readonly MeasureLine[], context: { asOf: string; edition: MeasureEdition }): string {
  assertSmallNumbersHidden(lines);
  const rows = [MEASURE_CSV_COLUMNS.join(",")];
  for (const line of lines) {
    rows.push(
      [context.asOf, context.edition, line.section, line.isDrill, line.measure, line.period, line.split, line.key, line.label, line.alertId, line.entryId, line.value, line.unit, line.basis]
        .map(csvCell)
        .join(","),
    );
  }
  return `${rows.join("\r\n")}\r\n`;
}

// --- the page --------------------------------------------------------------------------------------------------------------------

const t = (key: string, values?: Record<string, string | number>) => englishText(`staff.measuresExport.${key}`, values);

/** A catalog key's words, or `fallback` when the catalog has none (a measure code another module added since). */
function wordsOr(key: string, fallback: string): string {
  try {
    return t(key);
  } catch {
    return fallback;
  }
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Text made safe for HTML, inside an element or an attribute. */
export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => ESCAPES[char]);

/** Seconds in words: "45 s", "12 min 34 s", "1 h 5 min". */
export function secondsText(value: number): string {
  const total = Math.round(value);
  const sign = total < 0 ? "-" : "";
  const abs = Math.abs(total);
  if (abs < 60) return `${sign}${abs} s`;
  if (abs < 3600) return `${sign}${Math.floor(abs / 60)} min${abs % 60 === 0 ? "" : ` ${abs % 60} s`}`;
  const minutes = Math.round((abs % 3600) / 60);
  return `${sign}${Math.floor(abs / 3600)} h${minutes === 0 ? "" : ` ${minutes} min`}`;
}

const isNumber = (value: string) => /^-?\d+(\.\d+)?$/.test(value);

/** A line's value as the page prints it: units in words, hidden figures as the rule's words. */
export function valueText(line: MeasureLine): string {
  if (line.measure === "kind") return wordsOr(`kinds.${line.value}`, line.value);
  if (!isNumber(line.value)) return line.value;
  const number = Number(line.value);
  switch (line.unit) {
    case "percent":
      return `${line.value}%`;
    case "seconds":
      return secondsText(number);
    case "milliseconds":
      return `${number.toLocaleString("en-CA")} ms`;
    case "CAD":
      return `CAD ${line.value}`;
    case "calls":
      return t("units.calls", { n: number.toLocaleString("en-CA") });
    case "tokens":
      return t("units.tokens", { n: number.toLocaleString("en-CA") });
    case "count":
      return number.toLocaleString("en-CA");
    default:
      return line.value;
  }
}

/** The period in words: "Week of 2026-09-28", "Pilot to date", or the day or month as written. */
export function periodText(period: string): string {
  if (period === "pilot to date") return t("periods.pilot");
  if (period.startsWith("week ")) return t("periods.week", { monday: period.slice(5) });
  return period;
}

/** Who or what a line is for: all of it, a language, a neighbourhood, a building, a floor, an alert entry or thread, a month. */
export function forText(line: MeasureLine): string {
  switch (line.split) {
    case "total":
      return t("splits.total");
    case "entry":
      return t("splits.entry", { id: line.entryId ?? "" });
    case "thread":
      return t("splits.thread", { id: line.alertId ?? "" });
    case "month":
      return line.key ?? "";
    default:
      return line.label ?? line.key ?? "";
  }
}

const measureText = (line: MeasureLine) => wordsOr(`measures.${line.measure}`, line.measure);

function table(lines: readonly MeasureLine[]): string {
  const rows = lines
    .map(
      (line) =>
        `<tr><td>${escapeHtml(measureText(line))}</td><td>${escapeHtml(periodText(line.period))}</td><td class="for">${escapeHtml(forText(line))}</td><td class="value">${escapeHtml(valueText(line))}</td><td>${escapeHtml(line.basis ?? "")}</td></tr>`,
    )
    .join("\n");
  return `<table>
<thead><tr><th scope="col">${escapeHtml(t("columns.measure"))}</th><th scope="col">${escapeHtml(t("columns.period"))}</th><th scope="col">${escapeHtml(t("columns.for"))}</th><th scope="col">${escapeHtml(t("columns.value"))}</th><th scope="col">${escapeHtml(t("columns.basis"))}</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`;
}

function section(name: MeasureSection, lines: readonly MeasureLine[], level: "h2" | "h3"): string {
  return `<section class="measure" id="${level === "h2" ? name : `drill-${name}`}">
<${level}>${escapeHtml(t(`sections.${name}.title`))}</${level}>
<p class="lead">${escapeHtml(t(`sections.${name}.lead`))}</p>
${lines.length === 0 ? `<p>${escapeHtml(t("empty"))}</p>` : table(lines)}
</section>`;
}

const STYLE = `
  :root { color: #111; background: #fff; font: 11pt/1.4 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
  body { margin: 0 auto; max-width: 64rem; padding: 1.5rem 1rem 3rem; }
  h1 { font-size: 1.6rem; margin: 0 0 0.25rem; }
  h2 { font-size: 1.25rem; margin: 2rem 0 0.25rem; border-bottom: 2px solid #111; padding-bottom: 0.2rem; }
  h3 { font-size: 1.05rem; margin: 1.5rem 0 0.25rem; }
  .meta { font-weight: 600; margin: 0 0 0.75rem; }
  .lead, .note { margin: 0.25rem 0 0.75rem; max-width: 52rem; }
  .edition { border: 2px solid #111; padding: 0.5rem 0.75rem; display: inline-block; margin: 0.25rem 0 0.75rem; }
  table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
  th, td { border: 1px solid #999; padding: 0.2rem 0.4rem; text-align: left; vertical-align: top; }
  th { background: #eee; }
  td.value { text-align: right; font-variant-numeric: tabular-nums; }
  td.for { overflow-wrap: anywhere; }
  .drills { margin-top: 3rem; border-top: 4px double #111; }
  @page { margin: 15mm; }
  @media print {
    body { max-width: none; padding: 0; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    h2, h3 { break-after: avoid; }
    .drills { break-before: page; }
  }
`;

export interface MeasuresPageContext {
  asOf: string;
  edition: MeasureEdition;
  /** When the file was written: printed so two copies of one day can be told apart. */
  writtenAt: Date;
}

/** The printable page: the date and edition, the rule, what was left out, each section of real measures, then the drills in a section of their own. */
export function measuresHtml(lines: readonly MeasureLine[], context: MeasuresPageContext): string {
  assertSmallNumbersHidden(lines);
  const about = new Map(lines.filter((line) => line.section === "about").map((line) => [line.measure, line.value]));
  const real = MEASURE_SECTIONS.filter((name) => name !== "about" && name !== "drills");
  const bodySections = real
    .filter((name) => context.edition === "director" || !SPEND_SECTIONS.includes(name))
    .map((name) => section(name, lines.filter((line) => line.section === name && !line.isDrill), "h2"));
  const drillSections = MEASURE_SECTIONS.filter((name) => lines.some((line) => line.section === name && line.isDrill)).map((name) =>
    section(name, lines.filter((line) => line.section === name && line.isDrill), "h3"),
  );
  const edition = t(`editions.${context.edition}`);
  const written = context.writtenAt.toISOString().replace("T", " ").slice(0, 16);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(t("title", { date: context.asOf }))}</title>
<style>${STYLE}</style>
</head>
<body>
<header>
<h1>${escapeHtml(t("heading"))}</h1>
<p class="meta">${escapeHtml(t("asOf", { date: context.asOf, written }))}</p>
<p class="edition">${escapeHtml(edition)}</p>
<p class="note">${escapeHtml(t("rule"))}</p>
<p class="note">${escapeHtml(t("leftOut", { alerts: about.get("rehearsal_alerts_left_out") ?? "0", listed: about.get("rehearsal_entries_listed") ?? "0", notFound: about.get("rehearsal_entries_not_found") ?? "0" }))}</p>
<p class="note">${escapeHtml(t("week", { monday: about.get("week") ?? "" }))}</p>
${context.edition === "coordinator" ? `<p class="note">${escapeHtml(t("noSpend"))}</p>` : ""}
</header>
<main>
${bodySections.join("\n")}
<div class="drills">
<h2>${escapeHtml(t("drills.title"))}</h2>
<p class="lead">${escapeHtml(t("drills.lead"))}</p>
${drillSections.length === 0 ? `<p>${escapeHtml(t("drills.empty"))}</p>` : drillSections.join("\n")}
</div>
</main>
</body>
</html>
`;
}
