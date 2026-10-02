// Composition root of the places module for the staff surface (AD-2): the app's database connection
// (cvh_app_login) and the ports places may not wire itself: the audit trail (places has no edge to
// audit in the spine's dependency diagram) and the Ambassadors assigned to a floor. Server only.
import { record, recordRefusal, type AuditEvent } from "@/modules/audit";
import { createBuildingService, type BuildingService, type FloorAssignments, type PlacesAudit } from "@/modules/places";
import { getDb } from "@/platform/db";
import { assignments } from "./assignments";

let service: BuildingService | undefined;

/** The audit module's writers, which validate each event's `meta` strictly (src/modules/audit/domain/actions.ts). */
const audit: PlacesAudit = {
  record: (tx, event) => record(tx, event as AuditEvent),
  recordRefusal: (db, event) => recordRefusal(db, event as AuditEvent),
};

/**
 * Who is assigned to a floor: identity's reader of the assignments that list it (S01.14). The removal
 * guard asks it inside the removal's transaction; the database refuses the delete anyway
 * (ambassador_assignment_floor's foreign key is `on delete restrict`). src/app/staff/places.test.ts
 * fails if this goes back to NO_ASSIGNMENTS.
 */
const assignedToFloors: FloorAssignments = {
  onFloor: (executor, floor) => assignments().onFloor(executor, floor),
};

/** The building and floor use cases (S01.13). */
export function buildings(): BuildingService {
  return (service ??= createBuildingService({ db: getDb(), audit, assignments: assignedToFloors }));
}

/** Test seam: forget the composition. */
export function resetPlacesComposition(): void {
  service = undefined;
}
