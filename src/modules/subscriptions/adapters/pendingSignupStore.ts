// The statements of the pending sign-up (S07.02). Every one runs in the caller's transaction; the number is selected only by `phoneOf` (the
// ContactResolver's source, at the hand-off point). S07.04's inbound router adds its own reads by number here.
import { and, eq, gt, lte, sql } from "drizzle-orm";
import type { DbExecutor, DbTransaction } from "../../../platform/db";
import { pendingSignup, type PendingPlace } from "./schema";

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
    const inserted = await tx.insert(pendingSignup).values(row).onConflictDoNothing({ target: pendingSignup.phone }).returning({ id: pendingSignup.id });
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
