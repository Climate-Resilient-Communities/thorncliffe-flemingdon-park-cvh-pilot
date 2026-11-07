// Seed of the Hub and partner space's dummy data (the product owner's decision of 2026-11-07). Run through scripts/seed/partners.mjs:
//
//   SEED_DATABASE_URL=postgres://... npm run dummy:partners -- [--file <seed.json>] [--reset] [--dry-run] [--yes]
//
// Not a `seed:*` script on purpose: the production seed workflow (.github/workflows, test/seed-production-workflow.test.ts) offers every
// `seed:*` script, and dummy data must never reach production by that route. It reaches production only through
// .github/workflows/demo-data-production.yml, run on purpose by the owner (the product owner's decision of 2026-11-07).
//
// Reads data/partners/seed.json (every person fictional, every number a 555 number, every address at example.org) and loads it in one
// transaction (src/modules/partners/application/seedPartners.ts). A space already in the database keeps the status, purpose, capacities and
// confirmation staff gave it; --reset puts every space back to the file's. SEED_DATABASE_URL is required, with no fallback to
// MIGRATE_DATABASE_URL (scripts/seed/target.ts): the target is printed before anything is written, and a host other than this machine needs --yes.
// --dry-run checks the file and never connects.
//
// Exit code 0: loaded (or, with --dry-run, the file is usable). Exit code 1: the file is not usable (every problem is listed), the target was
// refused, or the run failed; nothing was changed.
import { readFileSync } from "node:fs";
import path from "node:path";
import { parsePartnerSeed, seedPartners } from "@/modules/partners";
import { createDb } from "@/platform/db";
import { announceSeedTarget } from "./target";

export async function main(argv: string[], env: NodeJS.ProcessEnv, root: string): Promise<number> {
  const at = argv.indexOf("--file");
  const file = at >= 0 ? path.resolve(argv[at + 1] ?? "") : path.join(root, "data", "partners", "seed.json");
  let data;
  try {
    data = parsePartnerSeed(JSON.parse(readFileSync(file, "utf8")));
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
  console.log(`${path.relative(root, file)}: ${data.orgs.length} organisations, ${data.spaces.length} spaces, ${data.statements.length} statements, ${data.commitments.length} standing commitments`);
  if (argv.includes("--dry-run")) return 0;

  const url = announceSeedTarget(argv, env);
  if (!url) return 1;
  const db = createDb(url);
  try {
    const result = await seedPartners(db, data, { resetStatus: argv.includes("--reset") });
    console.log(`Organisations: ${result.orgs}`);
    console.log(`Spaces: ${result.spaces.added} added, ${result.spaces.kept} kept as staff left them, ${result.spaces.reset} reset to the file`);
    console.log(`Records: ${Object.entries(result.records).map(([what, n]) => `${n} ${what}`).join(", ")}`);
    return 0;
  } catch (error) {
    const cause = (error as Error & { cause?: Error }).cause;
    console.error(`The seed failed and nothing was changed: ${(error as Error).message}${cause ? `\n${cause.message}` : ""}`);
    return 1;
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}
