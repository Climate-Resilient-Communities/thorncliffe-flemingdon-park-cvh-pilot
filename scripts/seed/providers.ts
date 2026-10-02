// Seed of the provider catalogue (S02.04). Run through scripts/seed/providers.mjs:
//
//   SEED_DATABASE_URL=postgres://... npm run seed:providers -- [--yes] [--dir <catalogue folder>]
//   npm run seed:providers -- --dry-run [--dir <catalogue folder>]
//
// SEED_DATABASE_URL is required, with no fallback to MIGRATE_DATABASE_URL, and must not be the transaction
// pooler (port 6543). The target host and database are printed before writing; a host other than
// localhost needs --yes, otherwise nothing is written and the exit code is 1. The dry run never
// touches a database.
//
// Reads data/catalogue/providers.json and translations/{lang}.json and upserts provider,
// provider_location, category and provider_category keyed by provider id. Running it twice changes
// nothing; a provider that left providers.json is unpublished and flagged "not in catalogue",
// never deleted. A translation that is not reviewed and current is not loaded (the text shows in
// English with translation.unavailable); the report counts them.
//
// Exit code 0: the catalogue was loaded (or, with --dry-run, would load).
// Exit code 1: the file failed its schema, so nothing was loaded and every failing entry is listed;
// or the run failed.
import path from "node:path";
import { createDb } from "@/platform/db";
import { announceSeedTarget } from "./target";
import {
  formatProviderFailures,
  formatProviderReport,
  planProviders,
  ProviderSeedRefusedError,
  readProviderCatalogue,
  seedProviders,
} from "@/modules/directory";

export async function main(argv: string[], env: NodeJS.ProcessEnv, root: string): Promise<number> {
  const dirIndex = argv.indexOf("--dir");
  const dir = dirIndex >= 0 ? path.resolve(argv[dirIndex + 1] ?? "") : path.join(root, "data", "catalogue");
  const input = readProviderCatalogue(dir);

  if (argv.includes("--dry-run")) {
    const plan = planProviders(input);
    if (plan.failures.length > 0) {
      for (const line of formatProviderFailures(plan.failures)) console.error(line);
      return 1;
    }
    for (const line of formatProviderReport(plan.report)) console.log(line);
    return 0;
  }

  const url = announceSeedTarget(argv, env);
  if (!url) return 1;
  const db = createDb(url);
  try {
    const result = await seedProviders(db, input);
    for (const line of formatProviderReport(result.report)) console.log(line);
    const { changed, removed } = result;
    console.log(
      `Rows changed: ${changed.providers} providers, ${changed.locations} locations, ${changed.categories} categories, ${changed.categoryLinks} category links`,
    );
    console.log(`Providers no longer in the catalogue: ${removed.flagged} flagged, ${removed.unpublished} unpublished`);
    return 0;
  } catch (error) {
    if (error instanceof ProviderSeedRefusedError) {
      for (const line of formatProviderFailures(error.failures)) console.error(line);
      return 1;
    }
    throw error;
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}
