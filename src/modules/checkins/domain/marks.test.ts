import { describe, expect, it } from "vitest";
import { decideMark, escalates, type MarkTarget } from "./marks";

const ID = "01900000-0000-4000-8000-000000000001";
const OTHER = "01900000-0000-4000-8000-000000000002";
const live: MarkTarget = { live: true, expired: false, markIds: [] };
const stub: MarkTarget = { live: false, expired: false, markIds: [] };
const expired: MarkTarget = { live: false, expired: true, markIds: [] };

describe("decideMark (E08 'Marks', 'Late mark')", () => {
  it("marks a live row with any mark, the later replacing the earlier", () => {
    for (const status of ["done", "not_reached", "needs_help"] as const) expect(decideMark(live, { id: ID, status })).toBe("mark");
    expect(decideMark({ ...live, markIds: [OTHER] }, { id: ID, status: "done" })).toBe("mark");
  });

  it("changes nothing for a mark id the row already took, live, late or expired", () => {
    for (const target of [live, stub, expired]) expect(decideMark({ ...target, markIds: [OTHER, ID] }, { id: ID, status: "needs_help" })).toBe("already");
  });

  it("knows a mark id sent again in upper case (a uuid's case is not part of it)", () => {
    const upper = "0190ABCD-0000-4000-8000-00000000000A";
    expect(decideMark({ ...live, markIds: [upper.toLowerCase()] }, { id: upper, status: "done" })).toBe("already");
    expect(decideMark({ ...stub, markIds: [upper.toLowerCase()] }, { id: upper, status: "needs_help" })).toBe("already");
  });

  it("escalates a late not reached or needs help on a row that left its round and has not expired; a late done has ended", () => {
    expect(decideMark(stub, { id: ID, status: "not_reached" })).toBe("escalate");
    expect(decideMark(stub, { id: ID, status: "needs_help" })).toBe("escalate");
    expect(decideMark(stub, { id: ID, status: "done" })).toBe("ended");
  });

  it("refuses a mark on a row that is not there, or a stub that expired", () => {
    expect(decideMark(null, { id: ID, status: "needs_help" })).toBe("round_ended");
    for (const status of ["done", "not_reached", "needs_help"] as const) expect(decideMark(expired, { id: ID, status })).toBe("round_ended");
  });

  it("tells the Hub about not reached and needs help, never done", () => {
    expect(escalates("not_reached")).toBe(true);
    expect(escalates("needs_help")).toBe(true);
    expect(escalates("done")).toBe(false);
  });
});
