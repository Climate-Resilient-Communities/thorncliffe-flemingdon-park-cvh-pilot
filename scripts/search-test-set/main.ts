// scripts/search-test-set: the search test set's command line (S03.01). Run through
// scripts/search-test-set/index.mjs (npm run search-test-set -- ...), which bundles this file.
//
//   validate                       check data/search-test-set/questions.jsonl against the schema and the
//                                  catalogue; exit 1 with file:line for every problem. Reports (does not
//                                  fail on) questions not yet checked by a second team member;
//                                  --require-checked fails on them.
//   run --engine <module> --release <n> --model <name> --threshold <x> --translated-leg on|off
//       [--split tuning|evaluation|all] [--date YYYY-MM-DD] [--out-dir <dir>] [--force]
//                                  ask every question of the chosen subset(s) (default all) and write
//                                  data/search-test-set/reports/{date}-{model}.json. <module> is an
//                                  ES module whose default export (or `createEngine()`) is a SearchEngine,
//                                  see lib.ts. The real one will wrap the /api/search use case.
//   --compare <a> <b> [--fail-on-worse]
//                                  per-language differences between two reports (paths, or file names in
//                                  the reports folder); --fail-on-worse exits 1 when any language dropped.
//
// Exit code 0: done. Exit code 1: the set failed validation, a language got worse with
// --fail-on-worse, or the run could not finish. Exit code 2: wrong usage.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
  uncheckedQuestions,
  type LocatedQuestion,
  type SearchEngine,
} from "./lib";

const USAGE = `usage: search-test-set validate [--require-checked]
       search-test-set run --engine <module> --release <n> --model <name> --threshold <x> --translated-leg on|off [--split tuning|evaluation|all] [--date YYYY-MM-DD] [--out-dir <dir>] [--force]
       search-test-set --compare <report a> <report b> [--fail-on-worse]`;

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

/** The questions of the real set, or the lines that explain why they are not valid. */
export function loadQuestions(root: string): { questions: LocatedQuestion[]; errors: string[] } {
  const ids = providerIdsOf(readFileSync(path.join(root, PROVIDERS_FILE), "utf8"));
  const { questions, errors } = parseQuestions(readFileSync(path.join(root, QUESTIONS_FILE), "utf8"), ids);
  return { questions, errors: formatLineErrors(errors) };
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

async function loadEngine(modulePath: string): Promise<SearchEngine> {
  const loaded = (await import(pathToFileURL(path.resolve(modulePath)).href)) as { default?: unknown; createEngine?: () => unknown };
  const engine = typeof loaded.createEngine === "function" ? await loaded.createEngine() : loaded.default;
  if (typeof engine !== "function") throw new Error(`${modulePath} must export a search engine function as default (or createEngine())`);
  return engine as SearchEngine;
}

async function run(argv: string[], root: string): Promise<number> {
  const enginePath = option(argv, "--engine");
  const release = option(argv, "--release");
  const model = option(argv, "--model");
  const thresholdText = option(argv, "--threshold");
  const leg = option(argv, "--translated-leg");
  const split = option(argv, "--split") ?? "all";
  const date = option(argv, "--date") ?? new Date().toISOString().slice(0, 10);
  const threshold = Number(thresholdText);
  if (!enginePath || !release || !model || !thresholdText || !Number.isFinite(threshold) || (leg !== "on" && leg !== "off")) {
    console.error(USAGE);
    return 2;
  }
  if (!["tuning", "evaluation", "all"].includes(split) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(USAGE);
    return 2;
  }

  const { questions, errors } = loadQuestions(root);
  if (errors.length > 0) {
    for (const line of errors) console.error(line);
    console.error("Not running: the questions file is not valid.");
    return 1;
  }
  const outDir = path.resolve(option(argv, "--out-dir") ?? path.join(root, "data", "search-test-set", "reports"));
  const outFile = path.join(outDir, reportFileName(date, model));
  if (existsSync(outFile) && !argv.includes("--force")) {
    console.error(`${outFile} already exists; pass --force to replace it, or a different --date.`);
    return 1;
  }

  const subsets = split === "all" ? (["tuning", "evaluation"] as const) : ([split] as ("tuning" | "evaluation")[]);
  const selected = questions.filter((q) => subsets.includes(q.split));
  const results = await runQuestions(selected, await loadEngine(enginePath));
  const report = buildReport(results, { date, release, model, threshold, translatedLeg: leg === "on" }, subsets);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
  for (const line of formatReport(report)) console.log(line);
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

export async function main(argv: string[], _env: NodeJS.ProcessEnv, root: string): Promise<number> {
  if (argv.includes("--compare")) return compare(argv, root);
  if (argv[0] === "validate") return validate(argv, root);
  if (argv[0] === "run") return run(argv, root);
  console.error(USAGE);
  return 2;
}
