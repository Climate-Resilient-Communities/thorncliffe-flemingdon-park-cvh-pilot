import { describe, expect, it } from "vitest";
import type { Audience } from "../../../contracts/audience";
import { NO_STATUS } from "./feed";
import { RESOLVED_WINDOW_MS, statusOf, statusesOf, type StatusEntry, type StatusPlace, type StatusThread } from "./status";

const NOW = new Date("2026-10-03T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const hoursAgo = (h: number) => minutesAgo(h * 60);

const buildings = (...rsns: string[]): Audience => ({ scope: "buildings", buildings: rsns.map((rsn) => ({ rsn, floors: null })), groups: [], types: ["power"] });
const neighbourhood = (...ids: string[]): Audience => ({ scope: "neighbourhood", neighbourhood_ids: ids, groups: [], types: ["power"] });

let n = 0;
const entry = (over: Partial<StatusEntry> & { audience: Audience | null }): StatusEntry => ({
  id: `e${String(++n).padStart(4, "0")}`,
  kind: "ack",
  phase: "problem",
  verified: true,
  superseded: false,
  publishedAt: hoursAgo(3),
  ...over,
});
const thread = (slug: string, entries: StatusEntry[], over: Partial<StatusThread> = {}): StatusThread => ({
  id: `t-${slug}`,
  slug,
  state: "open",
  closeReason: null,
  closedAt: null,
  entries,
  ...over,
});
const open = (slug: string, audience: Audience, over: Partial<StatusEntry> = {}) => thread(slug, [entry({ audience, ...over })]);
const closed = (slug: string, audience: Audience, closeReason: string, closedAt: Date | null) =>
  thread(slug, [entry({ audience }), entry({ audience, kind: "final", phase: null, publishedAt: closedAt ?? hoursAgo(1) })], { state: "closed", closeReason, closedAt });

const A: StatusPlace = { kind: "building", rsn: "100", neighbourhoodId: "TP" };
const B: StatusPlace = { kind: "building", rsn: "200", neighbourhoodId: "TP" };
const TP: StatusPlace = { kind: "neighbourhood", id: "TP" };
const status = (place: StatusPlace, threads: StatusThread[]) => {
  const { status: s, verified } = statusOf(place, threads, NOW);
  return { status: s, verified };
};

describe("statusOf", () => {
  it.each([
    ["an open thread whose covering entry is a problem is active", open("a", buildings("100")), "active"],
    ["an open thread whose covering entry is in progress is in progress", open("a", buildings("100"), { phase: "in_progress" }), "in_progress"],
    ["a thread closed resolved an hour ago is resolved", closed("a", buildings("100"), "resolved", hoursAgo(1)), "resolved"],
    ["no thread is none", null, "none"],
  ])("%s", (_name, t, expected) => {
    expect(status(A, t ? [t] : []).status).toBe(expected);
  });

  it("gives a place no thread covers `none`, verified (nothing is claimed that could be unverified)", () => {
    expect(statusOf(A, [open("a", buildings("999"))], NOW)).toEqual({ ...NO_STATUS, threads: [] });
  });

  it("orders active over in progress over resolved over none", () => {
    const active = open("act", buildings("100"));
    const progress = open("prog", buildings("100"), { phase: "in_progress" });
    const resolved = closed("res", buildings("100"), "resolved", hoursAgo(1));
    expect(status(A, [resolved, progress, active]).status).toBe("active");
    expect(status(A, [resolved, progress]).status).toBe("in_progress");
    expect(status(A, [resolved]).status).toBe("resolved");
    expect(status(A, [])).toEqual({ status: "none", verified: true });
  });

  it("lets a neighbourhood thread cover every building in the neighbourhood, and the neighbourhood itself", () => {
    const t = open("n", neighbourhood("TP"));
    expect(status(A, [t]).status).toBe("active");
    expect(status(B, [t]).status).toBe("active");
    expect(status(TP, [t]).status).toBe("active");
    expect(status({ kind: "building", rsn: "300", neighbourhoodId: "FP" }, [t]).status).toBe("none");
    expect(status({ kind: "neighbourhood", id: "FP" }, [t]).status).toBe("none");
    expect(status({ kind: "building", rsn: "300", neighbourhoodId: null }, [t]).status).toBe("none");
  });

  it("does not let one building's thread give its neighbourhood a status", () => {
    expect(status(TP, [open("a", buildings("100"))]).status).toBe("none");
  });

  it("ignores a superseded entry: the covering entry is the latest one that was not replaced", () => {
    const audience = buildings("100");
    const first = entry({ audience, publishedAt: hoursAgo(5), phase: "problem", superseded: true });
    const corrected = entry({ audience, kind: "correction", publishedAt: hoursAgo(4), phase: "in_progress" });
    expect(status(A, [thread("a", [first, corrected])]).status).toBe("in_progress");
    // The replaced entry alone covers nothing: no status comes from it.
    expect(status(A, [thread("a", [first])]).status).toBe("none");
  });

  it("never lets a withdrawal notice cover a thread", () => {
    const audience = buildings("100");
    const ack = entry({ audience, publishedAt: hoursAgo(5), superseded: true });
    const withdrawal = entry({ audience, kind: "withdrawal", phase: null, publishedAt: hoursAgo(4) });
    expect(status(A, [thread("a", [ack, withdrawal])]).status).toBe("none");
  });

  it("gives a withdrawn or expired thread `none`, never resolved", () => {
    expect(status(A, [closed("w", buildings("100"), "withdrawn", hoursAgo(1))]).status).toBe("none");
    expect(status(A, [closed("x", buildings("100"), "expired", hoursAgo(1))]).status).toBe("none");
  });

  it("measures the resolved window from closing time: 11 h 59 min resolved, exactly 12 h none", () => {
    const at = (ms: number) => closed("a", buildings("100"), "resolved", new Date(NOW.getTime() - ms));
    expect(status(A, [at(RESOLVED_WINDOW_MS - 60_000)]).status).toBe("resolved");
    expect(status(A, [at(RESOLVED_WINDOW_MS)]).status).toBe("none");
    expect(status(A, [at(RESOLVED_WINDOW_MS + 60_000)]).status).toBe("none");
    // The window counts from closing, not from the thread's first or last entry or its age.
    const old = thread("o", [entry({ audience: buildings("100"), publishedAt: hoursAgo(40) }), entry({ audience: buildings("100"), kind: "final", phase: null, publishedAt: hoursAgo(2) })], {
      state: "closed",
      closeReason: "resolved",
      closedAt: hoursAgo(2),
    });
    expect(status(A, [old]).status).toBe("resolved");
  });

  it("gives a resolved thread with no closing time `none`", () => {
    expect(status(A, [closed("a", buildings("100"), "resolved", null)]).status).toBe("none");
  });

  it("is `none` when the 12 hours pass, by the `now` it is given (the feed's server_now)", () => {
    const t = closed("a", buildings("100"), "resolved", hoursAgo(11));
    expect(statusOf(A, [t], NOW).status).toBe("resolved");
    expect(statusOf(A, [t], new Date(NOW.getTime() + 61 * 60_000)).status).toBe("none");
  });

  it("stops a narrowing update covering the building it dropped (A and B, then A)", () => {
    const wide = entry({ audience: buildings("100", "200"), publishedAt: hoursAgo(5) });
    const narrow = entry({ audience: buildings("100"), kind: "update", publishedAt: hoursAgo(4) });
    const t = thread("a", [wide, narrow]);
    expect(status(A, [t]).status).toBe("active");
    expect(status(B, [t]).status).toBe("none");
    // Before the update it covered both.
    expect(status(B, [thread("a", [wide])]).status).toBe("active");
  });

  it("follows the latest phase: an update that moves a problem to in progress", () => {
    const audience = buildings("100");
    const t = thread("a", [entry({ audience, publishedAt: hoursAgo(5) }), entry({ audience, kind: "update", phase: "in_progress", publishedAt: hoursAgo(4) })]);
    expect(status(A, [t]).status).toBe("in_progress");
  });

  describe("verified", () => {
    it("is true when a verified and an unverified thread give the same winning status", () => {
      const result = status(A, [open("u", buildings("100"), { verified: false }), open("v", buildings("100"), { verified: true })]);
      expect(result).toEqual({ status: "active", verified: true });
    });

    it("is false when only unverified threads give the status", () => {
      expect(status(A, [open("u", buildings("100"), { verified: false }), open("u2", buildings("100"), { verified: false })])).toEqual({ status: "active", verified: false });
    });

    it("is false for an unverified active thread beside a verified in-progress one: the winning status is active and rests on an unverified entry", () => {
      const result = status(A, [open("u", buildings("100"), { verified: false }), open("v", buildings("100"), { phase: "in_progress", verified: true })]);
      expect(result).toEqual({ status: "active", verified: false });
    });

    it("reads each thread's covering entry, not an earlier one", () => {
      const audience = buildings("100");
      const t = thread("a", [entry({ audience, verified: true, publishedAt: hoursAgo(5) }), entry({ audience, kind: "update", verified: false, publishedAt: hoursAgo(4) })]);
      expect(status(A, [t]).verified).toBe(false);
    });

    it("holds for a neighbourhood too", () => {
      expect(status(TP, [open("u", neighbourhood("TP"), { verified: false })])).toEqual({ status: "active", verified: false });
      expect(status(TP, [open("u", neighbourhood("TP"), { verified: false }), open("v", neighbourhood("TP"))])).toEqual({ status: "active", verified: true });
    });
  });

  it("names the threads that give the winning status, and only those", () => {
    const result = statusOf(A, [open("b", buildings("100")), open("a", buildings("100")), open("p", buildings("100"), { phase: "in_progress" }), open("z", buildings("999"))], NOW);
    expect(result.threads).toEqual(["a", "b"]);
  });

  it("lets a latest entry with an unparseable audience cover nothing, without promoting an older entry", () => {
    const older = entry({ audience: buildings("100", "200"), publishedAt: hoursAgo(5) });
    const latest = entry({ audience: null, kind: "update", publishedAt: hoursAgo(1) });
    const t = thread("m", [older, latest]);
    expect(status(A, [t]).status).toBe("none");
    expect(status({ kind: "building", rsn: "200", neighbourhoodId: null }, [t]).status).toBe("none");
  });

  it("reads an open thread whose covering entry has no phase as `none`", () => {
    expect(status(A, [open("a", buildings("100"), { kind: "final", phase: null })]).status).toBe("none");
  });
});

describe("statusesOf", () => {
  it("derives every listed place, with a building's neighbourhood from the places it is given", () => {
    const threads = [open("n", neighbourhood("TP")), open("b", buildings("300"), { phase: "in_progress" })];
    const result = statusesOf({ buildings: ["100", "300", "500"], neighbourhoods: ["TP", "FP"], neighbourhoodOf: { "100": "TP", "300": "FP", "500": "FP" } }, threads, NOW);
    expect([...result.buildings]).toEqual([
      ["100", { status: "active", verified: true }],
      ["300", { status: "in_progress", verified: true }],
      ["500", { status: "none", verified: true }],
    ]);
    expect([...result.neighbourhoods]).toEqual([
      ["TP", { status: "active", verified: true }],
      ["FP", { status: "none", verified: true }],
    ]);
  });

  it("covers a building by a neighbourhood audience only when its neighbourhood is known", () => {
    const result = statusesOf({ buildings: ["100"], neighbourhoods: ["TP"] }, [open("n", neighbourhood("TP"))], NOW);
    expect(result.buildings.get("100")?.status).toBe("none");
  });
});
