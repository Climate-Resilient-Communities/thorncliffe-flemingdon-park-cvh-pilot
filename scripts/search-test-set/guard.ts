// scripts/search-test-set: the guard (S03.09). The evaluation subset, asked through the real search use case (productionEngine.ts:
// the current release, Cohere, the private bucket, the translated-question leg with the route production resolves), measured against
// the Hub-approved launch bar (bar.ts). It is what CI runs on a change that can change search, and what the team runs by hand the week
// before launch and in week 4.
//
//   search-test-set guard --yes | --plan-only [--checkpoint pr|pre_launch|week_4|manual] [--bar <bar.json>] [--max-calls <n>]
//       [--summary-file <path>] [--date YYYY-MM-DD] [--out-dir <dir>] [--force]
//
//  - No bar yet (bar.json missing, not approved, or without a minimum): it says so and exits 0 before planning, connecting or calling.
//  - The usage guard (usageGuard.ts) runs before the first call: every model priced or an allowance in config, and the run's estimated
//    calls and tokens within what is left of the month counted from spend_event. Each call is recorded in spend_event as `test_set`.
//  - It fails (exit 1) when any language's hit rate, the no-match accuracy or the emergency accuracy is below its minimum, naming the
//    measure and the drop; or when the measurement is incomplete (the run stopped early, or a question got no usable answer): an
//    incomplete run cannot say the bar is met.
//  - At a manual checkpoint (anything but `pr`), each measure below its minimum is also recorded as an ops event `search.below_bar` for
//    the weekly review. A pull request's run records none: a branch is not what residents are searching.
//  - The report (the generic TestSetReport, evaluation subset only: question ids, provider ids, scores and counts, never a question's
//    text) is written to --out-dir as {date}-{model}-guard-{checkpoint}.json; --summary-file writes aggregates only.
// The evaluation subset is still never used for tuning: the guard only checks it against the bar and suggests nothing.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SubsetReport, TestQuestion } from "@/contracts/searchTestSet";
import { checkBar, evaluationIds, formatBar, formatShortfall, readBar, type Bar, type BarState, type Shortfall } from "./bar";
import { formatAllowance, resolveAllowance } from "./allowance";
import { formatPlan, planLeg, planQuestion, planningTranslator } from "./callPlan";
import { buildReport, errorCode, formatReport, torontoDate, type LocatedQuestion } from "./lib";
import { resolveProductionEnv, resolveSearchSettings, type ProductionEnv } from "./production";
import type { SearchCheckpoint } from "./productionEngine";
import { STOP_REASONS } from "./tuningSummary";
import { CallBudget, DEFAULT_MAX_CALLS, runLeg, type Pace, type TuningEngine } from "./tuningRun";
import { checkUsage, estimateUsage, resolveUsageBasis } from "./usageGuard";

export const GUARD_CHECKPOINTS = ["pr", "pre_launch", "week_4", "manual"] as const;
export type GuardCheckpoint = (typeof GUARD_CHECKPOINTS)[number];

export type GuardDeps = {
  loadQuestions: (root: string) => { questions: LocatedQuestion[]; errors: string[]; sha256: string };
  makeEngine: (env: ProductionEnv, options: { translatedLeg: boolean }) => Promise<TuningEngine>;
  /** The Cohere calls and tokens recorded in spend_event this calendar month (America/Toronto), every purpose. */
  monthUsage: (env: ProductionEnv) => Promise<{ calls: number; tokens: number }>;
  /** Records the measures below the bar as ops events (a manual checkpoint only). */
  recordBelowBar: (env: ProductionEnv, release: number, checkpoint: SearchCheckpoint, shortfalls: readonly Shortfall[]) => Promise<void>;
  usage: string;
  sleep?: (ms: number) => Promise<void>;
  pace?: Partial<Pace>;
};

export type GuardOptions = {
  checkpoint: GuardCheckpoint;
  bar: string | null;
  maxCalls: number;
  date: string;
  outDir: string | null;
  summaryFile: string | null;
  force: boolean;
  yes: boolean;
  planOnly: boolean;
};

const VALUE_FLAGS = ["--checkpoint", "--bar", "--max-calls", "--date", "--out-dir", "--summary-file"];
const BOOLEAN_FLAGS = ["--force", "--yes", "--plan-only"];

export function parseGuardOptions(argv: readonly string[]): { ok: true; options: GuardOptions } | { ok: false; error: string } {
  const values = new Map<string, string>();
  for (let i = 1; i < argv.length; i++) {
    const flag = argv[i]!;
    if (BOOLEAN_FLAGS.includes(flag)) continue;
    const value = argv[i + 1];
    if (!VALUE_FLAGS.includes(flag) || value === undefined || value.startsWith("--")) return { ok: false, error: "" };
    values.set(flag, value);
    i += 1;
  }
  if (argv.includes("--yes") && argv.includes("--plan-only")) return { ok: false, error: "--plan-only prints the plan and stops, and --yes starts the run: give one of them." };
  const checkpoint = values.get("--checkpoint") ?? "pr";
  const maxCalls = values.get("--max-calls");
  const date = values.get("--date") ?? torontoDate();
  if (!(GUARD_CHECKPOINTS as readonly string[]).includes(checkpoint) || (maxCalls !== undefined && !/^[1-9]\d{0,5}$/.test(maxCalls)) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: "" };
  }
  return {
    ok: true,
    options: {
      checkpoint: checkpoint as GuardCheckpoint,
      bar: values.get("--bar") ?? null,
      maxCalls: maxCalls === undefined ? DEFAULT_MAX_CALLS : Number(maxCalls),
      date,
      outDir: values.get("--out-dir") ?? null,
      summaryFile: values.get("--summary-file") ?? null,
      force: argv.includes("--force"),
      yes: argv.includes("--yes"),
      planOnly: argv.includes("--plan-only"),
    },
  };
}

type Variables = Readonly<Record<string, string | undefined>>;

function annotate(env: Variables, level: "error" | "warning" | "notice", title: string, message: string): string {
  return env.GITHUB_ACTIONS === "true" ? `::${level} title=${title}::${message}` : `${title}: ${message}`;
}

const pct = (share: number | null) => (share === null ? "-" : `${(share * 100).toFixed(1)}%`);

/** The job summary: the bar against what was measured, aggregates only (no question, no id). */
export function guardSummary(input: { checkpoint: GuardCheckpoint; bar: BarState; release?: number; model?: string; report?: SubsetReport; shortfalls?: Shortfall[]; incomplete?: string | null; callsMade?: number }): string[] {
  const head = `### Search guard (${input.checkpoint === "pr" ? "pull request" : `checkpoint ${input.checkpoint}`})`;
  if (!input.bar.set) return [head, "", `Not measured: ${input.bar.reason}. Nothing was called; the guard passes until the Hub approves a launch bar (S03.08).`];
  const bar: Bar = input.bar.bar;
  const lines = [head, "", `Evaluation subset on release ${input.release}, ${input.model}, against the launch bar approved by ${bar.approvedBy} on ${bar.approvedOn}; ${input.callsMade ?? 0} Cohere calls made.`, ""];
  const r = input.report;
  if (r) {
    lines.push("| Measure | Measured | Minimum |", "| --- | --- | --- |");
    for (const lang of Object.keys(bar.hitRate).sort()) lines.push(`| hit rate (${lang}) | ${pct(r.by_language[lang]?.top3.rate ?? null)} | ${pct(bar.hitRate[lang]!)} |`);
    if (bar.noMatchAccuracy !== null) lines.push(`| no-match accuracy | ${pct(r.overall.no_match.rate)} | ${pct(bar.noMatchAccuracy)} |`);
    if (bar.emergencyAccuracy !== null) lines.push(`| emergency accuracy | ${pct(r.overall.emergency.rate)} | ${pct(bar.emergencyAccuracy)} |`);
    lines.push("");
  }
  if (input.incomplete) lines.push(`**Not judged:** ${input.incomplete}`);
  else if ((input.shortfalls ?? []).length > 0) lines.push("**Below the launch bar:**", "", ...input.shortfalls!.map((s) => `- ${formatShortfall(s)}`));
  else lines.push("Every minimum of the launch bar is met.");
  return lines;
}

function writeSummary(file: string | null, lines: string[]) {
  if (!file) return;
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  writeFileSync(file, `${lines.join("\n")}\n`);
}

export async function runGuard(argv: string[], env: Variables, root: string, deps: GuardDeps): Promise<number> {
  const parsed = parseGuardOptions(argv);
  if (!parsed.ok) {
    console.error(parsed.error || deps.usage);
    return 2;
  }
  const options = parsed.options;

  // The bar first: without one there is nothing to guard, and nothing is planned, connected to or called.
  let bar: BarState;
  try {
    bar = readBar(root, options.bar ?? undefined);
  } catch (error) {
    console.error(annotate(env, "error", "Launch bar unreadable", (error as Error).message));
    return 1;
  }
  if (!bar.set) {
    console.log(annotate(env, "notice", "Search guard not measured", `${bar.reason}: nothing is measured or called until the Hub approves a launch bar (S03.08).`));
    writeSummary(options.summaryFile, guardSummary({ checkpoint: options.checkpoint, bar }));
    return 0;
  }

  const { questions, errors, sha256 } = deps.loadQuestions(root);
  if (errors.length > 0) {
    for (const line of errors) console.error(line);
    console.error("Not running: the questions file is not valid.");
    return 1;
  }
  const ids = evaluationIds(root, questions);
  if (!ids.ok) {
    console.error(annotate(env, "error", "Evaluation subset unreadable", ids.error));
    return 1;
  }
  const chosen = new Set(ids.ids);
  // Marked evaluation whatever their own `split` says, so the report measures exactly the subset that was asked.
  const evaluation: TestQuestion[] = questions.filter((q) => chosen.has(q.id)).map((q) => ({ ...q, split: "evaluation" }));
  if (evaluation.length === 0) {
    console.error(annotate(env, "error", "No evaluation questions", `the evaluation subset (${ids.source}) is empty: there is nothing to measure the bar with.`));
    return 1;
  }

  const settings = resolveSearchSettings(env);
  if (!settings.ok) {
    for (const problem of settings.problems) console.error(annotate(env, "error", "Unusable setting", problem));
    return 1;
  }
  const allowance = resolveAllowance(env);
  const basis = resolveUsageBasis(env);
  if (!allowance.ok || !basis.ok) {
    for (const problem of [...(allowance.ok ? [] : allowance.problems), ...(basis.ok ? [] : basis.problems)]) console.error(annotate(env, "error", "Unusable setting", problem));
    return 1;
  }

  // The leg as residents get it: on, with the route and fallback production resolves (a kind routed `off` makes no translation).
  const translator = planningTranslator(settings.settings);
  const model = settings.settings.embedModel;
  const plan = planLeg(evaluation, translator);
  const estimate = estimateUsage(
    evaluation,
    evaluation.map((q) => planQuestion(q, translator)),
    model,
  );
  console.log(`Search guard (${options.checkpoint}): ${evaluation.length} evaluation questions (${ids.source}).`);
  for (const line of [...formatBar(bar.bar), ...formatPlan(model, [{ leg: "on", plan }], options.maxCalls), formatAllowance(allowance.allowance)]) console.log(line);
  console.log(`  estimated usage: ${estimate.calls} calls, about ${estimate.tokens} tokens, models ${estimate.models.join(", ")}`);
  if (options.planOnly) return 0;
  if (!options.yes) {
    console.error("Nothing was called. Add --yes to run it.");
    return 2;
  }

  const resolved = resolveProductionEnv(env, settings.settings);
  if (!resolved.ok) {
    for (const name of resolved.missing) console.error(annotate(env, "error", "Missing setting", `${name} is not set; the search guard cannot run without it.`));
    for (const problem of resolved.problems) console.error(annotate(env, "error", "Unusable setting", problem));
    return 1;
  }

  const outDir = path.resolve(options.outDir ?? path.join(root, "data", "search-test-set", "reports"));
  const reportFile = path.join(outDir, `${options.date}-${model.replace(/[^A-Za-z0-9._-]+/g, "-")}-guard-${options.checkpoint}.json`);
  if (existsSync(reportFile) && !options.force) {
    console.error(`${reportFile} already exists; pass --force to replace it, or a different --date.`);
    return 1;
  }

  // The usage guard, before the first call.
  let used: { calls: number; tokens: number };
  try {
    used = await deps.monthUsage(resolved.value);
  } catch (error) {
    console.error(annotate(env, "error", "This month's usage unknown", `could not read this month's Cohere usage from spend_event (${errorCode(error)}), and the run needs it to keep the live-search reserve: nothing was called.`));
    return 1;
  }
  const month = checkUsage(allowance.allowance, basis.basis, used, estimate, options.maxCalls, torontoDate().slice(0, 7));
  for (const line of month.summary) console.log(line);
  if (month.refusal !== null) {
    console.error(annotate(env, "error", "Usage allowance", month.refusal));
    writeSummary(options.summaryFile, [`### Search guard (${options.checkpoint})`, "", `Not run: ${month.refusal}`]);
    return 1;
  }

  const budget = new CallBudget(options.maxCalls);
  const engine = await deps.makeEngine(resolved.value, { translatedLeg: true });
  let report: ReturnType<typeof buildReport>;
  let incomplete: string | null = null;
  try {
    console.log(`\nAsking ${evaluation.length} evaluation questions of release ${engine.facts.release} (${engine.facts.model}, threshold ${engine.facts.threshold}), translated-question leg on`);
    const run = await runLeg(evaluation, engine, { budget, translatedLeg: true, sleep: deps.sleep, pace: deps.pace });
    report = buildReport(run.scored, { date: options.date, release: String(engine.facts.release), model: engine.facts.model, threshold: engine.facts.threshold, translatedLeg: true, questionsSha256: sha256 }, ["evaluation"]);
    const unscored = run.rows.filter((row) => row.outcome === "rate_limited" || row.outcome === "vendor_error" || row.outcome === "search_failed").length;
    if (run.stopped !== null) incomplete = `the run stopped early (${STOP_REASONS[run.stopped]}) after ${budget.made} calls, so the bar cannot be judged.`;
    else if (unscored > 0) incomplete = `${unscored} question(s) got no usable answer (rate limited, vendor error or search failure), so the bar cannot be judged; run it again.`;
  } catch (error) {
    console.error(`The run failed: ${(error as Error).message}. Vendor calls made before it failed: ${budget.made}.`);
    return 1;
  } finally {
    await engine.close().catch(() => undefined);
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  for (const line of formatReport(report)) console.log(line);
  console.log(`\nReport written to ${reportFile}`);
  const subset = report.subsets.evaluation!;
  const facts = { release: engine.facts.release, model: engine.facts.model, callsMade: budget.made };

  if (incomplete !== null) {
    console.error(annotate(env, "error", "Search guard incomplete", incomplete));
    writeSummary(options.summaryFile, guardSummary({ checkpoint: options.checkpoint, bar, ...facts, report: subset, incomplete }));
    return 1;
  }

  const shortfalls = checkBar(bar.bar, subset);
  writeSummary(options.summaryFile, guardSummary({ checkpoint: options.checkpoint, bar, ...facts, report: subset, shortfalls }));
  if (shortfalls.length === 0) {
    console.log("Every minimum of the launch bar is met.");
    return 0;
  }
  for (const s of shortfalls) console.error(annotate(env, "error", "Below the launch bar", formatShortfall(s)));
  if (options.checkpoint !== "pr") {
    try {
      await deps.recordBelowBar(resolved.value, engine.facts.release, options.checkpoint, shortfalls);
      console.log(`Recorded ${shortfalls.length} search.below_bar ops event(s) for the weekly review.`);
    } catch (error) {
      console.error(annotate(env, "error", "Ops events not recorded", `the measures below the bar could not be recorded as ops events (${errorCode(error)}); add them to the weekly review by hand.`));
    }
  }
  return 1;
}
