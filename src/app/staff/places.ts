// Composition root of the places module for the staff surface (AD-2): the app's database connection
// (cvh_app_login) and the ports places may not wire itself: the audit trail (places has no edge to
// audit in the spine's dependency diagram) and the Ambassadors assigned to a floor. S08.06: the round
// types an Admin changes on the coverage page, audited the same way. Server only.
import { record, recordRefusal, type AuditEvent } from "@/modules/audit";
import { createBuildingService, createRoundTypes, type BuildingService, type FloorAssignments, type PlacesAudit, type RoundTypesService } from "@/modules/places";
import { getDb } from "@/platform/db";
import { assignments } from "./assignments";

let service: BuildingService | undefined;
let rounds: RoundTypesService | undefined;

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

/** S08.06: which types of disruption start a check-in round, and an Admin's change of them. */
export function roundTypes(): RoundTypesService {
  return (rounds ??= createRoundTypes({ db: getDb(), audit }));
}

/** Operational error log of the places screens (structured, no personal data): the event and the error's name. */
export function logPlacesError(event: string, fields: Record<string, string>): void {
  console.error(JSON.stringify({ evt: event, module: "places", ...fields }));
}

/** Test seam: forget the composition. */
export function resetPlacesComposition(): void {
  service = undefined;
  rounds = undefined;
}
