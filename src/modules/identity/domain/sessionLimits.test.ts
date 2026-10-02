import { describe, expect, it } from "vitest";
import { STAFF_ROLES } from "../../../contracts/staffRoles";
import {
  AMBASSADOR_IDLE_MS,
  SESSION_ABSOLUTE_MS,
  revocationCauseOf,
  sessionLimits,
  sessionStanding,
} from "./sessionLimits";

const T0 = new Date("2026-10-05T08:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const minutes = (n: number) => n * 60_000;
const hours = (n: number) => n * 3_600_000;
const session = (lastSeenMs = 0, revokedAt: Date | null = null) => ({ createdAt: T0, lastSeenAt: at(lastSeenMs), revokedAt });

describe("session limits per role", () => {
  it("gives Ambassadors 30 minutes idle and 12 hours in all; everyone else 12 hours and no idle limit", () => {
    expect(AMBASSADOR_IDLE_MS).toBe(minutes(30));
    expect(SESSION_ABSOLUTE_MS).toBe(hours(12));
    expect(sessionLimits("ambassador")).toEqual({ idleMs: minutes(30), absoluteMs: hours(12) });
    for (const role of ["coordinator", "director", "admin"] as const) expect(sessionLimits(role)).toEqual({ idleMs: null, absoluteMs: hours(12) });
  });

  it("ends an Ambassador's session after exactly 30 minutes with no request, not a moment before", () => {
    expect(sessionStanding(session(), "ambassador", at(minutes(30) - 1))).toBe("active");
    expect(sessionStanding(session(), "ambassador", at(minutes(30)))).toBe("idle_expired");
    // Activity moves the idle limit, not the absolute one.
    expect(sessionStanding(session(minutes(29)), "ambassador", at(minutes(58)))).toBe("active");
  });

  it("never ends a Coordinator's, Director's or Admin's session for being idle", () => {
    for (const role of ["coordinator", "director", "admin"] as const) {
      expect(sessionStanding(session(), role, at(hours(11)))).toBe("active");
    }
  });

  it.each(STAFF_ROLES)("ends a %s session 12 hours after sign-in, however active", (role) => {
    const busy = session(hours(12) - 1);
    expect(sessionStanding(busy, role, at(hours(12) - 1))).toBe("active");
    expect(sessionStanding(busy, role, at(hours(12)))).toBe("absolute_expired");
  });

  it("refuses a revoked session whatever its times", () => {
    for (const role of STAFF_ROLES) expect(sessionStanding(session(0, at(1)), role, at(2))).toBe("revoked");
  });
});

describe("revocation decisions", () => {
  it("names the cause of each account change an Admin makes", () => {
    expect(revocationCauseOf({ kind: "suspend" })).toBe("suspended");
    expect(revocationCauseOf({ kind: "remove" })).toBe("removed");
    expect(revocationCauseOf({ kind: "change_role" })).toBe("role_changed");
  });
});
