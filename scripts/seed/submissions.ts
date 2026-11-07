// Demo suggestions for the Hub's moderation queue (PRD §6.3, D9/E4). Run through scripts/seed/submissions.mjs:
//
//   SEED_DATABASE_URL=postgres://... npm run seed:submissions -- [--yes]
//
// Five made-up rows (two new places and a correction waiting, one declined as an advert, one accepted and waiting on the Providers page), so
// O-08 is not empty in a demo. Never in a migration. SEED_DATABASE_URL is required, with no fallback; a host other than this machine needs
// --yes (scripts/seed/target.ts). Running it again inserts nothing (each demo code, SEED-xxxx, is inserted once). The correction names the
// first provider the database holds, so run the provider seed first to have one.
//
// Exit code 0: seeded (or already seeded). Exit code 1: no target, or the run failed.
import { createDb } from "@/platform/db";
import { seedDemoSubmissions } from "@/modules/directory";
import { announceSeedTarget } from "./target";

export async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const url = announceSeedTarget(argv, env);
  if (!url) return 1;
  const db = createDb(url);
  try {
    const { inserted } = await seedDemoSubmissions(db);
    console.log(inserted === 0 ? "The demo suggestions are already there: nothing inserted." : `Inserted ${inserted} demo suggestions.`);
    return 0;
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}
