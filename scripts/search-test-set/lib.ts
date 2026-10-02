// The search test set: reading and validating the questions, running them against a search engine,
// and building and comparing reports (S03.01). The command line is in main.ts.
import {
  SearchV1Schema,
  TestQuestionSchema,
  TestSetReportSchema,
  type Metrics,
  type QuestionSplit,
  type Row,
  type SearchV1,
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
export function uncheckedQuestions<T extends TestQuestion>(questions: readonly T[]): T[] {
  return questions.filter((q) => q.checked_by === null);
}

/** Today's date in Toronto (YYYY-MM-DD), the default date of a report: the team works on Toronto days, not UTC days. */
export function torontoDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// --- running -------------------------------------------------------------------------------------
//
// The engine. The real one will be a thin wrapper that calls the search use case (the code behind
// /api/search) directly, in the same process. It must not go over HTTP: /api/search is throttled to
// 30 requests per 10 minutes per client (AD-22), so a run of ~150 questions would be refused.
//
// An engine is a function `({q, lang, v?}) => Promise<SearchV1 body>` (`lang` is the page language,
// as for /api/search), or an object `{search, has?}`. What it returns is validated against
// `SearchV1Schema` (src/contracts/searchTestSet.ts); a body that does not fit fails the run. An engine
// may also offer `has(id)`: whether the release being tested holds that provider. With it the report
// lists expected ids the release does not hold (`expected_not_in_release`) instead of counting them as
// misses; without it that list is reported as not checked. A function engine carries `has` as a property.

export type EngineInput = { q: string; lang: LangCode; v?: number };
export type SearchFn = (input: EngineInput) => Promise<unknown>;
export type HasFn = (id: string) => boolean | Promise<boolean>;
export type SearchEngine = SearchFn | { search: SearchFn; has?: HasFn };

export type QuestionResult = {
  question: TestQuestion;
  /** `ok`, `no_clear_match`, `unavailable`, or `error:<code>` when the engine threw. */
  status: string;
  emergency_first: boolean;
  results: SearchV1["results"];
  query_lang: LangCode | null;
  ms: number;
  /** Expected ids the release does not hold; null when the engine cannot say. */
  missing: string[] | null;
};

export type RunOptions = {
  /** Milliseconds, for timing; defaults to performance.now(). */
  now?: () => number;
  /** The release the run must be on (`--release`); the run fails if the engine answers from another one. */
  release?: number;
};

function normalise(engine: SearchEngine): { search: SearchFn; has?: HasFn } {
  if (typeof engine === "function") {
    const has = (engine as { has?: HasFn }).has;
    return { search: engine, has: has?.bind(engine) };
  }
  return { search: engine.search.bind(engine), has: engine.has?.bind(engine) };
}

/** The code of an engine error for the outcome `error:<code>`: its `code` if it has one, else its name. */
export function errorCode(error: unknown): string {
  const raw = (error as { code?: unknown } | null)?.code;
  const named = typeof raw === "string" && raw !== "" ? raw : (error as { name?: unknown } | null)?.name;
  const clean = typeof named === "string" ? named.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 40) : "";
  return clean === "" ? "unknown" : clean;
}

/**
 * Asks every question once, in file order, timing each one. An engine that throws does not stop the
 * run: the question's outcome is `error:<code>` and it counts as a miss. An answer that is not a valid
 * `SearchV1` body, a `release_v` that changes during the run, or one that differs from `options.release`
 * does stop it, with a message that names the question.
 */
export async function runQuestions(questions: readonly TestQuestion[], engine: SearchEngine, options: RunOptions = {}): Promise<QuestionResult[]> {
  const now = options.now ?? (() => performance.now());
  const { search, has } = normalise(engine);

  const known = new Map<string, boolean>();
  if (has) {
    for (const id of new Set(questions.flatMap((q) => q.expected))) known.set(id, await has(id));
  }

  const results: QuestionResult[] = [];
  let release: { v: number; question: string } | null = null;
  for (const question of questions) {
    const missing = has ? question.expected.filter((id) => known.get(id) === false) : null;
    const started = now();
    let raw: unknown;
    try {
      raw = await search({ q: question.q, lang: question.page_lang ?? question.lang, ...(options.release === undefined ? {} : { v: options.release }) });
    } catch (error) {
      results.push({ question, status: `error:${errorCode(error)}`, emergency_first: false, results: [], query_lang: null, ms: now() - started, missing });
      continue;
    }
    const ms = now() - started;
    const parsed = SearchV1Schema.safeParse(raw);
    if (!parsed.success) {
      const why = parsed.error.issues.map((i) => `${i.path.join(".") || "(body)"}: ${i.message}`).join("; ");
      throw new Error(`question ${question.id}: the engine's answer is not a SearchV1 body (${why})`);
    }
    const answer = parsed.data;
    if (options.release !== undefined && answer.release_v !== options.release) {
      throw new Error(`question ${question.id}: the engine answered from release ${answer.release_v}, but --release is ${options.release}`);
    }
    if (release && release.v !== answer.release_v) {
      throw new Error(`question ${question.id}: the engine's release changed from ${release.v} (question ${release.question}) to ${answer.release_v} during the run`);
    }
    release ??= { v: answer.release_v, question: question.id };
    results.push({ question, status: answer.status, emergency_first: answer.emergency_first, results: answer.results, query_lang: answer.query_lang, ms, missing });
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

/** A question whose expected providers are all missing from the release cannot be answered; it is listed apart, not scored. */
const unanswerable = (r: QuestionResult) => r.question.intent !== "no_match" && r.missing !== null && r.missing.length === r.question.expected.length;

export function measure(results: readonly QuestionResult[]): Metrics {
  const scored = results.filter((r) => r.question.intent !== "no_match" && !unanswerable(r));
  const inTop = (r: QuestionResult, n: number) => r.results.slice(0, n).some((hit) => r.question.expected.includes(hit.provider_id));
  const noMatch = results.filter((r) => r.question.intent === "no_match");
  const emergency = results.filter((r) => r.question.intent === "emergency");
  const notEmergency = results.filter((r) => r.question.intent !== "emergency");
  const returned = results.reduce((sum, r) => sum + r.results.length, 0);
  const times = results.map((r) => r.ms);
  return {
    questions: results.length,
    top3: rate(scored.filter((r) => inTop(r, 3)).length, scored.length),
    top5: rate(scored.filter((r) => inTop(r, 5)).length, scored.length),
    no_match: rate(noMatch.filter((r) => r.status === "no_clear_match").length, noMatch.length),
    emergency: rate(emergency.filter((r) => r.emergency_first).length, emergency.length),
    false_emergency_rate: rate(notEmergency.filter((r) => r.emergency_first).length, notEmergency.length),
    error_count: results.filter((r) => r.status.startsWith("error:")).length,
    unavailable_count: results.filter((r) => r.status === "unavailable").length,
    results_returned: { total: returned, mean: results.length === 0 ? null : round(returned / results.length, 2) },
    time_ms: { p50: percentile(times, 50), p95: percentile(times, 95) },
  };
}

/** The per-question row of the report. */
export function rowOf(r: QuestionResult): Row {
  const top = r.results[0];
  return {
    id: r.question.id,
    lang: r.question.lang,
    form: r.question.form,
    intent: r.question.intent,
    query_lang: r.query_lang,
    status: r.status,
    ranks: Object.fromEntries(
      r.question.expected.map((id) => {
        const index = r.results.findIndex((hit) => hit.provider_id === id);
        return [id, index < 0 ? null : index + 1];
      }),
    ),
    top_score: top ? top.score : null,
    ms: round(r.ms, 1),
    emergency_first: r.emergency_first,
    expected_missing: r.missing ?? [],
  };
}

export function measureSubset(results: readonly QuestionResult[]): SubsetReport {
  const langs = [...new Set(results.map((r) => r.question.lang))].sort();
  const kinds = [...new Set(results.map((r) => `${r.question.lang}/${r.question.form}`))].sort();
  const withMissing = results.filter((r) => (r.missing?.length ?? 0) > 0);
  return {
    overall: measure(results),
    by_language: Object.fromEntries(langs.map((lang) => [lang, measure(results.filter((r) => r.question.lang === lang))])),
    by_language_kind: Object.fromEntries(kinds.map((kind) => [kind, measure(results.filter((r) => `${r.question.lang}/${r.question.form}` === kind))])),
    expected_not_in_release: {
      checked: results.length > 0 && results.every((r) => r.missing !== null),
      ids: [...new Set(withMissing.flatMap((r) => r.missing!))].sort(),
      question_ids: withMissing.map((r) => r.question.id),
    },
    rows: results.map(rowOf),
  };
}

export type RunInfo = { date: string; release: string; model: string; threshold: number; translatedLeg: boolean; questionsSha256: string };

/** The report for a run; a subset whose questions were not run is null. */
export function buildReport(results: readonly QuestionResult[], info: RunInfo, subsets: readonly QuestionSplit[]): TestSetReport {
  const subsetOf = (split: QuestionSplit) =>
    subsets.includes(split) ? measureSubset(results.filter((r) => r.question.split === split)) : null;
  return {
    v: 2,
    date: info.date,
    release: info.release,
    model: info.model,
    threshold: info.threshold,
    translated_leg: info.translatedLeg,
    question_count: results.length,
    questions_sha256: info.questionsSha256,
    unchecked_count: uncheckedQuestions(results.map((r) => r.question)).length,
    subsets: { tuning: subsetOf("tuning"), evaluation: subsetOf("evaluation") },
  };
}

/** `{date}-{model}-leg-{on|off}-{split}.json`, with anything in the model name that is unsafe in a file name replaced. */
export function reportFileName(date: string, model: string, translatedLeg: boolean, split: QuestionSplit | "all"): string {
  return `${date}-${model.replace(/[^A-Za-z0-9._-]+/g, "-")}-leg-${translatedLeg ? "on" : "off"}-${split}.json`;
}

const pct = (r: { rate: number | null }) => (r.rate === null ? "-" : `${(r.rate * 100).toFixed(1)}%`);
const ms = (value: number | null) => (value === null ? "-" : `${value}`);

export function formatReport(report: TestSetReport): string[] {
  const lines = [
    `Search test set: release ${report.release}, model ${report.model}, threshold ${report.threshold}, translated-question leg ${report.translated_leg ? "on" : "off"}, ${report.date}`,
    `${report.question_count} questions run, ${report.unchecked_count} not checked by a second team member`,
  ];
  for (const name of ["tuning", "evaluation"] as const) {
    const subset = report.subsets[name];
    lines.push("", `${name} subset${subset ? "" : ": not run"}`);
    if (!subset) continue;
    const header = "      n  top3     top5     no-match emergency false-911 errors results p50ms  p95ms";
    const table = (title: string, groups: [string, Metrics][]) => {
      lines.push(`  ${title.padEnd(18)}${header}`);
      for (const [label, m] of groups) {
        lines.push(
          `  ${label.padEnd(18)}${String(m.questions).padStart(7)}  ${pct(m.top3).padEnd(8)} ${pct(m.top5).padEnd(8)} ${pct(m.no_match).padEnd(8)} ${pct(m.emergency).padEnd(9)} ${pct(m.false_emergency_rate).padEnd(9)} ${String(m.error_count).padEnd(6)} ${String(m.results_returned.mean ?? "-").padEnd(7)} ${ms(m.time_ms.p50).padEnd(6)} ${ms(m.time_ms.p95)}`,
        );
      }
    };
    table("lang", [...Object.entries(subset.by_language), ["overall", subset.overall]]);
    table("lang/form", Object.entries(subset.by_language_kind));
    const missing = subset.expected_not_in_release;
    if (!missing.checked) lines.push("  expected ids not in the release: not checked (the engine has no has(id))");
    else if (missing.ids.length > 0) lines.push(`  expected ids not in the release: ${missing.ids.join(", ")} (questions ${missing.question_ids.join(", ")}); questions with none of their ids in the release are not scored`);
    else lines.push("  expected ids not in the release: none");
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
  ["top3", "top 3", "higher"],
  ["top5", "top 5", "higher"],
  ["no_match", "no-match", "higher"],
  ["emergency", "emergency", "higher"],
  ["false_emergency_rate", "false 911", "lower"],
] as const;

export type Comparison = { lines: string[]; worse: string[]; warnings: string[] };

type Group = [label: string, a: Metrics | undefined, b: Metrics | undefined];

/**
 * Differences between two reports, per language and per language and form; `worse` lists everything
 * that dropped. A subset, language or language/form that report A has and report B does not counts
 * as worse. `warnings` say when the two runs did not use the same questions.
 */
export function compareReports(a: TestSetReport, b: TestSetReport): Comparison {
  const lines = [
    `A: release ${a.release}, ${a.model}, threshold ${a.threshold}, leg ${a.translated_leg ? "on" : "off"}, ${a.date}`,
    `B: release ${b.release}, ${b.model}, threshold ${b.threshold}, leg ${b.translated_leg ? "on" : "off"}, ${b.date}`,
  ];
  const warnings: string[] = [];
  if (a.questions_sha256 !== b.questions_sha256) warnings.push("A and B ran different question files (questions_sha256 differs); the numbers are not comparable.");
  if (a.question_count !== b.question_count) warnings.push(`A ran ${a.question_count} questions and B ran ${b.question_count}.`);
  if (warnings.length > 0) lines.push("", ...warnings.map((w) => `WARNING: ${w}`));

  const worse: string[] = [];
  for (const name of ["tuning", "evaluation"] as const) {
    const sa = a.subsets[name];
    const sb = b.subsets[name];
    lines.push("", `${name} subset`);
    if (!sa) {
      lines.push(`  not compared: report A has no ${name} run${sb ? " (report B has one)" : ""}`);
      continue;
    }
    if (!sb) {
      worse.push(`${name} subset: missing from report B`);
      lines.push(`  ${name} subset missing from report B WORSE`);
      continue;
    }
    lines.push("  group              top3 (A -> B)             top5      no-match  emergency  false-911  p95ms");
    const keys = (x: Record<string, Metrics>, y: Record<string, Metrics>) => [...new Set([...Object.keys(x), ...Object.keys(y)])].sort();
    const groups: Group[] = [
      ...keys(sa.by_language, sb.by_language).map((l): Group => [l, sa.by_language[l], sb.by_language[l]]),
      ...keys(sa.by_language_kind, sb.by_language_kind).map((l): Group => [l, sa.by_language_kind[l], sb.by_language_kind[l]]),
      ["overall", sa.overall, sb.overall],
    ];
    for (const [label, ma, mb] of groups) {
      if (!ma || !mb) {
        if (ma) worse.push(`${name} ${label}: missing from report B`);
        lines.push(`  ${label.padEnd(18)} only in report ${ma ? "A WORSE" : "B"}`);
        continue;
      }
      const cells = MEASURES.map(([key, title, better]) => {
        const ra = ma[key].rate;
        const rb = mb[key].rate;
        if (ra === null) return "-";
        if (rb === null) {
          worse.push(`${name} ${label} ${title}: ${(ra * 100).toFixed(1)}% -> no questions in report B`);
          return `${(ra * 100).toFixed(0)}->- WORSE`;
        }
        const diff = round((rb - ra) * 100, 1);
        const dropped = better === "higher" ? diff < 0 : diff > 0;
        if (dropped) worse.push(`${name} ${label} ${title}: ${(ra * 100).toFixed(1)}% -> ${(rb * 100).toFixed(1)}%`);
        const text = `${(ra * 100).toFixed(0)}->${(rb * 100).toFixed(0)} (${diff > 0 ? "+" : ""}${diff})`;
        return dropped ? `${text} WORSE` : text;
      });
      const p95 = ma.time_ms.p95 === null || mb.time_ms.p95 === null ? "-" : `${ma.time_ms.p95}->${mb.time_ms.p95}`;
      lines.push(`  ${label.padEnd(18)} ${cells[0]!.padEnd(24)} ${cells.slice(1).join("  ")}  ${p95}`);
    }
  }
  lines.push("", worse.length === 0 ? "No language got worse." : `Worse (${worse.length}):`, ...worse.map((w) => `  ${w}`));
  return { lines, worse, warnings };
}
