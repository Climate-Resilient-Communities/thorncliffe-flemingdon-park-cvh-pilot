// The launch bar (S03.08): data/search-test-set/bar.json, the Hub-approved minimums for the evaluation subset, and whether a
// report meets them. Launch readiness for search is met only when the latest evaluation report meets every minimum of an
// approved bar. S03.09's guard reads the bar and checks a report through `readBar()` and `meetsBar()`.
//
//   readBar(root?)            the bar, checked against BarSchema (src/contracts/searchTestSetLaunch.ts); throws, naming the file
//                             and the field, when it does not fit.
//   meetsBar(report, bar)     one result per minimum: hit rate per language (the language's top-3 rate), no-match accuracy and
//                             emergency accuracy (the overall rates), all from the report's evaluation subset, each with its
//                             minimum, the measured value, pass or fail, and the drop below the minimum. `met` is true only when
//                             the bar is approved, the report ran the evaluation subset, and every measure passes.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { TestSetReportSchema, type TestSetReport } from "@/contracts/searchTestSet";
import { BarSchema, type Bar } from "@/contracts/searchTestSetLaunch";

export const BAR_FILE = "data/search-test-set/bar.json";
export const REPORTS_DIR = "data/search-test-set/reports";

export function parseBar(text: string, label: string = BAR_FILE): Bar {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label}: not valid JSON (${(error as Error).message})`);
  }
  const parsed = BarSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`${label}: not a launch bar (${parsed.error.issues.map((i) => `${i.path.join(".") || "(file)"}: ${i.message}`).join("; ")})`);
  }
  return parsed.data;
}

/** data/search-test-set/bar.json under `root` (the repository; defaults to the working directory). */
export function readBar(root: string = process.cwd()): Bar {
  return parseBar(readFileSync(path.join(root, BAR_FILE), "utf8"));
}

export type BarMeasure = {
  measure: "hitRate" | "noMatchAccuracy" | "emergencyAccuracy";
  /** The language of a hit-rate minimum; null for the overall measures. */
  lang: string | null;
  /** For people: "hit rate (ur)", "no-match accuracy", "emergency accuracy". */
  name: string;
  minimum: number;
  /** The measured rate, 0 to 1; null when the evaluation subset had no question to measure it on. */
  actual: number | null;
  pass: boolean;
  /** How far below the minimum the measure is (minimum - actual), 0 when it passes; null when it could not be measured. */
  drop: number | null;
};

export type BarResult = {
  /** True only when the bar is approved, the evaluation subset was run, and every measure passes. */
  met: boolean;
  approved: boolean;
  measures: BarMeasure[];
  /** Why the bar is not met beyond the failing measures (not approved, no evaluation subset). */
  problems: string[];
};

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

export function meetsBar(report: TestSetReport, bar: Bar): BarResult {
  const evaluation = report.subsets.evaluation;
  const problems: string[] = [];
  const approved = bar.approvedBy !== null && bar.approvedOn !== null;
  if (!approved) problems.push(`the launch bar is not approved yet (${BAR_FILE} has no approvedBy): the Hub sets it from the first full evaluation report`);
  if (!evaluation) problems.push(`the report (${report.date}, ${report.model}) did not run the evaluation subset`);

  const judge = (measure: BarMeasure["measure"], lang: string | null, name: string, minimum: number, actual: number | null): BarMeasure => {
    const pass = actual !== null && actual >= minimum;
    return { measure, lang, name, minimum, actual, pass, drop: actual === null ? null : pass ? 0 : round4(minimum - actual) };
  };
  const measures: BarMeasure[] = [];
  for (const [lang, minimum] of Object.entries(bar.minimums.hitRate).sort(([a], [b]) => a.localeCompare(b))) {
    measures.push(judge("hitRate", lang, `hit rate (${lang})`, minimum, evaluation?.by_language[lang]?.top3.rate ?? null));
  }
  measures.push(judge("noMatchAccuracy", null, "no-match accuracy", bar.minimums.noMatchAccuracy, evaluation?.overall.no_match.rate ?? null));
  measures.push(judge("emergencyAccuracy", null, "emergency accuracy", bar.minimums.emergencyAccuracy, evaluation?.overall.emergency.rate ?? null));
  return { met: approved && evaluation !== null && measures.every((m) => m.pass), approved, measures, problems };
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
  const bar = readBar(root);
  const latest = latestEvaluationReport(root);
  if (!latest) {
    const lines = ["Search launch readiness: not met", `  no report in ${REPORTS_DIR} has run the evaluation subset yet`];
    if (bar.approvedBy === null) lines.push(`  the launch bar is not approved yet (${BAR_FILE} has no approvedBy)`);
    return { met: false, lines };
  }
  const result = meetsBar(latest.report, bar);
  return { met: result.met, lines: [`Search launch readiness: ${result.met ? "met" : "not met"} (${latest.file})`, ...formatBarResult(result)] };
}
