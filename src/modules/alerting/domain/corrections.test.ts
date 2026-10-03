import { describe, expect, it } from "vitest";
import { SUPERSEDING_KINDS, WITHDRAWAL_REASONS, isSupersedingKind, isWithdrawalReason, substantiveRemains, targetRefusal, validTargets, withdrawalText, type TargetFacts } from "./corrections";
import { ENTRY_KINDS, ENTRY_STATUSES, type EntryKind, type EntryStatus } from "./lifecycle";

const PUBLISHED = new Date("2026-10-01T14:00:00Z");
const entry = (id: string, kind: EntryKind, status: EntryStatus, webPublishedAt: Date | null = PUBLISHED): TargetFacts => ({ id, kind, status, webPublishedAt });

describe("the catalog of withdrawal reasons", () => {
  it("is wrong place, wrong information, duplicate and other, the same list the database checks", () => {
    expect(WITHDRAWAL_REASONS).toEqual(["wrong_place", "wrong_information", "duplicate", "other"]);
    expect(WITHDRAWAL_REASONS.every(isWithdrawalReason)).toBe(true);
    for (const value of ["", "Duplicate", "because", null, undefined, 3]) expect(isWithdrawalReason(value)).toBe(false);
  });

  it("names the two kinds that replace an entry", () => {
    expect(SUPERSEDING_KINDS).toEqual(["correction", "withdrawal"]);
    expect(ENTRY_KINDS.filter(isSupersedingKind)).toEqual(["correction", "withdrawal"]);
  });
});

describe("a valid target (epic E05, Definitions)", () => {
  it("is an approved entry, whatever its kind but a withdrawal notice; a correction can itself be corrected", () => {
    for (const kind of ENTRY_KINDS.filter((candidate) => candidate !== "withdrawal")) expect(targetRefusal(entry("a", kind, "approved")), kind).toBeNull();
    expect(targetRefusal(entry("a", "correction", "approved"))).toBeNull();
  });

  it("is a pending entry that is web-published (the D-1 case, E08), and not one with nothing published", () => {
    expect(targetRefusal(entry("a", "update", "pending_approval", PUBLISHED))).toBeNull();
    expect(targetRefusal(entry("a", "update", "pending_approval", null))).toBe("TARGET_NOT_PUBLISHED");
  });

  it("is not one that was corrected or withdrawn already: it says so", () => {
    expect(targetRefusal(entry("a", "update", "superseded"))).toBe("TARGET_SUPERSEDED");
  });

  it("is not a draft, a discarded entry or a system entry that nobody read as an entry of the thread", () => {
    for (const status of ENTRY_STATUSES.filter((s) => !["approved", "superseded", "pending_approval"].includes(s))) {
      expect(targetRefusal(entry("a", "update", status, null)), status).toBe("TARGET_NOT_PUBLISHED");
    }
  });

  it("is never a withdrawal notice, nor an entry that is not there", () => {
    for (const status of ENTRY_STATUSES) expect(targetRefusal(entry("a", "withdrawal", status)), status).toBe("TARGET_NOT_VALID");
    expect(targetRefusal(null)).toBe("TARGET_NOT_VALID");
  });

  it("lists the entries of a thread that can be corrected or withdrawn now, in the order given", () => {
    const entries = [
      entry("w", "withdrawal", "approved"),
      entry("c", "correction", "approved"),
      entry("u", "update", "superseded"),
      entry("d", "update", "draft", null),
      entry("p", "update", "pending_approval", null),
      entry("a", "ack", "approved"),
    ];
    expect(validTargets(entries).map((candidate) => candidate.id)).toEqual(["c", "a"]);
  });
});

describe("whether anything substantive remains once an entry is replaced", () => {
  const base = [entry("ack", "ack", "approved"), entry("up", "update", "approved"), entry("w", "withdrawal", "approved")];

  it("is true while a published, non-superseded acknowledgement, update, correction or final stands", () => {
    expect(substantiveRemains(base, ["up"])).toBe(true);
    expect(substantiveRemains(base, ["ack"])).toBe(true);
    expect(substantiveRemains([...base, entry("c", "correction", "approved")], ["ack", "up"])).toBe(true);
    expect(substantiveRemains([entry("f", "final", "approved")], [])).toBe(true);
  });

  it("is false when every one is replaced, and the withdrawal notices never count", () => {
    expect(substantiveRemains(base, ["ack", "up"])).toBe(false);
    expect(substantiveRemains([entry("ack", "ack", "superseded"), entry("w", "withdrawal", "approved")], [])).toBe(false);
    expect(substantiveRemains([entry("w", "withdrawal", "approved")], [])).toBe(false);
  });

  it("does not count an entry residents have not read: a draft, a discarded entry or a pending one with nothing published", () => {
    expect(substantiveRemains([entry("d", "update", "draft", null), entry("x", "update", "discarded", null), entry("p", "update", "pending_approval", null)], [])).toBe(false);
  });

  it("counts a pending entry that residents already read (the D-1 case)", () => {
    expect(substantiveRemains([entry("p", "update", "pending_approval", PUBLISHED)], [])).toBe(true);
  });
});

describe("the words of a withdrawal", () => {
  const catalog = (reason: string) => `The ${reason} words.`;

  it("are the catalog's for a reason from the list, with the Hub's own words added after them", () => {
    expect(withdrawalText("wrong_place", "", catalog)).toBe("The wrong_place words.");
    expect(withdrawalText("duplicate", "  See the other alert. ", catalog)).toBe("The duplicate words. See the other alert.");
  });

  it("are the Hub's alone for \"other\", and empty when they wrote none, so the use case refuses it", () => {
    expect(withdrawalText("other", "  A mistake in the date.  ", catalog)).toBe("A mistake in the date.");
    expect(withdrawalText("other", "   ", catalog)).toBe("");
  });

  it("have control characters taken out", () => {
    expect(withdrawalText("other", "Wrong\u0000 day\u0007.", catalog)).toBe("Wrong day.");
  });
});
