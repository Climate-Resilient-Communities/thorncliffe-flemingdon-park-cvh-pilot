import { describe, expect, it } from "vitest";
import type { Audience } from "@/contracts/audience";
import { ALERT_TEXT_MAX, contentRefusal } from "@/modules/alerting";
import type { BuildingFloorPlan } from "@/modules/places";
import { suggestedAck } from "./suggestAck";

const floor = (rsn: string, index: number, label: string) => ({ id: `01900000-0000-7000-8000-${rsn.padStart(8, "0")}${String(index).padStart(4, "0")}`, label, sortOrder: index });
const plan = (rsn: string, address: string, labels: string[], nb: "TP" | "FP" = "TP"): BuildingFloorPlan => ({
  rsn,
  address,
  neighbourhoodId: nb,
  neighbourhoodName: nb === "TP" ? "Thorncliffe Park" : "Flemingdon Park",
  floors: labels.map((label, index) => floor(rsn, index, label)),
});
const PLANS = [plan("1", "4 Milepost Pl", ["G", "1", "2", "3", "4", "5"]), plan("2", "26 Thorncliffe Park Dr", ["G", "1", "2"]), plan("3", "35 St Dennis Dr", ["1", "2"], "FP")];

const buildings = (types: string[], chosen: { rsn: string; floors: string[] | null }[]): Audience => ({ scope: "buildings", buildings: chosen, groups: [], types: [...types].sort() });
const nbhd = (types: string[], ids: string[]): Audience => ({ scope: "neighbourhood", neighbourhood_ids: ids, groups: [], types: [...types].sort() });

describe("the suggested acknowledgement", () => {
  it("is the prototype's wording for the type, with the building named", () => {
    expect(suggestedAck(["power"], buildings(["power"], [{ rsn: "1", floors: null }]), PLANS)).toBe("Power is out at 4 Milepost Pl. We are finding out why. More information to come.");
    expect(suggestedAck(["elevator"], buildings(["elevator"], [{ rsn: "2", floors: null }]), PLANS)).toBe("The elevator is not working at 26 Thorncliffe Park Dr. We are finding out why. More information to come.");
    expect(suggestedAck(["other"], buildings(["other"], [{ rsn: "2", floors: null }]), PLANS)).toBe("Something is wrong at 26 Thorncliffe Park Dr. We are finding out what. More information to come.");
  });

  it("names the floors, by the building's own labels, one floor or several", () => {
    const some = buildings(["water"], [{ rsn: "1", floors: [PLANS[0].floors[3].id, PLANS[0].floors[4].id, PLANS[0].floors[5].id] }]);
    expect(suggestedAck(["water"], some, PLANS)).toContain("Water is off at 4 Milepost Pl, floors 3, 4 and 5.");
    const one = buildings(["water"], [{ rsn: "1", floors: [PLANS[0].floors[0].id] }]);
    expect(suggestedAck(["water"], one, PLANS)).toContain("at 4 Milepost Pl, floor G.");
  });

  it("names several buildings, each with its own floors", () => {
    const audience = buildings(["flood"], [{ rsn: "1", floors: [PLANS[0].floors[1].id] }, { rsn: "2", floors: null }]);
    expect(suggestedAck(["flood"], audience, PLANS)).toContain("Water is leaking at 4 Milepost Pl, floor 1 and 26 Thorncliffe Park Dr.");
  });

  it("names the neighbourhood for a neighbourhood-wide type or a whole-neighbourhood audience", () => {
    expect(suggestedAck(["power"], nbhd(["power"], ["TP", "FP"]), PLANS)).toBe("Power is out in Thorncliffe Park and Flemingdon Park. We are finding out why. More information to come.");
    expect(suggestedAck(["heat"], nbhd(["heat"], ["TP"]), PLANS)).toContain("dangerously hot");
  });

  it("says several things in one sentence for several types", () => {
    const text = suggestedAck(["power", "water"], buildings(["power", "water"], [{ rsn: "1", floors: null }]), PLANS);
    expect(text).toBe("Several things are wrong at 4 Milepost Pl: power is out and water is off. We are finding out more. More information to come.");
  });

  it("falls back to the place's id for a place it has no name for", () => {
    expect(suggestedAck(["power"], buildings(["power"], [{ rsn: "999", floors: null }]), PLANS)).toContain("at 999.");
  });

  it("is always a text the alert accepts: a long list of buildings is summarised", () => {
    const many = Array.from({ length: 40 }, (_, index) => plan(String(1000 + index), `${index + 1000} A Very Long Street Name Boulevard West`, ["G", "1"]));
    const audience = buildings(["power", "water", "elevator"], many.map((p) => ({ rsn: p.rsn, floors: [p.floors[0].id] })));

    const text = suggestedAck(["power", "water", "elevator"], audience, many);

    expect(text.length).toBeLessThanOrEqual(ALERT_TEXT_MAX);
    expect(text).toContain("40 buildings");
    expect(contentRefusal({ text, types: ["elevator", "power", "water"], audience, phase: "problem", validUntil: new Date() })).toBeNull();
  });
});
