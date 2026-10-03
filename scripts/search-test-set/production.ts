// scripts/search-test-set: running the tuning questions against production's real search use case (S03.07).
//
//   search-test-set run --engine production --model <name> --translated-leg off|on|both --yes
//       [--release <n>] [--max-calls <n>] [--scores] [--summary-file <path>] [--date YYYY-MM-DD] [--out-dir <dir>] [--force]
//
// Each question goes through the use case behind /api/search (`createSearch`, productionEngine.ts): the current published
// release, its search data from the private bucket, Cohere's question embedding, the no-match threshold and the emergency
// safeguard, and, with the leg on, the translated-question leg with the route and the fallback production resolves from
// SEARCH_QUESTION_ROUTE and SEARCH_QUESTION_FALLBACK. Nothing here ranks. The vendor usage is counted as spend purpose `test_set`
// by the use case; no `search_log` row is written.
//
// The environment, by name only (never printed):
//   SEARCH_TEST_DATABASE_URL     the production database: the app's own login (its DATABASE_URL) is enough, since the run only reads
//                                directory_release and inserts spend_event; the workflow falls back to PRODUCTION_DATABASE_URL
//   COHERE_API_KEY               Cohere's key; held only in production and in the workflow's production environment
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY    the private bucket of the release files
//   SEARCH_THRESHOLD, SEARCH_EMERGENCY_THRESHOLD, SEARCH_QUESTION_ROUTE, SEARCH_QUESTION_FALLBACK, SEARCH_FALLBACK_MIN_BUDGET_MS
//                                optional: production's own values of these, resolved by the app's own parser (unset means the
//                                default, as in production). The threshold the run measures is the release's own, recorded on it.
//
// Usage allowance: production uses a free Cohere trial key that live search shares. A run prints the calls it plans per leg and
// does nothing more without --yes; it paces its calls, never makes more than --max-calls (default DEFAULT_MAX_CALLS) and stops
// cleanly, reporting partial results (exit 1); a 429 or another vendor failure is its own outcome and is never scored as a miss.
//
// Only the tuning subset runs. The evaluation subset is acceptance evidence for S03.08 and never used for tuning, so it is
// refused here, whatever flag is given; S03.08 runs it with its own change.
//
// Outputs in --out-dir (default data/search-test-set/reports): {date}-{model}-production-tuning.json (the TuningReport of
// src/contracts/searchTuning.ts: per question and aggregates, both legs), and per leg {date}-{model}-leg-{on|off}-tuning.json (the
// generic report, over the scored questions, so `--compare` shows the leg's effect per language). Question ids, provider ids,
// scores and counts only, never a question's text. --summary-file writes a short markdown summary of the aggregates only.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { TestQuestion } from "@/contracts/searchTestSet";
import type { LegReport, TuningReport } from "@/contracts/searchTuning";
import { EnvError, parseSearchEnv, type SearchSettings } from "@/platform/config/env";
import { formatPlan, planLeg, planningTranslator } from "./callPlan";
import { buildReport, compareReports, formatReport, reportFileName, torontoDate, uncheckedQuestions, type LocatedQuestion } from "./lib";
import { formatLeg, formatScores, markdownSummary } from "./tuningSummary";
import { CallBudget, DEFAULT_MAX_CALLS, legReport, runLeg, type Pace, type TuningEngine } from "./tuningRun";

/** The variables a production run cannot do without, in the order they are reported missing. */
export const REQUIRED_VARIABLES = ["SEARCH_TEST_DATABASE_URL", "COHERE_API_KEY", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"] as const;

export type ProductionEnv = {
  databaseUrl: string;
  cohereApiKey: string;
  supabaseUrl: string;
  supabaseSecretKey: string;
  /** The search settings, resolved from SEARCH_* by the app's own parser. */
  search: SearchSettings;
};

type Variables = Readonly<Record<string, string | undefined>>;

/** The SEARCH_* settings as production resolves them from the same variables, or the rules they break (names and rules, never values). */
export function resolveSearchSettings(env: Variables): { ok: true; settings: SearchSettings } | { ok: false; problems: string[] } {
  try {
    return { ok: true, settings: parseSearchEnv({ ...env }) };
  } catch (error) {
    if (error instanceof EnvError) return { ok: false, problems: error.problems };
    throw error;
  }
}

/** The environment of a run, or the names of what is missing and the problems with what is there (names and rules, never values). */
export function resolveProductionEnv(env: Variables, search: SearchSettings): { ok: true; value: ProductionEnv } | { ok: false; missing: string[]; problems: string[] } {
  const missing = REQUIRED_VARIABLES.filter((name) => !env[name]?.trim());
  const problems: string[] = [];
  const url = env.SEARCH_TEST_DATABASE_URL?.trim();
  if (url) {
    // Either pooler works: the use case reads one table and inserts spend rows, in short transactions with no prepared statements.
    try {
      const parsed = new URL(url);
      if (!/^postgres(?:ql)?:$/.test(parsed.protocol) || parsed.hostname === "") problems.push("SEARCH_TEST_DATABASE_URL must be a postgres:// URL");
    } catch {
      problems.push("SEARCH_TEST_DATABASE_URL is not a valid URL");
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
      search,
    },
  };
}

// --- the options -------------------------------------------------------------------------------------

export type ProductionOptions = {
  model: string;
  release: number | null;
  /** The legs to run, in order: `both` is off, then on. */
  legs: ("off" | "on")[];
  maxCalls: number;
  date: string;
  outDir: string | null;
  summaryFile: string | null;
  scores: boolean;
  force: boolean;
  yes: boolean;
};

const VALUE_FLAGS = ["--engine", "--model", "--release", "--translated-leg", "--split", "--max-calls", "--date", "--out-dir", "--summary-file"];
const BOOLEAN_FLAGS = ["--scores", "--force", "--yes"];

/** What the command line says about the evaluation subset: it is not run here. */
export const EVALUATION_REFUSAL =
  "The evaluation subset is acceptance evidence for S03.08 and is never used for tuning: this runner asks the tuning subset only, and no flag changes that.";

/**
 * Refuses the evaluation subset: any --split but tuning, and the flags that ask for it (--final, --s03-08-evaluation). The
 * default split is tuning.
 */
export function checkSplit(argv: readonly string[]): { ok: true } | { ok: false; error: string } {
  const index = argv.indexOf("--split");
  const split = index >= 0 ? argv[index + 1] : "tuning";
  if (split === "evaluation" || split === "all") return { ok: false, error: `--split ${split} would run the evaluation subset. ${EVALUATION_REFUSAL}` };
  if (split !== "tuning") return { ok: false, error: `--split must be tuning, not "${split ?? ""}". ${EVALUATION_REFUSAL}` };
  if (argv.includes("--final") || argv.includes("--s03-08-evaluation")) return { ok: false, error: `${EVALUATION_REFUSAL} (--final asks for it.)` };
  return { ok: true };
}

export function parseProductionOptions(argv: readonly string[]): { ok: true; options: ProductionOptions } | { ok: false; error: string; usage: boolean } {
  const split = checkSplit(argv);
  if (!split.ok) return { ok: false, usage: false, error: split.error };
  if (argv.includes("--threshold")) {
    return { ok: false, usage: false, error: "--threshold is not used with --engine production: the threshold is the one the release records, and the run only suggests a value (it sets nothing)." };
  }
  const values = new Map<string, string>();
  for (let i = 1; i < argv.length; i++) {
    const flag = argv[i]!;
    if (BOOLEAN_FLAGS.includes(flag)) continue;
    if (VALUE_FLAGS.includes(flag)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) return { ok: false, usage: true, error: "" };
      values.set(flag, value);
      i += 1;
      continue;
    }
    return { ok: false, usage: true, error: "" };
  }
  const model = values.get("--model");
  const leg = values.get("--translated-leg");
  const release = values.get("--release");
  const maxCalls = values.get("--max-calls");
  const date = values.get("--date") ?? torontoDate();
  if (
    !model ||
    (leg !== "off" && leg !== "on" && leg !== "both") ||
    (release !== undefined && !/^\d+$/.test(release)) ||
    (maxCalls !== undefined && !/^[1-9]\d{0,5}$/.test(maxCalls)) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
  ) {
    return { ok: false, usage: true, error: "" };
  }
  return {
    ok: true,
    options: {
      model,
      release: release === undefined ? null : Number(release),
      legs: leg === "both" ? ["off", "on"] : [leg],
      maxCalls: maxCalls === undefined ? DEFAULT_MAX_CALLS : Number(maxCalls),
      date,
      outDir: values.get("--out-dir") ?? null,
      summaryFile: values.get("--summary-file") ?? null,
      scores: argv.includes("--scores"),
      force: argv.includes("--force"),
      yes: argv.includes("--yes"),
    },
  };
}

// --- the run -----------------------------------------------------------------------------------------

export type ProductionRunDeps = {
  loadQuestions: (root: string) => { questions: LocatedQuestion[]; errors: string[]; sha256: string };
  makeEngine: (env: ProductionEnv, options: { translatedLeg: boolean }) => Promise<TuningEngine>;
  usage: string;
  /** Test seams: the pause between questions. */
  sleep?: (ms: number) => Promise<void>;
  pace?: Partial<Pace>;
};

/** A line that GitHub Actions shows as an annotation when it runs there. */
function annotate(env: Variables, level: "error" | "warning", title: string, message: string): string {
  return env.GITHUB_ACTIONS === "true" ? `::${level} title=${title}::${message}` : `${title}: ${message}`;
}

export async function runProduction(argv: string[], env: Variables, root: string, deps: ProductionRunDeps): Promise<number> {
  const parsed = parseProductionOptions(argv);
  if (!parsed.ok) {
    console.error(parsed.usage ? deps.usage : parsed.error);
    return 2;
  }
  const options = parsed.options;

  const { questions, errors, sha256 } = deps.loadQuestions(root);
  if (errors.length > 0) {
    for (const line of errors) console.error(line);
    console.error("Not running: the questions file is not valid.");
    return 1;
  }
  // The tuning subset, whatever was asked: the evaluation subset is never in the list this run walks through.
  const tuning: TestQuestion[] = questions.filter((q) => q.split === "tuning");

  const settings = resolveSearchSettings(env);
  if (!settings.ok) {
    for (const problem of settings.problems) console.error(annotate(env, "error", "Unusable setting", problem));
    return 1;
  }

  // The plan comes before anything is called, or even connected to: it needs only the questions and the route.
  const plans = options.legs.map((leg) => ({ leg, plan: planLeg(tuning, leg === "on" ? planningTranslator(settings.settings) : null) }));
  for (const line of formatPlan(options.model, plans, options.maxCalls)) console.log(line);
  if (!options.yes) {
    console.error("Nothing was called. Add --yes to run it.");
    return 2;
  }

  const resolved = resolveProductionEnv(env, settings.settings);
  if (!resolved.ok) {
    for (const name of resolved.missing) console.error(annotate(env, "error", "Missing setting", `${name} is not set; the search test set cannot run against production without it.`));
    for (const problem of resolved.problems) console.error(annotate(env, "error", "Unusable setting", problem));
    return 1;
  }

  const outDir = path.resolve(options.outDir ?? path.join(root, "data", "search-test-set", "reports"));
  const reportFile = path.join(outDir, `${options.date}-${options.model.replace(/[^A-Za-z0-9._-]+/g, "-")}-production-tuning.json`);
  const legFile = (leg: "off" | "on") => path.join(outDir, reportFileName(options.date, options.model, leg === "on", "tuning"));
  const files = [reportFile, ...options.legs.map(legFile)];
  const taken = files.find((file) => existsSync(file));
  if (taken && !options.force) {
    console.error(`${taken} already exists; pass --force to replace it, or a different --date.`);
    return 1;
  }

  const budget = new CallBudget(options.maxCalls);
  const legs: { off: LegReport | null; on: LegReport | null } = { off: null, on: null };
  const generic: Partial<Record<"off" | "on", ReturnType<typeof buildReport>>> = {};
  let facts: { release: number; model: string; threshold: number } | null = null;
  mkdirSync(outDir, { recursive: true });

  try {
    for (const leg of options.legs) {
      const engine = await deps.makeEngine(resolved.value, { translatedLeg: leg === "on" });
      try {
        if (engine.facts.model !== options.model) {
          console.error(`Release ${engine.facts.release} is embedded with ${engine.facts.model}, not ${options.model}: run with --model ${engine.facts.model}, or publish a release made with ${options.model} first.`);
          return 1;
        }
        if (options.release !== null && options.release !== engine.facts.release) {
          console.error(`--release is ${options.release}, but the current release is ${engine.facts.release}.`);
          return 1;
        }
        if (facts !== null && facts.release !== engine.facts.release) {
          console.error(`The current release changed during the run, from ${facts.release} to ${engine.facts.release}: run it again.`);
          return 1;
        }
        facts = engine.facts;
        console.log(`\nAsking ${tuning.length} tuning questions of release ${facts.release} (${facts.model}, threshold ${facts.threshold}), translated-question leg ${leg}`);
        const run = await runLeg(tuning, engine, {
          budget,
          translatedLeg: leg === "on",
          sleep: deps.sleep,
          pace: deps.pace,
          onQuestion: ({ id, outcome, index, of }) => {
            if (outcome !== "hit" && outcome !== "miss" && outcome !== "no_clear_match" && outcome !== "not_run") console.log(`  ${id}: ${outcome}`);
            if ((index + 1) % 25 === 0 || index + 1 === of) console.log(`  ${index + 1} of ${of} questions done, ${budget.made} vendor calls made`);
          },
        });
        legs[leg] = legReport(run, facts.threshold);
        generic[leg] = buildReport(run.scored, { date: options.date, release: String(facts.release), model: facts.model, threshold: facts.threshold, translatedLeg: leg === "on", questionsSha256: sha256 }, ["tuning"]);
        writeFileSync(legFile(leg), `${JSON.stringify(generic[leg], null, 2)}\n`);
      } finally {
        await engine.close().catch(() => undefined);
      }
    }
  } catch (error) {
    console.error(`The run failed: ${(error as Error).message}`);
    return 1;
  }

  const report: TuningReport = {
    v: 1,
    date: options.date,
    split: "tuning",
    release: facts!.release,
    model: facts!.model,
    release_threshold: facts!.threshold,
    questions_sha256: sha256,
    settings: {
      question_route: { ...settings.settings.questionRoute },
      question_fallback: { ...settings.settings.questionFallback },
      fallback_min_budget_ms: settings.settings.fallbackMinBudgetMs,
      emergency_threshold: settings.settings.emergencyThreshold,
    },
    max_calls: options.maxCalls,
    calls_made: budget.made,
    legs,
  };
  writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  if (options.summaryFile) {
    mkdirSync(path.dirname(path.resolve(options.summaryFile)), { recursive: true });
    writeFileSync(options.summaryFile, `${markdownSummary(report).join("\n")}\n`);
  }

  for (const leg of options.legs) {
    const g = generic[leg]!;
    for (const line of formatReport(g)) console.log(line);
    for (const line of formatLeg(legs[leg]!)) console.log(line);
    if (options.scores) for (const line of formatScores(legs[leg]!.rows)) console.log(line);
  }
  if (generic.off && generic.on) {
    console.log("\nThe translated-question leg's effect, off (A) to on (B):");
    for (const line of compareReports(generic.off, generic.on).lines) console.log(line);
  }
  const unchecked = uncheckedQuestions(tuning).length;
  if (unchecked > 0) console.warn(`WARNING: ${unchecked} question(s) not yet checked by a second team member.`);

  const partial = options.legs.filter((leg) => legs[leg]!.stopped !== null);
  const unscored = options.legs.reduce((n, leg) => n + legs[leg]!.counts.rate_limited + legs[leg]!.counts.vendor_error + legs[leg]!.counts.search_failed, 0);
  if (unscored > 0) console.warn(annotate(env, "warning", "Questions not scored", `${unscored} question(s) got no usable answer (rate limited, vendor error or search failure) and are left out of the rates.`));
  console.log(`\nReports written to ${outDir}: ${files.map((f) => path.basename(f)).join(", ")}`);
  if (partial.length > 0) {
    console.error(annotate(env, "error", "Partial results", `the run stopped early (${partial.map((leg) => `${leg}: ${legs[leg]!.stopped}`).join(", ")}); ${budget.made} of ${options.maxCalls} calls made.`));
    return 1;
  }
  return 0;
}
