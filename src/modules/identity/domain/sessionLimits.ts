import type { StaffRole } from "../../../contracts/staffRoles";

/**
 * Ambassadors are signed out after 30 minutes with no authenticated request (epic E01 "Session
 * limits"). The last request is staff_session.last_seen_at, written at most once a minute
 * (S01.07's sessionStore.touch), so an Ambassador may be signed out up to a minute early, never late.
 */
export const AMBASSADOR_IDLE_MS = 30 * 60 * 1000;

/** Every staff session ends 12 hours after sign-in, whatever the role. */
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;

export interface SessionLimits {
  /** null: no idle limit. */
  idleMs: number | null;
  absoluteMs: number;
}

/** The limits of a session of this role (the account's current role). */
export function sessionLimits(role: StaffRole): SessionLimits {
  return { idleMs: role === "ambassador" ? AMBASSADOR_IDLE_MS : null, absoluteMs: SESSION_ABSOLUTE_MS };
}

export interface SessionTimes {
  createdAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
}

/** Why a session can no longer be used, or `active`. */
export type SessionStanding = "active" | "revoked" | "absolute_expired" | "idle_expired";

/**
 * Whether a session may still be used at `now`: not revoked, younger than the absolute limit and,
 * for an Ambassador, used within the idle limit. A limit is reached at exactly its length.
 */
export function sessionStanding(session: SessionTimes, role: StaffRole, now: Date): SessionStanding {
  if (session.revokedAt !== null) return "revoked";
  const limits = sessionLimits(role);
  const at = now.getTime();
  if (at - session.createdAt.getTime() >= limits.absoluteMs) return "absolute_expired";
  if (limits.idleMs !== null && at - session.lastSeenAt.getTime() >= limits.idleMs) return "idle_expired";
  return "active";
}

/** What ends every session of an account (epic E01 "Session revocation"), as `session.revoked` records it. */
export type RevocationCause = "suspended" | "removed" | "password_reset" | "factor_reset" | "role_changed";

/** The account changes an Admin chooses (S01.06's StaffChange kinds) and the revocation each one causes. */
export function revocationCauseOf(change: { kind: "suspend" | "remove" | "change_role" }): RevocationCause {
  switch (change.kind) {
    case "suspend":
      return "suspended";
    case "remove":
      return "removed";
    case "change_role":
      return "role_changed";
  }
}
