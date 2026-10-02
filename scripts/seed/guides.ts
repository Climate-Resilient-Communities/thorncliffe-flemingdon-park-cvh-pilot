// Seed of the guides and essential numbers (S02.09). Run through scripts/seed/guides.mjs:
//
//   SEED_DATABASE_URL=postgres://... npm run seed:guides [-- --dir <catalogue folder>] [-- --dry-run]
//
// Exit code 0: everything in the files was loaded (translations that are stale or not reviewed
// are listed in the report, and show in English with translation.unavailable).
// Exit code 1: a guide or the numbers list was refused (the rest was loaded), or the whole run
// was refused (a 911 rule), or the run failed.
import path from "node:path";
import { createDb } from "@/platform/db";
import {
  formatSeedReport,
  planSeed,
  readContentCatalogue,
  SeedRefusedError,
  seedGuidesAndNumbers,
} from "@/modules/directory";

export async function main(argv: string[], env: NodeJS.ProcessEnv, root: string): Promise<number> {
  const dirIndex = argv.indexOf("--dir");
  const dir = dirIndex >= 0 ? path.resolve(argv[dirIndex + 1] ?? "") : path.join(root, "data", "catalogue");
  const dryRun = argv.includes("--dry-run");
  const input = readContentCatalogue(dir);

  if (dryRun) {
    const plan = planSeed(input);
    for (const line of formatSeedReport(plan.report)) console.log(line);
    for (const refusal of plan.refusals) console.error(`REFUSED RUN: ${refusal}`);
    return plan.refusals.length > 0 || plan.report.guides.some((g) => !g.loaded) || !plan.report.numbers.loaded ? 1 : 0;
  }

  const url = env.SEED_DATABASE_URL ?? env.MIGRATE_DATABASE_URL;
  if (!url) {
    console.error("SEED_DATABASE_URL is not set (use the same session-mode connection as the migrations)");
    return 1;
  }
  const db = createDb(url);
  try {
    const result = await seedGuidesAndNumbers(db, input);
    for (const line of formatSeedReport(result.report)) console.log(line);
    console.log(`Rows changed: ${result.changed.guides} guides, ${result.changed.numbers} numbers`);
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
