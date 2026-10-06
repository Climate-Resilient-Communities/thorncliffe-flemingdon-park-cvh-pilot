import { describe, expect, it } from "vitest";
import { CHECKIN_CONSENT_VERSION } from "@/contracts/checkin";
import { NO_REQUEST, draftOf, moved, needsConsent, problemOf, requestBody, whereOptions, type HeldRequest } from "./request";

const F1 = "0190f000-0000-7000-8000-000000000001";
const F2 = "0190f000-0000-7000-8000-000000000002";
const BUILDINGS = [
  { rsn: "100", address: "1 Test Rd", floors: [{ id: F1, label: "1" }, { id: F2, label: "2" }] },
  { rsn: "200", address: "2 Test Rd", floors: [] },
];
const OPTIONS = whereOptions([{ rsn: "100", floors: [F1, F2] }, { rsn: "200", floors: [] }], BUILDINGS);
const HELD: HeldRequest = { rsn: "100", floorId: F1, method: "call" };

describe("the check-in section's rules (S08.05)", () => {
  it("offers the saved buildings' chosen floors as 'where I live', never a building saved without a floor", () => {
    expect(OPTIONS).toEqual([
      { rsn: "100", floorId: F1, address: "1 Test Rd", floorLabel: "1" },
      { rsn: "100", floorId: F2, address: "1 Test Rd", floorLabel: "2" },
    ]);
    expect(whereOptions([{ rsn: "100", floors: [F2] }], BUILDINGS)).toHaveLength(1);
  });

  it("on the sign-up: a request needs a place, a method and the consent; with none, nothing is sent", () => {
    const on = { ...NO_REQUEST, on: true };
    expect(problemOf(NO_REQUEST, null, OPTIONS)).toBeNull();
    expect(requestBody(NO_REQUEST, null, OPTIONS, "signup")).toBeUndefined();
    expect(problemOf(on, null, OPTIONS)).toBe("place");
    expect(problemOf({ ...on, rsn: "100", floorId: F2 }, null, OPTIONS)).toBe("method");
    expect(problemOf({ ...on, rsn: "100", floorId: F2, method: "text" }, null, OPTIONS)).toBe("consent");
    const ready = { ...on, rsn: "100", floorId: F2, method: "text" as const, agreed: true };
    expect(problemOf(ready, null, OPTIONS)).toBeNull();
    expect(requestBody(ready, null, OPTIONS, "signup")).toEqual({ rsn: "100", floor: F2, method: "text", consent_version: CHECKIN_CONSENT_VERSION });
  });

  it("on the edit page: the method alone changes with no consent; another place needs it again; withdrawing sends none", () => {
    const kept = draftOf(HELD);
    expect(needsConsent(kept, HELD)).toBe(false);
    expect(requestBody({ ...kept, method: "text" }, HELD, OPTIONS, "edit")).toEqual({ rsn: "100", floor: F1, method: "text", consent_version: null });
    const elsewhere = { ...kept, floorId: F2 };
    expect(problemOf(elsewhere, HELD, OPTIONS)).toBe("consent");
    expect(requestBody({ ...elsewhere, agreed: true }, HELD, OPTIONS, "edit")).toMatchObject({ floor: F2, consent_version: CHECKIN_CONSENT_VERSION });
    expect(requestBody({ ...kept, on: false }, HELD, OPTIONS, "edit")).toBeNull();
    expect(requestBody(NO_REQUEST, null, OPTIONS, "edit")).toBeUndefined();
  });

  it("on the edit page: a request whose place is no longer saved is withdrawn, not a problem, unless a new place is asked for", () => {
    const options = whereOptions([{ rsn: "100", floors: [F2] }], BUILDINGS);
    expect(moved(HELD, options)).toBe(true);
    expect(moved(HELD, OPTIONS)).toBe(false);
    expect(problemOf(draftOf(HELD), HELD, options)).toBeNull();
    expect(requestBody(draftOf(HELD), HELD, options, "edit")).toBeNull();
    expect(problemOf({ ...draftOf(HELD), floorId: F2, agreed: true }, HELD, options)).toBeNull();
  });
});
