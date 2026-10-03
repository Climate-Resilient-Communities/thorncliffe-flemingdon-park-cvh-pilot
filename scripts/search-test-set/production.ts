// scripts/search-test-set: running the test set against production's real search use case (S03.07 infrastructure).
//
//   search-test-set run --engine production --model <name> --translated-leg on|off
//       [--release <n>] [--split tuning] [--scores] [--summary-file <path>] [--date YYYY-MM-DD] [--out-dir <dir>] [--force] [--yes]
//
// The engine is `createSearch` (the use case behind /api/search, with spend purpose `test_set` and no `search_log` row),
// built from the environment of the run instead of through Next (productionEngine.ts), reading the current release from the
// database and the vectors from the private bucket. The environment it needs, by name only:
//   SEARCH_TEST_DATABASE_URL     the production database, as postgres through the session pooler (port 5432)
//   COHERE_API_KEY               Cohere's key; held only in production and in the workflow's production environment
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY    the private bucket of the release files
// The threshold is the release's own (a release records it): there is no --threshold here. --model must name the model the
// release was embedded with, so a report cannot be labelled with a model it did not use. --release, when given, must be the
// current release. A database that is not on this machine needs --yes.
//
// Only the tuning subset runs. The evaluation subset is acceptance evidence for S03.08 and never used for tuning, so
// `--split evaluation|all` is refused unless `--s03-08-evaluation` is also given (and then `--final`, as for any run).
//
// Besides the report (the same file the other engines write, so `--compare` works), a run writes
// {report name}.production.json beside it: the embedding usage, every question's top score and best expected score (ids
// only, never a question's text) and the threshold the scores suggest (threshold.ts; it suggests, it sets nothing).
// `--scores` also prints that table and the no-match scores. `--summary-file` writes a short markdown summary of the
// aggregates only (for a job summary).
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { checkMigrationUrl } from "../db/migrate.mjs";
import type { QuestionSplit } from "@/contracts/searchTestSet";
import type { TestSetReport } from "@/contracts/searchTestSet";
import {
  buildReport,
  formatReport,
  reportFileName,
  runQuestions,
  torontoDate,
  uncheckedQuestions,
  type LocatedQuestion,
  type QuestionResult,
  type SearchEngine,
} from "./lib";
import { suggestThreshold, type ThresholdRow, type ThresholdSuggestion } from "./threshold";

// --- what the run needs -----------------------------------------------------------------------------

export const PRODUCTION_ENGINE = "production";
export const EVALUATION_FLAG = "--s03-08-evaluation";

/** The variables of a production run, in the order they are reported missing. */
export const REQUIRED_VARIABLES = ["SEARCH_TEST_DATABASE_URL", "COHERE_API_KEY", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"] as const;

export type ProductionEnv = {
  databaseUrl: string;
  cohereApiKey: string;
  supabaseUrl: string;
  supabaseSecretKey: string;
  /** Host and database of the database, for the --yes check; never the credentials. */
  databaseHost: string;
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** The environment of a run, or the names of what is missing and the problems with what is there (names and rules, never values). */
export function resolveProductionEnv(
  env: Readonly<Record<string, string | undefined>>,
  options: { yes: boolean },
): { ok: true; value: ProductionEnv } | { ok: false; missing: string[]; problems: string[] } {
  const missing = REQUIRED_VARIABLES.filter((name) => !env[name]?.trim());
  const problems: string[] = [];
  let host = "";
  const url = env.SEARCH_TEST_DATABASE_URL?.trim();
  if (url) {
    try {
      checkMigrationUrl(url, "SEARCH_TEST_DATABASE_URL");
      const parsed = new URL(url);
      host = parsed.hostname;
      if (!LOCAL_HOSTS.has(parsed.hostname) && !options.yes) {
        problems.push("SEARCH_TEST_DATABASE_URL is not on this machine: pass --yes to run against it");
      }
    } catch (error) {
      const e = error as Error & { title?: string; problems?: string[] };
      problems.push(e.title ?? "SEARCH_TEST_DATABASE_URL is not a usable database URL", ...(e.problems ?? []));
    }
  }
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (supabaseUrl) {
    try {
      if (new URL(supabaseUrl).protocol !== "https:") problems.push("NEXT_PUBLIC_SUPABASE_URL must be an https URL");
    } catch {
      problems.push("NEXT_PUBLIC_SUPABASE_URL is not a valid URL");
    }
  }
  if (missing.length > 0 || problems.length > 0) return { ok: false, missing: [...missing], problems };
  return {
    ok: true,
    value: {
      databaseUrl: url as string,
      cohereApiKey: (env.COHERE_API_KEY as string).trim(),
      supabaseUrl: supabaseUrl as string,
      supabaseSecretKey: (env.SUPABASE_SECRET_KEY as string).trim(),
      databaseHost: host,
    },
  };
}

// --- the options and the split guard ----------------------------------------------------------------

export type ProductionOptions = {
  model: string;
  release: number | null;
  translatedLeg: boolean;
  split: QuestionSplit | "all";
  date: string;
  outDir: string | null;
  summaryFile: string | null;
  scores: boolean;
  force: boolean;
  yes: boolean;
};

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

/** True when the command line asks for the production engine. */
export function wantsProductionEngine(argv: readonly string[]): boolean {
  return argv[0] === "run" && option(argv, "--engine") === PRODUCTION_ENGINE;
}

/**
 * Refuses the evaluation subset (`evaluation`, or `all` which holds it) unless S03.08's own flag is given, and then still
 * needs `--final`. The default split is `tuning`.
 */
export function checkSplit(split: string, argv: readonly string[]): { ok: true; split: QuestionSplit | "all" } | { ok: false; error: string } {
  if (split === "tuning") return { ok: true, split };
  if (split !== "evaluation" && split !== "all") return { ok: false, error: `--split must be tuning, evaluation or all, not "${split}"` };
  if (!argv.includes(EVALUATION_FLAG)) {
    return { ok: false, error: `--split ${split} includes the evaluation subset, which is acceptance evidence for S03.08 and is never used for tuning: it is refused without ${EVALUATION_FLAG}.` };
  }
  if (!argv.includes("--final")) return { ok: false, error: `--split ${split} also needs --final, as for every run of the evaluation subset.` };
  return { ok: true, split };
}

export function parseProductionOptions(argv: readonly string[]): { ok: true; options: ProductionOptions } | { ok: false; error: string; usage: boolean } {
  const model = option(argv, "--model");
  const leg = option(argv, "--translated-leg");
  const release = option(argv, "--release");
  const date = option(argv, "--date") ?? torontoDate();
  if (argv.includes("--threshold")) {
    return { ok: false, usage: false, error: "--threshold is not used with --engine production: the threshold is the one the release records. S03.07 suggests a value with --scores; it does not set one." };
  }
  if (!model || (leg !== "on" && leg !== "off") || (release !== undefined && !/^\d+$/.test(release)) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, usage: true, error: "" };
  }
  const split = checkSplit(option(argv, "--split") ?? "tuning", argv);
  if (!split.ok) return { ok: false, usage: false, error: split.error };
  return {
    ok: true,
    options: {
      model,
      release: release === undefined ? null : Number(release),
      translatedLeg: leg === "on",
      split: split.split,
      date,
      outDir: option(argv, "--out-dir") ?? null,
      summaryFile: option(argv, "--summary-file") ?? null,
      scores: argv.includes("--scores"),
      force: argv.includes("--force"),
      yes: argv.includes("--yes"),
    },
  };
}

// --- the engine's contract --------------------------------------------------------------------------

/** What the engine saw for one question, before any threshold: the five most similar providers. */
export type Probe = { top: { provider_id: string; score: number }[] };

export type EmbeddingUsage = {
  /** Embedding calls made, tokens the vendor reported, and calls whose usage it did not report. */
  calls: number;
  tokens: number;
  unreportedCalls: number;
};

export type ReleaseFacts = { release: number; model: string; threshold: number };

export interface ProductionEngine {
  search: Extract<SearchEngine, { search: unknown }>["search"];
  has: (id: string) => Promise<boolean>;
  /** The current release the run is measuring: number, embedding model and the threshold it recorded. */
  describe(): ReleaseFacts;
  /** One entry per `search` call, in order; null for a call that failed. */
  probes: (Probe | null)[];
  usage(): EmbeddingUsage;
  close(): Promise<void>;
}

export type MakeEngine = (env: ProductionEnv, options: { translatedLeg: boolean }) => Promise<ProductionEngine>;

/** Counts an embedder's calls and tokens, and hands each question vector to `onVector`. */
export function meterEmbedder<E extends { embedQuery: (input: never) => Promise<{ vector: number[]; tokens: number | null }> }>(
  inner: E,
  onVector: (vector: number[]) => void = () => undefined,
): { embedder: E; usage: () => EmbeddingUsage } {
  const usage: EmbeddingUsage = { calls: 0, tokens: 0, unreportedCalls: 0 };
  const embedder = {
    async embedQuery(input: never) {
      const answer = await inner.embedQuery(input);
      usage.calls += 1;
      if (answer.tokens === null) usage.unreportedCalls += 1;
      else usage.tokens += answer.tokens;
      onVector(answer.vector);
      return answer;
    },
  } as E;
  return { embedder, usage: () => ({ ...usage }) };
}

// --- scores -----------------------------------------------------------------------------------------

export type ScoreRow = {
  id: string;
  lang: string;
  intent: string;
  status: string;
  /** The highest similarity of any provider (before the threshold); null when the engine did not answer. */
  top_score: number | null;
  /** The best expected provider in the top 5, with its rank and similarity; null when none is. */
  expected_best: { provider_id: string; rank: number; score: number } | null;
};

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** The per-question scores, from what the engine saw (`probes`, in the order of `results`). */
export function scoreRows(results: readonly QuestionResult[], probes: readonly (Probe | null)[]): ScoreRow[] {
  return results.map((r, index) => {
    const top = probes[index]?.top ?? [];
    const rank = top.findIndex((hit) => r.question.expected.includes(hit.provider_id));
    const best = rank < 0 ? null : top[rank]!;
    return {
      id: r.question.id,
      lang: r.question.lang,
      intent: r.question.intent,
      status: r.status,
      top_score: top[0] ? round6(top[0].score) : null,
      expected_best: best ? { provider_id: best.provider_id, rank: rank + 1, score: round6(best.score) } : null,
    };
  });
}

export function thresholdRows(rows: readonly ScoreRow[]): ThresholdRow[] {
  return rows.map((r) => ({ id: r.id, intent: r.intent as ThresholdRow["intent"], topScore: r.top_score, expectedScore: r.expected_best?.score ?? null }));
}

const num = (x: number | null) => (x === null ? "-" : x.toFixed(4));

/** The scores as lines: every question, then the no-match scores from the highest, then the suggestion. Ids only, never question text. */
export function formatScores(rows: readonly ScoreRow[], suggestion: ThresholdSuggestion): string[] {
  const lines = ["", "Scores before the threshold (id, language, intent, top score, best expected provider: rank and score, outcome)"];
  for (const r of rows) {
    const expected = r.expected_best ? `${r.expected_best.provider_id} #${r.expected_best.rank} ${num(r.expected_best.score)}` : r.intent === "no_match" ? "n/a" : "not in top 5";
    lines.push(`  ${r.id.padEnd(10)} ${r.lang.padEnd(8)} ${r.intent.padEnd(10)} top ${num(r.top_score)}  ${expected.padEnd(22)} ${r.status}`);
  }
  const noMatch = rows.filter((r) => r.intent === "no_match").sort((a, b) => (b.top_score ?? -1) - (a.top_score ?? -1));
  lines.push("", `No-match questions by top score (${noMatch.length}): ${noMatch.map((r) => `${r.id} ${num(r.top_score)}`).join(", ") || "none"}`);
  lines.push(...formatSuggestion(suggestion));
  return lines;
}

export function formatSuggestion(s: ThresholdSuggestion): string[] {
  const count = (c: { hits: number; of: number; lost: number }) => `${c.hits} of ${c.of} questions keep a hit, ${c.lost} lost`;
  const lines: string[] = [];
  if (s.threshold === null) lines.push(`Suggested threshold: none (${s.reason})`);
  else {
    lines.push(`Suggested threshold: ${s.threshold} (just above the highest no-match top score ${num(s.highestNoMatch)}, over ${s.noMatchQuestions} no-match questions); ${count(s.atSuggested!)}`);
    if (s.atSuggested!.lostIds.length > 0) lines.push(`  hits lost: ${s.atSuggested!.lostIds.join(", ")}`);
  }
  if (s.atCurrent) lines.push(`At the release's threshold ${s.atCurrent.threshold}: ${count(s.atCurrent)}`);
  lines.push("This only suggests a value: the threshold is chosen by the team and set with SEARCH_THRESHOLD on a new release.");
  return lines;
}

// --- the short summary (aggregates only) ------------------------------------------------------------

const pct = (r: { rate: number | null }) => (r.rate === null ? "-" : `${(r.rate * 100).toFixed(1)}%`);
const ms = (x: number | null) => (x === null ? "-" : String(x));

/** A short markdown summary of one run: aggregates only, no question text or ids. */
export function formatSummary(report: TestSetReport, usage: EmbeddingUsage, suggestion: ThresholdSuggestion, split: string): string[] {
  const subset = report.subsets.tuning ?? report.subsets.evaluation;
  const lines = [
    `### Release ${report.release}, ${report.model}, translated-question leg ${report.translated_leg ? "on" : "off"} (${split})`,
    "",
    `Threshold of the release: ${report.threshold}. ${report.question_count} questions.`,
    "",
  ];
  if (subset) {
    lines.push("| Language | Questions | Hit top 3 | Hit top 5 | p50 ms | p95 ms |", "| --- | ---: | ---: | ---: | ---: | ---: |");
    for (const [lang, m] of [...Object.entries(subset.by_language), ["all", subset.overall] as const]) {
      lines.push(`| ${lang} | ${m.questions} | ${pct(m.top3)} | ${pct(m.top5)} | ${ms(m.time_ms.p50)} | ${ms(m.time_ms.p95)} |`);
    }
    lines.push("", `No-match accuracy ${pct(subset.overall.no_match)}, emergency accuracy ${pct(subset.overall.emergency)}, errors ${subset.overall.error_count}, unavailable ${subset.overall.unavailable_count}.`);
  }
  lines.push(`Embedding usage: ${usage.calls} calls, ${usage.tokens} tokens reported${usage.unreportedCalls > 0 ? `, ${usage.unreportedCalls} calls without a reported count` : ""}.`);
  lines.push("", ...formatSuggestion(suggestion).map((l) => l.trim()).filter((l) => !l.startsWith("hits lost")).map((l) => `- ${l}`));
  return lines;
}

// --- the run ----------------------------------------------------------------------------------------

export type ProductionRunDeps = {
  loadQuestions: (root: string) => { questions: LocatedQuestion[]; errors: string[]; sha256: string };
  makeEngine: MakeEngine;
  usage: string;
};

/** A missing-variable line that GitHub Actions shows as an annotation when it runs there. */
function annotate(env: Readonly<Record<string, string | undefined>>, title: string, message: string): string {
  return env.GITHUB_ACTIONS === "true" ? `::error title=${title}::${message}` : `${title}: ${message}`;
}

export async function runProduction(argv: string[], env: NodeJS.ProcessEnv, root: string, deps: ProductionRunDeps): Promise<number> {
  const parsed = parseProductionOptions(argv);
  if (!parsed.ok) {
    console.error(parsed.usage ? deps.usage : parsed.error);
    return 2;
  }
  const options = parsed.options;
  const resolved = resolveProductionEnv(env, { yes: options.yes });
  if (!resolved.ok) {
    for (const name of resolved.missing) console.error(annotate(env, "Missing setting", `${name} is not set; the search test set cannot run against production without it.`));
    for (const problem of resolved.problems) console.error(annotate(env, "Unusable setting", problem));
    return 1;
  }

  const { questions, errors, sha256 } = deps.loadQuestions(root);
  if (errors.length > 0) {
    for (const line of errors) console.error(line);
    console.error("Not running: the questions file is not valid.");
    return 1;
  }
  const subsets: QuestionSplit[] = options.split === "all" ? ["tuning", "evaluation"] : [options.split];
  const outDir = path.resolve(options.outDir ?? path.join(root, "data", "search-test-set", "reports"));
  const outFile = path.join(outDir, reportFileName(options.date, options.model, options.translatedLeg, options.split));
  const sideFile = outFile.replace(/\.json$/, ".production.json");
  if ((existsSync(outFile) || existsSync(sideFile)) && !options.force) {
    console.error(`${outFile} already exists; pass --force to replace it, or a different --date.`);
    return 1;
  }

  let engine: ProductionEngine | undefined;
  try {
    engine = await deps.makeEngine(resolved.value, { translatedLeg: options.translatedLeg });
    const facts = engine.describe();
    if (facts.model !== options.model) {
      console.error(`Release ${facts.release} is embedded with ${facts.model}, not ${options.model}: publish a release with that model first, or run with --model ${facts.model}.`);
      return 1;
    }
    if (options.release !== null && options.release !== facts.release) {
      console.error(`--release is ${options.release}, but the current release is ${facts.release}.`);
      return 1;
    }
    const selected = questions.filter((q) => subsets.includes(q.split));
    const results = await runQuestions(selected, engine, { release: facts.release });
    const report = buildReport(
      results,
      { date: options.date, release: String(facts.release), model: facts.model, threshold: facts.threshold, translatedLeg: options.translatedLeg, questionsSha256: sha256 },
      subsets,
    );
    const rows = scoreRows(results, engine.probes);
    const suggestion = suggestThreshold(thresholdRows(rows), facts.threshold);
    const usage = engine.usage();

    mkdirSync(outDir, { recursive: true });
    writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(sideFile, `${JSON.stringify({ release: facts.release, model: facts.model, threshold: facts.threshold, translated_leg: options.translatedLeg, split: options.split, embedding_usage: usage, suggestion, scores: rows }, null, 2)}\n`);
    if (options.summaryFile) {
      mkdirSync(path.dirname(path.resolve(options.summaryFile)), { recursive: true });
      writeFileSync(options.summaryFile, `${formatSummary(report, usage, suggestion, options.split).join("\n")}\n`);
    }
    for (const line of formatReport(report)) console.log(line);
    console.log("", `Embedding usage: ${usage.calls} calls, ${usage.tokens} tokens reported, ${usage.unreportedCalls} calls without a reported count`);
    if (options.scores) for (const line of formatScores(rows, suggestion)) console.log(line);
    else for (const line of formatSuggestion(suggestion)) console.log(line);
    if (report.unchecked_count > 0) console.warn(`WARNING: ${report.unchecked_count} question(s) not yet checked by a second team member: ${uncheckedQuestions(selected).map((q) => q.id).join(", ")}`);
    console.log(`\nReport written to ${outFile}`);
    return 0;
  } catch (error) {
    console.error(`The run failed: ${(error as Error).message}`);
    return 1;
  } finally {
    await engine?.close().catch(() => undefined);
  }
}
