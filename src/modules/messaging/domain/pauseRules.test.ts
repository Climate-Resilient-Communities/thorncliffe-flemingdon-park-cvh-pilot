import { describe, expect, it } from "vitest";
import { PAUSE_REASON_MAX_CHARS, cleanPauseReason } from "./pauseRules";

describe("a pause's reason", () => {
  it("is kept as typed, trimmed", () => {
    expect(cleanPauseReason("  Wrong alert sent to Thorncliffe Park  ")).toEqual({ ok: true, reason: "Wrong alert sent to Thorncliffe Park" });
  });

  it("reads as one line: line breaks, tabs and runs of spaces become one space", () => {
    expect(cleanPauseReason("Provider outage.\r\n\r\nTwilio status page\tshows   errors.")).toEqual({ ok: true, reason: "Provider outage. Twilio status page shows errors." });
  });

  it("drops control characters that print as nothing or as boxes, and keeps letters of every script", () => {
    expect(cleanPauseReason("Ab\u0000c\u001b d\u007f")).toEqual({ ok: true, reason: "Abc d" });
    expect(cleanPauseReason("غلط الرٹ بھیجا گیا")).toEqual({ ok: true, reason: "غلط الرٹ بھیجا گیا" });
  });

  it.each([[""], ["   "], ["\n\t \r\n"], ["\u0000\u001b"], [undefined], [null], [42], [{ reason: "x" }]])("is missing when it is %j", (raw) => {
    expect(cleanPauseReason(raw)).toEqual({ ok: false, problem: "missing" });
  });

  it("may be exactly 500 characters, and is too long at 501, counting characters rather than bytes", () => {
    expect(PAUSE_REASON_MAX_CHARS).toBe(500);
    expect(cleanPauseReason("a".repeat(500)).ok).toBe(true);
    expect(cleanPauseReason("a".repeat(501))).toEqual({ ok: false, problem: "too_long" });
    // Two-byte letters and a letter outside the first plane are one character each, as the table's char_length counts them.
    expect(cleanPauseReason("ں".repeat(500)).ok).toBe(true);
    expect(cleanPauseReason("𝒜".repeat(500)).ok).toBe(true);
    expect(cleanPauseReason("𝒜".repeat(501))).toEqual({ ok: false, problem: "too_long" });
  });

  it("is judged after cleaning: spaces around it never count against the limit", () => {
    expect(cleanPauseReason(` ${"a".repeat(500)} `).ok).toBe(true);
    expect(cleanPauseReason(`${"a ".repeat(250)}`)).toEqual({ ok: true, reason: "a ".repeat(250).trim() });
  });
});
