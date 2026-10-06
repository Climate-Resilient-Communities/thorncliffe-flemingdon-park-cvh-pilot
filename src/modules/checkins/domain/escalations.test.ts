import { describe, expect, it } from "vitest";
import { HANDLED_NOTE_MAX_CHARS, KEPT_ROW_HOURS, keptAtClose, outcomeAtClose, parseHandledNote, residentShown } from "./escalations";

describe("what a close does with a row (E08 'Closed stub', 'Round tally')", () => {
  it("keeps a not reached or needs help row the Hub has not handled, and makes every other row a stub", () => {
    expect(keptAtClose({ status: "not_reached", openEscalation: true })).toBe(true);
    expect(keptAtClose({ status: "needs_help", openEscalation: true })).toBe(true);
    expect(keptAtClose({ status: "needs_help", openEscalation: false })).toBe(false);
    expect(keptAtClose({ status: "done", openEscalation: true })).toBe(false);
    expect(keptAtClose({ status: "pending", openEscalation: false })).toBe(false);
  });

  it("tallies the latest mark, or unmarked", () => {
    expect(["pending", "done", "not_reached", "needs_help"].map(outcomeAtClose)).toEqual(["unmarked", "done", "not_reached", "needs_help"]);
  });

  it("keeps a row for 24 hours after the close", () => {
    expect(KEPT_ROW_HOURS).toBe(24);
  });
});

describe("the note an Admin writes when they mark an escalation handled", () => {
  it("is one trimmed line, a line break or control character made a space", () => {
    expect(parseHandledNote("  Called her back.\nShe is fine.\t ")).toEqual({ ok: true, note: "Called her back. She is fine." });
  });

  it("is refused when empty, not text, or over the limit", () => {
    expect(parseHandledNote(" \n ")).toEqual({ ok: false, problem: "note_missing" });
    expect(parseHandledNote(null)).toEqual({ ok: false, problem: "note_missing" });
    expect(parseHandledNote("x".repeat(HANDLED_NOTE_MAX_CHARS))).toMatchObject({ ok: true });
    expect(parseHandledNote("x".repeat(HANDLED_NOTE_MAX_CHARS + 1))).toEqual({ ok: false, problem: "note_too_long" });
  });
});

describe("whether an Admin sees the resident's details on an escalation", () => {
  it("only while the row names its subscriber, and never for a late mark's escalation", () => {
    expect(residentShown({ late: false }, { linked: true })).toBe(true);
    expect(residentShown({ late: false }, { linked: false })).toBe(false);
    expect(residentShown({ late: true }, { linked: true })).toBe(false);
  });
});
