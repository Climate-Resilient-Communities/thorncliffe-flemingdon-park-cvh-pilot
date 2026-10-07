// The launch bar (S03.08) and the one reader of it: data/search-test-set/bar.json, the Hub-approved minimums for the evaluation
// subset, checked against BarSchema (src/contracts/searchTestSetLaunch.ts):
//   {"version":1,"approvedBy":string|null,"approvedOn":"YYYY-MM-DD"|null,
//    "minimums":{"hitRate":{"<lang>":0..1},"noMatchAccuracy":0..1,"emergencyAccuracy":0..1}}
// It is committed unapproved (approvedBy and approvedOn null, no minimum) until the Hub sets it from the first full evaluation
// report. An unapproved bar is never met, and S03.09's guard measures nothing against it.
//
// For launch readiness (S03.08, `scripts/search-test-set readiness`):
//   readBarFile(root?)        the file as written; throws, naming the file and the field, when it does not fit the schema.
//   meetsBar(report, file)    one result per minimum (hit rate per language, no-match accuracy, emergency accuracy) from the report's
//                             evaluation subset, each with its minimum, the measured value, pass or fail and the drop below the
//                             minimum. `met` only when the bar is approved, names every launch language, the report ran the
//                             evaluation subset, and every measure passes.
//   launchReadiness(root)     the latest committed evaluation report against the bar.
// For the guard (S03.09, guard.ts):
//   readBar(root, file?) / parseBar(text)   the bar as a state: `{set: false, reason}` while it is missing, unapproved or holds no
//                             minimum, else `{set: true, bar}`; a file that does not fit the schema throws (never passes as no bar).
//   checkBar(bar, subset)     the minimums the evaluation subset misses (`Shortfall`s), formatted by formatShortfall.
//   evaluationIds(root, questions)   the evaluation subset's ids, from subsets.json.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { TestSetReportSchema, type SubsetReport, type TestSetReport } from "@/contracts/searchTestSet";
import { BarSchema, LAUNCH_LANGS, type BarFile } from "@/contracts/searchTestSetLaunch";
import type { SEARCH_BAR_MEASURES } from "@/modules/ops";
import { readSubsets, SUBSETS_FILE } from "./subsets";

export { SUBSETS_FILE };
export type { BarFile };
export const BAR_FILE = "data/search-test-set/bar.json";
export const REPORTS_DIR = "data/search-test-set/reports";

// --- reading -------------------------------------------------------------------------------------

/** bar.json's text as the file it is; throws "not a launch bar" naming each field that does not fit. */
export function parseBarFile(text: string, label: string = BAR_FILE): BarFile {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not a launch bar: not valid JSON (${(error as Error).message})`);
  }
  const parsed = BarSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`${label} is not a launch bar: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(file)"}: ${i.message}`).join("; ")}`);
  }
  return parsed.data;
}

/** data/search-test-set/bar.json under `root` (the repository; defaults to the working directory). */
export function readBarFile(root: string = process.cwd()): BarFile {
  return parseBarFile(readFileSync(path.join(root, BAR_FILE), "utf8"));
}

/** The Hub-approved minimums, as the guard uses them: a measure that is null has no minimum. */
export interface Bar {
  approvedBy: string;
  approvedOn: string;
  hitRate: Record<string, number>;
  noMatchAccuracy: number | null;
  emergencyAccuracy: number | null;
}

export type BarState = { set: true; bar: Bar } | { set: false; reason: string };

/** The file as the guard's state: no bar while it is unapproved or every minimum is empty or 0. */
export function barState(file: BarFile): BarState {
  const { approvedBy, approvedOn, minimums } = file;
  if (approvedBy === null || approvedOn === null) return { set: false, reason: "the launch bar has not been approved yet (approvedBy or approvedOn is null)" };
  const noMatchAccuracy = minimums.noMatchAccuracy > 0 ? minimums.noMatchAccuracy : null;
  const emergencyAccuracy = minimums.emergencyAccuracy > 0 ? minimums.emergencyAccuracy : null;
  if (Object.keys(minimums.hitRate).length === 0 && noMatchAccuracy === null && emergencyAccuracy === null) return { set: false, reason: "the launch bar holds no minimum yet" };
  return { set: true, bar: { approvedBy, approvedOn, hitRate: minimums.hitRate, noMatchAccuracy, emergencyAccuracy } };
}

/** bar.json's text as the guard's state; throws on a file that is not the agreed shape (a broken bar must not pass as "no bar"). */
export function parseBar(text: string, label: string = BAR_FILE): BarState {
  return barState(parseBarFile(text, label));
}

/** The bar at `file` (default bar.json under `root`); a missing file is "no bar yet". */
export function readBar(root: string, file?: string): BarState {
  const where = file ? path.resolve(file) : path.join(root, BAR_FILE);
  if (!existsSync(where)) return { set: false, reason: `there is no ${BAR_FILE} yet` };
  return parseBar(readFileSync(where, "utf8"), file ?? BAR_FILE);
}

/**
 * The ids of the evaluation subset: subsets.json's `evaluation` list when the file exists (S03.08 commits the assignment),
 * otherwise the questions whose `split` is evaluation. An id the questions file does not hold is an error, not a smaller run.
 */
export function evaluationIds(root: string, questions: readonly { id: string; split: string }[]): { ok: true; ids: string[]; source: string } | { ok: false; error: string } {
  let subsets;
  try {
    subsets = readSubsets(root);
  } catch (error) {
    return { ok: false, error: `${SUBSETS_FILE} is not a subset assignment: ${(error as Error).message}` };
  }
  if (!subsets) return { ok: true, ids: questions.filter((q) => q.split === "evaluation").map((q) => q.id), source: "the questions' split" };
  const known = new Set(questions.map((q) => q.id));
  const unknown = subsets.evaluation.filter((id) => !known.has(id));
  if (unknown.length > 0) return { ok: false, error: `${SUBSETS_FILE} names evaluation questions that data/search-test-set/questions.jsonl does not hold: ${unknown.join(", ")}` };
  return { ok: true, ids: subsets.evaluation, source: SUBSETS_FILE };
}

// --- measuring against the bar -------------------------------------------------------------------

/** The measures the bar sets a minimum for: the codes of ops' `search.below_bar` event and of the weekly review. */
export type BarMeasure = (typeof SEARCH_BAR_MEASURES)[number];

/** One minimum against what the evaluation subset measured. */
export type BarMeasureResult = {
  measure: BarMeasure;
  /** The language of a hit-rate minimum; null for the overall measures. */
  lang: string | null;
  /** For people: "hit rate (ur)", "no-match accuracy", "emergency accuracy". */
  name: string;
  minimum: number;
  /** The measured rate, 0 to 1; null when no question of it was scored. */
  actual: number | null;
  pass: boolean;
  /** How far below the minimum the measure is (minimum - actual), 0 when it passes; null when it could not be measured. */
  drop: number | null;
};

const MEASURE_NAMES: Record<BarMeasure, string> = { hit_rate: "hit rate", no_match_accuracy: "no-match accuracy", emergency_accuracy: "emergency accuracy" };
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

/** Every minimum of `bar` against `subset` (null: not run), hit rate by language first, in language order. Null minimums are skipped. */
function measureAgainst(bar: Pick<Bar, "hitRate" | "noMatchAccuracy" | "emergencyAccuracy">, subset: SubsetReport | null): BarMeasureResult[] {
  const judge = (measure: BarMeasure, lang: string | null, minimum: number, actual: number | null): BarMeasureResult => {
    const pass = actual !== null && actual >= minimum;
    const name = lang === null ? MEASURE_NAMES[measure] : `${MEASURE_NAMES[measure]} (${lang})`;
    return { measure, lang, name, minimum, actual, pass, drop: actual === null ? null : pass ? 0 : round4(minimum - actual) };
  };
  const out: BarMeasureResult[] = [];
  for (const lang of Object.keys(bar.hitRate).sort()) out.push(judge("hit_rate", lang, bar.hitRate[lang]!, subset?.by_language[lang]?.top3.rate ?? null));
  if (bar.noMatchAccuracy !== null) out.push(judge("no_match_accuracy", null, bar.noMatchAccuracy, subset?.overall.no_match.rate ?? null));
  if (bar.emergencyAccuracy !== null) out.push(judge("emergency_accuracy", null, bar.emergencyAccuracy, subset?.overall.emergency.rate ?? null));
  return out;
}

/** A measure below its minimum; `observed` is null when the run could not measure it (no question of it was scored). */
export interface Shortfall {
  measure: BarMeasure;
  lang: string | null;
  observed: number | null;
  minimum: number;
}

/** Every minimum of the bar that the evaluation subset's report does not meet, hit rate by language first, in language order. */
export function checkBar(bar: Bar, report: SubsetReport): Shortfall[] {
  return measureAgainst(bar, report)
    .filter((m) => !m.pass)
    .map((m) => ({ measure: m.measure, lang: m.lang, observed: m.actual, minimum: m.minimum }));
}

const percent = (share: number) => `${(share * 100).toFixed(1)}%`;

/** One line per shortfall, naming the measure and the drop below its minimum. */
export function formatShortfall(s: Shortfall): string {
  const name = s.lang === null ? MEASURE_NAMES[s.measure] : `${MEASURE_NAMES[s.measure]} (${s.lang})`;
  if (s.observed === null) return `${name}: not measured (no question of it was scored), minimum ${percent(s.minimum)}`;
  return `${name}: ${percent(s.observed)}, below the minimum ${percent(s.minimum)} by ${((s.minimum - s.observed) * 100).toFixed(1)} points`;
}

/** Each minimum of the bar, as lines for the plan and the summary. */
export function formatBar(bar: Bar): string[] {
  const langs = Object.keys(bar.hitRate).sort();
  const lines = [`Launch bar approved by ${bar.approvedBy} on ${bar.approvedOn}:`];
  if (langs.length > 0) lines.push(`  hit rate (top 3): ${langs.map((lang) => `${lang} ${percent(bar.hitRate[lang]!)}`).join(", ")}`);
  if (bar.noMatchAccuracy !== null) lines.push(`  no-match accuracy: ${percent(bar.noMatchAccuracy)}`);
  if (bar.emergencyAccuracy !== null) lines.push(`  emergency accuracy: ${percent(bar.emergencyAccuracy)}`);
  return lines;
}

// --- launch readiness ----------------------------------------------------------------------------

export type BarResult = {
  /** True only when the bar is approved and names every launch language, the evaluation subset was run, and every measure passes. */
  met: boolean;
  approved: boolean;
  measures: BarMeasureResult[];
  /** Why the bar is not met beyond the failing measures (not approved, a language without a minimum, no evaluation subset). */
  problems: string[];
};

export function meetsBar(report: TestSetReport, file: BarFile): BarResult {
  const evaluation = report.subsets.evaluation;
  const problems: string[] = [];
  const approved = file.approvedBy !== null && file.approvedOn !== null;
  if (!approved) problems.push(`the launch bar is not approved yet (${BAR_FILE} has no approvedBy): the Hub sets it from the first full evaluation report`);
  const unset = LAUNCH_LANGS.filter((lang) => file.minimums.hitRate[lang] === undefined);
  if (approved && unset.length > 0) problems.push(`the launch bar has no hit-rate minimum for ${unset.join(", ")}: every launch language needs one`);
  if (!evaluation) problems.push(`the report (${report.date}, ${report.model}) did not run the evaluation subset`);
  const measures = measureAgainst({ hitRate: file.minimums.hitRate, noMatchAccuracy: file.minimums.noMatchAccuracy, emergencyAccuracy: file.minimums.emergencyAccuracy }, evaluation);
  return { met: problems.length === 0 && measures.every((m) => m.pass), approved, measures, problems };
}

const pct = (value: number | null) => (value === null ? "not measured" : `${(value * 100).toFixed(1)}%`);

export function formatBarResult(result: BarResult): string[] {
  const lines = result.problems.map((problem) => `  ${problem}`);
  for (const m of result.measures) {
    const verdict = m.pass ? "pass" : m.drop === null ? "FAIL (not measured)" : `FAIL (${(m.drop * 100).toFixed(1)} points below)`;
    lines.push(`  ${m.name}: ${pct(m.actual)} against a minimum of ${pct(m.minimum)}: ${verdict}`);
  }
  return lines;
}

/** The latest committed report that ran the evaluation subset (by its date, then its file name), or null when there is none. */
export function latestEvaluationReport(root: string): { file: string; report: TestSetReport } | null {
  const dir = path.join(root, REPORTS_DIR);
  if (!existsSync(dir)) return null;
  let latest: { file: string; report: TestSetReport } | null = null;
  for (const name of readdirSync(dir).filter((file) => file.endsWith(".json")).sort()) {
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(path.join(dir, name), "utf8"));
    } catch {
      continue;
    }
    const parsed = TestSetReportSchema.safeParse(json);
    if (!parsed.success || parsed.data.subsets.evaluation === null) continue;
    if (!latest || parsed.data.date >= latest.report.date) latest = { file: path.join(REPORTS_DIR, name), report: parsed.data };
  }
  return latest;
}

export type Readiness = { met: boolean; lines: string[] };

/** Launch readiness for search: the latest evaluation report against the bar. */
export function launchReadiness(root: string): Readiness {
  const file = readBarFile(root);
  const latest = latestEvaluationReport(root);
  if (!latest) {
    const lines = ["Search launch readiness: not met", `  no report in ${REPORTS_DIR} has run the evaluation subset yet`];
    if (file.approvedBy === null) lines.push(`  the launch bar is not approved yet (${BAR_FILE} has no approvedBy)`);
    return { met: false, lines };
  }
  const result = meetsBar(latest.report, file);
  return { met: result.met, lines: [`Search launch readiness: ${result.met ? "met" : "not met"} (${latest.file})`, ...formatBarResult(result)] };
}
