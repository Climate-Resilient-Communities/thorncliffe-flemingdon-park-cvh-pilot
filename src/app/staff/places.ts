// Composition root of the places module for the staff surface (AD-2): the app's database connection
// (cvh_app_login) and the ports places may not wire itself: the audit trail (places has no edge to
// audit in the spine's dependency diagram) and the Ambassadors assigned to a floor. Server only.
import { record, recordRefusal, type AuditEvent } from "@/modules/audit";
import { NO_ASSIGNMENTS, createBuildingService, type BuildingService, type FloorAssignments, type PlacesAudit } from "@/modules/places";
import { getDb } from "@/platform/db";

let service: BuildingService | undefined;

/** The audit module's writers, which validate each event's `meta` strictly (src/modules/audit/domain/actions.ts). */
const audit: PlacesAudit = {
  record: (tx, event) => record(tx, event as AuditEvent),
  recordRefusal: (db, event) => recordRefusal(db, event as AuditEvent),
};

/**
 * Who is assigned to a floor. Until S01.14 creates `ambassador_assignment` nobody is, so a floor can
 * always be removed. S01.14 replaces this with identity's reader of the assignments that name the floor.
 */
// S01.14 MUST replace NO_ASSIGNMENTS here with the real reader in the same change that creates
// `ambassador_assignment`: while this stays, the removal guard sees nobody and a floor with Ambassadors
// assigned can be removed. src/app/staff/places.test.ts fails once that migration exists and this still
// names NO_ASSIGNMENTS.
const assignments: FloorAssignments = NO_ASSIGNMENTS;

/** The building and floor use cases (S01.13). */
export function buildings(): BuildingService {
  return (service ??= createBuildingService({ db: getDb(), audit, assignments }));
}

/** Test seam: forget the composition. */
export function resetPlacesComposition(): void {
  service = undefined;
}
