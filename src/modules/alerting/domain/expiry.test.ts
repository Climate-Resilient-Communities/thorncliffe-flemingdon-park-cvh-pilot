import { describe, expect, it } from "vitest";
import type { Audience } from "../../../contracts/audience";
import { UNTIL_RESOLVED_MS } from "./content";
import { EXPIRE_LATE_MINUTES, expiryOf, isLate } from "./expiry";
import type { EntryKind, EntryStatus } from "./lifecycle";
import type { ThreadEntryFacts } from "./thread";

const AUDIENCE: Audience = { scope: "buildings", buildings: [{ rsn: "4154146", floors: null }], groups: [], types: ["power"] };

let counter = 0;
function entry(over: Partial<ThreadEntryFacts> = {}): ThreadEntryFacts {
  counter += 1;
  return {
    id: `01900000-0000-7000-8000-${String(counter).padStart(12, "0")}`,
    kind: "ack" as EntryKind,
    status: "approved" as EntryStatus,
    webPublishedAt: new Date(Date.UTC(2026, 9, 4, 14, counter, 0)),
    phase: "problem",
    validUntil: new Date("2026-10-05T14:00:00Z"),
    validUntilMode: "at",
    audience: AUDIENCE,
    types: ["power"],
    ...over,
  };
}

const at = (iso: string) => new Date(iso);

describe("when a thread expires", () => {
  it("is when the covering entry's valid-until has passed; the instant itself counts as passed, the millisecond before does not", () => {
    const covering = entry({ validUntil: at("2026-10-05T14:00:00.000Z") });
    expect(expiryOf([covering], at("2026-10-05T13:59:59.999Z"))).toEqual({ expired: false, covering });
    expect(expiryOf([covering], at("2026-10-05T14:00:00.000Z"))).toMatchObject({ expired: true, covering, lateMs: 0 });
    expect(expiryOf([covering], at("2026-10-05T14:03:00.000Z"))).toMatchObject({ expired: true, lateMs: 180_000 });
  });

  it("reads the latest published, non-superseded substantive entry: a later update's valid-until replaces an earlier one's, either way", () => {
    const ack = entry({ validUntil: at("2026-10-05T10:00:00Z") });
    const renewed = entry({ kind: "update", validUntil: at("2026-10-06T10:00:00Z") });
    expect(expiryOf([ack, renewed], at("2026-10-05T12:00:00Z")).expired).toBe(false);
    const longAck = entry({ validUntil: at("2026-10-07T10:00:00Z") });
    const shortened = entry({ kind: "update", validUntil: at("2026-10-05T11:00:00Z") });
    expect(expiryOf([longAck, shortened], at("2026-10-05T12:00:00Z")).expired).toBe(true);
  });

  it("ignores an entry that is superseded, one residents have not read (a draft, a pending entry, a discarded one) and a withdrawal notice", () => {
    const ack = entry({ validUntil: at("2026-10-05T10:00:00Z") });
    const unread: Partial<ThreadEntryFacts>[] = [
      { kind: "update", status: "draft", webPublishedAt: null },
      { kind: "update", status: "pending_approval", webPublishedAt: null },
      { kind: "update", status: "discarded", webPublishedAt: null },
      { kind: "update", status: "superseded", validUntil: at("2026-10-09T10:00:00Z") },
      { kind: "withdrawal", validUntil: at("2026-10-09T10:00:00Z") },
    ];
    for (const over of unread) {
      const later = entry({ ...over, webPublishedAt: over.webPublishedAt === undefined ? new Date(Date.UTC(2026, 9, 4, 23, 0, 0)) : over.webPublishedAt });
      expect(expiryOf([ack, later], at("2026-10-05T12:00:00Z")).expired, JSON.stringify(over)).toBe(true);
    }
  });

  it("never expires a thread nothing residents read covers: an acknowledgement still waiting for approval", () => {
    expect(expiryOf([], at("2030-01-01T00:00:00Z"))).toEqual({ expired: false, covering: null });
    expect(expiryOf([entry({ status: "pending_approval", webPublishedAt: null })], at("2030-01-01T00:00:00Z"))).toEqual({ expired: false, covering: null });
  });

  it("is judged by an entry the system made too: a system final is the covering entry of a thread that already closed", () => {
    const system = entry({ kind: "final", status: "published_system", validUntil: at("2026-10-05T10:00:00Z") });
    expect(expiryOf([system], at("2026-10-05T10:00:01Z")).expired).toBe(true);
  });

  it("calls a close late once it is more than five minutes past the valid-until", () => {
    expect(EXPIRE_LATE_MINUTES).toBe(5);
    expect(isLate(5 * 60_000)).toBe(false);
    expect(isLate(5 * 60_000 + 1)).toBe(true);
    expect(isLate(0)).toBe(false);
  });
});

describe("a valid-until across the clock changes of 2026 (compared as UTC instants only)", () => {
  // Toronto: daylight time began 8 March 2026 at 02:00 (clocks 02:00 -> 03:00, UTC-5 -> UTC-4) and ends 1 November 2026 at 02:00 (clocks 02:00 -> 01:00, UTC-4 -> UTC-5).
  it("a valid-until typed in the repeated autumn hour was saved as one of two instants an hour apart: each expires at its own instant", () => {
    // 01:30 on 1 November happens twice: 05:30Z (daylight time, "before the change") and 06:30Z (standard time, "after").
    const before = entry({ validUntil: at("2026-11-01T05:30:00Z") });
    const after = entry({ validUntil: at("2026-11-01T06:30:00Z") });
    expect(expiryOf([before], at("2026-11-01T05:29:59Z")).expired).toBe(false);
    expect(expiryOf([before], at("2026-11-01T05:30:00Z")).expired).toBe(true);
    // Between the two 01:30s, the clock on the wall reads 01:45 the first time and 01:15 the second: the later instant is still ahead at both.
    expect(expiryOf([after], at("2026-11-01T05:45:00Z")).expired).toBe(false);
    expect(expiryOf([after], at("2026-11-01T06:15:00Z")).expired).toBe(false);
    expect(expiryOf([after], at("2026-11-01T06:30:00Z")).expired).toBe(true);
  });

  it("'until resolved' spanning the spring change is 24 elapsed hours, so it lasts until 13:00 the next day on the wall, not 12:00", () => {
    const saved = at("2026-03-07T17:00:00Z"); // 12:00 Toronto on 7 March (UTC-5)
    const resolved = entry({ validUntilMode: "resolved", validUntil: new Date(saved.getTime() + UNTIL_RESOLVED_MS) });
    expect(resolved.validUntil.toISOString()).toBe("2026-03-08T17:00:00.000Z"); // 13:00 on 8 March (UTC-4)
    // 12:30 on the wall on 8 March (16:30Z) is not 24 hours later: a thread judged by the wall clock would have expired here.
    expect(expiryOf([resolved], at("2026-03-08T16:30:00Z")).expired).toBe(false);
    expect(expiryOf([resolved], at("2026-03-08T16:59:59Z")).expired).toBe(false);
    expect(expiryOf([resolved], at("2026-03-08T17:00:00Z")).expired).toBe(true);
  });

  it("'until resolved' spanning the autumn change is 24 elapsed hours, so it ends at 11:00 the next day on the wall, not 12:00", () => {
    const saved = at("2026-10-31T16:00:00Z"); // 12:00 Toronto on 31 October (UTC-4)
    const resolved = entry({ validUntilMode: "resolved", validUntil: new Date(saved.getTime() + UNTIL_RESOLVED_MS) });
    expect(resolved.validUntil.toISOString()).toBe("2026-11-01T16:00:00.000Z"); // 11:00 on 1 November (UTC-5)
    expect(expiryOf([resolved], at("2026-11-01T15:59:59Z")).expired).toBe(false);
    // 11:30 on the wall (16:30Z) is past it: a judgement by wall-clock days would have waited until 12:00.
    expect(expiryOf([resolved], at("2026-11-01T16:30:00Z"))).toMatchObject({ expired: true, lateMs: 30 * 60_000 });
  });

  it("an update renews 'until resolved' from its own save: the earlier entry's instant no longer decides, across either change", () => {
    const ack = entry({ validUntilMode: "resolved", validUntil: at("2026-03-08T07:00:00Z") });
    const renewed = entry({ kind: "update", validUntilMode: "resolved", validUntil: at("2026-03-09T06:00:00Z") });
    expect(expiryOf([ack], at("2026-03-08T08:00:00Z")).expired).toBe(true);
    expect(expiryOf([ack, renewed], at("2026-03-08T08:00:00Z")).expired).toBe(false);
    const autumnAck = entry({ validUntilMode: "resolved", validUntil: at("2026-11-01T04:00:00Z") });
    const autumnRenewed = entry({ kind: "update", validUntilMode: "resolved", validUntil: at("2026-11-02T04:00:00Z") });
    expect(expiryOf([autumnAck, autumnRenewed], at("2026-11-01T07:00:00Z")).expired).toBe(false);
  });
});
