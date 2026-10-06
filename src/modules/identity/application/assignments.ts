// Ambassador assignments and coverage (S01.14): an Admin assigns an active Ambassador to a building,
// every floor of it or a list of floors by id, and removes assignments. `coversFloor` is the one
// coverage test (spine, AD-12): the sign-up warning (C6), the round filter and the coverage view all
// ask it. Every change is audited in its own transaction; a refused change is audited as refused.
//
// identity may not import places (AD-2), so the floors of a building come through a port that the
// composition root (src/app/staff/assignments.ts) wires to places. The change locks the building row
// through that port, as places' own floor edits do, so assigning a floor and removing it run one
// after the other; the database refuses the rest (ambassador_assignment_floor's foreign key).
//
// A saved assignment may cover a floor whose residents asked for a check-in while nobody covered it:
// the `rounds` port (checkins, wired by the composition root) adds them to the building's open rounds
// in the same transaction. That takes the round threads' locks, which an approval holds while it
// share-locks the buildings of its audience, and which a resident's edit takes after share-locking
// hers; so an assignment share-locks its building (a floor edit's FOR UPDATE still waits for it) and
// two assignments of one building run one after the other on an advisory lock taken first.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbExecutor, DbTransaction } from "../../../platform/db";
import { readAssignments } from "../adapters/assignmentRead";
import { ambassadorAssignment, ambassadorAssignmentFloor, staffAccount } from "../adapters/schema";
import { actorCan } from "../domain/accountAuthority";
import { coversNow, expandFloorRange, type FloorRef } from "../domain/coverage";
import type { PolicyAssignment } from "../domain/policy";
import { err, ok, type Result } from "../domain/result";
import type { AuditWriter } from "./accounts";

/** A floor of a building as the assignments need it. */
export interface BuildingFloor extends FloorRef {
  label: string;
}

/**
 * Port: the floors of a building, lowest first, or null when there is no such building. With `lock`
 * the building's row is locked until the transaction ends (places' own floor edits take the same lock).
 */
export interface BuildingFloorsReader {
  floorsOf(executor: DbExecutor, rsn: string, options?: { lock?: boolean | "share" }): Promise<readonly BuildingFloor[] | null>;
}

export type AssignRefusal =
  /** The actor is no longer an active Admin (demoted or suspended since the request began). */
  | "forbidden"
  | "building_not_found"
  | "account_not_found"
  /** The account is not an Ambassador (an Admin, Coordinator or Director is never assigned). */
  | "not_ambassador"
  /** The Ambassador is suspended, locked or removed: only an active one is assigned. */
  | "account_not_active"
  /** The list of floors is empty; "all floors" is `null`, not an empty list. */
  | "no_floors"
  /** A floor id that is not a floor of this building. */
  | "floor_not_in_building"
  /** A floor range with only one end given. */
  | "range_incomplete"
  /** A floor range that goes from a higher floor to a lower one: refused, not turned round. */
  | "range_reversed";

export type RemoveAssignmentRefusal = "forbidden" | "building_not_found" | "account_not_found" | "not_assigned";

/** The audit reason of each refusal (the audit module's REFUSAL_REASONS). */
const REASONS: Record<AssignRefusal | RemoveAssignmentRefusal, "validation" | "not_found" | "forbidden"> = {
  forbidden: "forbidden",
  building_not_found: "not_found",
  account_not_found: "not_found",
  not_ambassador: "validation",
  account_not_active: "validation",
  no_floors: "validation",
  floor_not_in_building: "validation",
  range_incomplete: "validation",
  range_reversed: "validation",
  not_assigned: "not_found",
};

/** Every floor from `from` to `to` (floor ids; either may be the lower), as the building orders its floors. */
export interface FloorRange {
  from: string;
  to: string;
}

export interface AssignmentSaved {
  staffId: string;
  rsn: string;
  /** The floors now assigned, lowest first; null for every floor. */
  floorIds: string[] | null;
}

/** One assignment with the person it is for, whatever their status (the Admin removes the stale ones). */
export interface AssignmentView {
  staffId: string;
  firstName: string;
  lastName: string;
  role: (typeof staffAccount.$inferSelect)["role"];
  status: (typeof staffAccount.$inferSelect)["status"];
  rsn: string;
  /** Null for every floor of the building. */
  floorIds: string[] | null;
  /** True when the person covers now: an active Ambassador. */
  covering: boolean;
  assignedAt: Date;
}

/** An active Ambassador, as the assignment form offers them. */
export interface AmbassadorOption {
  staffId: string;
  firstName: string;
  lastName: string;
}

/** An Ambassador as places' removal refusal lists them. */
export interface AssignedAmbassador {
  staffId: string;
  name: string;
}

/**
 * Port (checkins, wired by the composition root): an assignment was saved on this building, in this
 * transaction; the building's check-in requesters on floors it now covers join its open rounds.
 */
export interface AssignmentRounds {
  assignmentSaved(tx: DbTransaction, rsn: string): Promise<void>;
}

export interface AssignmentDeps {
  db: Db;
  floors: BuildingFloorsReader;
  rounds?: AssignmentRounds;
  audit: AuditWriter;
  now?: () => Date;
}

const RSN = /^[0-9]{1,9}$/;
const isUuid = (value: string): boolean => z.uuid().safeParse(value).success;

/** Found inside a transaction: nothing was written, and the refusal is audited after the rollback. */
class Refused extends Error {
  constructor(readonly error: AssignRefusal | RemoveAssignmentRefusal) {
    super(error);
  }
}

type Tx = DbTransaction;

export function createAssignmentService(deps: AssignmentDeps) {
  const { db, floors: floorReader, audit } = deps;
  const now = deps.now ?? (() => new Date());

  /** The floor ids each of the given assignments lists, by `${staffId}:${rsn}`. */
  async function listedFloors(executor: DbExecutor, staffIds: readonly string[]): Promise<Map<string, string[]>> {
    const listed = new Map<string, string[]>();
    if (staffIds.length === 0) return listed;
    const rows = await executor
      .select({ staffId: ambassadorAssignmentFloor.staffId, rsn: ambassadorAssignmentFloor.rsn, floorId: ambassadorAssignmentFloor.floorId })
      .from(ambassadorAssignmentFloor)
      .where(inArray(ambassadorAssignmentFloor.staffId, [...staffIds]))
      .orderBy(asc(ambassadorAssignmentFloor.floorId));
    for (const row of rows) {
      const key = `${row.staffId}:${row.rsn}`;
      listed.set(key, [...(listed.get(key) ?? []), row.floorId]);
    }
    return listed;
  }

  /** The given floor ids in the building's own order, lowest first (the order every audit record lists them in). */
  function inBuildingOrder(floors: readonly BuildingFloor[], ids: readonly string[]): string[] {
    const wanted = new Set(ids);
    return floors.filter((floor) => wanted.has(floor.id)).map((floor) => floor.id);
  }

  async function viewsOf(executor: DbExecutor, rows: { assignment: typeof ambassadorAssignment.$inferSelect; person: typeof staffAccount.$inferSelect }[]): Promise<AssignmentView[]> {
    const listed = await listedFloors(executor, [...new Set(rows.map(({ assignment }) => assignment.staffId))]);
    return rows.map(({ assignment, person }) => ({
      staffId: assignment.staffId,
      firstName: person.firstName,
      lastName: person.lastName,
      role: person.role,
      status: person.status,
      rsn: assignment.rsn,
      floorIds: assignment.allFloors ? null : (listed.get(`${assignment.staffId}:${assignment.rsn}`) ?? []),
      covering: coversNow(person),
      assignedAt: assignment.assignedAt,
    }));
  }

  /**
   * Reads the actor's account again under a share lock, at the top of the change's transaction: the request's
   * guard judged the session some time ago, and the actor may have been demoted or suspended since (the
   * same re-check as accounts.addPerson). Anyone but an active Admin is refused `forbidden`.
   */
  async function requireAdmin(tx: Tx, actorStaffId: string): Promise<void> {
    const [current] = isUuid(actorStaffId) ? await tx.select().from(staffAccount).where(eq(staffAccount.id, actorStaffId)).for("share") : [];
    if (!current || !actorCan(current, "accounts.manage")) throw new Refused("forbidden");
  }

  /** The audit meta of a refusal: only well-formed values, whatever the request said. */
  function refusalMeta(error: AssignRefusal | RemoveAssignmentRefusal, input: { staffId: string; rsn: string; floorIds?: readonly string[] | null }) {
    const floorIds = input.floorIds;
    return {
      reason: REASONS[error],
      ...(isUuid(input.staffId) ? { staff_id: input.staffId } : {}),
      ...(RSN.test(input.rsn) ? { rsn: input.rsn } : {}),
      ...(Array.isArray(floorIds) && floorIds.length <= 200 && floorIds.every(isUuid) ? { floor_ids: [...floorIds] } : {}),
    };
  }

  return {
    /**
     * Assigns an active Ambassador to a building: every floor of it (`floorIds` null) or the listed floors.
     * `range` adds every floor from one to the other, inclusive, in the building's own order (`sort_order`).
     * Saving again replaces what the Ambassador had for that building. A floor that is not one of the
     * building's, a list with none, or an account that is not an active Ambassador is refused.
     */
    async assign(
      actorStaffId: string,
      input: { staffId: string; rsn: string; floorIds: readonly string[] | null; range?: FloorRange },
    ): Promise<Result<AssignmentSaved, AssignRefusal>> {
      try {
        const saved = await db.transaction(async (tx: Tx) => {
          await requireAdmin(tx, actorStaffId);
          if (!RSN.test(input.rsn)) throw new Refused("building_not_found");
          // Two assignments of one building one after the other; the building share-locked (see the header).
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`assignment:${input.rsn}`}, 0))`);
          const floors = await floorReader.floorsOf(tx, input.rsn, { lock: "share" });
          if (floors === null) throw new Refused("building_not_found");
          if (!isUuid(input.staffId)) throw new Refused("account_not_found");
          const [person] = await tx.select().from(staffAccount).where(eq(staffAccount.id, input.staffId)).for("share");
          if (!person) throw new Refused("account_not_found");
          if (person.role !== "ambassador") throw new Refused("not_ambassador");
          if (person.status !== "active") throw new Refused("account_not_active");

          let chosen: string[] | null = null;
          if (input.floorIds !== null) {
            const wanted = new Set(input.floorIds);
            if (input.range) {
              if (input.range.from === "" || input.range.to === "") throw new Refused("range_incomplete");
              const expanded = expandFloorRange(floors, input.range.from, input.range.to);
              if (expanded === "unknown_end") throw new Refused("floor_not_in_building");
              if (expanded === "reversed") throw new Refused("range_reversed");
              for (const id of expanded) wanted.add(id);
            }
            if (wanted.size === 0) throw new Refused("no_floors");
            const known = new Set(floors.map((floor) => floor.id));
            if ([...wanted].some((id) => !known.has(id))) throw new Refused("floor_not_in_building");
            // The building's own order, lowest first, whatever order they were given in.
            chosen = floors.filter((floor) => wanted.has(floor.id)).map((floor) => floor.id);
          }

          // What a replaced assignment listed, for the audit record: null is "every floor"; undefined is a first assignment.
          const [existing] = await tx
            .select({ allFloors: ambassadorAssignment.allFloors })
            .from(ambassadorAssignment)
            .where(and(eq(ambassadorAssignment.staffId, person.id), eq(ambassadorAssignment.rsn, input.rsn)));
          const previous = existing ? (existing.allFloors ? null : inBuildingOrder(floors, (await listedFloors(tx, [person.id])).get(`${person.id}:${input.rsn}`) ?? [])) : undefined;

          const at = now();
          await tx
            .insert(ambassadorAssignment)
            .values({ staffId: person.id, rsn: input.rsn, allFloors: chosen === null, assignedBy: actorStaffId, assignedAt: at })
            .onConflictDoUpdate({ target: [ambassadorAssignment.staffId, ambassadorAssignment.rsn], set: { allFloors: chosen === null, assignedBy: actorStaffId, assignedAt: at } });
          await tx.delete(ambassadorAssignmentFloor).where(and(eq(ambassadorAssignmentFloor.staffId, person.id), eq(ambassadorAssignmentFloor.rsn, input.rsn)));
          if (chosen !== null) {
            await tx.insert(ambassadorAssignmentFloor).values(chosen.map((floorId) => ({ staffId: person.id, rsn: input.rsn, floorId })));
          }
          await deps.rounds?.assignmentSaved(tx, input.rsn);
          await audit.record(tx, {
            action: "assignment.saved",
            actorStaffId,
            subjectType: "building",
            subjectId: input.rsn,
            meta: { staff_id: person.id, rsn: input.rsn, floor_ids: chosen, ...(previous !== undefined ? { previous_floor_ids: previous } : {}) },
          });
          return { staffId: person.id, rsn: input.rsn, floorIds: chosen };
        });
        return ok(saved);
      } catch (error) {
        if (!(error instanceof Refused)) throw error;
        await audit.recordRefusal(db, {
          action: "assignment.saved",
          actorStaffId,
          subjectType: "building",
          subjectId: RSN.test(input.rsn) ? input.rsn : null,
          meta: refusalMeta(error.error, input),
        });
        return err(error.error as AssignRefusal);
      }
    },

    /** Removes an assignment (the Ambassador no longer covers that building). */
    async remove(actorStaffId: string, input: { staffId: string; rsn: string }): Promise<Result<{ staffId: string; rsn: string }, RemoveAssignmentRefusal>> {
      try {
        await db.transaction(async (tx: Tx) => {
          await requireAdmin(tx, actorStaffId);
          if (!RSN.test(input.rsn)) throw new Refused("building_not_found");
          const building = await floorReader.floorsOf(tx, input.rsn, { lock: true });
          if (building === null) throw new Refused("building_not_found");
          if (!isUuid(input.staffId)) throw new Refused("account_not_found");
          // What the assignment listed, for the audit record (null for every floor), read before the floor rows go.
          const [held] = await tx
            .select({ allFloors: ambassadorAssignment.allFloors })
            .from(ambassadorAssignment)
            .where(and(eq(ambassadorAssignment.staffId, input.staffId), eq(ambassadorAssignment.rsn, input.rsn)));
          if (!held) throw new Refused("not_assigned");
          const floorIds = held.allFloors ? null : inBuildingOrder(building, (await listedFloors(tx, [input.staffId])).get(`${input.staffId}:${input.rsn}`) ?? []);
          // The floor rows go with the assignment (on delete cascade).
          const removed = await tx
            .delete(ambassadorAssignment)
            .where(and(eq(ambassadorAssignment.staffId, input.staffId), eq(ambassadorAssignment.rsn, input.rsn)))
            .returning({ staffId: ambassadorAssignment.staffId });
          if (removed.length === 0) throw new Refused("not_assigned");
          await audit.record(tx, {
            action: "assignment.removed",
            actorStaffId,
            subjectType: "building",
            subjectId: input.rsn,
            meta: { staff_id: input.staffId, rsn: input.rsn, floor_ids: floorIds },
          });
        });
        return ok({ staffId: input.staffId, rsn: input.rsn });
      } catch (error) {
        if (!(error instanceof Refused)) throw error;
        await audit.recordRefusal(db, {
          action: "assignment.removed",
          actorStaffId,
          subjectType: "building",
          subjectId: RSN.test(input.rsn) ? input.rsn : null,
          meta: refusalMeta(error.error, input),
        });
        return err(error.error as RemoveAssignmentRefusal);
      }
    },

    /**
     * `identity.coversFloor(rsn, floorId)`: true only when the floor is a floor of that building and an
     * active Ambassador is assigned to the building as a whole or to that floor by id. A suspended, locked or
     * removed account covers nothing; an unknown building or a floor of another building is false. The
     * executor is the caller's transaction when it is in one.
     */
    async coversFloor(rsn: string, floorId: string, executor: DbExecutor = db): Promise<boolean> {
      if (!RSN.test(rsn) || !isUuid(floorId)) return false;
      // One query: the floor is a floor of that building (building_floor is places' table, read here by key only,
      // as the foreign key above does), and an active Ambassador is assigned to the whole building or to that floor.
      const rows = await executor.execute<{ covered: boolean }>(sql`select exists (
          select 1
          from ${ambassadorAssignment}
          inner join ${staffAccount} on ${staffAccount.id} = ${ambassadorAssignment.staffId}
          inner join building_floor on building_floor.rsn = ${ambassadorAssignment.rsn}
          where ${ambassadorAssignment.rsn} = ${rsn}
            and building_floor.id = ${floorId}
            and ${staffAccount.role} = 'ambassador'
            and ${staffAccount.status} = 'active'
            and (
              ${ambassadorAssignment.allFloors}
              or exists (
                select 1
                from ${ambassadorAssignmentFloor}
                where ${ambassadorAssignmentFloor.staffId} = ${ambassadorAssignment.staffId}
                  and ${ambassadorAssignmentFloor.rsn} = ${ambassadorAssignment.rsn}
                  and ${ambassadorAssignmentFloor.floorId} = ${floorId}
              )
            )
        ) as covered`);
      return rows[0]?.covered === true;
    },

    /** Every assignment, with the person and whether they cover now (the coverage view and the assignment lists). */
    async allAssignments(executor: DbExecutor = db): Promise<AssignmentView[]> {
      const rows = await executor
        .select({ assignment: ambassadorAssignment, person: staffAccount })
        .from(ambassadorAssignment)
        .innerJoin(staffAccount, eq(staffAccount.id, ambassadorAssignment.staffId))
        .orderBy(asc(staffAccount.lastName), asc(staffAccount.firstName), asc(ambassadorAssignment.rsn));
      return viewsOf(executor, rows);
    },

    /**
     * One person's assignments that count now, as the role policy reads them (scope of an Ambassador's calls):
     * the same `coversNow` test as `coversFloor`, so an account that does not cover has no scope either.
     */
    async assignmentsOf(staffId: string, executor: DbExecutor = db): Promise<PolicyAssignment[]> {
      if (!isUuid(staffId)) return [];
      return readAssignments(executor, staffId);
    },

    /** The active Ambassadors an Admin can assign. */
    async ambassadors(executor: DbExecutor = db): Promise<AmbassadorOption[]> {
      const rows = await executor
        .select({ staffId: staffAccount.id, firstName: staffAccount.firstName, lastName: staffAccount.lastName })
        .from(staffAccount)
        .where(and(eq(staffAccount.role, "ambassador"), eq(staffAccount.status, "active")))
        .orderBy(asc(staffAccount.lastName), asc(staffAccount.firstName), asc(staffAccount.id));
      return rows;
    },

    /**
     * The Ambassadors whose assignment lists the floor, whatever their status (the database refuses to
     * delete a listed floor whoever holds it), for places' refusal to remove it. An Ambassador assigned to
     * the whole building lists no floor. Asked inside the removal's transaction.
     */
    async onFloor(executor: DbExecutor, floor: { rsn: string; floorId: string }): Promise<AssignedAmbassador[]> {
      const rows = await executor
        .select({ staffId: staffAccount.id, firstName: staffAccount.firstName, lastName: staffAccount.lastName })
        .from(ambassadorAssignmentFloor)
        .innerJoin(staffAccount, eq(staffAccount.id, ambassadorAssignmentFloor.staffId))
        .where(and(eq(ambassadorAssignmentFloor.rsn, floor.rsn), eq(ambassadorAssignmentFloor.floorId, floor.floorId)))
        .orderBy(asc(staffAccount.lastName), asc(staffAccount.firstName), asc(staffAccount.id));
      return rows.map((row) => ({ staffId: row.staffId, name: `${row.firstName} ${row.lastName}` }));
    },
  };
}

export type AssignmentService = ReturnType<typeof createAssignmentService>;
