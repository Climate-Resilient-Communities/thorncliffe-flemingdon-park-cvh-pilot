import { describe, expect, it } from "vitest";
import { DELIVERY_STATES, type DeliveryState } from "./deliveryState";
import { PROBLEM_MEANINGS, PROBLEM_STATES, bucketOf, emptyCounts, isProblemState, problemMeaning, progressOf, referenceOf, sumOf, totalOf } from "./sendingProgress";

describe("which count a text is in", () => {
  it("puts every state in exactly one count: waiting, in flight, delivered, undelivered, failed, unknown, cancelled, or skipped", () => {
    const expected: Record<DeliveryState, string> = {
      queued: "waiting",
      claimed: "waiting",
      submitted: "inFlight",
      unknown: "unknown",
      delivered: "delivered",
      undelivered: "undelivered",
      failed: "failed",
      cancelled: "cancelled",
      skipped: "skipped",
      skipped_env: "skipped",
    };
    for (const state of DELIVERY_STATES) expect(bucketOf(state, false), state).toBe(expected[state]);
  });

  it("counts a claimed text as in flight only once it was handed to the provider: the one text a pause let go during an open hand-off is in flight", () => {
    expect(bucketOf("claimed", false)).toBe("waiting");
    expect(bucketOf("claimed", true)).toBe("inFlight");
    expect(bucketOf("submitted", true)).toBe("inFlight");
  });
});

describe("the progress of a list of texts", () => {
  const rows = [
    { lang: "ur", state: "delivered", handedOff: true },
    { lang: "en", state: "queued", handedOff: false },
    { lang: "en", state: "claimed", handedOff: true },
    { lang: "en", state: "submitted", handedOff: true },
    { lang: "en", state: "failed", handedOff: false },
    { lang: "en", state: "undelivered", handedOff: true },
    { lang: "en", state: "unknown", handedOff: true },
    { lang: "en", state: "cancelled", handedOff: false },
    { lang: "ur", state: "skipped_env", handedOff: false },
    { lang: "ur", state: "claimed", handedOff: false },
  ] as const;

  it("counts per language in the order of the language code, with the totals and every row accounted for", () => {
    const progress = progressOf(rows);
    expect(progress.languages.map((language) => language.lang)).toEqual(["en", "ur"]);
    expect(progress.languages[0]).toEqual({ lang: "en", waiting: 1, inFlight: 2, delivered: 0, undelivered: 1, failed: 1, unknown: 1, cancelled: 1, skipped: 0 });
    expect(progress.languages[1]).toEqual({ lang: "ur", waiting: 1, inFlight: 0, delivered: 1, undelivered: 0, failed: 0, unknown: 0, cancelled: 0, skipped: 1 });
    expect(progress.total).toEqual({ waiting: 2, inFlight: 2, delivered: 1, undelivered: 1, failed: 1, unknown: 1, cancelled: 1, skipped: 1 });
    expect(progress.texts).toBe(rows.length);
    expect(sumOf(progress.total)).toBe(rows.length);
  });

  it("counts the rows with a hand-off whatever their state is now", () => {
    expect(progressOf(rows).handedOff).toBe(rows.filter((row) => row.handedOff).length);
  });

  it("is empty for no texts", () => {
    expect(progressOf([])).toEqual({ languages: [], total: emptyCounts(), texts: 0, handedOff: 0 });
    expect(totalOf([])).toEqual(emptyCounts());
  });
});

describe("what a text that did not arrive means", () => {
  const meaning = (state: (typeof PROBLEM_STATES)[number], providerErrorCode: number | null, attempts = 1) => problemMeaning({ state, providerErrorCode, attempts });

  it("says an unknown outcome is unclear and was not re-sent, whatever else the row holds", () => {
    expect(meaning("unknown", null)).toEqual({ meaning: "unclear", code: null });
    expect(meaning("unknown", 30005)).toEqual({ meaning: "unclear", code: null });
  });

  it("puts the provider's codes in plain meanings, for a failed text and an undelivered one alike", () => {
    const table: [number, string][] = [
      [30005, "not_in_service"],
      [21612, "not_in_service"],
      [21211, "invalid_number"],
      [30006, "landline"],
      [21614, "landline"],
      [30003, "phone_off"],
      [21610, "opted_out"],
      [30004, "blocked"],
      [30007, "blocked"],
      [30032, "sender_not_ready"],
      [30001, "provider_busy"],
      [30008, "carrier_error"],
    ];
    for (const [code, expected] of table) {
      expect(meaning("failed", code).meaning, `failed ${code}`).toBe(expected);
      expect(meaning("undelivered", code).meaning, `undelivered ${code}`).toBe(expected);
      expect(meaning("failed", code).code).toBeNull();
    }
  });

  it("keeps the provider's code for one it does not know, and only then", () => {
    expect(meaning("failed", 31999)).toEqual({ meaning: "other_code", code: 31999 });
    expect(meaning("undelivered", 12345)).toEqual({ meaning: "other_code", code: 12345 });
  });

  it("says why a failed text with no code failed: three tries, or no reason given; an undelivered one with no code was not delivered", () => {
    expect(meaning("failed", null, 3).meaning).toBe("retries_exhausted");
    expect(meaning("failed", null, 1).meaning).toBe("no_reason");
    expect(meaning("undelivered", null).meaning).toBe("undelivered_no_reason");
  });

  it("has a meaning in the list for everything it can answer", () => {
    for (const state of PROBLEM_STATES) {
      for (const code of [null, 30005, 99999]) for (const attempts of [0, 3]) expect(PROBLEM_MEANINGS).toContain(meaning(state, code, attempts).meaning);
    }
  });

  it("recognises the three states a list can be opened for, and no other", () => {
    expect(PROBLEM_STATES.every(isProblemState)).toBe(true);
    for (const other of ["delivered", "queued", "", undefined, null, 3]) expect(isProblemState(other), String(other)).toBe(false);
  });

  it("shows a text by the last six characters of its id and nothing a number is made of", () => {
    expect(referenceOf("01900000-0000-7000-8000-00000abc1234")).toBe("abc1234".slice(1));
    expect(referenceOf("01900000-0000-7000-8000-00000abc1234")).toHaveLength(6);
  });
});
