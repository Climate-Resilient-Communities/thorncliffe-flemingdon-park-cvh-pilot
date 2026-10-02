/**
 * The failed-sign-in throttle (epic E01 definitions): 5 failed attempts for one username within
 * 15 minutes lock that username for 15 minutes; 20 failures from one client (a keyed hash of its
 * IP address) within an hour block that client for an hour. While locked, every attempt is
 * refused with the same generic message, even with the right password, and is not checked.
 *
 * Lock periods: the lock starts at the failure that reaches the limit and lasts as long as the
 * window (15 minutes for a username, 1 hour for a client). Attempts refused during a lock are
 * audited but not counted, so a lock ends on time and counting starts again from zero after it.
 */
export interface ThrottleLimit {
  failures: number;
  windowMs: number;
  lockMs: number;
}

export const USERNAME_LIMIT: ThrottleLimit = { failures: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000 };
export const CLIENT_LIMIT: ThrottleLimit = { failures: 20, windowMs: 60 * 60_000, lockMs: 60 * 60_000 };

/** Failures and ended locks older than this are deleted (the spine keeps a client's IP hash at most 24 hours). */
export const THROTTLE_RETENTION_MS = 24 * 60 * 60_000;

/** The lock a new failure starts, given the failures in the window including it; null when under the limit. */
export function lockAfterFailure(failuresInWindow: number, limit: ThrottleLimit, now: Date): Date | null {
  return failuresInWindow >= limit.failures ? new Date(now.getTime() + limit.lockMs) : null;
}

/** True while a lock that ends at `lockedUntil` is in force. */
export function isLocked(lockedUntil: Date | null, now: Date): boolean {
  return lockedUntil !== null && lockedUntil.getTime() > now.getTime();
}
