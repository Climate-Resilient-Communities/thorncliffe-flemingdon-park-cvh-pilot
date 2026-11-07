import { describe, expect, it } from "vitest";
import { decideSpaceChange, isUnconfirmed, spaceTotals, withStatus, type SpaceChangeInput } from "./space";

const input = (change: Partial<SpaceChangeInput> = {}): SpaceChangeInput => ({ status: "open", purpose: "warming", capacityMax: "60", capacityNow: "31", ...change });

describe("decideSpaceChange", () => {
  it("takes an open space with its purpose, limit and count", () => {
    expect(decideSpaceChange(input())).toEqual({ ok: true, next: { status: "open", purpose: "warming", capacityMax: 60, capacityNow: 31 } });
    expect(decideSpaceChange(input({ status: " full ", capacityNow: "60" }))).toEqual({ ok: true, next: { status: "full", purpose: "warming", capacityMax: 60, capacityNow: 60 } });
  });

  it("leaves the count blank when nobody counted, and drops it when the space is not open or full", () => {
    expect(decideSpaceChange(input({ capacityNow: "" }))).toMatchObject({ ok: true, next: { capacityNow: null } });
    expect(decideSpaceChange(input({ status: "closed", capacityNow: "12" }))).toMatchObject({ ok: true, next: { status: "closed", capacityNow: null } });
    expect(decideSpaceChange(input({ status: "not_activated", capacityNow: "abc" }))).toMatchObject({ ok: true, next: { capacityNow: null } });
  });

  it("refuses an unknown status or purpose, a limit outside 1 to 2000, a count that is not a whole number or above the limit", () => {
    expect(decideSpaceChange(input({ status: "opened" }))).toEqual({ ok: false, error: "status_unknown" });
    expect(decideSpaceChange(input({ purpose: "clean air" }))).toEqual({ ok: false, error: "purpose_unknown" });
    for (const capacityMax of ["0", "2001", "-3", "4.5", "", "many"]) expect(decideSpaceChange(input({ capacityMax })), capacityMax).toEqual({ ok: false, error: "capacity_max_invalid" });
    for (const capacityNow of ["-1", "2.5", "twelve"]) expect(decideSpaceChange(input({ capacityNow })), capacityNow).toEqual({ ok: false, error: "capacity_now_invalid" });
    expect(decideSpaceChange(input({ capacityNow: "61" }))).toEqual({ ok: false, error: "capacity_over" });
  });
});

describe("withStatus (P-07's buttons)", () => {
  it("keeps the purpose and limit, and keeps the count only while the space stays open or full", () => {
    const current = { status: "open" as const, purpose: "charging" as const, capacityMax: 25, capacityNow: 9 };
    expect(withStatus(current, "full")).toEqual({ status: "full", purpose: "charging", capacityMax: "25", capacityNow: "9" });
    expect(withStatus(current, "closed")).toEqual({ status: "closed", purpose: "charging", capacityMax: "25", capacityNow: "" });
    expect(decideSpaceChange(withStatus({ ...current, capacityNow: null }, "open"))).toMatchObject({ ok: true, next: { capacityNow: null } });
  });
});

describe("isUnconfirmed", () => {
  const now = new Date("2026-11-07T18:00:00Z");
  it("is true for an open or full space confirmed more than 4 hours ago, or never", () => {
    expect(isUnconfirmed("open", new Date("2026-11-07T13:59:00Z"), now)).toBe(true);
    expect(isUnconfirmed("full", null, now)).toBe(true);
    expect(isUnconfirmed("open", new Date("2026-11-07T14:00:00Z"), now)).toBe(false);
  });

  it("is never true for a space residents are not shown", () => {
    expect(isUnconfirmed("closed", null, now)).toBe(false);
    expect(isUnconfirmed("not_activated", new Date(0), now)).toBe(false);
  });
});

describe("spaceTotals", () => {
  it("counts the spaces by status, and the people and places of the open and full ones only", () => {
    expect(
      spaceTotals([
        { status: "open", capacityMax: 60, capacityNow: 31 },
        { status: "full", capacityMax: 50, capacityNow: 50 },
        { status: "open", capacityMax: 45, capacityNow: null },
        { status: "closed", capacityMax: 35, capacityNow: null },
        { status: "not_activated", capacityMax: 80, capacityNow: null },
      ]),
    ).toEqual({ byStatus: { open: 2, full: 1, closed: 1, not_activated: 1 }, peopleNow: 81, placesMax: 155 });
  });
});
