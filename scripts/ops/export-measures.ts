// scripts/export-measures (S09.05, FR-M1 to FR-M5, D-8, NFR-N9, AD-4): an Admin writes the pilot measures for the week-8 go / no-go review, daily and for the
// review itself, as a CSV and a printable HTML page. Run it through the launcher scripts/export-measures, which bundles it with esbuild:
//
//   node --env-file=.env.production.local scripts/export-measures --edition director --out-dir <folder> [--week 2026-09-28]
//   node --env-file=.env.production.local scripts/export-measures --edition coordinator --out-dir <folder>
//
// `--edition` is required: `director` is the Admin and Director edition (with spend and cost per alert), `coordinator` the Coordinator edition (without them),
// as the role policy says who sees spend (AD-4, `spend.view`: the script refuses an edition the policy no longer matches). `--week` is the Monday (Toronto) of
// the week read for installs, directory, map and search use (default: the last complete week). `--out-dir` is where the two files go, and is required too,
// so the Admin and Director edition never lands in the repository's working tree by a run that forgot it: `pilot-measures-{day}-{edition}.csv` and `.html`,
// the day being today in Toronto. `--rehearsals` and `--survey` name the two files it reads
// (default: docs/procedures/rehearsals.md and docs/procedures/survey-results.csv in this repository): the alerts sent for a rehearsal, left out of the
// measures, and the translation-understood survey.
//
// It reads in one read-only snapshot over the app's own database connection (DATABASE_URL, as cvh_app_login) and changes nothing. Every count of 1 to 4 reads
// "fewer than 5" (E09's small-number rule, with the percentages and the second hidden cell), drills are apart, and the files hold no phone number, subscriber id
// or message body: no reading selects one, and only the lines' own columns are written (src/modules/ops/domain/measureExport.ts). The procedure is
// docs/procedures/export-measures.md.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { StaffRole } from "../../src/contracts/staffRoles";
import { can, createAssignments, floorCoverage } from "../../src/modules/identity";
import {
  MEASURE_EDITIONS,
  MeasureFileError,
  editionHasSpend,
  isWeekStart,
  parseRehearsalAlerts,
  parseSurvey,
  pilotMeasuresExport,
  type CoverageInput,
  type MeasureEdition,
  type MeasurePorts,
} from "../../src/modules/ops";
import { floorsOfBuilding, listBuildings, neighbourhoodIds } from "../../src/modules/places";
import { readAlertCost, readCohereShare, readSpendOverview } from "../../src/modules/spend";
import { readSubscriberMeasures } from "../../src/modules/subscriptions";
import { EnvError, parseEnv, type Env } from "../../src/platform/config/env";
import { createDb, type Db, type DbExecutor } from "../../src/platform/db";

export interface Connection {
  db: Db;
  close: () => Promise<void>;
}

export interface CliDeps {
  env: Record<string, string | undefined>;
  now: () => Date;
  out: (line: string) => void;
  error: (line: string) => void;
  /** The repository's root, where the default files are read from. */
  root: string;
  /** Test seam: reads a file (default `fs.readFileSync` as UTF-8). */
  read?: (file: string) => string;
  /** Test seam: writes a file (default `fs.writeFileSync`, making the folder). */
  write?: (file: string, content: string) => void;
  /** Test seam: the database (a test database in tests). */
  connect?: (databaseUrl: string) => Connection;
}

const USAGE =
  "Usage: node --env-file=<production env file> scripts/export-measures --edition director|coordinator --out-dir <folder> [--week <Monday, YYYY-MM-DD>]\n" +
  "       [--rehearsals <rehearsals.md>] [--survey <survey-results.csv>]\n\n" +
  "Writes the pilot measures (PRD section 9) as of today in Toronto, as pilot-measures-{day}-{edition}.csv and .html. director: the Admin and Director\n" +
  "edition, with spend and cost per alert; coordinator: without them. The small-number rule is applied (a count of 1 to 4 reads \"fewer than 5\"), drills\n" +
  "are apart, the alerts listed in docs/procedures/rehearsals.md are left out, and the files hold no phone number, subscriber id or message body.";

/** Every alert entry: the cost report's list is the latest N, and the export wants them all; and every month of the vendor's use. */
const ALL_ENTRIES = 100_000;
const ALL_MONTHS = 120;

function connectTo(databaseUrl: string): Connection {
  const db = createDb(databaseUrl, { max: 1 });
  return { db, close: () => db.$client.end({ timeout: 5 }) };
}

const isEdition = (value: string): value is MeasureEdition => (MEASURE_EDITIONS as readonly string[]).includes(value);

/**
 * The edition's readers, by the role policy (AD-4): an edition is named after the role it is for, which must see counts and coverage (`coverage.view`), and has
 * spend exactly when that role sees spend (`spend.view`). A change of the policy that breaks either makes the script refuse rather than write the wrong edition.
 */
export function editionMatchesPolicy(edition: MeasureEdition): boolean {
  const role: StaffRole = edition;
  return can(role, "coverage.view") && can(role, "spend.view") === editionHasSpend(edition);
}

/**
 * Coverage by neighbourhood (the E5 coverage view's measure), by identity's rule (`floorCoverage` over the assignments that count now: an active Ambassador's,
 * the one coverage test, AD-12) on places' buildings and floors, read through the snapshot's executor. A neighbourhood with no building is counted as 0.
 */
export async function coverageByNeighbourhood(db: Db, executor: DbExecutor): Promise<CoverageInput[]> {
  const assignments = await createAssignments({ db, floors: { floorsOf: floorsOfBuilding } }).allAssignments(executor);
  const totals = new Map<string, CoverageInput>();
  for (const nbhd of await neighbourhoodIds(executor)) totals.set(nbhd, { nbhd, name: nbhd, buildings: 0, buildingsCovered: 0, buildingsFullyCovered: 0, floors: 0, floorsCovered: 0 });
  for (const building of await listBuildings(executor)) {
    const floors = (await floorsOfBuilding(executor, building.rsn)) ?? [];
    const covering = assignments.filter((assignment) => assignment.rsn === building.rsn && assignment.covering);
    const covered = floorCoverage(floors, covering).filter((floor) => floor.covered).length;
    const sum = totals.get(building.neighbourhoodId) ?? { nbhd: building.neighbourhoodId, name: building.neighbourhoodId, buildings: 0, buildingsCovered: 0, buildingsFullyCovered: 0, floors: 0, floorsCovered: 0 };
    totals.set(building.neighbourhoodId, {
      ...sum,
      buildings: sum.buildings + 1,
      buildingsCovered: sum.buildingsCovered + (covered > 0 ? 1 : 0),
      buildingsFullyCovered: sum.buildingsFullyCovered + (floors.length > 0 && covered === floors.length ? 1 : 0),
      floors: sum.floors + floors.length,
      floorsCovered: sum.floorsCovered + covered,
    });
  }
  return [...totals.values()];
}

/** The ports of the measures ops may not read itself, on this connection (AD-2: the script is a composition root). */
export function measurePorts(db: Db, env: Pick<Env, "spendPilotBudgetCents" | "spendTokenEstimateCadPerMillion">): MeasurePorts {
  return {
    subscribers: (executor) => readSubscriberMeasures(executor),
    alertCost: async (executor) => {
      const report = await readAlertCost(executor, ALL_ENTRIES);
      return { real: report.real, drills: report.drills, cohere: await readCohereShare(executor, ALL_MONTHS) };
    },
    spend: (executor, now) => readSpendOverview(executor, { now, budgetCents: env.spendPilotBudgetCents, cohereEstimateCadPerMillionTokens: env.spendTokenEstimateCadPerMillion }),
    coverage: (executor) => coverageByNeighbourhood(db, executor),
  };
}

export async function runExportMeasures(argv: string[], deps: CliDeps): Promise<number> {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { edition: { type: "string" }, week: { type: "string" }, "out-dir": { type: "string" }, rehearsals: { type: "string" }, survey: { type: "string" } },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    deps.error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 2;
  }
  const edition = typeof values.edition === "string" ? values.edition : "";
  if (!isEdition(edition)) {
    deps.error(`--edition is required: director (the Admin and Director edition, with spend) or coordinator (without spend)\n${USAGE}`);
    return 2;
  }
  const outDir = typeof values["out-dir"] === "string" ? values["out-dir"].trim() : "";
  if (outDir === "") {
    deps.error(`--out-dir is required: the folder the two files go to (for the director edition, one only Admins and Directors can open)\n${USAGE}`);
    return 2;
  }
  if (!editionMatchesPolicy(edition)) {
    deps.error(`Refusing to run: the role policy no longer matches the ${edition} edition (who sees counts and spend, AD-4). The script must change with it.`);
    return 1;
  }
  const week = typeof values.week === "string" ? values.week : undefined;
  if (week !== undefined && !isWeekStart(week)) {
    deps.error(`--week must be a Monday written YYYY-MM-DD, not "${week.slice(0, 20)}"\n${USAGE}`);
    return 2;
  }
  let env: Env;
  try {
    env = parseEnv(deps.env);
  } catch (error) {
    if (!(error instanceof EnvError)) throw error;
    deps.error(`Refusing to run: the environment is not valid:\n${error.problems.map((problem) => `  ${problem}`).join("\n")}`);
    return 1;
  }
  if (env.databaseUrl === undefined || env.databaseUrl === "") {
    deps.error("Refusing to run: DATABASE_URL is not set (use --env-file with the environment's file).");
    return 1;
  }

  const read = deps.read ?? ((file: string) => readFileSync(file, "utf8"));
  const rehearsalsFile = typeof values.rehearsals === "string" ? values.rehearsals : path.join(deps.root, "docs", "procedures", "rehearsals.md");
  const surveyFile = typeof values.survey === "string" ? values.survey : path.join(deps.root, "docs", "procedures", "survey-results.csv");
  let rehearsalEntryIds: string[];
  let survey: ReturnType<typeof parseSurvey>;
  try {
    rehearsalEntryIds = parseRehearsalAlerts(read(rehearsalsFile));
    survey = parseSurvey(read(surveyFile));
  } catch (error) {
    if (error instanceof MeasureFileError) {
      deps.error(`Refusing to run: ${error.file === "rehearsals" ? rehearsalsFile : surveyFile}, ${error.message}. Correct the file and run it again.`);
      return 1;
    }
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      deps.error(`Refusing to run: cannot read ${String((error as NodeJS.ErrnoException).path ?? "a file")}.`);
      return 1;
    }
    throw error;
  }

  const connection = (deps.connect ?? connectTo)(env.databaseUrl);
  try {
    const now = deps.now();
    const files = await pilotMeasuresExport(connection.db, { now, edition, week, rehearsalEntryIds, survey }, measurePorts(connection.db, env));
    const base = path.join(outDir, `pilot-measures-${files.asOf}-${edition}`);
    const write =
      deps.write ??
      ((file: string, content: string) => {
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, content, "utf8");
      });
    write(`${base}.csv`, files.csv);
    write(`${base}.html`, files.html);
    deps.out(`Wrote ${base}.csv and ${base}.html: the pilot measures as of ${files.asOf} (Toronto), ${files.lines.length} lines, ${edition === "director" ? "the Admin and Director edition" : "the Coordinator edition"}.`);
    deps.out(
      `Left out: ${files.leftOut.alertIds.size} alert${files.leftOut.alertIds.size === 1 ? "" : "s"} sent for a rehearsal (${files.leftOut.listed} listed in the rehearsal log, ${files.leftOut.notFound} not found).`,
    );
    if (edition === "director") deps.out("This edition has spend and cost per alert: share it only with Admins and Directors (AD-4).");
    return 0;
  } finally {
    await connection.close();
  }
}

/** Entry point used by the launcher, scripts/export-measures. */
export function main(argv: string[], root: string): Promise<number> {
  return runExportMeasures(argv, {
    env: process.env,
    now: () => new Date(),
    out: (line) => console.log(line),
    error: (line) => console.error(line),
    root,
  });
}
