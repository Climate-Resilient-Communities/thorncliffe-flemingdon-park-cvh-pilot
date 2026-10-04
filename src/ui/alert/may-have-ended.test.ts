import { describe, expect, it } from "vitest";
import { clockOffsetMs, mayHaveEnded, serverTimeAt } from "./may-have-ended";

const VALID_UNTIL = "2026-10-01T19:00:00.000Z";
const at = (iso: string) => Date.parse(iso);

describe("clockOffsetMs", () => {
  it("is the server's clock minus the phone's, as of when the copy was received", () => {
    expect(clockOffsetMs("2026-10-01T15:00:00.000Z", at("2026-10-01T15:00:00.000Z"))).toBe(0);
    expect(clockOffsetMs("2026-10-01T15:00:00.000Z", at("2026-10-01T14:00:00.000Z"))).toBe(3_600_000);
    expect(clockOffsetMs(new Date("2026-10-01T15:00:00.000Z"), at("2026-10-01T16:30:00.000Z"))).toBe(-5_400_000);
  });
});

describe("mayHaveEnded: an alert read from a kept copy, by the phone's clock adjusted by the last known server_now offset", () => {
  it("is false before the valid-until and true from the valid-until on, with a phone whose clock is right", () => {
    const offsetMs = clockOffsetMs("2026-10-01T15:00:00.000Z", at("2026-10-01T15:00:00.000Z"));

    expect(mayHaveEnded(VALID_UNTIL, { now: at("2026-10-01T18:59:59.000Z"), offsetMs })).toBe(false);
    expect(mayHaveEnded(VALID_UNTIL, { now: at("2026-10-01T19:00:00.000Z"), offsetMs })).toBe(true);
    expect(mayHaveEnded(VALID_UNTIL, { now: at("2026-10-01T23:00:00.000Z"), offsetMs })).toBe(true);
  });

  it("uses the server's time, not the phone's, when the phone's clock is two hours fast: the alert is not called ended early", () => {
    // The copy was made at 15:00 by the server, when the phone's (fast) clock said 17:00.
    const offsetMs = clockOffsetMs("2026-10-01T15:00:00.000Z", at("2026-10-01T17:00:00.000Z"));

    // The phone's clock says 18:30, which is 16:30 by the server's: still valid until 19:00.
    expect(mayHaveEnded(VALID_UNTIL, { now: at("2026-10-01T18:30:00.000Z"), offsetMs })).toBe(false);
    expect(mayHaveEnded(VALID_UNTIL, { now: at("2026-10-01T21:00:00.000Z"), offsetMs })).toBe(true);
  });

  it("uses the server's time when the phone's clock is two hours slow: the alert is not called current late", () => {
    const offsetMs = clockOffsetMs("2026-10-01T15:00:00.000Z", at("2026-10-01T13:00:00.000Z"));

    // The phone's clock says 16:30, which is 18:30 by the server's: not over yet. At 17:00 on the phone it is 19:00 by the server's.
    expect(mayHaveEnded(VALID_UNTIL, { now: at("2026-10-01T16:30:00.000Z"), offsetMs })).toBe(false);
    expect(mayHaveEnded(VALID_UNTIL, { now: at("2026-10-01T17:00:00.000Z"), offsetMs })).toBe(true);
  });

  it("measures from a copy that was already old when it was kept: the offset is the one of the copy, and the phone's own time passing is added", () => {
    // A copy built at 10:00 (server) and kept at 10:00:20 (phone, right): read at 20:00 it has long passed 19:00.
    const offsetMs = clockOffsetMs("2026-10-01T10:00:00.000Z", at("2026-10-01T10:00:20.000Z"));

    expect(serverTimeAt(at("2026-10-01T20:00:00.000Z"), offsetMs)).toBe(at("2026-10-01T19:59:40.000Z"));
    expect(mayHaveEnded(VALID_UNTIL, { now: at("2026-10-01T20:00:00.000Z"), offsetMs })).toBe(true);
  });
});
