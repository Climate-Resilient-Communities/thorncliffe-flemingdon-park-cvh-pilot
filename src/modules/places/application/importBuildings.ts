// The buildings seed (S01.13, AD-25): an idempotent upsert of the pilot's buildings keyed by rsn, in
// one transaction with the `seed.run` audit event. Everything is decided first (domain/register.ts);
// a plan with a failure writes nothing.
import { eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../../platform/db";
import { uuidv7 } from "../../../platform/ids";
import { building, buildingFloor, neighbourhood } from "../adapters/schema";
import { PILOT_AREAS, formatProblem, type ImportPlan, type PlanProblem, type PlannedBuilding } from "../domain/register";
import type { PlacesAudit } from "./ports";

export const BUILDINGS_SEED_CODE = "buildings";

/** The plan has failing rows: nothing was written (the refusal is audited). */
export class BuildingImportRefusedError extends Error {
  constructor(
    readonly failures: PlanProblem[],
    readonly warnings: PlanProblem[],
  ) {
    super(`Import refused, nothing changed. ${failures.length} failing row${failures.length === 1 ? "" : "s"}:\n${failures.map((failure) => `  - ${formatProblem(failure)}`).join("\n")}`);
    this.name = "BuildingImportRefusedError";
  }
}

export interface ImportDeps {
  audit: PlacesAudit;
  /** Test seams. */
  now?: () => Date;
  newId?: () => string;
}

export interface ImportCounts {
  /** Buildings the plan loads (the pilot rows, less those the merge file folds into another). */
  buildings_loaded: number;
  buildings_inserted: number;
  buildings_updated: number;
  buildings_unchanged: number;
  /** Buildings that were flagged "not in latest register" and are in it again. */
  buildings_restored: number;
  /** Buildings flagged "not in latest register" by this run. */
  buildings_flagged: number;
  /** Rows folded into another building by the merge file. */
  buildings_merged: number;
  /** Buildings loaded before that this run marked merged into another (UAT F-5): kept, and left out of every list from now on. */
  buildings_hidden: number;
  /** Merged buildings whose line left the merge file: listed again. */
  buildings_unmerged: number;
  floors_created: number;
}

export interface ImportResult {
  counts: ImportCounts;
  warnings: PlanProblem[];
  /** Every building in the database that the register no longer lists, flagged by this run or earlier. */
  notInRegister: { rsn: string; address: string; since: Date }[];
}

type BuildingRow = typeof building.$inferSelect;

const FACT_FIELDS = ["neighbourhoodId", "address", "latitude", "longitude", "storeys", "elevators", "emergencyPower", "coolingRoom", "airConditioning", "barrierFreeEntrance"] as const;

const sameFacts = (row: BuildingRow, planned: PlannedBuilding) => FACT_FIELDS.every((field) => row[field] === planned[field]);

const factsOf = (planned: PlannedBuilding) => Object.fromEntries(FACT_FIELDS.map((field) => [field, planned[field]])) as Pick<BuildingRow, (typeof FACT_FIELDS)[number]>;

/**
 * Loads the plan: the two neighbourhoods, every building by upsert, and, for a building the
 * database has not seen, its floors 1 to N from the register's storeys, unconfirmed, each with a
 * stable id. For a building it already has, the facts are updated (with their last-updated time,
 * only when one differs) and its floors are never touched: a label an Admin confirmed is never
 * overwritten, and the floor ids that assignments refer to never change. A building the register
 * no longer lists is flagged "not in latest register" (the time it was first missed) and kept.
 *
 * Throws BuildingImportRefusedError, after auditing the refusal, when the plan has a failure. A
 * database error rolls everything back.
 */
export async function importBuildings(db: Db, plan: ImportPlan, deps: ImportDeps): Promise<ImportResult> {
  const { audit } = deps;
  if (plan.failures.length > 0) {
    await audit.recordRefusal(db, {
      action: "seed.run",
      actorStaffId: null,
      subjectType: "buildings",
      subjectId: null,
      meta: { seed: BUILDINGS_SEED_CODE, warnings: plan.warnings.length, failures: plan.failures.length },
    });
    throw new BuildingImportRefusedError(plan.failures, plan.warnings);
  }

  const now = (deps.now ?? (() => new Date()))();
  const newId = deps.newId ?? (() => uuidv7());
  const warnings = [...plan.warnings];
  const counts: ImportCounts = {
    buildings_loaded: plan.buildings.length,
    buildings_inserted: 0,
    buildings_updated: 0,
    buildings_unchanged: 0,
    buildings_restored: 0,
    buildings_flagged: 0,
    buildings_merged: plan.counts.merged,
    buildings_hidden: 0,
    buildings_unmerged: 0,
    floors_created: 0,
  };
  let notInRegister: ImportResult["notInRegister"] = [];

  await db.transaction(async (tx) => {
    // One import at a time: two would each see the other's buildings as new.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('cvh.seed.buildings'))`);

    for (const area of PILOT_AREAS) {
      await tx
        .insert(neighbourhood)
        .values({ id: area.neighbourhoodId, name: area.name, fsa: area.fsa })
        .onConflictDoUpdate({
          target: neighbourhood.id,
          set: { name: sql`excluded.name`, fsa: sql`excluded.fsa` },
          setWhere: sql`(${neighbourhood.name}, ${neighbourhood.fsa}) is distinct from (excluded.name, excluded.fsa)`,
        });
    }

    const existing = new Map((await tx.select().from(building)).map((row) => [row.rsn, row]));
    const floorCounts = new Map<string, number>(
      (await tx.select({ rsn: buildingFloor.rsn, floors: sql<number>`count(*)::int` }).from(buildingFloor).groupBy(buildingFloor.rsn)).map((row) => [row.rsn, row.floors]),
    );
    const loaded = new Set(plan.buildings.map((planned) => planned.rsn));

    for (const planned of plan.buildings) {
      const row = existing.get(planned.rsn);
      if (!row) {
        await tx.insert(building).values({ rsn: planned.rsn, ...factsOf(planned), factsUpdatedAt: now });
        counts.buildings_inserted += 1;
        const floors = planned.storeys === null ? [] : Array.from({ length: planned.storeys }, (_, index) => ({ id: newId(), rsn: planned.rsn, label: String(index + 1), sortOrder: index + 1, confirmed: false }));
        if (floors.length > 0) await tx.insert(buildingFloor).values(floors);
        counts.floors_created += floors.length;
        continue;
      }
      const changed = !sameFacts(row, planned);
      const restored = row.notInRegisterSince !== null;
      // A building the merge file folded into another before, whose line is gone: it is a building of its own again, and listed.
      const unmerged = row.mergedInto !== null;
      if (changed || restored || unmerged) {
        await tx
          .update(building)
          .set({ ...(changed ? { ...factsOf(planned), factsUpdatedAt: now } : {}), notInRegisterSince: null, mergedInto: null })
          .where(eq(building.rsn, planned.rsn));
      }
      if (changed) counts.buildings_updated += 1;
      else counts.buildings_unchanged += 1;
      if (restored) counts.buildings_restored += 1;
      if (unmerged) counts.buildings_unmerged += 1;
      if (planned.storeys !== null && row.storeys !== null && planned.storeys !== row.storeys) {
        warnings.push({
          source: "database",
          row: null,
          rsn: planned.rsn,
          address: planned.address,
          message: `the register now says ${planned.storeys} storeys (it said ${row.storeys}); the floors were not changed: check them at /staff/buildings`,
        });
      } else if (planned.storeys !== null && row.storeys === null && (floorCounts.get(planned.rsn) ?? 0) === 0) {
        warnings.push({ source: "database", row: null, rsn: planned.rsn, address: planned.address, message: `the register now says ${planned.storeys} storeys and the building has no floors: add them at /staff/buildings` });
      }
    }

    // A building loaded before that the merge file now folds into another is not missing from the
    // register: it is marked merged into its primary (UAT F-5), so it leaves every building list, and it
    // is kept, with its floors, so nothing that names it breaks. It is not flagged.
    const mergedInto = new Map(plan.buildings.flatMap((planned) => planned.mergedRsns.map((rsn) => [rsn, planned.rsn] as const)));
    const absent = [...existing.values()].filter((row) => !loaded.has(row.rsn));
    for (const row of absent) {
      const primary = mergedInto.get(row.rsn);
      if (primary === undefined) continue;
      if (row.mergedInto !== primary) {
        await tx.update(building).set({ mergedInto: primary }).where(eq(building.rsn, row.rsn));
        counts.buildings_hidden += 1;
      }
      warnings.push({
        source: "merge",
        row: null,
        rsn: row.rsn,
        address: row.address,
        message: `merged into rsn ${primary} by building-merge.csv: kept with its floors and left out of every building list; an ambassador assigned to it is listed at /staff/coverage?building=${row.rsn}: assign them to rsn ${primary} instead`,
      });
    }
    const missing = absent.filter((row) => !mergedInto.has(row.rsn));
    // A building that was merged and whose line left the merge file, and that the register no longer lists either: it is listed again, flagged below.
    const unmergedMissing = missing.filter((row) => row.mergedInto !== null);
    if (unmergedMissing.length > 0) {
      await tx
        .update(building)
        .set({ mergedInto: null })
        .where(inArray(building.rsn, unmergedMissing.map((row) => row.rsn)));
      counts.buildings_unmerged += unmergedMissing.length;
    }
    const newlyMissing = missing.filter((row) => row.notInRegisterSince === null);
    if (newlyMissing.length > 0) {
      await tx
        .update(building)
        .set({ notInRegisterSince: now })
        .where(inArray(building.rsn, newlyMissing.map((row) => row.rsn)));
      counts.buildings_flagged = newlyMissing.length;
    }
    notInRegister = missing.map((row) => ({ rsn: row.rsn, address: row.address, since: row.notInRegisterSince ?? now })).sort((a, b) => a.rsn.localeCompare(b.rsn));
    for (const gone of notInRegister) {
      warnings.push({ source: "database", row: null, rsn: gone.rsn, address: gone.address, message: "not in latest register: kept, flagged for an Admin to review at /staff/buildings" });
    }

    await audit.record(tx, {
      action: "seed.run",
      actorStaffId: null,
      subjectType: "buildings",
      subjectId: null,
      meta: { seed: BUILDINGS_SEED_CODE, counts: { ...counts }, warnings: warnings.length, failures: 0 },
    });
  });

  return { counts, warnings, notInRegister };
}
