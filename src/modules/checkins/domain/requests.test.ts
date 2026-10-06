import { describe, expect, it } from "vitest";
import type { Audience } from "../../../contracts/audience";
import { isRoundThread, lockOrder, placeKept, planRequestChange, roundMatches, type CheckinRequest } from "./requests";

const F1 = "0190f000-0000-7000-8000-000000000001";
const F2 = "0190f000-0000-7000-8000-000000000002";
const HELD: CheckinRequest = { method: "call", rsn: "100", floorId: F1, consentVersion: "2026-10-06.1" };
const PLACE = { rsn: "100", floorId: F1, neighbourhoodId: "TP" };

const neighbourhood = (ids: string[], over: Partial<Audience> = {}): Audience => ({ scope: "neighbourhood", neighbourhood_ids: ids, groups: [], types: ["heat"], ...over }) as Audience;
const buildings = (list: { rsn: string; floors: string[] | null }[], over: Partial<Audience> = {}): Audience => ({ scope: "buildings", buildings: list, groups: [], types: ["power"], ...over }) as Audience;

describe("roundMatches (E08 'Round': the 'where I live' place against the thread's audience, by matches)", () => {
  it("a neighbourhood audience covers every building of its neighbourhoods", () => {
    expect(roundMatches(neighbourhood(["TP"]), PLACE)).toBe(true);
    expect(roundMatches(neighbourhood(["FP"]), PLACE)).toBe(false);
  });

  it("a buildings audience covers its buildings, and only its floors when it lists them", () => {
    expect(roundMatches(buildings([{ rsn: "100", floors: null }]), PLACE)).toBe(true);
    expect(roundMatches(buildings([{ rsn: "100", floors: [F1] }]), PLACE)).toBe(true);
    expect(roundMatches(buildings([{ rsn: "100", floors: [F2] }]), PLACE)).toBe(false);
    expect(roundMatches(buildings([{ rsn: "200", floors: null }]), PLACE)).toBe(false);
  });

  it("the place alone decides: the audience's groups play no part", () => {
    expect(roundMatches(neighbourhood(["TP"], { groups: ["seniors"] }), PLACE)).toBe(true);
  });
});

describe("isRoundThread, placeKept and lockOrder", () => {
  it("a thread is a round's when one of its types is a round type", () => {
    expect(isRoundThread(["water", "power"], ["heat", "power"])).toBe(true);
    expect(isRoundThread(["water"], ["heat", "power"])).toBe(false);
  });

  it("the request's place is kept only when its building and that floor are among the new places", () => {
    expect(placeKept(HELD, [{ rsn: "100", floorId: F1 }])).toBe(true);
    expect(placeKept(HELD, [{ rsn: "100", floorId: F2 }, { rsn: "100", floorId: null }])).toBe(false);
  });

  it("locks rows in one order, without repeats", () => {
    expect(lockOrder(["b", "a", "b"])).toEqual(["a", "b"]);
  });
});

describe("planRequestChange (the edit page: E08 'Check-in request', 'Changed location')", () => {
  const places = [{ rsn: "100", floorId: F1 }, { rsn: "100", floorId: F2 }];
  const ask = (floorId: string, consentVersion: string | null, method: "call" | "text" = "call") => ({ rsn: "100", floorId, method, consentVersion });

  it("with no request sent, withdraws the one held only when its place is no longer saved", () => {
    expect(planRequestChange(HELD, places, undefined)).toEqual({ withdraw: false, ask: null, method: null });
    expect(planRequestChange(HELD, [{ rsn: "100", floorId: F2 }], undefined)).toEqual({ withdraw: true, ask: null, method: null });
    expect(planRequestChange(null, [], undefined)).toEqual({ withdraw: false, ask: null, method: null });
  });

  it("withdraws on none", () => {
    expect(planRequestChange(HELD, places, null)).toEqual({ withdraw: true, ask: null, method: null });
    expect(planRequestChange(null, places, null)).toEqual({ withdraw: false, ask: null, method: null });
  });

  it("changes only the method at the same place, with no new consent", () => {
    expect(planRequestChange(HELD, places, ask(F1, null, "text"))).toEqual({ withdraw: false, ask: null, method: "text" });
    expect(planRequestChange(HELD, places, ask(F1, null))).toEqual({ withdraw: false, ask: null, method: null });
  });

  it("asks at a new place only with the consent confirmed again, withdrawing the one held", () => {
    expect(planRequestChange(HELD, places, ask(F2, null))).toBe("consent_missing");
    expect(planRequestChange(null, places, ask(F1, null))).toBe("consent_missing");
    expect(planRequestChange(HELD, places, ask(F2, "2026-10-06.1"))).toEqual({
      withdraw: true,
      ask: { method: "call", rsn: "100", floorId: F2, consentVersion: "2026-10-06.1" },
      method: null,
    });
    expect(planRequestChange(null, places, ask(F1, "2026-10-06.1", "text"))).toEqual({
      withdraw: false,
      ask: { method: "text", rsn: "100", floorId: F1, consentVersion: "2026-10-06.1" },
      method: null,
    });
  });
});
