import { describe, expect, it } from "vitest";
import { ENTRY_STATUSES, ENTRY_TRANSITIONS, checkApproval, checkShownBinding, isFinal, requestTransition, type ApprovalFacts, type EntryStatus } from "./lifecycle";

const ALLOWED: readonly [EntryStatus | null, EntryStatus][] = [
  [null, "draft"],
  ["draft", "pending_approval"],
  ["pending_approval", "draft"],
  ["draft", "discarded"],
  ["pending_approval", "discarded"],
  ["pending_approval", "approved"],
];

const STARTS: readonly (EntryStatus | null)[] = [null, ...ENTRY_STATUSES];

describe("entry transitions", () => {
  it("are exactly the six of this epic", () => {
    expect(ENTRY_TRANSITIONS.map((rule) => [rule.from, rule.to])).toEqual(ALLOWED);
  });

  it("allow each transition of the epic on an open thread, with no web publication", () => {
    for (const [from, to] of ALLOWED) {
      expect(requestTransition({ from, to, webPublished: false, threadOpen: true }), `${from} -> ${to}`).toMatchObject({ ok: true });
    }
  });

  it("refuse every other pair of statuses (all 7 x 6 of them) as an illegal transition", () => {
    let refused = 0;
    for (const from of STARTS) {
      for (const to of ENTRY_STATUSES) {
        if (ALLOWED.some(([a, b]) => a === from && b === to)) continue;
        refused += 1;
        expect(requestTransition({ from, to, webPublished: false, threadOpen: true }), `${from} -> ${to}`).toEqual({ ok: false, refusal: "ILLEGAL_TRANSITION" });
      }
    }
    expect(refused).toBe(STARTS.length * ENTRY_STATUSES.length - ALLOWED.length);
  });

  it("refuse every transition on a closed thread with ALERT_CLOSED, except the discard that closing makes", () => {
    for (const [from, to] of ALLOWED) {
      expect(requestTransition({ from, to, webPublished: false, threadOpen: false }), `${from} -> ${to}`).toEqual({ ok: false, refusal: "ALERT_CLOSED" });
    }
    for (const from of ["draft", "pending_approval"] as const) {
      expect(requestTransition({ from, to: "discarded", webPublished: false, threadOpen: false, closing: true })).toMatchObject({ ok: true, action: "discard" });
    }
    // `closing` allows nothing but the discard.
    expect(requestTransition({ from: "pending_approval", to: "approved", webPublished: false, threadOpen: false, closing: true })).toEqual({ ok: false, refusal: "ALERT_CLOSED" });
    // An illegal transition is illegal whether or not the thread is open.
    expect(requestTransition({ from: "approved", to: "draft", webPublished: false, threadOpen: false })).toEqual({ ok: false, refusal: "ILLEGAL_TRANSITION" });
  });

  it("never return a web-published entry to draft or discard it, but still approve and submit what is allowed", () => {
    expect(requestTransition({ from: "pending_approval", to: "draft", webPublished: true, threadOpen: true })).toEqual({ ok: false, refusal: "WEB_PUBLISHED" });
    expect(requestTransition({ from: "pending_approval", to: "discarded", webPublished: true, threadOpen: true })).toEqual({ ok: false, refusal: "WEB_PUBLISHED" });
    expect(requestTransition({ from: "pending_approval", to: "approved", webPublished: true, threadOpen: true })).toMatchObject({ ok: true });
  });

  it("leave approved, discarded, superseded and published_system with nowhere to go", () => {
    expect(ENTRY_STATUSES.filter(isFinal)).toEqual(["approved", "discarded", "superseded", "published_system"]);
  });
});

describe("approval", () => {
  const AUTHOR = "11111111-1111-4111-8111-111111111111";
  const EDITOR = "22222222-2222-4222-8222-222222222222";
  const APPROVER = "33333333-3333-4333-8333-333333333333";
  const NOW = new Date("2026-10-01T15:00:00Z");
  const facts = (over: Partial<ApprovalFacts> = {}): ApprovalFacts => ({
    approverId: APPROVER,
    authorId: AUTHOR,
    editorIds: [AUTHOR, EDITOR],
    status: "pending_approval",
    version: 3,
    contentHash: "a".repeat(64),
    shownVersion: 3,
    shownHash: "a".repeat(64),
    validUntil: new Date("2026-10-02T15:00:00Z"),
    now: NOW,
    ...over,
  });

  it("passes for a pending entry, a person who never edited it, the version and hash shown, and a valid-until ahead", () => {
    expect(checkApproval(facts())).toBeNull();
  });

  it("refuses an entry that is not waiting any more (approved, discarded, superseded, published by the system) as not pending", () => {
    for (const status of ENTRY_STATUSES.filter((s) => s !== "pending_approval" && s !== "draft")) {
      expect(checkApproval(facts({ status })), status).toBe("ENTRY_NOT_PENDING");
    }
  });

  it("refuses an entry that went back to a draft since the approver read it as changed (This alert changed. Review it again.), whatever it holds", () => {
    expect(checkApproval(facts({ status: "draft", contentHash: null }))).toBe("ENTRY_CHANGED");
    expect(checkApproval(facts({ status: "draft" }))).toBe("ENTRY_CHANGED");
  });

  it("refuses the author and every editor", () => {
    expect(checkApproval(facts({ approverId: AUTHOR }))).toBe("EDITOR_CANNOT_APPROVE");
    expect(checkApproval(facts({ approverId: EDITOR }))).toBe("EDITOR_CANNOT_APPROVE");
    // Even when the author is missing from the editor list, the author never approves.
    expect(checkApproval(facts({ approverId: AUTHOR, editorIds: [] }))).toBe("EDITOR_CANNOT_APPROVE");
  });

  it("refuses when the version or the hash is not the one shown, or the entry holds no hash", () => {
    expect(checkApproval(facts({ shownVersion: 2 }))).toBe("ENTRY_CHANGED");
    expect(checkApproval(facts({ shownHash: "b".repeat(64) }))).toBe("ENTRY_CHANGED");
    expect(checkApproval(facts({ contentHash: null }))).toBe("ENTRY_CHANGED");
  });

  it("refuses a valid-until that is now or past, and passes one a moment ahead", () => {
    expect(checkApproval(facts({ validUntil: NOW }))).toBe("VALID_UNTIL_PAST");
    expect(checkApproval(facts({ validUntil: new Date(NOW.getTime() - 1) }))).toBe("VALID_UNTIL_PAST");
    expect(checkApproval(facts({ validUntil: new Date(NOW.getTime() + 1) }))).toBeNull();
  });

  it("checks in order: not pending, then editor, then changed, then valid-until", () => {
    expect(checkApproval(facts({ status: "approved", approverId: AUTHOR, shownVersion: 1, validUntil: NOW }))).toBe("ENTRY_NOT_PENDING");
    expect(checkApproval(facts({ status: "draft", approverId: AUTHOR, shownVersion: 1, validUntil: NOW }))).toBe("EDITOR_CANNOT_APPROVE");
    expect(checkApproval(facts({ status: "draft", validUntil: NOW }))).toBe("ENTRY_CHANGED");
    expect(checkApproval(facts({ approverId: AUTHOR, shownVersion: 1, validUntil: NOW }))).toBe("EDITOR_CANNOT_APPROVE");
    expect(checkApproval(facts({ shownVersion: 1, validUntil: NOW }))).toBe("ENTRY_CHANGED");
  });
});

describe("the version and hash an approver was shown", () => {
  const HASH = "a".repeat(64);
  const binding = (over: Partial<Parameters<typeof checkShownBinding>[0]> = {}) => ({ status: "pending_approval" as EntryStatus, version: 3, contentHash: HASH, shownVersion: 3, shownHash: HASH, ...over });

  it("holds for the pending entry with that version and hash", () => {
    expect(checkShownBinding(binding())).toBeNull();
  });

  it("is a changed entry when it went back to a draft (pulled back by its author or returned by an approver), or has another version or hash", () => {
    expect(checkShownBinding(binding({ status: "draft", contentHash: null }))).toBe("ENTRY_CHANGED");
    expect(checkShownBinding(binding({ shownVersion: 2 }))).toBe("ENTRY_CHANGED");
    expect(checkShownBinding(binding({ shownHash: "b".repeat(64) }))).toBe("ENTRY_CHANGED");
    expect(checkShownBinding(binding({ contentHash: null }))).toBe("ENTRY_CHANGED");
  });

  it("is not pending for an entry that was approved, discarded or closed out since: another approver was first", () => {
    for (const status of ["approved", "discarded", "superseded", "published_system"] as const) {
      expect(checkShownBinding(binding({ status })), status).toBe("ENTRY_NOT_PENDING");
    }
  });
});
