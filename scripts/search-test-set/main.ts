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
//   import <file.csv> [--dry-run] [--skip-refused]
//                                  S03.08: reads the ambassadors' sheet (data/search-test-set/template.csv filled in, saved as CSV
//                                  UTF-8; an .xlsx is refused with that advice) and appends its rows to questions.jsonl, each
//                                  numbered {lang}-{nn} when its id is empty, then assigns the new questions their subset (assign).
//                                  A row is refused when it fails the schema or the catalogue, repeats an id or a question, holds
//                                  personal data (phone number, email address, unit or apartment number, by pattern, any script's
//                                  digits), or has no expected provider and is not no_match; rows missing a provider are listed on
//                                  their own. Any refused row stops the import with nothing written, unless --skip-refused (the
//                                  other rows are imported). --dry-run checks and writes nothing.
//   coverage [--launch]            S03.08: the gaps against the launch coverage (each launch language 10, romanized Urdu 5,
//                                  Hinglish 3, emergency 10, no-match 10) and the evaluation subset's (4 per language, 4 emergency,
//                                  4 no-match). Prints "Launch readiness (coverage): not met" with each gap and exits 0; with
//                                  --launch (or SEARCH_TEST_SET_LAUNCH=1) a gap exits 1.
//   assign [--adopt-splits]        S03.08: assigns every question not yet in data/search-test-set/subsets.json to a subset by the
//                                  committed seed (the rule is in subsets.ts; existing ones never move) and writes the split into
//                                  questions.jsonl. --adopt-splits writes a first subsets.json from the splits questions.jsonl holds
//                                  (used once, when it was created); it refuses when subsets.json exists.
//   readiness                      S03.08: whether the latest report that ran the evaluation subset meets every minimum of the
//                                  approved launch bar (data/search-test-set/bar.json); exit 0 when met, 1 when not.
//   guard --yes | --plan-only [--checkpoint pr|pre_launch|week_4|manual] [--bar <bar.json>] [--max-calls <n>] [--summary-file <path>]
//       [--date YYYY-MM-DD] [--out-dir <dir>] [--force]
//                                S03.09: the evaluation subset through the same production search use case, against the Hub-approved
//                                launch bar (data/search-test-set/bar.json, or --bar): exit 0 when every minimum is met or no bar is set
//                                yet (nothing is called then), exit 1 naming each measure below its minimum and the drop, or when the
//                                measurement is incomplete. The usage guard (usageGuard.ts) runs before the first call. At a manual
//                                checkpoint (not `pr`) a measure below its minimum is also recorded as ops event `search.below_bar`.
//                                Usage, rules and outputs: guard.ts.
//   --compare <a> <b> [--fail-on-worse]
//                                  per-language and per-language/form differences between two reports
//                                  (paths, or file names in the reports folder); a language or subset
//                                  missing from b counts as worse; warns when a and b ran different
//                                  questions. --fail-on-worse exits 1 when anything dropped.
//
// validate also checks that questions.jsonl's split fields agree with data/search-test-set/subsets.json.
//
// Exit code 0: done. Exit code 1: the set failed validation, something got worse with
// --fail-on-worse, or the run could not finish (the engine's answer is not a SearchV1 body, or its
// release is not --release or changes during the run). Exit code 2: wrong usage.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { QuestionSplit, TestQuestion } from "@/contracts/searchTestSet";
import type { SubsetsFile } from "@/contracts/searchTestSetLaunch";
import { launchReadiness } from "./bar";
import { importRows, parseCsv, questionLine } from "./importSheet";
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
import { assignSubsets, checkCoverage, checkSubsets, DEFAULT_SEED, formatCoverage, readSubsets, subsetsJson, SUBSETS_FILE } from "./subsets";

const USAGE = `usage: search-test-set validate [--require-checked]
       search-test-set run --engine <module> --release <n> --model <name> --threshold <x> --translated-leg on|off [--split tuning|evaluation|all --final] [--date YYYY-MM-DD] [--out-dir <dir>] [--force]
       search-test-set run --engine production --model <name> --translated-leg off|on|both --yes|--plan-only [--release <n>] [--max-calls <n>] [--scores] [--summary-file <path>] [--date YYYY-MM-DD] [--out-dir <dir>] [--force]
       search-test-set import <sheet.csv> [--dry-run] [--skip-refused]
       search-test-set coverage [--launch]
       search-test-set assign [--adopt-splits]
       search-test-set readiness
       search-test-set guard --yes|--plan-only [--checkpoint pr|pre_launch|week_4|manual] [--bar <bar.json>] [--max-calls <n>] [--summary-file <path>] [--date YYYY-MM-DD] [--out-dir <dir>] [--force]
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

/** Writes subsets.json and the split of every question whose split it changes into questions.jsonl, leaving every other line as it is. */
function writeAssignment(root: string, file: SubsetsFile) {
  const evaluation = new Set(file.evaluation);
  const questionsPath = path.join(root, QUESTIONS_FILE);
  const lines = readFileSync(questionsPath, "utf8").split("\n");
  const rewritten = lines.map((raw) => {
    if (raw.trim() === "") return raw;
    const question = JSON.parse(raw) as TestQuestion;
    const split: QuestionSplit = evaluation.has(question.id) ? "evaluation" : "tuning";
    return question.split === split ? raw : questionLine({ ...question, split });
  });
  writeFileSync(questionsPath, rewritten.join("\n"));
  writeFileSync(path.join(root, SUBSETS_FILE), subsetsJson(file));
}

function assign(argv: string[], root: string): number {
  const { questions, errors } = loadQuestions(root);
  if (errors.length > 0) {
    for (const line of errors) console.error(line);
    console.error("Not assigning: the questions file is not valid.");
    return 1;
  }
  const previous = readSubsets(root);
  if (argv.includes("--adopt-splits")) {
    if (previous) {
      console.error(`${SUBSETS_FILE} already exists: --adopt-splits only writes the first one.`);
      return 1;
    }
    const adopted = assignSubsets(questions, { seed: DEFAULT_SEED, evaluation: questions.filter((q) => q.split === "evaluation").map((q) => q.id), tuning: questions.filter((q) => q.split === "tuning").map((q) => q.id) });
    writeAssignment(root, adopted.file);
    console.log(`${SUBSETS_FILE} written from the splits in ${QUESTIONS_FILE}: ${adopted.file.evaluation.length} evaluation, ${adopted.file.tuning.length} tuning.`);
    return 0;
  }
  const result = assignSubsets(questions, previous);
  writeAssignment(root, result.file);
  console.log(`${SUBSETS_FILE} (seed ${result.file.seed}): ${result.file.evaluation.length} evaluation, ${result.file.tuning.length} tuning.`);
  console.log(`  newly in evaluation: ${result.evaluation.join(", ") || "none"}`);
  console.log(`  newly in tuning: ${result.tuning.join(", ") || "none"}`);
  if (result.removed.length > 0) console.log(`  removed (no longer in the set): ${result.removed.join(", ")}`);
  return 0;
}

function importSheet(argv: string[], root: string): number {
  const sheet = argv[1];
  if (!sheet || sheet.startsWith("--")) {
    console.error(USAGE);
    return 2;
  }
  if (/\.xlsx?$/i.test(sheet)) {
    console.error(`${sheet}: save the sheet as "CSV UTF-8 (comma delimited)" (Excel) or download it as "Comma-separated values" (Google Sheets) and import the .csv.`);
    return 2;
  }
  const { questions, errors } = loadQuestions(root);
  if (errors.length > 0) {
    for (const line of errors) console.error(line);
    console.error("Not importing: the questions file is not valid as it is.");
    return 1;
  }
  const ids = providerIdsOf(readFileSync(path.join(root, PROVIDERS_FILE), "utf8"));
  const result = importRows(parseCsv(readFileSync(path.resolve(sheet), "utf8")), questions, ids);
  if (result.sheetErrors.length > 0) {
    for (const line of result.sheetErrors) console.error(`${sheet}: ${line}`);
    return 1;
  }
  for (const refused of result.refused) for (const reason of refused.reasons) console.error(`${sheet}: row ${refused.row}: ${reason}`);
  if (result.missingExpected.length > 0) console.error(`Rows missing an expected provider: ${result.missingExpected.join(", ")}`);
  console.log(`${result.accepted.length} row(s) accepted, ${result.refused.length} refused.`);
  if (argv.includes("--dry-run")) return result.refused.length > 0 ? 1 : 0;
  if (result.refused.length > 0 && !argv.includes("--skip-refused")) {
    console.error("Nothing imported: fix the refused rows, or pass --skip-refused to import the others.");
    return 1;
  }
  if (result.accepted.length === 0) return result.refused.length > 0 ? 1 : 0;
  const questionsPath = path.join(root, QUESTIONS_FILE);
  const text = readFileSync(questionsPath, "utf8");
  const lines = result.accepted.map((q) => questionLine({ ...q, split: "tuning" }));
  appendFileSync(questionsPath, `${text === "" || text.endsWith("\n") ? "" : "\n"}${lines.join("\n")}\n`);
  console.log(`${result.accepted.length} question(s) added to ${QUESTIONS_FILE}: ${result.accepted.map((q) => q.id).join(", ")}`);
  const status = assign(["assign"], root);
  return status !== 0 ? status : result.refused.length > 0 ? 1 : 0;
}

function coverage(argv: string[], env: NodeJS.ProcessEnv, root: string): number {
  const { questions, errors } = loadQuestions(root);
  if (errors.length > 0) {
    for (const line of errors) console.error(line);
    return 1;
  }
  const result = checkCoverage(questions);
  for (const line of formatCoverage(result)) console.log(line);
  const launch = argv.includes("--launch") || env.SEARCH_TEST_SET_LAUNCH === "1";
  return launch && (result.gaps.length > 0 || result.evaluationGaps.length > 0) ? 1 : 0;
}

function readiness(root: string): number {
  const result = launchReadiness(root);
  for (const line of result.lines) console.log(line);
  return result.met ? 0 : 1;
}

function validate(argv: string[], root: string): number {
  const { questions, errors: lineErrors } = loadQuestions(root);
  const errors = [...lineErrors];
  if (lineErrors.length === 0) {
    try {
      const subsets = readSubsets(root);
      if (subsets) errors.push(...checkSubsets(questions, subsets));
    } catch (error) {
      errors.push((error as Error).message);
    }
  }
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
  if (argv[0] === "import") return importSheet(argv, root);
  if (argv[0] === "coverage") return coverage(argv, env, root);
  if (argv[0] === "assign") return assign(argv, root);
  if (argv[0] === "readiness") return readiness(root);
  if (argv[0] === "run" && option(argv, "--engine") === "production") {
    // The real search use case, built from the environment: loaded only when asked for (it pulls in the whole directory module).
    const { runProduction } = await import("./production");
    const { makeProductionEngine, readCohereCallsThisMonth, readCohereUsageThisMonth } = await import("./productionEngine");
    return runProduction(argv, env, root, { loadQuestions, makeEngine: makeProductionEngine, monthCalls: readCohereCallsThisMonth, monthUsage: readCohereUsageThisMonth, usage: USAGE });
  }
  if (argv[0] === "guard") {
    const { runGuard } = await import("./guard");
    const { makeProductionEngine, readCohereUsageThisMonth, recordBelowBar } = await import("./productionEngine");
    return runGuard(argv, env, root, { loadQuestions, makeEngine: makeProductionEngine, monthUsage: readCohereUsageThisMonth, recordBelowBar, usage: USAGE });
  }
  if (argv[0] === "run") return run(argv, root);
  console.error(USAGE);
  return 2;
}
