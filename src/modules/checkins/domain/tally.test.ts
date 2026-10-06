import { describe, expect, it } from "vitest";
import { TALLY_STATUSES, countsByPlace, isTallyStatus, noCounts, stillInRound, type TallyCount } from "./tally";

const count = (floorId: string, status: TallyCount["status"], n: number, alertId = "thread-1"): TallyCount => ({ alertId, rsn: "7001", floorId, status, n });

describe("the round tally read back (E08 'Round tally')", () => {
  it("has the requests, then the five outcomes", () => {
    expect(TALLY_STATUSES).toEqual(["requested", "done", "not_reached", "needs_help", "withdrawn", "unmarked"]);
    expect(isTallyStatus("unmarked")).toBe(true);
    expect(isTallyStatus("pending")).toBe(false);
  });

  it("gathers each place's counts, every status present, in the order the places first appear", () => {
    const places = countsByPlace([count("f2", "requested", 2), count("f1", "requested", 1), count("f2", "done", 1), count("f2", "withdrawn", 1), count("f1", "requested", 1, "thread-2")]);
    expect(places).toEqual([
      { alertId: "thread-1", rsn: "7001", floorId: "f2", counts: { ...noCounts(), requested: 2, done: 1, withdrawn: 1 } },
      { alertId: "thread-1", rsn: "7001", floorId: "f1", counts: { ...noCounts(), requested: 1 } },
      { alertId: "thread-2", rsn: "7001", floorId: "f1", counts: { ...noCounts(), requested: 1 } },
    ]);
  });

  it("says how many requests have no outcome yet: none once every row has left its round", () => {
    expect(stillInRound({ ...noCounts(), requested: 3, done: 1 })).toBe(2);
    expect(stillInRound({ requested: 6, done: 1, not_reached: 1, needs_help: 1, withdrawn: 2, unmarked: 1 })).toBe(0);
    // A row counted twice would show as a negative number.
    expect(stillInRound({ ...noCounts(), requested: 1, done: 1, withdrawn: 1 })).toBe(-1);
  });
});
