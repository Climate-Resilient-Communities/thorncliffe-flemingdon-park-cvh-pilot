// scripts/search-test-set: the search test set's command line (S03.01). Run through
// scripts/search-test-set/index.mjs (npm run search-test-set -- ...), which bundles this file.
//
//   validate                       check data/search-test-set/questions.jsonl against the schema and the
//                                  catalogue; exit 1 with file:line for every problem. Reports (does not
//                                  fail on) questions not yet checked by a second team member;
//                                  --require-checked fails on them.
//   run --engine <module> --release <n> --model <name> --threshold <x> --translated-leg on|off
//       [--split tuning|evaluation|all --final] [--date YYYY-MM-DD] [--out-dir <dir>] [--force]
//                                  ask every question of the chosen subset (default tuning) and write
//                                  data/search-test-set/reports/{date}-{model}-leg-{on|off}-{split}.json.
//                                  The date defaults to today in Toronto. The evaluation subset is
//                                  acceptance evidence and never used for tuning, so running it
//                                  (--split evaluation, or all) needs --final. <module> is an ES module
//                                  whose default export (or `createEngine({translatedLeg})`) is a SearchEngine,
//                                  see lib.ts; createEngine is told whether the translated-question leg is on,
//                                  so the same engine module gives both reports (S03.05).
//                                  The real engine calls the search use case directly, not /api/search
//                                  over HTTP: that is limited to 30 requests per 10 minutes. Prints a
//                                  warning when questions are not yet checked by a second team member.
//   run --engine production --model <name> --translated-leg off|on|both --yes | --plan-only [--release <n>] [--max-calls <n>]
//       [--scores] [--summary-file <path>] [--date YYYY-MM-DD] [--out-dir <dir>] [--force]
//                                S03.07: the tuning subset asked through production's real search use case, with the
//                                database, Cohere and the private bucket named by environment variables (scripts/search-test-set/production.ts
//                                has the list and the rules): prints the calls it plans and needs --yes (--plan-only prints
//                                the plan and stops), refuses to start when this month's Cohere calls and its own worst case would
//                                pass the allowance less the live-search reserve, never makes more than --max-calls, reports the
//                                hit rate per language, no-match and emergency accuracy, p50/p95, the vendor usage and a suggested
//                                threshold (it sets nothing). The evaluation subset is refused.
//   --compare <a> <b> [--fail-on-worse]
//                                  per-language and per-language/form differences between two reports
//                                  (paths, or file names in the reports folder); a language or subset
//                                  missing from b counts as worse; warns when a and b ran different
//                                  questions. --fail-on-worse exits 1 when anything dropped.
//
// Exit code 0: done. Exit code 1: the set failed validation, something got worse with
// --fail-on-worse, or the run could not finish (the engine's answer is not a SearchV1 body, or its
// release is not --release or changes during the run). Exit code 2: wrong usage.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { QuestionSplit } from "@/contracts/searchTestSet";
import {
  buildReport,
  compareReports,
  formatLineErrors,
  formatReport,
  parseQuestions,
  parseReport,
  PROVIDERS_FILE,
  providerIdsOf,
  QUESTIONS_FILE,
  reportFileName,
  runQuestions,
  torontoDate,
  uncheckedQuestions,
  type LocatedQuestion,
  type SearchEngine,
} from "./lib";

const USAGE = `usage: search-test-set validate [--require-checked]
       search-test-set run --engine <module> --release <n> --model <name> --threshold <x> --translated-leg on|off [--split tuning|evaluation|all --final] [--date YYYY-MM-DD] [--out-dir <dir>] [--force]
       search-test-set run --engine production --model <name> --translated-leg off|on|both --yes|--plan-only [--release <n>] [--max-calls <n>] [--scores] [--summary-file <path>] [--date YYYY-MM-DD] [--out-dir <dir>] [--force]
       search-test-set --compare <report a> <report b> [--fail-on-worse]`;

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

/** The questions of the real set, or the lines that explain why they are not valid; `sha256` is of the file. */
export function loadQuestions(root: string): { questions: LocatedQuestion[]; errors: string[]; sha256: string } {
  const ids = providerIdsOf(readFileSync(path.join(root, PROVIDERS_FILE), "utf8"));
  const bytes = readFileSync(path.join(root, QUESTIONS_FILE));
  const { questions, errors } = parseQuestions(bytes.toString("utf8"), ids);
  return { questions, errors: formatLineErrors(errors), sha256: createHash("sha256").update(bytes).digest("hex") };
}

function warnUnchecked(unchecked: readonly { id: string }[], out: (line: string) => void) {
  if (unchecked.length > 0) {
    out(`WARNING: ${unchecked.length} question(s) not yet checked by a second team member: ${unchecked.map((q) => q.id).join(", ")}`);
  }
}

function validate(argv: string[], root: string): number {
  const { questions, errors } = loadQuestions(root);
  if (errors.length > 0) {
    for (const line of errors) console.error(line);
    console.error(`${errors.length} problem(s) in ${QUESTIONS_FILE}`);
    return 1;
  }
  const unchecked = uncheckedQuestions(questions);
  console.log(`${QUESTIONS_FILE}: ${questions.length} questions, all valid`);
  if (unchecked.length > 0) {
    const where = unchecked.map((q) => q.id).join(", ");
    console.log(`${unchecked.length} not yet checked by a second team member: ${where}`);
    if (argv.includes("--require-checked")) return 1;
  }
  return 0;
}

async function loadEngine(modulePath: string, options: { translatedLeg: boolean }): Promise<SearchEngine> {
  const loaded = (await import(pathToFileURL(path.resolve(modulePath)).href)) as { default?: unknown; createEngine?: (options: { translatedLeg: boolean }) => unknown };
  if (typeof loaded.createEngine !== "function") {
    // The report says which leg setting it was run with: an engine that cannot be told is not made to follow it.
    console.warn(
      `WARNING: --translated-leg ${options.translatedLeg ? "on" : "off"} was given, but ${modulePath} has no createEngine(): its default export is used as it is, and the report's translated_leg is only as true as that engine is configured.`,
    );
  }
  const engine = typeof loaded.createEngine === "function" ? await loaded.createEngine(options) : loaded.default;
  const isObject = typeof engine === "object" && engine !== null && typeof (engine as { search?: unknown }).search === "function";
  if (typeof engine !== "function" && !isObject) {
    throw new Error(`${modulePath} must export a search engine (a function, or an object with search()) as default, or createEngine()`);
  }
  return engine as SearchEngine;
}

async function run(argv: string[], root: string): Promise<number> {
  const enginePath = option(argv, "--engine");
  const release = option(argv, "--release");
  const model = option(argv, "--model");
  const thresholdText = option(argv, "--threshold");
  const leg = option(argv, "--translated-leg");
  const split = option(argv, "--split") ?? "tuning";
  const date = option(argv, "--date") ?? torontoDate();
  const threshold = Number(thresholdText);
  if (!enginePath || !release || !/^\d+$/.test(release) || !model || !thresholdText || !Number.isFinite(threshold) || (leg !== "on" && leg !== "off")) {
    console.error(USAGE);
    return 2;
  }
  if (!["tuning", "evaluation", "all"].includes(split) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(USAGE);
    return 2;
  }
  if (split !== "tuning" && !argv.includes("--final")) {
    console.error(`--split ${split} runs the evaluation subset, which is acceptance evidence and never used for tuning: pass --final to run it.`);
    return 2;
  }

  const { questions, errors, sha256 } = loadQuestions(root);
  if (errors.length > 0) {
    for (const line of errors) console.error(line);
    console.error("Not running: the questions file is not valid.");
    return 1;
  }
  const subsets: QuestionSplit[] = split === "all" ? ["tuning", "evaluation"] : [split as QuestionSplit];
  const outDir = path.resolve(option(argv, "--out-dir") ?? path.join(root, "data", "search-test-set", "reports"));
  const outFile = path.join(outDir, reportFileName(date, model, leg === "on", split as QuestionSplit | "all"));
  if (existsSync(outFile) && !argv.includes("--force")) {
    console.error(`${outFile} already exists; pass --force to replace it, or a different --date.`);
    return 1;
  }

  const selected = questions.filter((q) => subsets.includes(q.split));
  let results;
  try {
    results = await runQuestions(selected, await loadEngine(enginePath, { translatedLeg: leg === "on" }), { release: Number(release) });
  } catch (error) {
    console.error(`The run failed: ${(error as Error).message}`);
    return 1;
  }
  const report = buildReport(results, { date, release, model, threshold, translatedLeg: leg === "on", questionsSha256: sha256 }, subsets);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
  for (const line of formatReport(report)) console.log(line);
  if (report.unchecked_count > 0) warnUnchecked(uncheckedQuestions(selected), (line) => console.warn(line));
  console.log(`\nReport written to ${outFile}`);
  return 0;
}

function compare(argv: string[], root: string): number {
  const [a, b] = argv.slice(argv.indexOf("--compare") + 1).filter((arg) => !arg.startsWith("--"));
  if (!a || !b) {
    console.error(USAGE);
    return 2;
  }
  const resolve = (name: string) => {
    const direct = path.resolve(name);
    if (existsSync(direct)) return direct;
    const inReports = path.join(root, "data", "search-test-set", "reports", name.endsWith(".json") ? name : `${name}.json`);
    return existsSync(inReports) ? inReports : direct;
  };
  try {
    const result = compareReports(parseReport(readFileSync(resolve(a), "utf8"), a), parseReport(readFileSync(resolve(b), "utf8"), b));
    for (const line of result.lines) console.log(line);
    return argv.includes("--fail-on-worse") && result.worse.length > 0 ? 1 : 0;
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
}

export async function main(argv: string[], env: NodeJS.ProcessEnv, root: string): Promise<number> {
  if (argv.includes("--compare")) return compare(argv, root);
  if (argv[0] === "validate") return validate(argv, root);
  if (argv[0] === "run" && option(argv, "--engine") === "production") {
    // The real search use case, built from the environment: loaded only when asked for (it pulls in the whole directory module).
    const { runProduction } = await import("./production");
    const { makeProductionEngine, readCohereCallsThisMonth } = await import("./productionEngine");
    return runProduction(argv, env, root, { loadQuestions, makeEngine: makeProductionEngine, monthCalls: readCohereCallsThisMonth, usage: USAGE });
  }
  if (argv[0] === "run") return run(argv, root);
  console.error(USAGE);
  return 2;
}
