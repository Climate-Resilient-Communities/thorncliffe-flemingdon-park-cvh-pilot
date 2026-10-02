// The search test set: reading and validating the questions, running them against a search engine,
// and building and comparing reports (S03.01). The command line is in main.ts.
import {
  TestQuestionSchema,
  TestSetReportSchema,
  type Metrics,
  type SubsetReport,
  type TestQuestion,
  type TestSetReport,
} from "@/contracts/searchTestSet";
import type { LangCode } from "@/contracts/lang";

export const QUESTIONS_FILE = "data/search-test-set/questions.jsonl";
export const PROVIDERS_FILE = "data/catalogue/providers.json";

// --- reading the questions ------------------------------------------------------------------------

export type LocatedQuestion = TestQuestion & { line: number };
export type LineError = { line: number; message: string };

/** The provider ids of data/catalogue/providers.json. */
export function providerIdsOf(providersJson: string): Set<string> {
  const file = JSON.parse(providersJson) as { providers?: { id?: unknown }[] };
  return new Set((file.providers ?? []).map((p) => String(p.id)));
}

/**
 * Parses the questions file (JSON Lines: one question per line, blank lines ignored). Every problem
 * carries its line number: bad JSON, a field that fails the schema, a provider id that is not in the
 * catalogue, a repeated question id.
 */
export function parseQuestions(text: string, providerIds: ReadonlySet<string>): { questions: LocatedQuestion[]; errors: LineError[] } {
  const questions: LocatedQuestion[] = [];
  const errors: LineError[] = [];
  const firstLineOfId = new Map<string, number>();
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    if (raw.trim() === "") return;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (error) {
      errors.push({ line, message: `not valid JSON (${(error as Error).message})` });
      return;
    }
    const parsed = TestQuestionSchema.safeParse(json);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const where = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
        errors.push({ line, message: `${where}${issue.message}` });
      }
      return;
    }
    const question = parsed.data;
    let ok = true;
    for (const id of question.expected) {
      if (!providerIds.has(id)) {
        errors.push({ line, message: `expected: provider id ${id} is not in ${PROVIDERS_FILE}` });
        ok = false;
      }
    }
    const earlier = firstLineOfId.get(question.id);
    if (earlier !== undefined) {
      errors.push({ line, message: `id: ${question.id} is already used on line ${earlier}` });
      ok = false;
    } else {
      firstLineOfId.set(question.id, line);
    }
    if (ok) questions.push({ ...question, line });
  });
  return { questions, errors };
}

export function formatLineErrors(errors: readonly LineError[], file = QUESTIONS_FILE): string[] {
  return errors.map((e) => `${file}:${e.line}: ${e.message}`);
}

/** Questions not yet checked by a second team member. */
export function uncheckedQuestions(questions: readonly TestQuestion[]): TestQuestion[] {
  return questions.filter((q) => q.checked_by_role === null);
}

// --- running -------------------------------------------------------------------------------------

/** What the runner needs from a search engine: the parts of the `SearchV1` body that are scored. */
export type SearchOutcome = {
  status: "ok" | "no_clear_match";
  emergency_first: boolean;
  results: { id: string }[];
};
export type SearchEngine = (input: { q: string; lang: LangCode }) => Promise<SearchOutcome>;

export type QuestionResult = { question: TestQuestion; outcome: SearchOutcome; ms: number };

/** Asks every question once, in file order, timing each one with `now` (milliseconds). */
export async function runQuestions(
  questions: readonly TestQuestion[],
  engine: SearchEngine,
  now: () => number = () => performance.now(),
): Promise<QuestionResult[]> {
  const results: QuestionResult[] = [];
  for (const question of questions) {
    const started = now();
    const outcome = await engine({ q: question.q, lang: question.lang });
    results.push({ question, outcome, ms: now() - started });
  }
  return results;
}

// --- measuring -----------------------------------------------------------------------------------

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;
const rate = (hits: number, of: number) => ({ hits, of, rate: of === 0 ? null : round(hits / of, 4) });

/** Nearest-rank percentile of a list of times; null when there are none. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return round(sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!, 1);
}

export function measure(results: readonly QuestionResult[]): Metrics {
  const scored = results.filter((r) => r.question.kind !== "no_match");
  const inTop = (r: QuestionResult, n: number) => r.outcome.results.slice(0, n).some((hit) => r.question.expected.includes(hit.id));
  const noMatch = results.filter((r) => r.question.kind === "no_match");
  const emergency = results.filter((r) => r.question.kind === "emergency");
  const returned = results.reduce((sum, r) => sum + r.outcome.results.length, 0);
  const times = results.map((r) => r.ms);
  return {
    questions: results.length,
    top3: rate(scored.filter((r) => inTop(r, 3)).length, scored.length),
    top5: rate(scored.filter((r) => inTop(r, 5)).length, scored.length),
    no_match: rate(noMatch.filter((r) => r.outcome.status === "no_clear_match").length, noMatch.length),
    emergency: rate(emergency.filter((r) => r.outcome.emergency_first).length, emergency.length),
    results_returned: { total: returned, mean: results.length === 0 ? null : round(returned / results.length, 2) },
    time_ms: { p50: percentile(times, 50), p95: percentile(times, 95) },
  };
}

export function measureSubset(results: readonly QuestionResult[]): SubsetReport {
  const langs = [...new Set(results.map((r) => r.question.lang))].sort();
  return {
    overall: measure(results),
    by_language: Object.fromEntries(langs.map((lang) => [lang, measure(results.filter((r) => r.question.lang === lang))])),
  };
}

export type RunInfo = { date: string; release: string; model: string; threshold: number; translatedLeg: boolean };

/** The report for a run; a subset whose questions were not run is null. */
export function buildReport(results: readonly QuestionResult[], info: RunInfo, subsets: readonly ("tuning" | "evaluation")[]): TestSetReport {
  const subsetOf = (split: "tuning" | "evaluation") =>
    subsets.includes(split) ? measureSubset(results.filter((r) => r.question.split === split)) : null;
  return {
    v: 1,
    date: info.date,
    release: info.release,
    model: info.model,
    threshold: info.threshold,
    translated_leg: info.translatedLeg,
    question_count: results.length,
    subsets: { tuning: subsetOf("tuning"), evaluation: subsetOf("evaluation") },
  };
}

/** `{date}-{model}.json`, with anything in the model name that is unsafe in a file name replaced. */
export function reportFileName(date: string, model: string): string {
  return `${date}-${model.replace(/[^A-Za-z0-9._-]+/g, "-")}.json`;
}

const pct = (r: { rate: number | null }) => (r.rate === null ? "-" : `${(r.rate * 100).toFixed(1)}%`);
const ms = (value: number | null) => (value === null ? "-" : `${value}`);

export function formatReport(report: TestSetReport): string[] {
  const lines = [
    `Search test set: release ${report.release}, model ${report.model}, threshold ${report.threshold}, translated-question leg ${report.translated_leg ? "on" : "off"}, ${report.date}`,
  ];
  for (const name of ["tuning", "evaluation"] as const) {
    const subset = report.subsets[name];
    lines.push("", `${name} subset${subset ? "" : ": not run"}`);
    if (!subset) continue;
    lines.push("  lang      n  top3     top5     no-match emergency results p50ms  p95ms");
    const rows: [string, Metrics][] = [...Object.entries(subset.by_language), ["overall", subset.overall]];
    for (const [label, m] of rows) {
      lines.push(
        `  ${label.padEnd(8)} ${String(m.questions).padStart(2)}  ${pct(m.top3).padEnd(8)} ${pct(m.top5).padEnd(8)} ${pct(m.no_match).padEnd(8)} ${pct(m.emergency).padEnd(9)} ${String(m.results_returned.mean ?? "-").padEnd(7)} ${ms(m.time_ms.p50).padEnd(6)} ${ms(m.time_ms.p95)}`,
      );
    }
  }
  return lines;
}

// --- comparing -----------------------------------------------------------------------------------

export function parseReport(text: string, label: string): TestSetReport {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label}: not valid JSON (${(error as Error).message})`);
  }
  const parsed = TestSetReportSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`${label}: not a search test-set report (${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")})`);
  }
  return parsed.data;
}

const MEASURES = [
  ["top3", "top 3"],
  ["top5", "top 5"],
  ["no_match", "no-match"],
  ["emergency", "emergency"],
] as const;

export type Comparison = { lines: string[]; worse: string[] };

/** Per-language differences between two reports; `worse` lists every language and measure that dropped. */
export function compareReports(a: TestSetReport, b: TestSetReport): Comparison {
  const lines = [
    `A: release ${a.release}, ${a.model}, threshold ${a.threshold}, leg ${a.translated_leg ? "on" : "off"}, ${a.date}`,
    `B: release ${b.release}, ${b.model}, threshold ${b.threshold}, leg ${b.translated_leg ? "on" : "off"}, ${b.date}`,
  ];
  const worse: string[] = [];
  for (const name of ["tuning", "evaluation"] as const) {
    const sa = a.subsets[name];
    const sb = b.subsets[name];
    lines.push("", `${name} subset`);
    if (!sa || !sb) {
      lines.push(`  not compared: ${!sa && !sb ? "neither report" : !sa ? "report A" : "report B"} has no ${name} run`);
      continue;
    }
    lines.push("  lang      top3 (A -> B)             top5      no-match  emergency  p95ms");
    const langs = [...new Set([...Object.keys(sa.by_language), ...Object.keys(sb.by_language)])].sort();
    const rows: [string, Metrics | undefined, Metrics | undefined][] = [
      ...langs.map((l): [string, Metrics | undefined, Metrics | undefined] => [l, sa.by_language[l], sb.by_language[l]]),
      ["overall", sa.overall, sb.overall],
    ];
    for (const [label, ma, mb] of rows) {
      if (!ma || !mb) {
        lines.push(`  ${label.padEnd(8)} only in report ${ma ? "A" : "B"}`);
        continue;
      }
      const cells = MEASURES.map(([key, title]) => {
        const ra = ma[key].rate;
        const rb = mb[key].rate;
        if (ra === null || rb === null) return "-";
        const diff = round((rb - ra) * 100, 1);
        if (diff < 0) worse.push(`${name} ${label} ${title}: ${(ra * 100).toFixed(1)}% -> ${(rb * 100).toFixed(1)}%`);
        const text = `${(ra * 100).toFixed(0)}->${(rb * 100).toFixed(0)} (${diff > 0 ? "+" : ""}${diff})`;
        return diff < 0 ? `${text} WORSE` : text;
      });
      const p95 = ma.time_ms.p95 === null || mb.time_ms.p95 === null ? "-" : `${ma.time_ms.p95}->${mb.time_ms.p95}`;
      lines.push(`  ${label.padEnd(8)} ${cells[0]!.padEnd(24)} ${cells.slice(1).join("  ")}  ${p95}`);
    }
  }
  lines.push("", worse.length === 0 ? "No language got worse." : `Worse (${worse.length}):`, ...worse.map((w) => `  ${w}`));
  return { lines, worse };
}
