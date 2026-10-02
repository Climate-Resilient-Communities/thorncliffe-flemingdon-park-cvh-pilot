import { and, eq, lt, or, sql } from "drizzle-orm";
import type { ThrottleStore } from "../application/ports";
import { signInFailure, signInLock } from "./schema";

// A fixed seed for the advisory locks of sign-in keys: the key's 64-bit hash under this seed.
const THROTTLE_LOCK_SEED = 7_315_420_071;

/** The failed-sign-in throttle's tables through Drizzle (S01.07). */
export const drizzleThrottleStore: ThrottleStore = {
  async lockKeys(tx, keyHashes) {
    // Sorted and de-duplicated, so two requests sharing keys always lock them in the same order.
    for (const key of [...new Set(keyHashes)].sort()) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, ${THROTTLE_LOCK_SEED}))`);
    }
  },

  async lockedUntil(db, keys) {
    if (keys.length === 0) return null;
    const [row] = await db
      .select({ until: sql<Date | null>`max(${signInLock.lockedUntil})`.mapWith(signInLock.lockedUntil) })
      .from(signInLock)
      .where(or(...keys.map((key) => and(eq(signInLock.kind, key.kind), eq(signInLock.keyHash, key.keyHash)))));
    return row?.until ?? null;
  },

  async recordFailure(tx, failure, windowsStart) {
    await tx.insert(signInFailure).values(failure);
    const [counts] = await tx
      .select({
        username: sql<number>`count(*) filter (where ${signInFailure.usernameHash} = ${failure.usernameHash} and ${signInFailure.at} > ${windowsStart.username.toISOString()}::timestamptz)`.mapWith(Number),
        client: sql<number>`count(*) filter (where ${signInFailure.clientHash} = ${failure.clientHash} and ${signInFailure.at} > ${windowsStart.client.toISOString()}::timestamptz)`.mapWith(Number),
      })
      .from(signInFailure)
      .where(or(eq(signInFailure.usernameHash, failure.usernameHash), eq(signInFailure.clientHash, failure.clientHash)));
    return { username: counts?.username ?? 0, client: counts?.client ?? 0 };
  },

  async setLock(tx, kind, keyHash, until) {
    await tx
      .insert(signInLock)
      .values({ kind, keyHash, lockedUntil: until })
      .onConflictDoUpdate({
        target: [signInLock.kind, signInLock.keyHash],
        set: { lockedUntil: sql`greatest(${signInLock.lockedUntil}, excluded.locked_until)` },
      });
  },

  async purge(tx, before) {
    await tx.delete(signInFailure).where(lt(signInFailure.at, before));
    await tx.delete(signInLock).where(lt(signInLock.lockedUntil, before));
  },
};
