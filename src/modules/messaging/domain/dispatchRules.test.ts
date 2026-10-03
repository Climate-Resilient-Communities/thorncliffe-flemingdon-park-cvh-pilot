import { describe, expect, it } from "vitest";
import {
  BACKOFF_MS,
  CLAIM_RANKS,
  MAX_ATTEMPTS,
  alertNotSendable,
  capacitySegments,
  claimRank,
  classifyAnswer,
  createPaceLimiter,
  isAuthFailure,
  pauseApplies,
  statusCallbackUrl,
  takeWithinSegments,
  type AlertStanding,
  type SubmitAnswer,
} from "./dispatchRules";
import { RECIPIENT_KINDS, type RecipientKind } from "./deliveryRules";

const NOW = new Date("2026-10-03T15:00:00Z");
const SID = `SM${"0123456789abcdef".repeat(2)}`;

describe("the claim order", () => {
  it("puts fire and evacuation alert entries first, then on-call and other transactional texts, then building before neighbourhood alerts", () => {
    const rank = (row: Parameters<typeof claimRank>[0]) => claimRank(row);
    expect(rank({ kind: "alert", recipientKind: "subscriber", entryTypes: ["fire"], audienceScope: "neighbourhood" })).toBe(CLAIM_RANKS.fireOrEvacuationAlert);
    expect(rank({ kind: "alert", recipientKind: "subscriber", entryTypes: ["power", "evacuation"], audienceScope: "buildings" })).toBe(CLAIM_RANKS.fireOrEvacuationAlert);
    expect(rank({ kind: "transactional", recipientKind: "oncall" })).toBe(CLAIM_RANKS.oncall);
    expect(rank({ kind: "transactional", recipientKind: "subscriber" })).toBe(CLAIM_RANKS.transactional);
    expect(rank({ kind: "transactional", recipientKind: "inbound_reply" })).toBe(CLAIM_RANKS.transactional);
    expect(rank({ kind: "alert", recipientKind: "subscriber", entryTypes: ["power"], audienceScope: "buildings" })).toBe(CLAIM_RANKS.buildingAlert);
    expect(rank({ kind: "alert", recipientKind: "subscriber", entryTypes: ["power"], audienceScope: "neighbourhood" })).toBe(CLAIM_RANKS.neighbourhoodAlert);
    expect(rank({ kind: "campaign", recipientKind: "subscriber" })).toBe(CLAIM_RANKS.campaign);
    const order = [
      CLAIM_RANKS.fireOrEvacuationAlert,
      CLAIM_RANKS.oncall,
      CLAIM_RANKS.transactional,
      CLAIM_RANKS.buildingAlert,
      CLAIM_RANKS.neighbourhoodAlert,
      CLAIM_RANKS.campaign,
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("ranks an alert with no types or scope as a neighbourhood alert, never ahead of a fire", () => {
    expect(claimRank({ kind: "alert", recipientKind: "roster" })).toBe(CLAIM_RANKS.neighbourhoodAlert);
    expect(claimRank({ kind: "alert", recipientKind: "roster", entryTypes: [], audienceScope: null })).toBe(CLAIM_RANKS.neighbourhoodAlert);
  });
});

describe("the pause", () => {
  it("applies to every text except those to an on-call number", () => {
    const applies = RECIPIENT_KINDS.filter((kind) => pauseApplies({ recipientKind: kind }));
    expect(applies).toEqual((RECIPIENT_KINDS as readonly RecipientKind[]).filter((kind) => kind !== "oncall"));
    expect(pauseApplies({ recipientKind: "oncall" })).toBe(false);
  });
});

describe("what a provider's answer means", () => {
  const accepted: SubmitAnswer = { kind: "accepted", httpStatus: 201, status: "queued", messageId: SID };

  it("gives acceptance as submitted, with the provider's id", () => {
    expect(classifyAnswer(accepted, 0)).toEqual({ kind: "submitted", providerMessageId: SID });
  });

  it("requeues only a 429 with an error body, and a connection that failed before any of the request was sent", () => {
    expect(classifyAnswer({ kind: "rejected", httpStatus: 429, errorCode: 20429, message: "Too many requests" }, 0)).toEqual({ kind: "requeue", dueInMs: 30_000 });
    expect(classifyAnswer({ kind: "rejected", httpStatus: 429, errorCode: null, message: "slow down" }, 0)).toEqual({ kind: "requeue", dueInMs: 30_000 });
    for (const reason of ["connection_refused", "host_not_found", "network_unreachable", "connect_timeout", "tls_failed"] as const) {
      expect(classifyAnswer({ kind: "not_sent", reason }, 0), reason).toEqual({ kind: "requeue", dueInMs: 30_000 });
    }
  });

  it("backs off 30 seconds, 2 minutes and 10 minutes, at most 3 times, and then the text fails", () => {
    expect(BACKOFF_MS).toEqual([30_000, 120_000, 600_000]);
    expect(MAX_ATTEMPTS).toBe(3);
    const notAccepted: SubmitAnswer = { kind: "not_sent", reason: "connection_refused" };
    expect([0, 1, 2].map((attempts) => classifyAnswer(notAccepted, attempts))).toEqual([
      { kind: "requeue", dueInMs: 30_000 },
      { kind: "requeue", dueInMs: 120_000 },
      { kind: "requeue", dueInMs: 600_000 },
    ]);
    expect(classifyAnswer(notAccepted, 3)).toEqual({ kind: "failed", errorCode: null, reason: "retries_exhausted" });
    expect(classifyAnswer({ kind: "rejected", httpStatus: 429, errorCode: 20429, message: "Too many requests" }, 3)).toEqual({ kind: "failed", errorCode: 20429, reason: "retries_exhausted" });
  });

  it("fails a provider 4xx other than 429 for good, with its code (an invalid number, an opted-out recipient)", () => {
    expect(classifyAnswer({ kind: "rejected", httpStatus: 400, errorCode: 21211, message: "invalid number" }, 0)).toEqual({ kind: "failed", errorCode: 21211, reason: "permanent_error" });
    expect(classifyAnswer({ kind: "rejected", httpStatus: 400, errorCode: 21610, message: "opted out" }, 2)).toEqual({ kind: "failed", errorCode: 21610, reason: "permanent_error" });
    expect(classifyAnswer({ kind: "rejected", httpStatus: 404, errorCode: null, message: null }, 0)).toEqual({ kind: "failed", errorCode: null, reason: "permanent_error" });
    // A code the table could not hold is not kept.
    expect(classifyAnswer({ kind: "rejected", httpStatus: 400, errorCode: 0, message: null }, 0)).toEqual({ kind: "failed", errorCode: null, reason: "permanent_error" });
    expect(classifyAnswer({ kind: "rejected", httpStatus: 400, errorCode: 123_456, message: null }, 0)).toEqual({ kind: "failed", errorCode: null, reason: "permanent_error" });
  });

  it("makes everything else unknown, never a retry: a 5xx, a timeout, a dropped connection, an acceptance followed by an error", () => {
    expect(classifyAnswer({ kind: "rejected", httpStatus: 500, errorCode: null, message: null }, 0)).toEqual({ kind: "unknown", cause: "server_error", httpStatus: 500 });
    expect(classifyAnswer({ kind: "rejected", httpStatus: 503, errorCode: 20503, message: "unavailable" }, 1)).toEqual({ kind: "unknown", cause: "server_error", httpStatus: 503 });
    expect(classifyAnswer({ kind: "rejected", httpStatus: 302, errorCode: null, message: null }, 0)).toEqual({ kind: "unknown", cause: "unexpected_status", httpStatus: 302 });
    // A 429 with no error body is not the provider saying "not accepted".
    expect(classifyAnswer({ kind: "rejected", httpStatus: 429, errorCode: null, message: null }, 0)).toEqual({ kind: "unknown", cause: "rate_limited_without_error_body", httpStatus: 429 });
    for (const reason of ["timeout", "connection_lost", "unusable_response", "accepted_then_dropped", "accepted_then_error"] as const) {
      expect(classifyAnswer({ kind: "no_answer", reason }, 0), reason).toEqual({ kind: "unknown", cause: reason, httpStatus: null });
    }
  });

  it("never turns an answer into a retry once the request may have been sent, whatever the attempt count", () => {
    const maybeSent: SubmitAnswer[] = [
      { kind: "no_answer", reason: "timeout" },
      { kind: "no_answer", reason: "accepted_then_error" },
      { kind: "rejected", httpStatus: 500, errorCode: null, message: null },
    ];
    for (const answer of maybeSent) for (const attempts of [0, 1, 2, 3]) expect(classifyAnswer(answer, attempts).kind, JSON.stringify(answer)).toBe("unknown");
  });

  it("reads 401 and 403 as the credentials being refused", () => {
    expect(isAuthFailure({ kind: "rejected", httpStatus: 401, errorCode: 20003, message: "Authenticate" })).toBe(true);
    expect(isAuthFailure({ kind: "rejected", httpStatus: 403, errorCode: null, message: null })).toBe(true);
    expect(isAuthFailure({ kind: "rejected", httpStatus: 400, errorCode: 21211, message: null })).toBe(false);
    expect(isAuthFailure(accepted)).toBe(false);
  });
});

describe("sendable at the hand-off point (alert)", () => {
  const standing = (over: Partial<AlertStanding> = {}): AlertStanding => ({
    entryStatus: "approved",
    entryKind: "ack",
    validUntil: new Date(NOW.getTime() + 3_600_000),
    threadOpen: true,
    isClosingEntry: false,
    isDrill: false,
    ...over,
  });

  it("sends an approved entry of an open thread, before its valid-until, to a subscriber", () => {
    expect(alertNotSendable(standing(), "subscriber", NOW)).toBeNull();
  });

  it("cancels what was withdrawn: an entry that is superseded, discarded, not approved or gone", () => {
    expect(alertNotSendable(standing({ entryStatus: "superseded" }), "subscriber", NOW)).toEqual({ outcome: "cancelled", reason: "entry_superseded" });
    expect(alertNotSendable(standing({ entryStatus: "discarded" }), "subscriber", NOW)).toEqual({ outcome: "cancelled", reason: "entry_discarded" });
    expect(alertNotSendable(standing({ entryStatus: "pending_approval" }), "subscriber", NOW)).toEqual({ outcome: "cancelled", reason: "entry_not_approved" });
    expect(alertNotSendable(null, "subscriber", NOW)).toEqual({ outcome: "cancelled", reason: "entry_missing" });
  });

  it("cancels the texts of a closed thread, except the closing entry's", () => {
    expect(alertNotSendable(standing({ threadOpen: false }), "subscriber", NOW)).toEqual({ outcome: "cancelled", reason: "thread_closed" });
    expect(alertNotSendable(standing({ threadOpen: false, entryKind: "final", isClosingEntry: true }), "subscriber", NOW)).toBeNull();
    expect(alertNotSendable(standing({ threadOpen: false, entryKind: "withdrawal", isClosingEntry: true }), "subscriber", NOW)).toBeNull();
  });

  it("skips an ack, update or correction past its valid-until, but never checks a final or a withdrawal", () => {
    const past = new Date(NOW.getTime() - 1);
    for (const entryKind of ["ack", "update", "correction"] as const) {
      expect(alertNotSendable(standing({ entryKind, validUntil: past }), "subscriber", NOW), entryKind).toEqual({ outcome: "skipped", reason: "valid_until_passed" });
    }
    // The instant itself is past: valid-until is exclusive.
    expect(alertNotSendable(standing({ validUntil: NOW }), "subscriber", NOW)).toEqual({ outcome: "skipped", reason: "valid_until_passed" });
    for (const entryKind of ["final", "withdrawal"] as const) {
      expect(alertNotSendable(standing({ entryKind, validUntil: past }), "subscriber", NOW), entryKind).toBeNull();
    }
  });

  it("sends a drill entry only to the drill roster, and a real entry never to it", () => {
    expect(alertNotSendable(standing({ isDrill: true }), "roster", NOW)).toBeNull();
    expect(alertNotSendable(standing({ isDrill: true }), "subscriber", NOW)).toEqual({ outcome: "skipped", reason: "drill_recipient_mismatch" });
    expect(alertNotSendable(standing({ isDrill: false }), "roster", NOW)).toEqual({ outcome: "skipped", reason: "drill_recipient_mismatch" });
  });
});

describe("capacity and the pace", () => {
  it("counts the segments a run can still send at the pace", () => {
    expect(capacitySegments(50_000, 3)).toBe(150);
    expect(capacitySegments(999, 3)).toBe(2);
    expect(capacitySegments(0, 3)).toBe(0);
    expect(capacitySegments(-5, 3)).toBe(0);
  });

  it("takes the longest prefix in claim order that fits, and never skips over a row that does not", () => {
    const rows = [{ id: "a", segments: 2 }, { id: "b", segments: 1 }, { id: "c", segments: 5 }, { id: "d", segments: 1 }];
    expect(takeWithinSegments(rows, 3).map((row) => row.id)).toEqual(["a", "b"]);
    expect(takeWithinSegments(rows, 8).map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(takeWithinSegments(rows, 1)).toEqual([]);
    expect(takeWithinSegments(rows, 100).map((row) => row.id)).toEqual(["a", "b", "c", "d"]);
  });

  /** Drives a limiter the way the dispatcher does (wait, then record) and returns every submission as [ms, segments]. */
  function simulate(rate: number, sizes: number[], barrierMs = 0): [number, number][] {
    const limiter = createPaceLimiter(rate, 0, barrierMs);
    let now = 0;
    const sent: [number, number][] = [];
    for (const segments of sizes) {
      now += limiter.waitMs(now, segments);
      limiter.record(now, segments);
      sent.push([now, segments]);
    }
    return sent;
  }

  /** The most segments in any window of 1000 ms (half open, so a send exactly 1000 ms later is outside it). */
  function busiest(sent: [number, number][]): number {
    return Math.max(...sent.map(([at]) => sent.filter(([other]) => other > at - 1000 && other <= at).reduce((sum, [, segments]) => sum + segments, 0)));
  }

  it("never lets more than 3 segments into any one second, for one-segment texts, at the full rate", () => {
    const sent = simulate(3, Array(300).fill(1));
    expect(busiest(sent)).toBe(3);
    // 300 one-segment texts at 3 a second take 100 seconds: the pace is used, not wasted.
    expect(sent.at(-1)![0]).toBe(99_000);
  });

  it("holds for any mix of one- and many-segment texts (a sliding window, not a bucket aligned to the clock)", () => {
    let seed = 12345;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    for (let round = 0; round < 20; round += 1) {
      const sizes = Array.from({ length: 200 }, () => 1 + Math.floor(random() * 3));
      const sent = simulate(3, sizes);
      expect(busiest(sent), `round ${round}`).toBeLessThanOrEqual(3);
    }
  });

  it("holds a text of more segments than the rate until nothing else is counted, and counts it for as long as its segments take", () => {
    const sent = simulate(3, [1, 6, 1]);
    // The 6-segment text waits for the first to age out; the next text waits the 2 seconds the 6 segments take at the pace.
    expect(sent).toEqual([[0, 1], [1000, 6], [3000, 1]]);
  });

  it("waits out the barrier the previous lease holder left, then sends at the pace", () => {
    const sent = simulate(3, [1, 1, 1, 1], 750);
    expect(sent.map(([at]) => at)).toEqual([750, 750, 750, 1750]);
  });

  it("reports what it has committed the provider to, for the next holder", () => {
    const limiter = createPaceLimiter(3, 0);
    expect(limiter.debtMs(0)).toBe(0);
    limiter.record(0, 1);
    limiter.record(400, 1);
    expect(limiter.debtMs(500)).toBe(900);
    expect(limiter.debtMs(5000)).toBe(0);
    expect(createPaceLimiter(3, 0, 2000).debtMs(500)).toBe(1500);
  });

  it("refuses a pace that is not a positive number", () => {
    expect(() => createPaceLimiter(0, 0)).toThrow();
    expect(() => createPaceLimiter(-1, 0)).toThrow();
  });
});

describe("the status callback URL", () => {
  it("is PUBLIC_BASE_URL/api/twilio/status?ref={callback_ref}", () => {
    const ref = "0190aaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    expect(statusCallbackUrl("https://cvh.example", ref)).toBe(`https://cvh.example/api/twilio/status?ref=${ref}`);
    expect(statusCallbackUrl("https://cvh.example/", ref)).toBe(`https://cvh.example/api/twilio/status?ref=${ref}`);
  });
});
