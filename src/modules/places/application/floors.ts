// Floor editing and building confirmation (S01.13): what an Admin does at /staff/buildings. The
// staff guard has already refused anyone but an Admin (policy action `buildings.manage`); every
// change is audited in its own transaction, and a refused change is audited as refused with a reason.
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../../../platform/db";
import { uuidv7 } from "../../../platform/ids";
import { building, buildingFloor, neighbourhood } from "../adapters/schema";
import { CONTACT_OWNER, checkContact, isContactRole, type ContactError, type ContactRole } from "../domain/buildingContact";
import { checkFloorLabel, type FloorLabelError } from "../domain/floorLabel";
import { compareAddresses } from "../domain/street";
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

/** The building contact an Admin entered (S02.08); the Hub owns it. */
export interface BuildingContact {
  /** Which office the number reaches, as stored: a code, shown to residents as a translated label. */
  role: ContactRole;
  /** E.164: +14165550123 */
  phone: string;
  owner: typeof CONTACT_OWNER;
  updatedAt: Date;
}

export interface BuildingDetail extends BuildingSummary {
  facts: BuildingFacts;
  /** Null when no contact was entered. */
  contact: BuildingContact | null;
  /** Lowest first. */
  floors: FloorView[];
}

export interface FloorPlanFloor {
  id: string;
  label: string;
  /** Orders the floors of a building, lowest first. */
  sortOrder: number;
}

/** A building with its floors, as the coverage view needs it. */
export interface BuildingFloorPlan {
  rsn: string;
  address: string;
  neighbourhoodId: string;
  neighbourhoodName: string;
  floors: FloorPlanFloor[];
  /**
   * UAT F-5: the building data/seed/building-merge.csv folded this one into. Only a list read with `includeMerged` has merged buildings (each with this set);
   * every other list leaves them out.
   */
  mergedInto?: string;
}

/**
 * The order of every building list (UAT F-7): by neighbourhood, then by street and house number as a number (`compareAddresses`), then rsn.
 */
export const byNeighbourhoodAndAddress = (a: { neighbourhoodName: string; address: string; rsn: string }, b: { neighbourhoodName: string; address: string; rsn: string }): number =>
  a.neighbourhoodName.localeCompare(b.neighbourhoodName, "en") || compareAddresses(a.address, b.address) || a.rsn.localeCompare(b.rsn, "en", { numeric: true });

export type FloorRefusal = FloorLabelError | ContactError | "building_not_found" | "floor_not_found" | "floor_has_assignments" | "no_change" | "already_confirmed" | "no_floors";

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
  role_invalid: "validation",
  phone_invalid: "validation",
  role_without_phone: "validation",
  phone_without_role: "validation",
  not_work_number: "validation",
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

/** The contact of a building row; null unless all of it is there (the database checks it is all or nothing). */
export function contactOf(row: Pick<typeof building.$inferSelect, "contactRole" | "contactPhone" | "contactUpdatedAt">): BuildingContact | null {
  if (row.contactRole === null || row.contactPhone === null || row.contactUpdatedAt === null || !isContactRole(row.contactRole)) return null;
  return { role: row.contactRole, phone: row.contactPhone, owner: CONTACT_OWNER, updatedAt: row.contactUpdatedAt };
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
    /** Every building, by neighbourhood and address (street, then number). A building merged into another (UAT F-5) is not listed. */
    async listBuildings(): Promise<BuildingSummary[]> {
      const rows = (
        await db
          .select({ building, neighbourhoodName: neighbourhood.name })
          .from(building)
          .innerJoin(neighbourhood, eq(neighbourhood.id, building.neighbourhoodId))
          .where(isNull(building.mergedInto))
      ).sort((a, b) => byNeighbourhoodAndAddress({ ...a.building, neighbourhoodName: a.neighbourhoodName }, { ...b.building, neighbourhoodName: b.neighbourhoodName }));
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

    /**
     * Every building with its floors, lowest first, by neighbourhood and address (street, then number): what the coverage view
     * (S01.14) lays the assignments over, and every place picker. A building with no floors yet has an empty list. A building merged
     * into another (UAT F-5) is left out, unless `includeMerged` asks for it (with `mergedInto` set): for the screens that look a building
     * up by its rsn (an audience written before the merge, an assignment on it), never for a list to choose from.
     */
    async listFloorPlans(options: { includeMerged?: boolean } = {}): Promise<BuildingFloorPlan[]> {
      const rows = (
        await db
          .select({ rsn: building.rsn, address: building.address, neighbourhoodId: building.neighbourhoodId, neighbourhoodName: neighbourhood.name, mergedInto: building.mergedInto })
          .from(building)
          .innerJoin(neighbourhood, eq(neighbourhood.id, building.neighbourhoodId))
          .where(options.includeMerged ? undefined : isNull(building.mergedInto))
      ).sort(byNeighbourhoodAndAddress);
      const floors = await db.select().from(buildingFloor).orderBy(asc(buildingFloor.sortOrder), asc(buildingFloor.label));
      const byBuilding = new Map<string, FloorPlanFloor[]>();
      for (const floor of floors) byBuilding.set(floor.rsn, [...(byBuilding.get(floor.rsn) ?? []), { id: floor.id, label: floor.label, sortOrder: floor.sortOrder }]);
      return rows.map(({ mergedInto, ...row }) => ({ ...row, floors: byBuilding.get(row.rsn) ?? [], ...(mergedInto === null ? {} : { mergedInto }) }));
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
        contact: contactOf(row),
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

    /**
     * Enters, changes or removes the building contact (S02.08). The Hub is its owner and now its last-updated
     * date. Both fields empty removes it; one without the other, a role that is not on the list, a number that is
     * not a North American one, or a number the Admin did not confirm as a work or office number the building
     * agreed to publish is refused with the reason, and nothing is saved. Saving what is already there is
     * refused as no change, so the date means "last changed".
     */
    setContact(actorStaffId: string, input: { rsn: string; role: string; phone: string; workNumber: boolean }): Promise<FloorResult<{ contact: BuildingContact | null }>> {
      return change(actorStaffId, "building.contact_changed", input.rsn, async (tx) => {
        const row = await lockBuilding(tx, input.rsn);
        const checked = checkContact(input.role, input.phone, input.workNumber);
        if (!checked.ok) throw new Refused(checked.error);
        const before = contactOf(row);
        if ((checked.contact === null && before === null) || (checked.contact && before && checked.contact.role === before.role && checked.contact.phone === before.phone)) {
          throw new Refused("no_change");
        }
        const at = now();
        await tx
          .update(building)
          .set(
            checked.contact
              ? { contactRole: checked.contact.role, contactPhone: checked.contact.phone, contactOwner: CONTACT_OWNER, contactUpdatedAt: at }
              : { contactRole: null, contactPhone: null, contactOwner: null, contactUpdatedAt: null },
          )
          .where(eq(building.rsn, input.rsn));
        await audit.record(tx, {
          action: "building.contact_changed",
          actorStaffId,
          subjectType: "building",
          subjectId: input.rsn,
          meta: checked.contact ? {} : { cleared: true },
        });
        return { contact: checked.contact ? { ...checked.contact, owner: CONTACT_OWNER, updatedAt: at } : null };
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
