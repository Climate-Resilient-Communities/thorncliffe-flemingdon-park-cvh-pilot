import { describe, expect, it } from "vitest";
import { REF_PATTERN } from "@/contracts/placeSubmission";
import { decideApply, decideReview, dueOf, makeRef, submissionFlags, waitedDays } from "./placeSubmission";

describe("makeRef", () => {
  it("makes a code in its one written form from eight random bytes", () => {
    expect(makeRef(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]))).toBe("2345-6789");
    expect(makeRef(new Uint8Array([29, 30, 255, 128, 64, 10, 11, 12]))).toMatch(REF_PATTERN);
    for (let n = 0; n < 256; n += 1) expect(makeRef(new Uint8Array(8).fill(n))).toMatch(REF_PATTERN);
  });

  it("refuses fewer than eight bytes", () => {
    expect(() => makeRef(new Uint8Array(7))).toThrow(RangeError);
  });
});

describe("the decision (O-09, O-10)", () => {
  it("is made once, on a suggestion that exists", () => {
    expect(decideReview({ status: "pending" })).toEqual({ ok: true });
    expect(decideReview({ status: "accepted" })).toEqual({ ok: false, error: "already_decided" });
    expect(decideReview({ status: "declined" })).toEqual({ ok: false, error: "already_decided" });
    expect(decideReview(null)).toEqual({ ok: false, error: "not_found" });
  });

  it("is applied to the catalogue once, and only when accepted", () => {
    expect(decideApply({ status: "accepted", appliedAt: null })).toEqual({ ok: true });
    expect(decideApply({ status: "accepted", appliedAt: new Date() })).toEqual({ ok: false, error: "already_applied" });
    expect(decideApply({ status: "pending", appliedAt: null })).toEqual({ ok: false, error: "not_accepted" });
    expect(decideApply({ status: "declined", appliedAt: null })).toEqual({ ok: false, error: "not_accepted" });
    expect(decideApply(null)).toEqual({ ok: false, error: "not_found" });
  });
});

describe("the queue's flags (O-08)", () => {
  const add = { kind: "add" as const, category: "Food Banks", cost: "free" as const, name: "Thursday food bank", what: "Free groceries." };

  it("flags a missing kind of place, a cost and words about money", () => {
    expect(submissionFlags(add)).toEqual([]);
    expect(submissionFlags({ ...add, category: null })).toEqual(["noCat"]);
    expect(submissionFlags({ ...add, cost: "fee" })).toEqual(["fee"]);
    expect(submissionFlags({ ...add, cost: "low" })).toEqual(["lowCost"]);
    expect(submissionFlags({ ...add, name: "Phone repair, 20% off" })).toEqual(["words"]);
    expect(submissionFlags({ ...add, what: "Sale on cases this week" })).toEqual(["words"]);
    expect(submissionFlags({ ...add, what: "Pay what you can" })).toEqual(["words"]);
  });

  it("does not read money into ordinary words, and flags nothing on a correction", () => {
    expect(submissionFlags({ ...add, what: "Help with paperwork and taxes for seniors." })).toEqual([]);
    expect(submissionFlags({ ...add, kind: "correct", category: null, cost: "fee" })).toEqual([]);
  });
});

describe("the week residents are told (R-21)", () => {
  const sent = new Date("2026-11-01T15:00:00Z");

  it("counts whole days since a suggestion was sent", () => {
    expect(waitedDays(sent, new Date("2026-11-01T20:00:00Z"))).toBe(0);
    expect(waitedDays(sent, new Date("2026-11-03T14:59:00Z"))).toBe(1);
    expect(waitedDays(sent, new Date("2026-11-03T15:00:00Z"))).toBe(2);
    expect(waitedDays(sent, new Date("2026-10-31T15:00:00Z"))).toBe(0);
  });

  it("is due in some days, tomorrow, today, then overdue", () => {
    expect(dueOf(0)).toEqual({ kind: "dueIn", days: 7 });
    expect(dueOf(5)).toEqual({ kind: "dueIn", days: 2 });
    expect(dueOf(6)).toEqual({ kind: "dueTomorrow" });
    expect(dueOf(7)).toEqual({ kind: "dueToday" });
    expect(dueOf(9)).toEqual({ kind: "overdue", days: 2 });
  });
});
