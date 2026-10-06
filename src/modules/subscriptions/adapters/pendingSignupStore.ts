// The statements of the pending sign-up (S07.02). Every one runs in the caller's transaction; the number is selected only by `phoneOf` (the
// ContactResolver's source, at the hand-off point) and by `ofNumber` (S07.04's inbound router, under the number's lock).
import { and, eq, gt, lte, sql } from "drizzle-orm";
import type { DbExecutor, DbTransaction } from "../../../platform/db";
import { pendingSignup, type PendingPlace } from "./schema";

/** S08.05: a check-in request made during sign-up, on one of its places with that floor, kept until YES (E08 "Request during sign-up"). */
export interface PendingCheckin {
  method: "call" | "text";
  rsn: string;
  floorId: string;
  consentVersion: string;
}

/** A pending sign-up to insert; the database gives `created_at` and `expires_at` (48 hours later), from its own clock. */
export interface NewPendingSignup {
  id: string;
  phone: string;
  lang: string;
  neighbourhoodId: string;
  places: PendingPlace[];
  groups: string[];
  topics: string[];
  consentVersion: string;
  startedBy: "web" | "staff";
  /** S08.05: a covered request (an uncovered one is never saved); none by default. */
  checkin?: PendingCheckin | null;
}

/** A pending sign-up as the inbound router reads it (no number). */
export interface PendingSignupRow extends Omit<NewPendingSignup, "phone" | "checkin"> {
  checkin: PendingCheckin | null;
  expired: boolean;
}

// A fixed seed for the advisory lock of one number, so it never meets another module's lock on a hash of the same text.
const NUMBER_LOCK_SEED = 7_302_118_449;

export const pendingSignupStore = {
  /**
   * One sign-up per number at a time, across every instance: two submissions for the same number run one after the other until the
   * transaction ends. The lock is on a hash of the number, so nothing is written.
   */
  async lockNumber(tx: DbTransaction, phone: string): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`pending_signup:${phone}`}, ${NUMBER_LOCK_SEED}))`);
  },

  /** Deletes the number's pending sign-up when its 48 hours have passed (the purge job does the same for every number). */
  async deleteExpired(tx: DbTransaction, phone: string): Promise<void> {
    await tx.delete(pendingSignup).where(and(eq(pendingSignup.phone, phone), lte(pendingSignup.expiresAt, sql`now()`)));
  },

  /** The new row's id, or null when the number already has a pending sign-up (nothing is written then). */
  async insert(tx: DbTransaction, row: NewPendingSignup): Promise<string | null> {
    const { checkin, ...rest } = row;
    const values = {
      ...rest,
      ...(checkin ? { checkinMethod: checkin.method, checkinConsentVersion: checkin.consentVersion, whereILiveRsn: checkin.rsn, whereILiveFloorId: checkin.floorId } : {}),
    };
    const inserted = await tx.insert(pendingSignup).values(values).onConflictDoNothing({ target: pendingSignup.phone }).returning({ id: pendingSignup.id });
    return inserted[0]?.id ?? null;
  },

  /** Whether the row exists (no number is read). */
  async exists(executor: DbExecutor, id: string): Promise<boolean> {
    const [row] = await executor.select({ id: pendingSignup.id }).from(pendingSignup).where(eq(pendingSignup.id, id));
    return row !== undefined;
  },

  async delete(tx: DbTransaction, id: string): Promise<boolean> {
    const deleted = await tx.delete(pendingSignup).where(eq(pendingSignup.id, id)).returning({ id: pendingSignup.id });
    return deleted.length > 0;
  },

  /**
   * The inbound router's read (S07.04): the number's pending sign-up, whether or not it has expired (`expired`: its `expires_at` has passed
   * by the database's clock, so YES no longer confirms it), or null. The number is not read back.
   */
  async ofNumber(tx: DbTransaction, phone: string): Promise<PendingSignupRow | null> {
    const [row] = await tx
      .select({
        id: pendingSignup.id,
        lang: pendingSignup.lang,
        neighbourhoodId: pendingSignup.neighbourhoodId,
        places: pendingSignup.places,
        groups: pendingSignup.groups,
        topics: pendingSignup.topics,
        consentVersion: pendingSignup.consentVersion,
        startedBy: pendingSignup.startedBy,
        checkinMethod: pendingSignup.checkinMethod,
        checkinConsentVersion: pendingSignup.checkinConsentVersion,
        whereILiveRsn: pendingSignup.whereILiveRsn,
        whereILiveFloorId: pendingSignup.whereILiveFloorId,
        expired: sql<boolean>`${pendingSignup.expiresAt} <= now()`,
      })
      .from(pendingSignup)
      .where(eq(pendingSignup.phone, phone));
    if (!row) return null;
    const { checkinMethod, checkinConsentVersion, whereILiveRsn, whereILiveFloorId, ...rest } = row;
    // The four are set together or not at all (the table's check).
    const checkin =
      checkinMethod !== null && checkinConsentVersion !== null && whereILiveRsn !== null && whereILiveFloorId !== null
        ? { method: checkinMethod as PendingCheckin["method"], rsn: whereILiveRsn, floorId: whereILiveFloorId, consentVersion: checkinConsentVersion }
        : null;
    return { ...rest, startedBy: rest.startedBy as "web" | "staff", checkin };
  },

  /** The number of an unexpired pending sign-up, for the resolver's source only. Null when it is gone or its 48 hours have passed. */
  async phoneOf(tx: DbTransaction, id: string): Promise<string | null> {
    const [row] = await tx
      .select({ phone: pendingSignup.phone })
      .from(pendingSignup)
      .where(and(eq(pendingSignup.id, id), gt(pendingSignup.expiresAt, sql`now()`)));
    return row?.phone ?? null;
  },
};

export type PendingSignupStore = typeof pendingSignupStore;
