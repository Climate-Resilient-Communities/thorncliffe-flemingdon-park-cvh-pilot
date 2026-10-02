// Seed of the pilot's 43 buildings and their floors (S01.13, AD-25). Run through scripts/seed/buildings.mjs (this file is what it bundles):
//
//   SEED_DATABASE_URL=postgres://... npm run seed:buildings [-- --file <register.geojson>] [-- --merge <building-merge.csv>] [-- --dry-run] [-- --yes]
//
// SEED_DATABASE_URL is required, with no fallback to MIGRATE_DATABASE_URL: a seed must never reach a database by
// accident (scripts/seed/target.ts). It must be a session-mode connection (not the transaction pooler, port 6543).
// The target host and database are printed before anything is written. A host other than localhost, 127.0.0.1 or
// ::1 is refused unless --yes is passed. --dry-run never connects.
//
// Reads data/seed/apartment_building_reg.geojson, keeps the rows whose postal area is M4H (Thorncliffe
// Park, 32 buildings) or M3C (Flemingdon Park, 11), and upserts them by rsn with their address,
// coordinates, neighbourhood and D4-P facts. Floors 1 to N (N = CONFIRMED_STOREYS) are created, unconfirmed,
// only for a building seen for the first time; a re-run updates facts and never touches floors. A building
// the register no longer lists is flagged "not in latest register" and kept. data/seed/building-merge.csv
// (optional) maps registrations that are one building to a primary rsn.
//
// Exit code 0: loaded (warnings are listed in the report). Exit code 1: refused, with nothing changed, because the URL is
// missing, unusable or remote without --yes,
// or a row failed validation (the report lists every failing row), or the run failed.
// --dry-run reads only the files, never the database: the same report, as "would load".
import path from "node:path";
import { record, recordRefusal } from "@/modules/audit";
import {
  BuildingImportRefusedError,
  formatImportReport,
  importBuildings,
  planBuildingImport,
  readMergeFile,
  readRegisterFile,
  type PlacesAuditEvent,
} from "@/modules/places";
import { createDb } from "@/platform/db";
import { announceSeedTarget } from "./target";
import type { AuditEvent } from "@/modules/audit";

const option = (argv: string[], name: string) => {
  const at = argv.indexOf(name);
  return at >= 0 ? path.resolve(argv[at + 1] ?? "") : null;
};

/** The report on stdout, except the failing rows, which go to stderr with the line that counts them. */
function print(lines: string[]): void {
  let failing = false;
  for (const line of lines) {
    failing ||= line.startsWith("Failures (");
    (failing ? console.error : console.log)(line);
  }
}

export async function main(argv: string[], env: NodeJS.ProcessEnv, root: string): Promise<number> {
  const file = option(argv, "--file") ?? path.join(root, "data", "seed", "apartment_building_reg.geojson");
  const mergeFile = option(argv, "--merge") ?? path.join(root, "data", "seed", "building-merge.csv");
  const features = readRegisterFile(file);
  const merges = readMergeFile(mergeFile);
  const plan = planBuildingImport(features, merges.entries);
  plan.failures.unshift(...merges.failures);

  if (argv.includes("--dry-run")) {
    print(formatImportReport(plan));
    return plan.failures.length > 0 ? 1 : 0;
  }

  const url = announceSeedTarget(argv, env);
  if (!url) return 1;
  const db = createDb(url);
  try {
    // The audit module validates each event's meta strictly (src/modules/audit/domain/actions.ts).
    const audit = {
      record: (tx: Parameters<typeof record>[0], event: PlacesAuditEvent) => record(tx, event as AuditEvent),
      recordRefusal: (target: Parameters<typeof recordRefusal>[0], event: PlacesAuditEvent) => recordRefusal(target, event as AuditEvent),
    };
    const result = await importBuildings(db, plan, { audit });
    print(formatImportReport(plan, { counts: { ...result.counts }, warnings: result.warnings }));
    return 0;
  } catch (error) {
    if (error instanceof BuildingImportRefusedError) {
      print(formatImportReport(plan));
      console.error("Nothing was changed.");
      return 1;
    }
    throw error;
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}
