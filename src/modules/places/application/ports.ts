import type { Db, DbExecutor, DbTransaction } from "../../../platform/db";

/** The audit actions the places module writes (S01.13); the audit module validates each one's `meta` strictly. */
export type PlacesAuditAction = "seed.run" | "building.floor_added" | "building.floor_renamed" | "building.floor_removed" | "building.confirmed";

export interface PlacesAuditEvent {
  action: PlacesAuditAction;
  /** The Admin who acted; null for the seed script (the system). */
  actorStaffId: string | null;
  subjectType: "building" | "buildings";
  /** The building's rsn; null for a whole import or when the rsn in a request is not one. */
  subjectId: string | null;
  meta?: Record<string, unknown>;
}

/**
 * Port: the audit trail. places may not import the audit module (the spine's dependency diagram has
 * no such edge, AD-2), so the composition root (src/app/staff/places.ts, scripts/seed/buildings.ts)
 * wires the audit module's `record` and `recordRefusal` here.
 */
export interface PlacesAudit {
  /** Writes the `ok` record inside the change's own transaction, so both commit or neither does. */
  record(tx: DbTransaction, event: PlacesAuditEvent): Promise<void>;
  /** Writes the `refused` record in its own transaction, after the refused change was rolled back. Never throws. */
  recordRefusal(db: Db, event: PlacesAuditEvent): Promise<void>;
}

/** An Ambassador as the refusal to remove a floor lists them. */
export interface AssignedAmbassador {
  staffId: string;
  /** First and last name, as the Hub shows them. */
  name: string;
}

/**
 * Port: the Ambassadors whose assignment names a floor. The assignments are identity's
 * (`ambassador_assignment`, S01.14), so the composition root wires the real reader there. Until
 * S01.14 the table does not exist and the wired reader returns nobody (NO_ASSIGNMENTS).
 *
 * "Names a floor" means a listed floor id. An Ambassador assigned to a whole building (floor ids
 * null) names no floor, so removing one floor does not leave their assignment pointing at nothing.
 * Asked inside the removal's transaction, after the building row is locked.
 */
export interface FloorAssignments {
  onFloor(executor: DbExecutor, floor: { rsn: string; floorId: string }): Promise<readonly AssignedAmbassador[]>;
}

/** Until S01.14: nobody is assigned to any floor. */
export const NO_ASSIGNMENTS: FloorAssignments = { onFloor: async () => [] };
