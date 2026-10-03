import { describe, expect, it } from "vitest";
import type { BuildingFloorPlan } from "@/modules/places";
import { catalogText, forbiddenMessage, logScreen } from "./view";

const PLANS: BuildingFloorPlan[] = [
  { rsn: "7001", address: "45 Thorncliffe Park Dr", neighbourhoodId: "TP", neighbourhoodName: "Thorncliffe Park", floors: [{ id: "01900000-0000-7000-8000-000000000f01", label: "G", sortOrder: 0 }] },
  { rsn: "7002", address: "4 Milepost Pl", neighbourhoodId: "FP", neighbourhoodName: "Flemingdon Park", floors: [] },
];
// 9:30 a.m. in Toronto.
const NOW = new Date("2026-10-04T13:30:00.000Z");

describe("the log screen", () => {
  it("is for the acknowledgement with its own title, lead and button", () => {
    const screen = logScreen(PLANS, NOW, { kind: "ack" });
    expect(screen.kind).toBe("ack");
    expect(screen.title).toBe("Log a disruption");
    expect(screen.submit).toBe(catalogText("submit"));
    expect(screen.benchmark).toContain("5 to 10 minutes");
  });

  it("is the alert composer's first step for an update, with its own words", () => {
    const screen = logScreen(PLANS, NOW, { kind: "update" });
    expect(screen.kind).toBe("update");
    expect(screen.title).toBe("Compose an alert");
    expect(screen.lead).not.toBe(logScreen(PLANS, NOW, { kind: "ack" }).lead);
    expect(screen.submit).toBe(catalogText("submitAlert"));
  });

  it("lists the building types and then the neighbourhood-wide ones, none ticked", () => {
    const { types } = logScreen(PLANS, NOW, { kind: "ack" });
    expect(types.building.items.map((item) => item.id)).toEqual(["power", "water", "elevator", "fire", "flood", "other"]);
    expect(types.neighbourhood.items.map((item) => item.id)).toEqual(["heat", "smoke", "winter"]);
    expect([...types.building.items, ...types.neighbourhood.items].every((item) => !item.checked && item.label.length > 0)).toBe(true);
    expect(types.neighbourhood.hint).toContain("neighbourhood");
  });

  it("keeps the types typed before a refusal", () => {
    const { types } = logScreen(PLANS, NOW, { kind: "ack", typed: { types: ["power", "heat"] } });
    expect([...types.building.items, ...types.neighbourhood.items].filter((item) => item.checked).map((item) => item.id)).toEqual(["power", "heat"]);
  });

  it("starts the time of the first report at now, as Toronto wall-clock time, and keeps what was typed after a refusal", () => {
    expect(logScreen(PLANS, NOW, { kind: "ack" }).when.fields).toEqual({ date: "2026-10-04", time: "09:30", fold: "" });
    const typed = { date: "2026-10-03", time: "23:15", fold: "" as const };
    expect(logScreen(PLANS, NOW, { kind: "ack", typed: { when: typed } }).when.fields).toEqual(typed);
    expect(logScreen(PLANS, NOW, { kind: "ack" }).when.timeLabel).toContain("Toronto time");
  });

  it("offers the same place picker as the place page, with nothing chosen", () => {
    const { place } = logScreen(PLANS, NOW, { kind: "ack" });
    expect(place.fields.scope.neighbourhood.checked).toBe(false);
    expect(place.fields.scope.buildings.checked).toBe(false);
    expect(JSON.stringify(place.fields)).toContain("45 Thorncliffe Park Dr");
    expect(JSON.stringify(place.fields)).toContain("Flemingdon Park");
  });

  it("has a refusal for a role that may not log", () => {
    expect(forbiddenMessage()).toBe("Only a Coordinator or an Admin can log a disruption.");
  });
});
