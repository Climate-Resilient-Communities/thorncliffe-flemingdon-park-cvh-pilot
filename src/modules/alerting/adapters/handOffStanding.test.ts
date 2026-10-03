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

describe("the closing entry, once the close records it (S05.03)", () => {
  const OTHER = "0198a000-0000-7000-8000-0000000000e2";
  const FINAL = "0198a000-0000-7000-8000-0000000000e1";
  const recorded = { entryId: FINAL, entryStatus: "approved", entryKind: "final", approvedAt: new Date(T.getTime() - 60_000), threadStatus: "closed", closedAt: T, closingEntryId: FINAL };

  it("is the recorded entry, whatever instant it was approved at", () => {
    expect(isClosingEntry(recorded)).toBe(true);
    expect(isClosingEntry({ ...recorded, entryKind: "withdrawal" })).toBe(true);
    expect(isClosingEntry({ ...recorded, entryStatus: "published_system" })).toBe(true);
  });

  it("is no other entry of the closed thread, even one approved at the very instant of the close", () => {
    expect(isClosingEntry({ ...recorded, entryId: OTHER, approvedAt: T })).toBe(false);
    expect(isClosingEntry({ ...recorded, entryId: OTHER, entryKind: "withdrawal", approvedAt: T })).toBe(false);
  });

  it("is not the recorded entry once it is not approved, or is not a final or a withdrawal, or its thread is open", () => {
    for (const entryStatus of ["superseded", "discarded", "pending_approval", "draft"]) expect(isClosingEntry({ ...recorded, entryStatus }), entryStatus).toBe(false);
    for (const entryKind of ["ack", "update", "correction"]) expect(isClosingEntry({ ...recorded, entryKind }), entryKind).toBe(false);
    expect(isClosingEntry({ ...recorded, threadStatus: "open", closedAt: null })).toBe(false);
  });

  it("keeps the equality rule for a thread closed before the close recorded anything (closingEntryId null)", () => {
    expect(isClosingEntry({ ...base, entryId: OTHER, closingEntryId: null })).toBe(true);
    expect(isClosingEntry({ ...base, entryId: OTHER, closingEntryId: null, approvedAt: new Date(T.getTime() - 1) })).toBe(false);
  });
});
