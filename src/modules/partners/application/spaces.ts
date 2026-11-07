// The spaces partners open for residents (the partner space, 2026-11-07): the Hub's status board (P-02), one space with its history (P-06),
// the spaces of one organisation (P-07), the change of a space (P-01, P-06, P-07) and what residents are shown (GET /api/spaces).
//
// Who may change a space (a Coordinator or an Admin, `space.update`) is the caller's guard (src/app/staff/guard.ts); a use case takes the acting
// staff member's id and name for the record. A change locks the space's row, applies domain/space.ts, writes the space, a `space_change` row and
// the audit record in one transaction; a refusal is audited in its own transaction after, as every staff refusal is (AD-13).
import { asc, desc, eq, inArray } from "drizzle-orm";
import { record, recordRefusal } from "@/modules/audit";
import type { Db, DbExecutor } from "@/platform/db";
import { partnerOrg, space, spaceChange } from "../adapters/schema";
import {
  RESIDENT_STATUSES,
  decideSpaceChange,
  type ResidentSpaceStatus,
  type SpaceChangeError,
  type SpaceChangeInput,
  type SpaceState,
  type SpacePurpose,
  type SpaceStatus,
} from "../domain/space";

/** A space as the Hub's screens show it. */
export interface SpaceRow {
  id: string;
  orgId: string;
  orgName: string;
  orgShortName: string;
  /** The directory's catalogue id of the place, or null. */
  providerId: string | null;
  name: string;
  room: string | null;
  street: string;
  purpose: SpacePurpose;
  status: SpaceStatus;
  capacityMax: number;
  capacityNow: number | null;
  opensAt: string | null;
  closesAt: string | null;
  confirmedAt: Date | null;
  confirmedBy: string | null;
}

/** One change of a space, as P-06 lists them. */
export interface SpaceChangeRow {
  status: SpaceStatus;
  purpose: SpacePurpose;
  capacityNow: number | null;
  capacityMax: number;
  by: string;
  at: Date;
}

const columns = {
  id: space.id,
  orgId: space.orgId,
  orgName: partnerOrg.name,
  orgShortName: partnerOrg.shortName,
  providerId: space.providerId,
  name: space.name,
  room: space.room,
  street: space.street,
  purpose: space.purpose,
  status: space.status,
  capacityMax: space.capacityMax,
  capacityNow: space.capacityNow,
  opensAt: space.opensAt,
  closesAt: space.closesAt,
  confirmedAt: space.confirmedAt,
  confirmedBy: space.confirmedBy,
};

const asRow = (row: Record<keyof typeof columns, unknown>): SpaceRow => row as SpaceRow;

/** Every space, by organisation (in the organisations' order) then by id: the status board of P-02. */
export async function listSpaces(executor: DbExecutor): Promise<SpaceRow[]> {
  const rows = await executor.select(columns).from(space).innerJoin(partnerOrg, eq(partnerOrg.id, space.orgId)).orderBy(asc(partnerOrg.sortOrder), asc(space.id));
  return rows.map(asRow);
}

/** One space with its changes, newest first (at most 20); null when there is no such space. */
export async function readSpace(executor: DbExecutor, id: string): Promise<{ space: SpaceRow; changes: SpaceChangeRow[] } | null> {
  const [row] = await executor.select(columns).from(space).innerJoin(partnerOrg, eq(partnerOrg.id, space.orgId)).where(eq(space.id, id));
  if (!row) return null;
  const changes = await executor
    .select({
      status: spaceChange.status,
      purpose: spaceChange.purpose,
      capacityNow: spaceChange.capacityNow,
      capacityMax: spaceChange.capacityMax,
      by: spaceChange.changedByLabel,
      at: spaceChange.changedAt,
    })
    .from(spaceChange)
    .where(eq(spaceChange.spaceId, id))
    .orderBy(desc(spaceChange.changedAt))
    .limit(20);
  return { space: asRow(row), changes: changes as SpaceChangeRow[] };
}

/** What residents are shown of an open or full space (GET /api/spaces): the place it is at, its status and purpose, and when it was confirmed. */
export interface ResidentSpace {
  providerId: string;
  status: ResidentSpaceStatus;
  purpose: SpacePurpose;
  confirmedAt: Date;
}

/**
 * The open and full spaces at a place of the directory, for every resident alike (AD-3): nothing about who asks. A space with no place, or
 * one not open or full, is left out; an open space always has a confirmation (the database's `space_confirmed_when_open`).
 */
export async function residentSpaces(executor: DbExecutor): Promise<ResidentSpace[]> {
  const rows = await executor
    .select({ providerId: space.providerId, status: space.status, purpose: space.purpose, confirmedAt: space.confirmedAt })
    .from(space)
    .where(inArray(space.status, [...RESIDENT_STATUSES]))
    .orderBy(asc(space.providerId));
  return rows.flatMap((row) => (row.providerId !== null && row.confirmedAt !== null ? [{ ...row, providerId: row.providerId, confirmedAt: row.confirmedAt } as ResidentSpace] : []));
}

/** Who changes a space: the Hub account (for the record) and the words shown as "confirmed by". */
export interface SpaceActor {
  staffId: string;
  /** The person and organisation as words ("Ann Okafor, the Hub"). */
  label: string;
}

export type SpaceChangeResult = { ok: true; space: SpaceRow } | { ok: false; error: SpaceChangeError | "not_found" };

export interface SpaceOptions {
  /** Test seam: the clock of the confirmation. */
  now?: () => Date;
}

/**
 * Sets a space's status, purpose and capacity, and confirms it as it stands (P-01 opens a space, P-06 changes any of it, P-07's buttons). The
 * row is locked, so two people pressing at once write one after the other and each change is recorded. `input` is the form's fields, or a
 * function of the space as it is under the lock (P-07's Open / Full / Closed and "Still correct", which keep what the button does not name:
 * a purpose or count someone changed a moment before is not put back by a page loaded earlier).
 */
export async function changeSpace(
  db: Db,
  actor: SpaceActor,
  spaceId: string,
  input: SpaceChangeInput | ((current: SpaceState) => SpaceChangeInput),
  options: SpaceOptions = {},
): Promise<SpaceChangeResult> {
  const now = (options.now ?? (() => new Date()))();
  const outcome = await db.transaction(async (tx): Promise<SpaceChangeResult> => {
    const [current] = await tx
      .select({ status: space.status, purpose: space.purpose, capacityMax: space.capacityMax, capacityNow: space.capacityNow })
      .from(space)
      .where(eq(space.id, spaceId))
      .for("update");
    if (!current) return { ok: false, error: "not_found" };
    const decision = decideSpaceChange(typeof input === "function" ? input(current as SpaceState) : input);
    if (!decision.ok) return decision;
    const next = decision.next;
    await tx
      .update(space)
      .set({ status: next.status, purpose: next.purpose, capacityMax: next.capacityMax, capacityNow: next.capacityNow, confirmedAt: now, confirmedBy: actor.label, updatedBy: actor.staffId, updatedAt: now })
      .where(eq(space.id, spaceId));
    await tx.insert(spaceChange).values({
      spaceId,
      status: next.status,
      purpose: next.purpose,
      capacityNow: next.capacityNow,
      capacityMax: next.capacityMax,
      changedBy: actor.staffId,
      changedByLabel: actor.label,
      changedAt: now,
    });
    await record(tx, {
      action: "space.status_set",
      actorStaffId: actor.staffId,
      subjectType: "space",
      subjectId: spaceId,
      meta: { status: next.status, previous: current.status as SpaceStatus, purpose: next.purpose, capacity_max: next.capacityMax, capacity_now: next.capacityNow },
    });
    const [row] = await tx.select(columns).from(space).innerJoin(partnerOrg, eq(partnerOrg.id, space.orgId)).where(eq(space.id, spaceId));
    return { ok: true, space: asRow(row) };
  });
  if (!outcome.ok) {
    await recordRefusal(db, {
      action: "space.status_set",
      actorStaffId: actor.staffId,
      subjectType: "space",
      subjectId: /^SP[0-9]{2,4}$/.test(spaceId) ? spaceId : null,
      meta: outcome.error === "not_found" ? { reason: "not_found" } : { reason: "validation", code: outcome.error },
    });
  }
  return outcome;
}
