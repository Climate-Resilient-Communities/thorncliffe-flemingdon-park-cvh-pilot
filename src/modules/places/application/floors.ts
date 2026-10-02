// Floor editing and building confirmation (S01.13): what an Admin does at /staff/buildings. The
// staff guard has already refused anyone but an Admin (policy action `buildings.manage`); every
// change is audited in its own transaction, and a refused change is audited as refused with a reason.
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../../../platform/db";
import { uuidv7 } from "../../../platform/ids";
import { building, buildingFloor, neighbourhood } from "../adapters/schema";
import { checkFloorLabel, type FloorLabelError } from "../domain/floorLabel";
import type { AssignedAmbassador, FloorAssignments, PlacesAudit, PlacesAuditEvent } from "./ports";

export interface FloorView {
  /** Stable: a rename keeps it, and assignments refer to it. */
  id: string;
  label: string;
  confirmed: boolean;
}

export interface BuildingSummary {
  rsn: string;
  address: string;
  neighbourhoodId: string;
  neighbourhoodName: string;
  /** Storeys by the register; null when it did not say. */
  storeys: number | null;
  floorCount: number;
  /** The floors were checked and marked confirmed by an Admin. */
  confirmedAt: Date | null;
  /** Set when the latest import no longer lists the building: for an Admin to review. */
  notInRegisterSince: Date | null;
}

/** The register's facts (D4-P); null is "not known". */
export interface BuildingFacts {
  elevators: number | null;
  emergencyPower: boolean | null;
  coolingRoom: boolean | null;
  airConditioning: string | null;
  barrierFreeEntrance: boolean | null;
  /** When any of the building's facts last changed. */
  updatedAt: Date;
}

export interface BuildingDetail extends BuildingSummary {
  facts: BuildingFacts;
  /** Lowest first. */
  floors: FloorView[];
}

export type FloorRefusal = FloorLabelError | "building_not_found" | "floor_not_found" | "floor_has_assignments" | "no_change" | "already_confirmed" | "no_floors";

/** An expected outcome as a value (spine: Errors). A refusal to remove a floor lists the Ambassadors who block it. */
export type FloorResult<T> = { ok: true; value: T } | { ok: false; error: FloorRefusal; ambassadors?: readonly AssignedAmbassador[] };

/** Where a new floor goes in the list. */
export type FloorPlace = "top" | "bottom";

export interface BuildingServiceDeps {
  db: Db;
  audit: PlacesAudit;
  assignments: FloorAssignments;
  now?: () => Date;
  newId?: () => string;
}

/**
 * The same rule as the audit trail's schema for a floor id (`z.uuid()`, RFC 9562 versions and variants): an id
 * that passes a looser pattern but not this one would make the refusal's own audit event fail, leaving the
 * refusal unaudited. 11111111-1111-1111-1111-111111111111 is such an id.
 */
const isFloorId = (value: string): boolean => z.uuid().safeParse(value).success;
const RSN = /^[0-9]{1,9}$/;

/** Found inside a transaction: nothing was written, and the refusal is audited after the rollback. */
class Refused extends Error {
  constructor(
    readonly error: FloorRefusal,
    readonly detail: { floorId?: string; label?: string; ambassadors?: readonly AssignedAmbassador[] } = {},
  ) {
    super(error);
  }
}

/** The audit reason of each refusal (the audit module's REFUSAL_REASONS). */
const REASONS: Record<FloorRefusal, "validation" | "duplicate" | "not_found" | "floor_has_assignments" | "conflict"> = {
  label_empty: "validation",
  label_too_long: "validation",
  label_characters: "validation",
  label_duplicate: "duplicate",
  building_not_found: "not_found",
  floor_not_found: "not_found",
  floor_has_assignments: "floor_has_assignments",
  no_change: "conflict",
  already_confirmed: "conflict",
  no_floors: "validation",
};

/** True when the error, or one it wraps (Drizzle wraps the driver's), is a unique violation of a building's floor labels. */
function isLabelUniqueViolation(error: unknown): boolean {
  for (let current = error, depth = 0; current && typeof current === "object" && depth < 5; depth += 1) {
    const { code, constraint_name: constraint } = current as { code?: unknown; constraint_name?: unknown };
    if (code === "23505" && constraint === "building_floor_label_unique") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

const floorOf = (row: typeof buildingFloor.$inferSelect): FloorView => ({ id: row.id, label: row.label, confirmed: row.confirmed });

export function createBuildingService(deps: BuildingServiceDeps) {
  const { db, audit, assignments } = deps;
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => uuidv7());

  type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

  /** The building row, locked until the transaction ends, so two edits of one building run one after the other. */
  async function lockBuilding(tx: Tx, rsn: string) {
    if (!RSN.test(rsn)) throw new Refused("building_not_found");
    const [row] = await tx.select().from(building).where(eq(building.rsn, rsn)).for("update");
    if (!row) throw new Refused("building_not_found");
    return row;
  }

  const floorsOf = (tx: Tx, rsn: string) => tx.select().from(buildingFloor).where(eq(buildingFloor.rsn, rsn)).orderBy(asc(buildingFloor.sortOrder), asc(buildingFloor.label));

  /** Runs a change in a transaction; a refusal inside it rolls back and is audited as refused. */
  async function change<T>(
    actorStaffId: string,
    action: Extract<PlacesAuditEvent["action"], `building.${string}`>,
    rsn: string,
    run: (tx: Tx) => Promise<T>,
  ): Promise<FloorResult<T>> {
    try {
      return { ok: true, value: await db.transaction(run) };
    } catch (error) {
      const refusal = error instanceof Refused ? error : isLabelUniqueViolation(error) ? new Refused("label_duplicate") : null;
      if (!refusal) throw error;
      const { floorId, label, ambassadors } = refusal.detail;
      await audit.recordRefusal(db, {
        action,
        actorStaffId,
        subjectType: "building",
        subjectId: RSN.test(rsn) ? rsn : null,
        meta: {
          reason: REASONS[refusal.error],
          ...(floorId !== undefined && isFloorId(floorId) ? { floor_id: floorId } : {}),
          ...(action === "building.floor_removed" && label !== undefined ? { label } : {}),
          ...(ambassadors !== undefined ? { assignments: ambassadors.length } : {}),
        },
      });
      return { ok: false, error: refusal.error, ...(ambassadors ? { ambassadors } : {}) };
    }
  }

  return {
    /** Every building, by neighbourhood and address. */
    async listBuildings(): Promise<BuildingSummary[]> {
      const rows = await db
        .select({ building, neighbourhoodName: neighbourhood.name })
        .from(building)
        .innerJoin(neighbourhood, eq(neighbourhood.id, building.neighbourhoodId))
        .orderBy(asc(neighbourhood.name), asc(building.address), asc(building.rsn));
      const counts = new Map(
        (await db.select({ rsn: buildingFloor.rsn, floors: sql<number>`count(*)::int` }).from(buildingFloor).groupBy(buildingFloor.rsn)).map((row) => [row.rsn, row.floors]),
      );
      return rows.map(({ building: row, neighbourhoodName }) => ({
        rsn: row.rsn,
        address: row.address,
        neighbourhoodId: row.neighbourhoodId,
        neighbourhoodName,
        storeys: row.storeys,
        floorCount: counts.get(row.rsn) ?? 0,
        confirmedAt: row.floorsConfirmedAt,
        notInRegisterSince: row.notInRegisterSince,
      }));
    },

    /** One building with its facts and floors; null when there is none with that rsn. */
    async getBuilding(rsn: string): Promise<BuildingDetail | null> {
      if (!RSN.test(rsn)) return null;
      const [found] = await db
        .select({ building, neighbourhoodName: neighbourhood.name })
        .from(building)
        .innerJoin(neighbourhood, eq(neighbourhood.id, building.neighbourhoodId))
        .where(eq(building.rsn, rsn));
      if (!found) return null;
      const row = found.building;
      const floors = await db.select().from(buildingFloor).where(eq(buildingFloor.rsn, rsn)).orderBy(asc(buildingFloor.sortOrder), asc(buildingFloor.label));
      return {
        rsn: row.rsn,
        address: row.address,
        neighbourhoodId: row.neighbourhoodId,
        neighbourhoodName: found.neighbourhoodName,
        storeys: row.storeys,
        floorCount: floors.length,
        confirmedAt: row.floorsConfirmedAt,
        notInRegisterSince: row.notInRegisterSince,
        facts: {
          elevators: row.elevators,
          emergencyPower: row.emergencyPower,
          coolingRoom: row.coolingRoom,
          airConditioning: row.airConditioning,
          barrierFreeEntrance: row.barrierFreeEntrance,
          updatedAt: row.factsUpdatedAt,
        },
        floors: floors.map(floorOf),
      };
    },

    /**
     * Adds a floor, at the top of the list or the bottom (for "G", "L", "P1"). The label is checked
     * against the rules and the building's other labels. A floor added to a confirmed building is
     * confirmed: an Admin named it.
     */
    addFloor(actorStaffId: string, input: { rsn: string; label: string; place?: FloorPlace }): Promise<FloorResult<FloorView>> {
      return change(actorStaffId, "building.floor_added", input.rsn, async (tx) => {
        const row = await lockBuilding(tx, input.rsn);
        const floors = await floorsOf(tx, input.rsn);
        const checked = checkFloorLabel(input.label, floors.map((floor) => floor.label));
        if (!checked.ok) throw new Refused(checked.error);
        const orders = floors.map((floor) => floor.sortOrder);
        const sortOrder = orders.length === 0 ? 1 : input.place === "bottom" ? Math.min(...orders) - 1 : Math.max(...orders) + 1;
        const [created] = await tx
          .insert(buildingFloor)
          .values({ id: newId(), rsn: input.rsn, label: checked.label, sortOrder, confirmed: row.floorsConfirmedAt !== null })
          .returning();
        await audit.record(tx, { action: "building.floor_added", actorStaffId, subjectType: "building", subjectId: input.rsn, meta: { floor_id: created.id, label: created.label } });
        return floorOf(created);
      });
    },

    /** Renames a floor. Its id, its place in the list and its assignments stay as they are. */
    renameFloor(actorStaffId: string, input: { rsn: string; floorId: string; label: string }): Promise<FloorResult<FloorView & { previousLabel: string }>> {
      return change(actorStaffId, "building.floor_renamed", input.rsn, async (tx) => {
        await lockBuilding(tx, input.rsn);
        const floors = await floorsOf(tx, input.rsn);
        const floor = isFloorId(input.floorId) ? floors.find((candidate) => candidate.id === input.floorId) : undefined;
        if (!floor) throw new Refused("floor_not_found", { floorId: input.floorId });
        const checked = checkFloorLabel(input.label, floors.filter((other) => other.id !== floor.id).map((other) => other.label));
        if (!checked.ok) throw new Refused(checked.error, { floorId: floor.id });
        if (checked.label === floor.label) throw new Refused("no_change", { floorId: floor.id });
        const [renamed] = await tx.update(buildingFloor).set({ label: checked.label }).where(eq(buildingFloor.id, floor.id)).returning();
        await audit.record(tx, {
          action: "building.floor_renamed",
          actorStaffId,
          subjectType: "building",
          subjectId: input.rsn,
          meta: { floor_id: floor.id, from: floor.label, to: renamed.label },
        });
        return { ...floorOf(renamed), previousLabel: floor.label };
      });
    },

    /**
     * Removes a floor, unless an Ambassador is assigned to it: the refusal lists them, and the
     * Admin reassigns or removes them first.
     */
    removeFloor(actorStaffId: string, input: { rsn: string; floorId: string }): Promise<FloorResult<FloorView>> {
      return change(actorStaffId, "building.floor_removed", input.rsn, async (tx) => {
        await lockBuilding(tx, input.rsn);
        const [floor] = isFloorId(input.floorId) ? await tx.select().from(buildingFloor).where(and(eq(buildingFloor.id, input.floorId), eq(buildingFloor.rsn, input.rsn))) : [];
        if (!floor) throw new Refused("floor_not_found", { floorId: input.floorId });
        const assigned = await assignments.onFloor(tx, { rsn: input.rsn, floorId: floor.id });
        if (assigned.length > 0) throw new Refused("floor_has_assignments", { floorId: floor.id, label: floor.label, ambassadors: assigned });
        await tx.delete(buildingFloor).where(eq(buildingFloor.id, floor.id));
        await audit.record(tx, {
          action: "building.floor_removed",
          actorStaffId,
          subjectType: "building",
          subjectId: input.rsn,
          meta: { floor_id: floor.id, label: floor.label, assignments: 0 },
        });
        return floorOf(floor);
      });
    },

    /** Marks the building's floors as checked: the building and every floor it has become confirmed. */
    confirmBuilding(actorStaffId: string, input: { rsn: string }): Promise<FloorResult<{ floors: number; confirmedAt: Date }>> {
      return change(actorStaffId, "building.confirmed", input.rsn, async (tx) => {
        const row = await lockBuilding(tx, input.rsn);
        if (row.floorsConfirmedAt !== null) throw new Refused("already_confirmed");
        const floors = await floorsOf(tx, input.rsn);
        if (floors.length === 0) throw new Refused("no_floors");
        const confirmedAt = now();
        await tx.update(building).set({ floorsConfirmedAt: confirmedAt, floorsConfirmedBy: actorStaffId }).where(eq(building.rsn, input.rsn));
        await tx.update(buildingFloor).set({ confirmed: true }).where(eq(buildingFloor.rsn, input.rsn));
        await audit.record(tx, { action: "building.confirmed", actorStaffId, subjectType: "building", subjectId: input.rsn, meta: { floors: floors.length } });
        return { floors: floors.length, confirmedAt };
      });
    },
  };
}

export type BuildingService = ReturnType<typeof createBuildingService>;
