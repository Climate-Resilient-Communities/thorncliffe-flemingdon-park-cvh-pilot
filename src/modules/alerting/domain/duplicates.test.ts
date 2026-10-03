import { describe, expect, it } from "vitest";
import type { Audience } from "../../../contracts/audience";
import { audiencesOverlap, possibleDuplicateOf } from "./duplicates";

const buildings = (rsns: string[], types = ["power"], groups: Audience["groups"] = [], floors: string[] | null = null): Audience => ({
  scope: "buildings",
  buildings: rsns.map((rsn) => ({ rsn, floors })),
  groups,
  types,
});
const nbhd = (ids: string[], types = ["power"], groups: Audience["groups"] = []): Audience => ({ scope: "neighbourhood", neighbourhood_ids: ids, groups, types });

const NEIGHBOURHOOD_OF: Record<string, string> = { "100": "TP", "200": "TP", "300": "FP" };
const of = (rsn: string) => NEIGHBOURHOOD_OF[rsn] ?? null;

describe("audiencesOverlap", () => {
  it("overlaps buildings that share a building, and not buildings that share none", () => {
    expect(audiencesOverlap(buildings(["100", "200"]), buildings(["200", "300"]), of)).toBe(true);
    expect(audiencesOverlap(buildings(["100"]), buildings(["200"]), of)).toBe(false);
  });

  it("does not let floors narrow it: a profile with no floor recorded matches every floor of its building (AD-7)", () => {
    expect(audiencesOverlap(buildings(["100"], ["power"], [], ["a"]), buildings(["100"], ["power"], [], ["b"]), of)).toBe(true);
  });

  it("overlaps neighbourhoods that share one", () => {
    expect(audiencesOverlap(nbhd(["TP"]), nbhd(["TP", "FP"]), of)).toBe(true);
    expect(audiencesOverlap(nbhd(["TP"]), nbhd(["FP"]), of)).toBe(false);
  });

  it("overlaps a neighbourhood with a building in it, either way round, and not with a building elsewhere", () => {
    expect(audiencesOverlap(nbhd(["TP"]), buildings(["100"]), of)).toBe(true);
    expect(audiencesOverlap(buildings(["100"]), nbhd(["TP"]), of)).toBe(true);
    expect(audiencesOverlap(nbhd(["TP"]), buildings(["300"]), of)).toBe(false);
    expect(audiencesOverlap(nbhd(["TP"]), buildings(["999"]), of)).toBe(false);
  });

  it("needs a type in common", () => {
    expect(audiencesOverlap(buildings(["100"], ["power"]), buildings(["100"], ["water"]), of)).toBe(false);
    expect(audiencesOverlap(buildings(["100"], ["power", "water"]), buildings(["100"], ["water"]), of)).toBe(true);
  });

  it("lets groups narrow: two named sets with nothing in common reach nobody in common, and no group is everyone", () => {
    expect(audiencesOverlap(buildings(["100"], ["power"], ["seniors"]), buildings(["100"], ["power"], ["families"]), of)).toBe(false);
    expect(audiencesOverlap(buildings(["100"], ["power"], ["seniors", "families"]), buildings(["100"], ["power"], ["families"]), of)).toBe(true);
    expect(audiencesOverlap(buildings(["100"], ["power"], ["seniors"]), buildings(["100"]), of)).toBe(true);
  });
});

describe("possibleDuplicateOf", () => {
  const own = { alertId: "mine", audience: buildings(["100"]) };

  it("is the first candidate that overlaps, in the order given (newest first)", () => {
    const found = possibleDuplicateOf(own, [
      { alertId: "elsewhere", audience: buildings(["300"]) },
      { alertId: "newer", audience: nbhd(["TP"]) },
      { alertId: "older", audience: buildings(["100"]) },
    ], of);

    expect(found).toBe("newer");
  });

  it("is null when nothing overlaps, and never the thread itself", () => {
    expect(possibleDuplicateOf(own, [{ alertId: "elsewhere", audience: buildings(["300"]) }], of)).toBeNull();
    expect(possibleDuplicateOf(own, [{ alertId: "mine", audience: buildings(["100"]) }], of)).toBeNull();
    expect(possibleDuplicateOf(own, [], of)).toBeNull();
  });
});
