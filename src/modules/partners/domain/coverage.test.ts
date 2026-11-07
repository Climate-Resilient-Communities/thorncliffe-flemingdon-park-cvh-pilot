import { describe, expect, it } from "vitest";
import { coverageCounts, coverageOf, type CoverageStatement } from "./coverage";

const statement = (id: string, kind: CoverageStatement["kind"], change: Partial<CoverageStatement> = {}): CoverageStatement => ({ id, kind, orgId: "HUB", claimedBy: null, answers: null, ...change });

describe("coverageOf (P-04)", () => {
  it("puts what an organisation is doing under covered, and a need nobody took or answered under not covered", () => {
    const items = coverageOf([statement("ST1", "doing"), statement("ST2", "need"), statement("ST3", "cannot_cover")], []);
    expect(items.map((item) => [item.id, item.group, item.reason])).toEqual([
      ["ST1", "covered", "doing"],
      ["ST2", "gap", "not_taken"],
      ["ST3", "gap", "cannot_cover"],
    ]);
  });

  it("moves a need someone took on to being worked on, and one only offered to waiting, with the offer folded into it", () => {
    const items = coverageOf(
      [statement("ST1", "need", { claimedBy: "CRC" }), statement("ST2", "need"), statement("ST3", "can_take", { orgId: "TNO", answers: "ST2" }), statement("ST4", "can_take", { orgId: "CITY" })],
      [],
    );
    expect(items).toEqual([
      { source: "statement", id: "ST1", group: "working", reason: "taken", offeredBy: null },
      { source: "statement", id: "ST2", group: "waiting", reason: "offered", offeredBy: "TNO" },
      { source: "statement", id: "ST4", group: "waiting", reason: "offer_standing", offeredBy: null },
    ]);
  });

  it("shows a standing commitment as covered once confirmed, a gap once declined, and waiting until then", () => {
    const items = coverageOf([], [
      { id: "C1", orgId: "HUB", forDisruption: "confirmed" },
      { id: "C2", orgId: "FHC", forDisruption: "declined" },
      { id: "C3", orgId: "CRC", forDisruption: null },
    ]);
    expect(items.map((item) => [item.id, item.group, item.reason])).toEqual([
      ["C1", "covered", "commitment_confirmed"],
      ["C2", "gap", "commitment_declined"],
      ["C3", "waiting", "commitment_unconfirmed"],
    ]);
    expect(coverageCounts(items)).toEqual({ gap: 1, working: 0, waiting: 1, covered: 1 });
  });
});
