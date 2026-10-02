// Seed of the guides and essential numbers (S02.09). Run through scripts/seed/guides.mjs:
//
//   SEED_DATABASE_URL=postgres://... npm run seed:guides -- [--yes] [--dir <catalogue folder>] [--dry-run]
//   npm run seed:guides -- --launch-check [--dir <catalogue folder>]
//
// SEED_DATABASE_URL is required, with no fallback to MIGRATE_DATABASE_URL, and must not be the transaction
// pooler (port 6543). The target host and database are printed before writing; a host other than
// localhost needs --yes, otherwise nothing is written and the exit code is 1.
//
// Exit code 0: everything in the files was loaded (translations that are stale or not reviewed
// are listed in the report, and show in English with translation.unavailable).
// --launch-check reads only the files, never the database: exit 0 only when every launch language has a
// reviewed, current translation of every 911 text; otherwise it lists each language x 911 key missing one.
// Exit code 1: a guide or the numbers list was refused (the rest was loaded), or the whole run
// was refused (a 911 rule), or the run failed.
import path from "node:path";
import { createDb } from "@/platform/db";
import { announceSeedTarget } from "./target";
import {
  checkGuidesLaunch,
  formatLaunchGaps,
  formatSeedReport,
  planGuidesAndNumbers,
  readContentCatalogue,
  SeedRefusedError,
  seedGuidesAndNumbers,
} from "@/modules/directory";

export async function main(argv: string[], env: NodeJS.ProcessEnv, root: string): Promise<number> {
  const dirIndex = argv.indexOf("--dir");
  const dir = dirIndex >= 0 ? path.resolve(argv[dirIndex + 1] ?? "") : path.join(root, "data", "catalogue");
  const dryRun = argv.includes("--dry-run");
  const input = readContentCatalogue(dir);

  if (argv.includes("--launch-check")) {
    const gaps = checkGuidesLaunch(input);
    for (const line of formatLaunchGaps(gaps)) (gaps.length > 0 ? console.error : console.log)(line);
    return gaps.length > 0 ? 1 : 0;
  }

  if (dryRun) {
    const plan = planGuidesAndNumbers(input);
    for (const line of formatSeedReport(plan.report)) console.log(line);
    for (const refusal of plan.refusals) console.error(`REFUSED RUN: ${refusal}`);
    return plan.refusals.length > 0 || plan.report.guides.some((g) => !g.loaded) || !plan.report.numbers.loaded ? 1 : 0;
  }

  const url = announceSeedTarget(argv, env);
  if (!url) return 1;
  const db = createDb(url);
  try {
    const result = await seedGuidesAndNumbers(db, input);
    for (const line of formatSeedReport(result.report)) console.log(line);
    console.log(`Rows changed: ${result.changed.guides} guides, ${result.changed.numbers} numbers`);
    console.log(`Rows removed (no longer in the files): ${result.removed.guides} guides, ${result.removed.numbers} numbers`);
    return result.partial ? 1 : 0;
  } catch (error) {
    if (error instanceof SeedRefusedError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}
