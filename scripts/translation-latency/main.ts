// scripts/translation-latency: measures how long each launch language takes on every model in its route, and turns
// the measurement into attempt timeouts and route deadlines (S04.01, AR-14). Run through
// scripts/translation-latency/index.mjs (npm run translation-latency -- ...), which bundles this file.
//
//   plan [selection]               print the calls the selection makes, per key and model (no call is made)
//   run --max-calls-per-model <n> [selection] [--key-var VAR] [--key-var-for model=VAR ...] [--env-file <path>]
//       [--max-output-tokens 1024] [--call-timeout-ms 60000] [--out <path>] [--force] [--resume] [--dry-run]
//                                  translate each text into each language with each model of its route, one call at a
//                                  time, and write the report. Before any call it prints the plan and refuses to start
//                                  unless every (key, model) plans at most <n> calls (there is no default: say what
//                                  the month's allowance can spare). A model is stopped at its first per-month 429,
//                                  and a rejected key stops the run. --dry-run prints the plan and stops.
//                                  The key is read from the env var named by --key-var (default COHERE_API_KEY), from
//                                  the environment or the env file (default .env at the repository root);
//                                  --key-var-for gives one model another key. A full run (no subset flags, 3
//                                  repetitions) writes data/translation-latency/{date}.json; a subset needs --out.
//                                  Each answered call is also appended to <out>.samples.jsonl, so a run cut short
//                                  can carry on with --resume without paying for its calls again.
//   merge <report> <report> ... --out <path> [--date YYYY-MM-DD] [--force]
//                                  one report from partial runs of the same texts and code path
//   timeouts <report> [--routes <file>] [--markdown | --sql [--table t --lang-column c --model-column c
//       --timeout-column c --timeout-unit ms|s] [--allow-missing]]
//                                  the attempt timeout of each route position and each language's route deadline, by
//                                  the rule in the E04 definitions; --markdown prints the table for the spine, --sql
//                                  the body of the follow-up migration that sets them in translation_route
//   failures <report>              the launch-readiness checklist lines (> 2 failures in 60 attempts)
//
// selection: [--routes <file>] [--langs ur,ps] [--models m1,m2] [--positions 1,2] [--texts id1,id2] [--reps 3]
//
// Exit code 0: done. 1: the run could not finish (a model stopped, a key rejected) or the report is not valid.
// 2: wrong usage, or the usage guard refused the plan.
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { LangCodeSchema, type LangCode } from "@/contracts/lang";
import type { CohereChatClient } from "@/modules/translation/adapters/cohereTranslator";
import { torontoDate } from "../search-test-set/lib";
import {
  DEFAULT_SQL_SHAPE,
  PROVISIONAL_ROUTES,
  REPORTS_DIR,
  SampleSchema,
  TEXTS_FILE,
  buildReport,
  checkGuard,
  checklistLines,
  createCohereCaller,
  formatPlan,
  formatResults,
  mergeReports,
  parseReport,
  parseRoutes,
  parseTexts,
  planCalls,
  proposeTimeouts,
  runPlan,
  sampleKey,
  summarisePlan,
  timeoutsMarkdown,
  timeoutsSql,
  type LatencyReport,
  type Routes,
  type Sample,
  type Selection,
  type SqlShape,
} from "./lib";

const USAGE = `usage: translation-latency plan [selection]
       translation-latency run --max-calls-per-model <n> [selection] [--key-var VAR] [--key-var-for model=VAR ...] [--env-file <path>] [--max-output-tokens n] [--call-timeout-ms n] [--out <path>] [--force] [--resume] [--dry-run]
       translation-latency merge <report> <report> ... --out <path> [--date YYYY-MM-DD] [--force]
       translation-latency timeouts <report> [--routes <file>] [--markdown | --sql [--table t] [--lang-column c] [--model-column c] [--timeout-column c] [--timeout-unit ms|s] [--allow-missing]]
       translation-latency failures <report>
selection: [--routes <file>] [--langs ur,ps] [--models m1,m2] [--positions 1,2] [--texts id1,id2] [--reps 3]`;

export const DEFAULT_REPETITIONS = 3;
export const DEFAULT_KEY_VAR = "COHERE_API_KEY";
export const DEFAULT_MAX_OUTPUT_TOKENS = 1024;
export const DEFAULT_CALL_TIMEOUT_MS = 60_000;

class UsageError extends Error {}

type Env = Readonly<Record<string, string | undefined>>;

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new UsageError(`${name} needs a value`);
  return value;
}

function options(argv: readonly string[], name: string): string[] {
  return argv.flatMap((arg, i) => (arg === name && argv[i + 1] !== undefined ? [argv[i + 1]!] : []));
}

const list = (value: string | undefined) => (value === undefined ? undefined : value.split(",").map((v) => v.trim()).filter(Boolean));

function wholeNumber(argv: readonly string[], name: string, fallback?: number): number | undefined {
  const value = option(argv, name);
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1) throw new UsageError(`${name} must be a whole number of at least 1`);
  return Number(value);
}

const ENV_VAR = /^[A-Z_][A-Z0-9_]*$/;

/** The selection flags, and whether they choose less than the full measurement. */
function selection(argv: readonly string[]): { sel: Selection; subset: boolean } {
  const routesFile = option(argv, "--routes");
  const routes: Routes = routesFile ? parseRoutes(readFileSync(path.resolve(routesFile), "utf8")) : PROVISIONAL_ROUTES;
  const langs = list(option(argv, "--langs"))?.map((l) => {
    const parsed = LangCodeSchema.safeParse(l);
    if (!parsed.success) throw new UsageError(`${l} is not a launch language code`);
    return parsed.data as LangCode;
  });
  const positions = list(option(argv, "--positions"))?.map((p) => {
    if (!/^[1-9]$/.test(p)) throw new UsageError(`--positions takes route positions such as 1,2, not ${p}`);
    return Number(p);
  });
  const keyVar = option(argv, "--key-var") ?? DEFAULT_KEY_VAR;
  const keyVarFor: Record<string, string> = {};
  for (const pair of options(argv, "--key-var-for")) {
    const [model, name] = pair.split("=");
    if (!model || !name || !ENV_VAR.test(name)) throw new UsageError(`--key-var-for takes model=ENV_VAR, not ${pair}`);
    keyVarFor[model] = name;
  }
  if (!ENV_VAR.test(keyVar)) throw new UsageError(`--key-var takes an env var name, not ${keyVar}`);
  const repetitions = wholeNumber(argv, "--reps", DEFAULT_REPETITIONS)!;
  const sel: Selection = { routes, langs, models: list(option(argv, "--models")), positions, textIds: list(option(argv, "--texts")), repetitions, keyVar, keyVarFor };
  const subset = Boolean(routesFile || langs || sel.models || positions || sel.textIds || repetitions !== DEFAULT_REPETITIONS);
  return { sel, subset };
}

function loadTexts(root: string) {
  return parseTexts(readFileSync(path.join(root, TEXTS_FILE)));
}

/** KEY=VALUE lines (optionally `export`ed and quoted); nothing else of the file is used. */
export function readEnvFile(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]!] = m[2]!.trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

export interface Deps {
  /** The vendor client for a key. By default the real CohereClient; tests pass a fake. */
  clientFor?: (key: string, keyVar: string) => CohereChatClient | Promise<CohereChatClient>;
  now?: () => number;
  log?: (line: string) => void;
  error?: (line: string) => void;
}

async function realClient(key: string): Promise<CohereChatClient> {
  const { CohereClient } = await import("cohere-ai");
  return new CohereClient({ token: key }) as unknown as CohereChatClient;
}

function writeNew(file: string, body: string, force: boolean) {
  if (existsSync(file) && !force) throw new UsageError(`${file} exists: pass --force to replace it`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
}

async function run(argv: readonly string[], env: Env, root: string, deps: Deps): Promise<number> {
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  const { sel, subset } = selection(argv);
  const { texts, sha256 } = loadTexts(root);
  const calls = planCalls(texts, sel);
  const date = option(argv, "--date") ?? torontoDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new UsageError("--date takes YYYY-MM-DD");
  const outOption = option(argv, "--out");
  if (subset && !outOption && !argv.includes("--dry-run")) {
    throw new UsageError(`a subset run needs --out <path>: ${REPORTS_DIR}/{date}.json is kept for the full measurement`);
  }
  const out = path.resolve(root, outOption ?? path.join(REPORTS_DIR, `${date}.json`));
  const checkpoint = `${out}.samples.jsonl`;

  let earlier: Sample[] = [];
  if (existsSync(checkpoint) && !argv.includes("--dry-run")) {
    if (!argv.includes("--resume")) throw new UsageError(`${checkpoint} holds calls from an unfinished run: pass --resume to carry on from it, or delete it`);
    earlier = readFileSync(checkpoint, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => SampleSchema.parse(JSON.parse(line)));
  }
  const done = new Set(earlier.filter((s) => s.outcome !== "quota_exhausted" && s.outcome !== "auth_failed" && s.outcome !== "rate_limited").map(sampleKey));
  earlier = earlier.filter((s) => done.has(sampleKey(s)));
  const remaining = calls.filter((c) => !done.has(sampleKey(c)));

  const plan = summarisePlan(remaining);
  for (const line of formatPlan(plan, sel.repetitions, new Set(remaining.map((c) => c.textId)).size)) log(line);
  if (earlier.length > 0) log(`(${earlier.length} call(s) already made, read from ${checkpoint})`);
  if (argv.includes("--dry-run")) return 0;

  const max = wholeNumber(argv, "--max-calls-per-model");
  const refused = checkGuard(plan, max);
  if (refused.length > 0) {
    for (const line of refused) error(`Not starting: ${line}`);
    return 2;
  }
  if (existsSync(out) && !argv.includes("--force") && !argv.includes("--resume")) throw new UsageError(`${out} exists: pass --force to replace it`);

  const fileEnv = readEnvFile(path.resolve(root, option(argv, "--env-file") ?? ".env"));
  const keys = new Map<string, string>();
  for (const keyVar of new Set(remaining.map((c) => c.keyVar))) {
    const key = env[keyVar] || fileEnv[keyVar];
    if (!key) {
      error(`Not starting: no ${keyVar} in the environment or the env file`);
      return 2;
    }
    keys.set(keyVar, key);
  }
  const clients = new Map<string, CohereChatClient>();
  for (const [keyVar, key] of keys) clients.set(keyVar, await (deps.clientFor ?? realClient)(key, keyVar));

  const maxOutputTokens = wholeNumber(argv, "--max-output-tokens", DEFAULT_MAX_OUTPUT_TOKENS)!;
  const callTimeoutMs = wholeNumber(argv, "--call-timeout-ms", DEFAULT_CALL_TIMEOUT_MS)!;
  const caller = createCohereCaller({ clientFor: (keyVar) => clients.get(keyVar)!, maxOutputTokens, callTimeoutMs, now: deps.now });
  const startedAt = new Date().toISOString();
  mkdirSync(path.dirname(out), { recursive: true });
  const result = await runPlan(remaining, new Map(texts.map((t) => [t.id, t.text])), caller, {
    maxCallsPerModel: max!,
    onSample: (s, i, total) => {
      appendFileSync(checkpoint, `${JSON.stringify(s)}\n`);
      log(`[${i + 1}/${total}] ${s.lang.padEnd(4)} ${s.model.padEnd(30)} ${s.text_id.padEnd(28)} r${s.rep} ${String(Math.round(s.ms)).padStart(6)} ms  ${s.outcome}`);
    },
  });

  const report = buildReport(
    {
      date,
      startedAt,
      finishedAt: new Date().toISOString(),
      maxOutputTokens,
      callTimeoutMs,
      textsSha256: sha256,
      textIds: [...new Set(calls.map((c) => c.textId))],
      repetitions: sel.repetitions,
      routes: Object.fromEntries(Object.entries(sel.routes).filter(([lang]) => calls.some((c) => c.lang === lang))) as Routes,
      plannedCalls: calls.length,
    },
    { samples: [...earlier, ...result.samples], stopped: result.stopped },
  );
  writeNew(out, `${JSON.stringify(report, null, 2)}\n`, true);
  log("");
  for (const line of formatResults(report)) log(line);
  for (const s of report.stopped) error(`STOPPED: ${s.model} on ${s.key_var} (${s.reason}); ${s.skipped} planned call(s) not made`);
  const checklist = checklistLines(report.failures_over_threshold);
  if (checklist.length > 0) {
    log("\nFor the launch-readiness checklist:");
    for (const line of checklist) log(line);
  }
  const shown = path.relative(root, out).startsWith("..") ? out : path.relative(root, out);
  log(`\nReport: ${shown}${report.complete ? "" : " (incomplete: carry on later with --resume)"}`);
  if (report.complete) rmSync(checkpoint, { force: true });
  return report.complete ? 0 : 1;
}

function readReport(file: string | undefined): LatencyReport {
  if (!file) throw new UsageError("a report path is needed");
  return parseReport(readFileSync(path.resolve(file), "utf8"));
}

function timeouts(argv: readonly string[], log: (line: string) => void, error: (line: string) => void): number {
  const report = readReport(argv[1]);
  const routesFile = option(argv, "--routes");
  const routes: Routes = routesFile ? parseRoutes(readFileSync(path.resolve(routesFile), "utf8")) : (report.routes as Routes);
  const proposal = proposeTimeouts(report, routes);
  for (const m of proposal.missing) error(`MISSING: no answered call for ${m.lang} position ${m.position} (${m.model}): no timeout can be proposed`);
  for (const t of proposal.thin) error(`THIN: ${t.lang} ${t.model} has ${t.samples} answered call(s), fewer than 60: its p99 is rougher still`);
  for (const p of proposal.positions.filter((x) => x.capped)) error(`CAPPED: ${p.lang} ${p.model} p99 ${Math.round(p.p99_ms)} ms x 1.25 is over 20 s`);
  if (argv.includes("--sql")) {
    if (proposal.missing.length > 0 && !argv.includes("--allow-missing")) {
      error("Not writing SQL: some route positions have no measurement (pass --allow-missing to leave them at their provisional values)");
      return 1;
    }
    const unit = option(argv, "--timeout-unit") ?? DEFAULT_SQL_SHAPE.unit;
    if (unit !== "ms" && unit !== "s") throw new UsageError("--timeout-unit is ms or s");
    const shape: SqlShape = {
      table: option(argv, "--table") ?? DEFAULT_SQL_SHAPE.table,
      langColumn: option(argv, "--lang-column") ?? DEFAULT_SQL_SHAPE.langColumn,
      modelColumn: option(argv, "--model-column") ?? DEFAULT_SQL_SHAPE.modelColumn,
      timeoutColumn: option(argv, "--timeout-column") ?? DEFAULT_SQL_SHAPE.timeoutColumn,
      unit,
    };
    log(timeoutsSql(proposal, report, shape));
    return 0;
  }
  if (argv.includes("--markdown")) {
    for (const line of timeoutsMarkdown(proposal, report)) log(line);
    return 0;
  }
  log(`${"lang".padEnd(5)} ${"model".padEnd(33)} ${"p99 ms".padStart(7)} ${"n".padStart(3)}  attempt  deadline`);
  const deadline = new Map(proposal.deadlines.map((d) => [d.lang, d.route_deadline_s]));
  for (const p of proposal.positions) {
    log(`${p.lang.padEnd(5)} ${`${p.position}. ${p.model}`.padEnd(33)} ${String(Math.round(p.p99_ms)).padStart(7)} ${String(p.samples).padStart(3)}  ${String(p.attempt_timeout_s).padStart(5)} s  ${p.position === 1 && deadline.has(p.lang) ? `${deadline.get(p.lang)} s` : ""}`);
  }
  return 0;
}

export async function main(argv: string[], env: Env = process.env, root: string = process.cwd(), deps: Deps = {}): Promise<number> {
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  try {
    switch (argv[0]) {
      case "plan": {
        const { sel } = selection(argv);
        const { texts } = loadTexts(root);
        const calls = planCalls(texts, sel);
        for (const line of formatPlan(summarisePlan(calls), sel.repetitions, new Set(calls.map((c) => c.textId)).size)) log(line);
        return 0;
      }
      case "run":
        return await run(argv, env, root, deps);
      case "merge": {
        const files = argv.slice(1).filter((a, i, all) => !a.startsWith("--") && !["--out", "--date"].includes(all[i - 1] ?? ""));
        const outOption = option(argv, "--out");
        if (files.length < 2 || !outOption) throw new UsageError("merge needs two or more reports and --out <path>");
        const merged = mergeReports(files.map((f) => readReport(f)), option(argv, "--date") ?? torontoDate());
        writeNew(path.resolve(root, outOption), `${JSON.stringify(merged, null, 2)}\n`, argv.includes("--force"));
        for (const line of formatResults(merged)) log(line);
        return 0;
      }
      case "timeouts":
        return timeouts(argv, log, error);
      case "failures": {
        const lines = checklistLines(readReport(argv[1]).failures_over_threshold);
        for (const line of lines.length ? lines : ["No route position failed more than 2 in 60 attempts."]) log(line);
        return 0;
      }
      default:
        error(USAGE);
        return 2;
    }
  } catch (e) {
    if (e instanceof UsageError) {
      error(e.message);
      error(USAGE);
      return 2;
    }
    error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}
