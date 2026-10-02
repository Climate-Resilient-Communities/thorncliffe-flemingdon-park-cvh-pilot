import { describe, expect, it } from "vitest";
import { CLIENT_LIMIT, USERNAME_LIMIT, isLocked, lockAfterFailure } from "./signInThrottle";

const now = new Date("2026-10-02T12:00:00Z");

describe("failed-sign-in throttle", () => {
  it("locks a username for 15 minutes at the fifth failure within 15 minutes", () => {
    expect(USERNAME_LIMIT).toEqual({ failures: 5, windowMs: 900_000, lockMs: 900_000 });
    expect(lockAfterFailure(4, USERNAME_LIMIT, now)).toBeNull();
    expect(lockAfterFailure(5, USERNAME_LIMIT, now)).toEqual(new Date("2026-10-02T12:15:00Z"));
  });

  it("blocks a client for an hour at the twentieth failure within an hour", () => {
    expect(CLIENT_LIMIT).toEqual({ failures: 20, windowMs: 3_600_000, lockMs: 3_600_000 });
    expect(lockAfterFailure(19, CLIENT_LIMIT, now)).toBeNull();
    expect(lockAfterFailure(20, CLIENT_LIMIT, now)).toEqual(new Date("2026-10-02T13:00:00Z"));
  });

  it("is locked until the lock's end, and not at or after it", () => {
    const until = new Date("2026-10-02T12:15:00Z");
    expect(isLocked(null, now)).toBe(false);
    expect(isLocked(until, now)).toBe(true);
    expect(isLocked(until, until)).toBe(false);
  });
});
