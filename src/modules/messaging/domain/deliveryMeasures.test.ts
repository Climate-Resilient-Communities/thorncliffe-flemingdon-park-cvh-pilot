import { describe, expect, it } from "vitest";
import { DELIVERED_SHARE_PERCENT, NEVER_SENT_STATES, correctionReach, entryTimings, splitDrills, wasHandedOff, type MeasuredRow, type ReachRow } from "./deliveryMeasures";
import type { DeliveryState } from "./deliveryState";

const APPROVED = new Date("2026-10-03T15:00:00.000Z");
const at = (seconds: number) => new Date(APPROVED.getTime() + seconds * 1000);

const row = (lang: string, state: DeliveryState, handedOff: number | null, completed: number | null = null, recipientKind = "subscriber"): MeasuredRow => ({
  lang,
  recipientKind,
  state,
  handedOffAt: handedOff === null ? null : at(handedOff),
  completedAt: completed === null ? null : at(completed),
});

describe("which rows are handed off (S06.08)", () => {
  it("are the rows with a hand-off, and never a cancelled, skipped or skipped_env one", () => {
    expect(DELIVERED_SHARE_PERCENT).toBe(90);
    expect([...NEVER_SENT_STATES]).toEqual(["cancelled", "skipped", "skipped_env"]);
    for (const state of ["claimed", "submitted", "unknown", "delivered", "undelivered", "failed"] as const) expect(wasHandedOff(row("en", state, 1)), state).toBe(true);
    for (const state of NEVER_SENT_STATES) expect(wasHandedOff(row("en", state, 1)), state).toBe(false);
    // Queued (including a text put back after a 429), or a row that failed before its hand-off, was never handed off.
    expect(wasHandedOff(row("en", "queued", null))).toBe(false);
    expect(wasHandedOff(row("en", "failed", null, 5))).toBe(false);
  });
});

describe("time to deliver, per entry and language (S06.08, FR-M2)", () => {
  it("reports the time from approval to the first hand-off and to the moment delivered rows reach 90% of the rows handed off", () => {
    // Ten texts handed off at 5, 6 ... 14 seconds; nine arrive, the ninth at 40 seconds, the 90% mark (9 of 10).
    const rows = Array.from({ length: 10 }, (_, index) => row("en", index < 9 ? "delivered" : "submitted", 5 + index, index < 9 ? 20 + index * 2.5 : null));
    const timings = entryTimings(rows, APPROVED);
    expect(timings.drill).toBe(false);
    expect(timings.languages).toEqual([
      { lang: "en", handedOff: 10, delivered: 9, firstHandOffAfterMs: 5000, ninetyPercentDelivered: { reached: true, afterApprovalMs: 40_000 } },
    ]);
  });

  it("reaches 90% at the k-th delivery, however late the others come, with the instants sorted and not the rows' order", () => {
    // Twenty rows: 90% is 18 deliveries. Deliveries come in at 100, 99 ... 83 seconds (listed in reverse); two rows never arrive.
    const delivered = Array.from({ length: 18 }, (_, index) => row("ur", "delivered", 1, 100 - index));
    const rows = [...delivered, row("ur", "undelivered", 2, 300), row("ur", "unknown", 3)];
    expect(entryTimings(rows, APPROVED).languages[0]).toMatchObject({ handedOff: 20, delivered: 18, ninetyPercentDelivered: { reached: true, afterApprovalMs: 100_000 } });
  });

  it("says 'not reached' with the final delivered share when 90% is never reached", () => {
    const rows = [row("en", "delivered", 5, 30), row("en", "delivered", 6, 31), row("en", "delivered", 7, 32), row("en", "undelivered", 8, 50)];
    const [english] = entryTimings(rows, APPROVED).languages;
    expect(english.ninetyPercentDelivered).toEqual({ reached: false, deliveredShare: 0.75 });
    expect(english).toMatchObject({ handedOff: 4, delivered: 3, firstHandOffAfterMs: 5000 });
  });

  it("counts a single delivered text out of a single handed off as reaching 90% at its own delivery", () => {
    expect(entryTimings([row("en", "delivered", 2, 9)], APPROVED).languages[0]).toMatchObject({ handedOff: 1, ninetyPercentDelivered: { reached: true, afterApprovalMs: 9000 } });
    expect(entryTimings([row("en", "submitted", 2)], APPROVED).languages[0].ninetyPercentDelivered).toEqual({ reached: false, deliveredShare: 0 });
  });

  it("leaves the rows that were never sent out of the denominator", () => {
    // Nine delivered of nine handed off reaches 90%; the cancelled, skipped and skipped_env rows would have made it 9 of 12.
    const rows = [
      ...Array.from({ length: 9 }, (_, index) => row("en", "delivered", 5, 10 + index)),
      row("en", "cancelled", null, 3),
      row("en", "skipped", null, 3),
      row("en", "skipped_env", null, 3),
      row("en", "queued", null),
    ];
    expect(entryTimings(rows, APPROVED).languages[0]).toMatchObject({ handedOff: 9, delivered: 9, ninetyPercentDelivered: { reached: true, afterApprovalMs: 18_000 } });
  });

  it("measures each language on its own rows and in language order, and gives no measure to a language that sent nothing", () => {
    const rows = [row("ur", "delivered", 12, 40), row("en", "delivered", 4, 9), row("ps", "cancelled", null, 3), row("ps", "skipped", null, 3)];
    const { languages } = entryTimings(rows, APPROVED);
    expect(languages.map((entry) => entry.lang)).toEqual(["en", "ur"]);
    expect(languages.map((entry) => entry.firstHandOffAfterMs)).toEqual([4000, 12_000]);
  });

  it("has no language to report for an entry nothing of which was handed off", () => {
    expect(entryTimings([row("en", "queued", null), row("en", "cancelled", null, 2)], APPROVED)).toEqual({ drill: false, languages: [] });
    expect(entryTimings([], APPROVED)).toEqual({ drill: false, languages: [] });
  });

  it("is apart for a drill: its rows are for the drill roster, and say so", () => {
    expect(entryTimings([row("en", "delivered", 4, 9, "roster")], APPROVED).drill).toBe(true);
  });

  it("does not count a delivered row that has no delivery time as delivered, since there is no moment to measure", () => {
    expect(entryTimings([row("en", "delivered", 4, null)], APPROVED).languages[0]).toMatchObject({ delivered: 0, ninetyPercentDelivered: { reached: false, deliveredShare: 0 } });
  });
});

const reach = (entryId: string, recipientId: string | null, state: DeliveryState, handedOff: boolean, recipientKind = "subscriber"): ReachRow => ({
  entryId,
  recipientId,
  recipientKind,
  state,
  handedOffAt: handedOff ? at(1) : null,
});

describe("a correction's reach (S06.08, FR-M4)", () => {
  const ORIGINAL = "entry-original";
  const CORRECTION = "entry-correction";
  const r = (n: number) => `recipient-${n}`;

  it("reports attempted reach (the original's recipients, and the correction rows handed off to them) apart from confirmed reach (correction rows delivered)", () => {
    // The original went to five recipients (one of its texts was cancelled when the correction replaced it). The correction was handed off to four of
    // them and delivered to two; a sixth recipient, new to the correction, is not the original's.
    const rows = [
      reach(ORIGINAL, r(1), "delivered", true),
      reach(ORIGINAL, r(2), "delivered", true),
      reach(ORIGINAL, r(3), "submitted", true),
      reach(ORIGINAL, r(4), "undelivered", true),
      reach(ORIGINAL, r(5), "cancelled", false),
      reach(CORRECTION, r(1), "delivered", true),
      reach(CORRECTION, r(2), "delivered", true),
      reach(CORRECTION, r(3), "submitted", true),
      reach(CORRECTION, r(5), "unknown", true),
      reach(CORRECTION, r(4), "queued", false),
      reach(CORRECTION, r(6), "delivered", true),
    ];
    expect(correctionReach(rows, ORIGINAL, CORRECTION)).toEqual({
      drill: false,
      originalRecipients: 5,
      attemptedReach: 4,
      confirmedReach: 2,
      attemptedShare: 0.8,
      confirmedShare: 0.4,
    });
  });

  it("counts a recipient once, and leaves out the correction texts that were never handed off, were cancelled or skipped", () => {
    const rows = [
      reach(ORIGINAL, r(1), "delivered", true),
      reach(ORIGINAL, r(2), "delivered", true),
      reach(ORIGINAL, r(3), "delivered", true),
      reach(CORRECTION, r(1), "cancelled", false),
      reach(CORRECTION, r(2), "skipped", false),
      reach(CORRECTION, r(3), "skipped_env", false),
    ];
    expect(correctionReach(rows, ORIGINAL, CORRECTION)).toMatchObject({ originalRecipients: 3, attemptedReach: 0, confirmedReach: 0, attemptedShare: 0, confirmedShare: 0 });
  });

  it("cannot match a recipient who has since been deleted, so leaves them out on both sides", () => {
    const rows = [reach(ORIGINAL, r(1), "delivered", true), reach(ORIGINAL, null, "delivered", true), reach(CORRECTION, r(1), "delivered", true), reach(CORRECTION, null, "delivered", true)];
    expect(correctionReach(rows, ORIGINAL, CORRECTION)).toMatchObject({ originalRecipients: 1, attemptedReach: 1, confirmedReach: 1, attemptedShare: 1, confirmedShare: 1 });
  });

  it("has no shares when the original had no recipients, and ignores rows of other entries", () => {
    expect(correctionReach([reach("another", r(1), "delivered", true)], ORIGINAL, CORRECTION)).toEqual({
      drill: false,
      originalRecipients: 0,
      attemptedReach: 0,
      confirmedReach: 0,
      attemptedShare: null,
      confirmedShare: null,
    });
  });

  it("is apart for a drill, whose recipients are the drill roster", () => {
    const rows = [reach(ORIGINAL, r(1), "delivered", true, "roster"), reach(CORRECTION, r(1), "delivered", true, "roster")];
    expect(correctionReach(rows, ORIGINAL, CORRECTION)).toMatchObject({ drill: true, originalRecipients: 1, confirmedReach: 1 });
  });
});

describe("drills apart", () => {
  it("keeps drill measures and real ones in separate lists, never added together", () => {
    const measured = [{ drill: false, id: "a" }, { drill: true, id: "b" }, { drill: false, id: "c" }];
    expect(splitDrills(measured)).toEqual({ real: [measured[0], measured[2]], drills: [measured[1]] });
    expect(splitDrills([])).toEqual({ real: [], drills: [] });
  });
});
