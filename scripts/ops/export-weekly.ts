// scripts/export-weekly (S09.04, NFR-N4, AR-21): an Admin writes the weekly reliability review as a CSV. Run it through the launcher scripts/export-weekly,
// which bundles it with esbuild:
//
//   node --env-file=.env.production.local scripts/export-weekly [--week 2026-10-05] [--out weekly-review-2026-10-05.csv]
//
// `--week` is the Monday (Toronto) of the week, default the last complete week. `--out` is the file to write, default `weekly-review-{week}.csv` in the
// current directory. It reads the SQL view `weekly_review` over the app's own database connection (DATABASE_URL, as cvh_app_login) and changes nothing.
// The CSV has the small-number rule applied by the view (a count of 1 to 4 reads "fewer than 5") and holds no phone number, subscriber id or message
// body: the view reads none of them, and only its own columns are written (src/modules/ops/domain/weeklyReview.ts). Drills are on their own lines
// (`is_drill`). The CSV is for the weekly meeting; the notes and actions of the meeting go in docs/procedures/weekly-notes/{week}.md, written by an
// Admin by hand: there is no notes table and no endpoint that writes them.
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { isWeekStart, lastFullWeek, weeklyReviewExport } from "../../src/modules/ops";
import { createDb, type Db } from "../../src/platform/db";

export interface Connection {
  db: Db;
  close: () => Promise<void>;
}

export interface CliDeps {
  env: Record<string, string | undefined>;
  now: () => Date;
  out: (line: string) => void;
  error: (line: string) => void;
  /** Test seam: writes the file (default `fs.writeFileSync`). */
  write?: (file: string, content: string) => void;
  /** Test seam: the database (a test database in tests). */
  connect?: (databaseUrl: string) => Connection;
}

const USAGE =
  "Usage: node --env-file=<production env file> scripts/export-weekly [--week <Monday, YYYY-MM-DD>] [--out <file>]\n\n" +
  "Writes the weekly reliability review of the week (Monday 00:00 to Sunday 23:59 in Toronto; default: the last complete week) as a CSV, default\n" +
  "weekly-review-{week}.csv. The small-number rule is applied (a count of 1 to 4 reads \"fewer than 5\") and the file holds no phone number,\n" +
  "subscriber id or message body. Drills are on their own lines. The meeting's notes go in docs/procedures/weekly-notes/{week}.md.";

function connectTo(databaseUrl: string): Connection {
  const db = createDb(databaseUrl, { max: 1 });
  return { db, close: () => db.$client.end({ timeout: 5 }) };
}

export async function runExportWeekly(argv: string[], deps: CliDeps): Promise<number> {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({ args: argv, options: { week: { type: "string" }, out: { type: "string" } }, strict: true, allowPositionals: false }));
  } catch (error) {
    deps.error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 2;
  }
  const week = typeof values.week === "string" ? values.week : lastFullWeek(deps.now());
  if (!isWeekStart(week)) {
    deps.error(`--week must be a Monday written YYYY-MM-DD, not "${week.slice(0, 20)}"\n${USAGE}`);
    return 2;
  }
  const databaseUrl = deps.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === "") {
    deps.error("Refusing to run: DATABASE_URL is not set (use --env-file with the environment's file).");
    return 1;
  }
  const file = typeof values.out === "string" && values.out !== "" ? values.out : `weekly-review-${week}.csv`;

  const connection = (deps.connect ?? connectTo)(databaseUrl);
  try {
    const csv = await weeklyReviewExport(connection.db, week);
    (deps.write ?? ((path, content) => writeFileSync(path, content, "utf8")))(file, csv);
    const lines = csv.split("\r\n").length - 2;
    deps.out(`Wrote ${file}: the review of the week starting ${week}, ${lines} line${lines === 1 ? "" : "s"}.`);
    deps.out(`Notes and actions of the meeting go in docs/procedures/weekly-notes/${week}.md.`);
    return 0;
  } finally {
    await connection.close();
  }
}

/** Entry point used by the launcher, scripts/export-weekly. */
export function main(argv: string[]): Promise<number> {
  return runExportWeekly(argv, {
    env: process.env,
    now: () => new Date(),
    out: (line) => console.log(line),
    error: (line) => console.error(line),
  });
}
