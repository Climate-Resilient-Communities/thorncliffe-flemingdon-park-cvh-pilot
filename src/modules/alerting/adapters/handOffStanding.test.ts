import { describe, expect, it } from "vitest";
import { isClosingEntry } from "./handOffStanding";

const T = new Date("2026-10-03T15:00:00.000Z");
const closed = { threadStatus: "closed", closedAt: T };
const base = { entryStatus: "approved", entryKind: "final", approvedAt: T, ...closed };

describe("the closing entry, as the hand-off point tells it from the other entries of a closed thread", () => {
  it("is the approved final or withdrawal whose approval and the thread's close are one transaction (the same instant)", () => {
    expect(isClosingEntry(base)).toBe(true);
    expect(isClosingEntry({ ...base, entryKind: "withdrawal" })).toBe(true);
  });

  it("is no entry of an open thread", () => {
    expect(isClosingEntry({ ...base, threadStatus: "open", closedAt: null })).toBe(false);
  });

  it("is not an ack, update or correction, however it was approved", () => {
    for (const entryKind of ["ack", "update", "correction"]) expect(isClosingEntry({ ...base, entryKind }), entryKind).toBe(false);
  });

  it("is not an entry approved at another instant than the close (an earlier final of a thread closed later, or any older entry)", () => {
    expect(isClosingEntry({ ...base, approvedAt: new Date(T.getTime() - 1) })).toBe(false);
    expect(isClosingEntry({ ...base, approvedAt: new Date(T.getTime() + 1) })).toBe(false);
  });

  it("is not an entry that is not approved, or has no approval or close time", () => {
    for (const entryStatus of ["superseded", "discarded", "pending_approval", "draft", "published_system"]) expect(isClosingEntry({ ...base, entryStatus }), entryStatus).toBe(false);
    expect(isClosingEntry({ ...base, approvedAt: null })).toBe(false);
    expect(isClosingEntry({ ...base, closedAt: null })).toBe(false);
  });
});
