import { describe, expect, it } from "vitest";
import type { BuildingList } from "@/contracts/buildingList";
import type { FeedV1 } from "@/contracts/feed";
import { homeRows } from "./home-view";

const FLOOR = "0198a000-0000-7000-8000-0000000000a1";
const list: BuildingList = {
  v: 1,
  generated_at: "2026-10-01T12:00:00.000Z",
  buildings: [
    { rsn: "100", address: "1 Test St", neighbourhoodId: "TP", neighbourhood: "Thorncliffe Park", floors: [{ id: FLOOR, label: "1" }] },
    { rsn: "200", address: "2 Test St", neighbourhoodId: "FP", neighbourhood: "Flemingdon Park", floors: [] },
    { rsn: "300", address: "3 Test St", neighbourhoodId: "TP", neighbourhood: "Thorncliffe Park", floors: [] },
  ],
};
const feed = (buildings: FeedV1["places"]["buildings"]): FeedV1 => ({
  v: 1,
  feed_version: 1,
  server_now: "2026-10-01T15:00:00.000Z",
  threads: [],
  places: {
    buildings,
    neighbourhoods: [
      { id: "TP", status: "none", verified: true },
      { id: "FP", status: "active", verified: false },
    ],
  },
});
const all = feed([
  { rsn: "100", status: "none", verified: true },
  { rsn: "200", status: "in_progress", verified: true },
  { rsn: "300", status: "resolved", verified: true },
]);

describe("homeRows", () => {
  it("lists the chosen buildings in the order chosen, each with its status from the feed and its address from the list", () => {
    const rows = homeRows({ chosen: ["300", "100"], list, view: { feed: all, failed: false } });

    expect(rows.buildings.map((row) => [row.rsn, row.address, row.shown])).toEqual([
      ["300", "3 Test St", { kind: "status", status: "resolved", verified: true }],
      ["100", "1 Test St", { kind: "status", status: "none", verified: true }],
    ]);
  });

  it("shows only the neighbourhoods of the chosen buildings, once each", () => {
    const rows = homeRows({ chosen: ["100", "300"], list, view: { feed: all, failed: false } });

    expect(rows.neighbourhoods.map((row) => row.id)).toEqual(["TP"]);
  });

  it("with no chosen building, shows every neighbourhood in the feed", () => {
    const rows = homeRows({ chosen: [], list, view: { feed: all, failed: false } });

    expect(rows.buildings).toEqual([]);
    expect(rows.neighbourhoods.map((row) => [row.id, row.shown])).toEqual([
      ["TP", { kind: "status", status: "none", verified: true }],
      ["FP", { kind: "status", status: "active", verified: false }],
    ]);
  });

  it("shows every neighbourhood when the list cannot say which are the resident's", () => {
    const rows = homeRows({ chosen: ["100"], list: null, view: { feed: all, failed: false } });

    expect(rows.buildings[0].address).toBeUndefined();
    expect(rows.neighbourhoods.map((row) => row.id)).toEqual(["TP", "FP"]);
  });

  it("says Not known, never none, for a building the feed does not list", () => {
    const rows = homeRows({ chosen: ["100", "999"], list, view: { feed: feed([{ rsn: "100", status: "none", verified: true }]), failed: false } });

    expect(rows.buildings[1].shown).toEqual({ kind: "unknown" });
  });

  it("says it is checking until the first answer, and Not known when the first ask failed: never none", () => {
    expect(homeRows({ chosen: ["100"], list, view: { feed: null, failed: false } }).buildings[0].shown).toEqual({ kind: "checking" });
    expect(homeRows({ chosen: ["100"], list, view: { feed: null, failed: true } }).buildings[0].shown).toEqual({ kind: "unknown" });
    expect(homeRows({ chosen: [], list, view: { feed: null, failed: true } }).neighbourhoods.map((row) => row.shown.kind)).toEqual(["unknown", "unknown"]);
  });

  it("keeps showing the last feed when a later ask fails", () => {
    const rows = homeRows({ chosen: ["200"], list, view: { feed: all, failed: true } });

    expect(rows.buildings[0].shown).toEqual({ kind: "status", status: "in_progress", verified: true });
  });
});
