import { describe, expect, it } from "vitest";
import type { Audience } from "../../../contracts/audience";
import { UNTIL_RESOLVED_MS } from "./content";
import type { EntryKind, EntryStatus } from "./lifecycle";
import { SUBSTANTIVE_KINDS, coveringEntry, isAckOnly, isPublished, isSubstantive, newestFirst, readableEntries, threadValidUntil, updateStart, type ThreadEntryFacts } from "./thread";

const AUDIENCE: Audience = { scope: "buildings", buildings: [{ rsn: "4154146", floors: null }], groups: [], types: ["power"] };

let counter = 0;
/** An entry published at `at` (minutes after 14:00 on 4 October 2026), unless it says otherwise. */
function entry(over: Partial<ThreadEntryFacts> & { at?: number | null } = {}): ThreadEntryFacts {
  counter += 1;
  const { at, ...rest } = over;
  const published = at === null ? null : new Date(Date.UTC(2026, 9, 4, 14, at ?? counter, 0));
  return {
    id: `01900000-0000-7000-8000-${String(counter).padStart(12, "0")}`,
    kind: "ack",
    status: "approved",
    webPublishedAt: published,
    phase: "problem",
    validUntil: new Date("2026-10-05T14:00:00Z"),
    validUntilMode: "at",
    audience: AUDIENCE,
    types: ["power"],
    ...rest,
  };
}

describe("which entries residents can read", () => {
  it("are the web-published ones that were not discarded: an approved, a superseded and a system entry; never a draft, a discarded entry or one with no publication time", () => {
    const statuses: [EntryStatus, boolean][] = [
      ["draft", false],
      ["pending_approval", false],
      ["approved", true],
      ["discarded", false],
      ["superseded", true],
      ["published_system", true],
    ];
    for (const [status, readable] of statuses) {
      // Only approval (and E08's D-1 posting) sets the publication time, so a pending entry has none here.
      expect(isPublished({ status, webPublishedAt: status === "pending_approval" ? null : new Date() }), status).toBe(readable);
    }
    expect(isPublished({ status: "approved", webPublishedAt: null })).toBe(false);
    // A pending entry that was web-published at submit (the D-1 case, E08) is read.
    expect(isPublished({ status: "pending_approval", webPublishedAt: new Date() })).toBe(true);
  });

  it("are listed newest first by publication time, whatever order they come in, without changing the input", () => {
    const first = entry({ at: 1 });
    const second = entry({ at: 2, kind: "update" });
    const third = entry({ at: 3, kind: "update" });
    const input = [second, first, third];
    expect(newestFirst(input).map((e) => e.id)).toEqual([third.id, second.id, first.id]);
    expect(input.map((e) => e.id)).toEqual([second.id, first.id, third.id]);
  });

  it("break a tie in publication time by id, the later id first (ids rise with creation)", () => {
    const a = entry({ at: 5 });
    const b = entry({ at: 5, kind: "update" });
    expect(a.id < b.id).toBe(true);
    expect(newestFirst([a, b]).map((e) => e.id)).toEqual([b.id, a.id]);
    expect(newestFirst([b, a]).map((e) => e.id)).toEqual([b.id, a.id]);
  });

  it("put an entry with no publication time last", () => {
    const unpublished = entry({ at: null, status: "draft" });
    const published = entry({ at: 1 });
    expect(newestFirst([unpublished, published]).map((e) => e.id)).toEqual([published.id, unpublished.id]);
  });

  it("keep the earlier entries: an update replaces nothing", () => {
    const ack = entry({ at: 1 });
    const update = entry({ at: 2, kind: "update" });
    expect(readableEntries([ack, update]).map((e) => e.kind)).toEqual(["update", "ack"]);
  });
});

describe("the covering entry and the thread's valid-until", () => {
  it("is the latest published substantive entry, so a later update's valid-until is the thread's", () => {
    const ack = entry({ at: 1, validUntil: new Date("2026-10-05T10:00:00Z") });
    const update = entry({ at: 2, kind: "update", validUntil: new Date("2026-10-06T10:00:00Z") });
    expect(coveringEntry([ack, update])?.id).toBe(update.id);
    expect(threadValidUntil([ack, update])).toEqual(new Date("2026-10-06T10:00:00Z"));
    // A later update that chose an earlier time shortens the thread: the latest entry's choice is the one that stands.
    const shorter = entry({ at: 3, kind: "update", validUntil: new Date("2026-10-04T20:00:00Z") });
    expect(threadValidUntil([ack, update, shorter])).toEqual(new Date("2026-10-04T20:00:00Z"));
  });

  it("skips what is not substantive, superseded or not published", () => {
    const ack = entry({ at: 1, validUntil: new Date("2026-10-05T10:00:00Z") });
    const withdrawal = entry({ at: 2, kind: "withdrawal", validUntil: new Date("2026-10-09T10:00:00Z") });
    const superseded = entry({ at: 3, kind: "update", status: "superseded", validUntil: new Date("2026-10-09T10:00:00Z") });
    const pending = entry({ at: null, kind: "update", status: "pending_approval", validUntil: new Date("2026-10-09T10:00:00Z") });
    const draft = entry({ at: null, kind: "update", status: "draft" });
    expect(coveringEntry([ack, withdrawal, superseded, pending, draft])?.id).toBe(ack.id);
    expect(threadValidUntil([ack, withdrawal, superseded, pending, draft])).toEqual(new Date("2026-10-05T10:00:00Z"));
  });

  it("is nothing while nothing substantive is published: no covering entry and no valid-until", () => {
    expect(coveringEntry([])).toBeNull();
    expect(coveringEntry([entry({ at: null, status: "pending_approval" }), entry({ at: null, status: "draft" })])).toBeNull();
    expect(threadValidUntil([entry({ at: null, status: "pending_approval" })])).toBeNull();
  });

  it("counts a correction and a final as substantive and a withdrawal not", () => {
    expect([...SUBSTANTIVE_KINDS]).toEqual(["ack", "update", "correction", "final"]);
    const kinds: EntryKind[] = ["ack", "update", "correction", "withdrawal", "final"];
    expect(kinds.filter(isSubstantive)).toEqual(["ack", "update", "correction", "final"]);
  });
});

describe("whether the thread is still an acknowledgement", () => {
  it("is so while every substantive entry residents can read is an acknowledgement: its next step is the promotion", () => {
    expect(isAckOnly([entry({ at: 1 })])).toBe(true);
    expect(isAckOnly([entry({ at: 1 }), entry({ at: 2 })])).toBe(true);
  });

  it("is not once there is an update or a full alert of its own, nor when nothing is published", () => {
    expect(isAckOnly([entry({ at: 1 }), entry({ at: 2, kind: "update" })])).toBe(false);
    expect(isAckOnly([entry({ at: 1, kind: "update" })])).toBe(false);
    expect(isAckOnly([])).toBe(false);
    expect(isAckOnly([entry({ at: null, status: "pending_approval" })])).toBe(false);
  });

  it("ignores an update that waits: only what residents read counts", () => {
    expect(isAckOnly([entry({ at: 1 }), entry({ at: null, kind: "update", status: "pending_approval" })])).toBe(true);
  });
});

describe("what an update starts from", () => {
  const NOW = new Date("2026-10-04T16:00:00Z");

  it("carries over the thread's audience and types from the covering entry", () => {
    const wide: Audience = { scope: "neighbourhood", neighbourhood_ids: ["TP"], groups: ["seniors"], types: ["heat"] };
    const start = updateStart(entry({ audience: wide, types: ["heat"] }), NOW);
    expect(start.audience).toEqual(wide);
    expect(start.types).toEqual(["heat"]);
  });

  it('defaults the valid-until to the covering entry\'s choice: "until resolved" renews to 24 elapsed hours from now', () => {
    const resolved = updateStart(entry({ validUntilMode: "resolved", validUntil: new Date("2026-10-04T15:00:00Z") }), NOW);
    expect(resolved.validUntilMode).toBe("resolved");
    expect(resolved.validUntil).toEqual(new Date(NOW.getTime() + UNTIL_RESOLVED_MS));
    expect(resolved.validUntil).toEqual(new Date("2026-10-05T16:00:00Z"));
  });

  it("keeps a chosen date and time as it was, even when it has passed (the author must choose another before the update can be saved)", () => {
    const at = updateStart(entry({ validUntilMode: "at", validUntil: new Date("2026-10-04T12:00:00Z") }), NOW);
    expect(at.validUntilMode).toBe("at");
    expect(at.validUntil).toEqual(new Date("2026-10-04T12:00:00Z"));
  });
});
