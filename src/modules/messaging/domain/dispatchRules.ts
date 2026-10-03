/**
 * The sender's rules (S06.02, AD-8, E06 definitions), pure: no I/O, no clock (every instant is given). The dispatcher
 * (../application/dispatcher.ts) asks here what to claim first, how fast to send, what a provider's answer means for a row,
 * and whether a row is still sendable at the hand-off point; the database mirrors only what it can enforce itself
 * (`delivery_claim_rank()` is `claimRank`, and the `delivery_guard` trigger is the transition table).
 *
 * The guarantee behind all of it is no automatic duplicate submission, not exactly-once delivery: a text is handed to the
 * provider at most once, and anything unclear after the request may have been sent is `unknown`, never sent again.
 */
import { SAFETY_OVERRIDE_TYPES } from "../../../contracts/audience";
import type { DeliveryKind, RecipientKind } from "./deliveryRules";
import { STATUS_CALLBACK_PATH } from "./statusCallback";

/** The sender lease lasts 60 seconds from its last renewal (E06 "Sender lease"). */
export const LEASE_TTL_MS = 60_000;
/** A holder renews when this long has passed since the last renewal, so a stall of a minute is the only way to lose it. */
export const LEASE_RENEW_AFTER_MS = 20_000;
/** A row claimed for this long without a hand-off returns to `queued`; one handed off with no recorded outcome for this long is `unknown`. */
export const CLAIM_EXPIRY_MS = 5 * 60_000;
/** A `submitted` row with no terminal status after this long becomes `unknown`. */
export const SUBMITTED_EXPIRY_MS = 24 * 60 * 60_000;
/** The wait before each retry of a text the provider did not accept: 30 s, 2 min, 10 min. */
export const BACKOFF_MS = [30_000, 120_000, 600_000] as const;
/** At most three retries (the table's `attempts` stops at 3): the next text the provider does not accept fails. */
export const MAX_ATTEMPTS = BACKOFF_MS.length;
/** Twilio's default toll-free rate. */
export const DEFAULT_SEGMENTS_PER_SECOND = 3;
/** A run lasts at most this long (the route's `maxDuration`), and plans its sends to end 10 s before the limit. */
export const RUN_LIMIT_MS = 60_000;
export const RUN_MARGIN_MS = 10_000;
/**
 * The longest the adapter waits for the provider's answer once a request is sent, and what the run still needs after the answer
 * (the outcome's write, the claims put back, the lease given up). The last send of a run starts at the run's limit less the margin,
 * so the margin must cover both: a send that starts as late as it may still finishes, and its outcome is written, inside the limit.
 * A unit test holds the three together.
 */
export const PROVIDER_TIMEOUT_MS = 8_000;
export const OUTCOME_WRITE_ALLOWANCE_MS = 2_000;
/**
 * The limit of the run an approval starts (`kickDispatcher`). That run lives inside the approving request's function, after the
 * response, so it must end well inside that function's `maxDuration`; the approving route sets 60 s (S04.07), and pg_cron's next run
 * (every minute) takes whatever the kick did not send. With the margin above it sends for 10 s, about 30 segments.
 */
export const KICK_RUN_LIMIT_MS = 20_000;
/** Rows the sweep settles in one run (the rest wait for the next one), so a backlog cannot use up a run that has texts to send. */
export const SWEEP_BATCH_ROWS = 200;
/** Rows claimed at a time, so a fire alert approved during a burst is claimed at the next batch, not the next run. */
export const CLAIM_BATCH_ROWS = 10;
/**
 * A 401 stops the run at once (the credentials are wrong for the whole account, and every further text would fail for good); a 403 stops
 * it after this many in a row (a 403 can also be about one text, so a few are tolerated).
 */
export const AUTH_FAILURE_LIMIT = 3;

// --- claim order -----------------------------------------------------------------------------------------

/** Where a row stands in the claim order: lower goes first, then oldest first. */
export const CLAIM_RANKS = {
  fireAlert: 0,
  oncall: 1,
  transactional: 2,
  buildingAlert: 3,
  neighbourhoodAlert: 4,
  campaign: 5,
} as const;
export type ClaimRank = (typeof CLAIM_RANKS)[keyof typeof CLAIM_RANKS];

/**
 * The entry types that put an alert first: the safety types of the audience rules (`SAFETY_OVERRIDE_TYPES`), the disruption type
 * `fire` ("Fire alarm or evacuation", the one type that covers an evacuation). `delivery_claim_rank()` in the database repeats the
 * list, and a test compares the two.
 */
export const FIRST_ALERT_TYPES: readonly string[] = SAFETY_OVERRIDE_TYPES;

/**
 * The claim order of the E06 definitions: fire alert entries first (the `fire` type covers an evacuation), then on-call and other transactional
 * texts, then building-level before neighbourhood-level alerts (then oldest first, which the caller adds). A campaign text,
 * which the definitions do not rank, goes last. `delivery_claim_rank()` in the database is this function, fixed when the row
 * is created from what the entry says (its types and audience scope never change once it is submitted).
 */
export function claimRank(row: { kind: DeliveryKind; recipientKind: RecipientKind; entryTypes?: readonly string[] | null; audienceScope?: string | null }): ClaimRank {
  if (row.kind === "alert" && (row.entryTypes ?? []).some((type) => FIRST_ALERT_TYPES.includes(type))) return CLAIM_RANKS.fireAlert;
  if (row.kind === "transactional" && row.recipientKind === "oncall") return CLAIM_RANKS.oncall;
  if (row.kind === "transactional") return CLAIM_RANKS.transactional;
  if (row.kind === "alert" && row.audienceScope === "buildings") return CLAIM_RANKS.buildingAlert;
  if (row.kind === "alert") return CLAIM_RANKS.neighbourhoodAlert;
  return CLAIM_RANKS.campaign;
}

// --- the pause -------------------------------------------------------------------------------------------

/**
 * Whether the pause stops this text: it applies to `alert`, `campaign` and resident `transactional` texts; on-call texts to
 * `oncall` recipients are still sent so Admins hear about problems (E06 definitions, "Sendable (every kind)").
 */
export function pauseApplies(row: { recipientKind: RecipientKind }): boolean {
  return row.recipientKind !== "oncall";
}

// --- pace and capacity -----------------------------------------------------------------------------------

/** How many segments a run can still send at `segmentsPerSecond` in `remainingMs` (whole segments). */
export function capacitySegments(remainingMs: number, segmentsPerSecond: number): number {
  if (!(remainingMs > 0)) return 0;
  return Math.floor((remainingMs * segmentsPerSecond) / 1000);
}

/**
 * The longest prefix of `rows` (already in claim order) whose segments fit in `maxSegments`. A row that does not fit ends
 * the prefix: the order is never skipped over, so a lower-priority text never overtakes the one before it.
 */
export function takeWithinSegments<T extends { segments: number }>(rows: readonly T[], maxSegments: number): T[] {
  const taken: T[] = [];
  let total = 0;
  for (const row of rows) {
    if (total + row.segments > maxSegments) break;
    total += row.segments;
    taken.push(row);
  }
  return taken;
}

export interface PaceLimiter {
  /** How long to wait from `nowMs` before a text of `segments` may be submitted. */
  waitMs(nowMs: number, segments: number): number;
  /** Records a submission at `nowMs`. */
  record(nowMs: number, segments: number): void;
  /** How long after `nowMs` the next holder must still wait (what this limiter has committed the provider to). */
  debtMs(nowMs: number): number;
}

/**
 * The shared send pace: at most `segmentsPerSecond` segments in any one second (a sliding window, not a bucket aligned to
 * the clock), so the provider never receives more than its rate whatever the mix of one- and many-segment texts. Each
 * submission counts for a second from the moment it is made, and a text longer than a second's worth of segments counts
 * for as long as its segments take at the pace; a text of more segments than the rate waits until nothing else is counted.
 * `barrierMs` is what the previous lease holder left (`dispatcher_lease.paced_until`): nothing is submitted before it.
 * Pure: the caller gives the instants, so a fake clock proves it.
 */
export function createPaceLimiter(segmentsPerSecond: number, startMs: number, barrierMs = 0): PaceLimiter {
  if (!(segmentsPerSecond > 0)) throw new Error("The send pace must be a positive number of segments per second");
  const sent: { until: number; segments: number }[] = [];
  const blockedUntil = startMs + Math.max(0, barrierMs);
  const countedFor = (segments: number) => Math.max(1000, Math.ceil((segments * 1000) / segmentsPerSecond));
  return {
    waitMs(nowMs, segments) {
      const room = Math.max(segmentsPerSecond, segments);
      let at = Math.max(nowMs, blockedUntil);
      for (;;) {
        const counted = sent.filter((entry) => entry.until > at);
        const total = counted.reduce((sum, entry) => sum + entry.segments, 0);
        if (total + segments <= room) return at - nowMs;
        at = Math.min(...counted.map((entry) => entry.until));
      }
    },
    record(nowMs, segments) {
      sent.push({ until: nowMs + countedFor(segments), segments });
      // What has expired can never count again (the clock only moves forward).
      for (let index = sent.length - 1; index >= 0; index -= 1) if (sent[index].until <= nowMs) sent.splice(index, 1);
    },
    debtMs(nowMs) {
      return Math.max(0, blockedUntil - nowMs, ...sent.map((entry) => entry.until - nowMs));
    },
  };
}

// --- what the provider's answer means ------------------------------------------------------------------

/**
 * What a provider answered (the adapter's data, never an error): `accepted` (2xx with a message id), `rejected` (an HTTP error
 * with Twilio's code and message), `not_sent` (the connection failed before any of the request was sent) and `no_answer` (the
 * request may have been sent, and no usable answer came back).
 */
export type SubmitAnswer =
  | { kind: "accepted"; httpStatus: number; status: string; messageId: string }
  | { kind: "rejected"; httpStatus: number; errorCode: number | null; message: string | null }
  | { kind: "not_sent"; reason: NotSentReason }
  | { kind: "no_answer"; reason: NoAnswerReason };

export const NOT_SENT_REASONS = ["connection_refused", "host_not_found", "network_unreachable", "connect_timeout", "tls_failed"] as const;
export type NotSentReason = (typeof NOT_SENT_REASONS)[number];

export const NO_ANSWER_REASONS = ["timeout", "connection_lost", "unusable_response", "accepted_then_dropped", "accepted_then_error"] as const;
export type NoAnswerReason = (typeof NO_ANSWER_REASONS)[number];

/** Why a row became `unknown` (the code `ops_event` records; no text, no number). */
export const UNKNOWN_CAUSES = [
  "server_error",
  "rate_limited_without_error_body",
  "unexpected_status",
  "timeout",
  "connection_lost",
  "unusable_response",
  "accepted_then_dropped",
  "accepted_then_error",
  "provider_threw",
  "no_outcome_after_hand_off",
  "no_terminal_status",
] as const;
export type UnknownCause = (typeof UNKNOWN_CAUSES)[number];

/** What the dispatcher writes on the row after the provider call. */
export type SubmitOutcome =
  | { kind: "submitted"; providerMessageId: string }
  /** Not accepted: back to `queued`, one more attempt, due after the backoff. */
  | { kind: "requeue"; dueInMs: number }
  | { kind: "failed"; errorCode: number | null; reason: "permanent_error" | "retries_exhausted" }
  | { kind: "unknown"; cause: UnknownCause; httpStatus: number | null };

/** Codes (not texts) of the not-accepted answers a failed row keeps. */
const providerCode = (code: number | null): number | null => (code !== null && Number.isInteger(code) && code >= 1 && code <= 99_999 ? code : null);

/**
 * The E06 definitions as a function. Only two answers say the provider did not take the text, and only they are retried
 * (3 times at most, then `failed`): HTTP 429 with an error body, and a connection that failed before any of the request was
 * sent. A provider 4xx other than 429 is a permanent error (`failed`, never retried). Everything else after the request may
 * have been sent (a 5xx, a timeout, a dropped connection, an acceptance followed by an error) is `unknown`, and an `unknown`
 * is never sent again automatically. `attempts` is the number of earlier returns to the queue.
 */
export function classifyAnswer(answer: SubmitAnswer, attempts: number): SubmitOutcome {
  switch (answer.kind) {
    case "accepted":
      return { kind: "submitted", providerMessageId: answer.messageId };
    case "not_sent":
      return notAccepted(attempts, null);
    case "no_answer":
      return { kind: "unknown", cause: answer.reason, httpStatus: null };
    case "rejected": {
      const { httpStatus } = answer;
      if (httpStatus === 429) {
        const hasErrorBody = answer.errorCode !== null || answer.message !== null;
        return hasErrorBody ? notAccepted(attempts, providerCode(answer.errorCode)) : { kind: "unknown", cause: "rate_limited_without_error_body", httpStatus };
      }
      if (httpStatus >= 400 && httpStatus <= 499) return { kind: "failed", errorCode: providerCode(answer.errorCode), reason: "permanent_error" };
      return { kind: "unknown", cause: httpStatus >= 500 ? "server_error" : "unexpected_status", httpStatus };
    }
  }
}

function notAccepted(attempts: number, errorCode: number | null): SubmitOutcome {
  if (attempts >= MAX_ATTEMPTS) return { kind: "failed", errorCode, reason: "retries_exhausted" };
  return { kind: "requeue", dueInMs: BACKOFF_MS[attempts] };
}

/** Whether an answer says the credentials are wrong or not allowed (401 or 403). */
export function isAuthFailure(answer: SubmitAnswer): boolean {
  return answer.kind === "rejected" && (answer.httpStatus === 401 || answer.httpStatus === 403);
}

/** Whether the run stops: at the first 401, or at the AUTH_FAILURE_LIMIT-th 401 or 403 in a row (`inARow` counts this answer). */
export function authFailureStopsRun(answer: SubmitAnswer, inARow: number): boolean {
  if (answer.kind !== "rejected") return false;
  if (answer.httpStatus === 401) return true;
  return answer.httpStatus === 403 && inARow >= AUTH_FAILURE_LIMIT;
}

// --- sendable at the hand-off point --------------------------------------------------------------------

/** What the hand-off reads about an alert delivery's entry and thread (alerting gives it; see AlertStandingReader). */
export interface AlertStanding {
  /** The entry's status: only `approved` is sendable (`superseded` and `discarded` are named in the reasons). */
  entryStatus: string;
  entryKind: "ack" | "update" | "correction" | "withdrawal" | "final";
  /** Whether the entry's valid-until has passed, by the database's clock (the reader asks the database; no app clock decides). */
  validUntilPassed: boolean;
  threadOpen: boolean;
  /** The entry whose approval closed the thread: its deliveries stay sendable after the close. */
  isClosingEntry: boolean;
  isDrill: boolean;
}

export const NOT_SENDABLE_REASONS = [
  "paused",
  "send_by_passed",
  "recipient_gone",
  "entry_missing",
  "entry_not_approved",
  "entry_superseded",
  "entry_discarded",
  "thread_closed",
  "valid_until_passed",
  "drill_recipient_mismatch",
  "campaign_not_sendable",
] as const;
export type NotSendableReason = (typeof NOT_SENDABLE_REASONS)[number];

/** What a row that is not sendable becomes: `cancelled` when what it said was withdrawn, `skipped` when it can no longer reach its recipient. */
export interface NotSendable {
  outcome: "cancelled" | "skipped";
  reason: NotSendableReason;
}

/**
 * "Sendable (`alert`)" (E06 definitions): the entry is approved and not superseded or discarded; its thread is open, or the
 * entry is the closing entry; for `ack`, `update` and `correction` the valid-until has not passed (finals and withdrawals have
 * no valid-until check); drill entries only to `roster` recipients (and a real entry never to one). Withdrawn content is
 * `cancelled` (the same as `cancelQueued` would have made it); a text that is too late or has no right recipient is `skipped`.
 * `null` is sendable.
 */
export function alertNotSendable(standing: AlertStanding | null, recipientKind: RecipientKind): NotSendable | null {
  if (standing === null) return { outcome: "cancelled", reason: "entry_missing" };
  if (standing.entryStatus !== "approved") {
    const reason: NotSendableReason = standing.entryStatus === "superseded" ? "entry_superseded" : standing.entryStatus === "discarded" ? "entry_discarded" : "entry_not_approved";
    return { outcome: "cancelled", reason };
  }
  if (!standing.threadOpen && !standing.isClosingEntry) return { outcome: "cancelled", reason: "thread_closed" };
  const expires = standing.entryKind === "ack" || standing.entryKind === "update" || standing.entryKind === "correction";
  if (expires && standing.validUntilPassed) return { outcome: "skipped", reason: "valid_until_passed" };
  if (standing.isDrill !== (recipientKind === "roster")) return { outcome: "skipped", reason: "drill_recipient_mismatch" };
  return null;
}

/** The URL the provider calls back with a text's status: `PUBLIC_BASE_URL/api/twilio/status?ref={callback_ref}` (S06.04 checks the signature against it). */
export function statusCallbackUrl(publicBaseUrl: string, callbackRef: string): string {
  return `${publicBaseUrl.replace(/\/+$/, "")}${STATUS_CALLBACK_PATH}?ref=${encodeURIComponent(callbackRef)}`;
}

/**
 * Twilio's webhook connection overrides for the status callback, in the URL's fragment (S06.04). By default Twilio retries a webhook once
 * and only when the TCP or TLS connection fails (`rc=1`, `rp=ct`), so a 5xx, which is what the route answers when its database fails
 * while a final status is applied, would lose that status for good. `rc=3` asks for up to three retries and `rp=ct,5xx` for them on a
 * connection failure and on any 5xx answer (not on a 4xx: a refused signature is not mended by sending it again). Twilio's own total time
 * limit (`tt`, 15 s by default and at most 15 s) covers the retries, so a database that stays down longer is left to the sweep, which
 * makes the text `unknown` (visible, never lost, never sent again). Every callback is idempotent, so a retry changes nothing that the
 * first did not. The fragment is never sent to the server and Twilio leaves it out of the signature, so the URL the callback is
 * checked against (`statusCallbackUrl`) is unchanged.
 */
export const STATUS_CALLBACK_CONNECTION_OVERRIDES = "#rc=3&rp=ct,5xx";

/** The `StatusCallback` the provider is given: the URL it will call (and sign) plus the connection overrides that make a 5xx worth a retry. */
export function providerStatusCallbackUrl(publicBaseUrl: string, callbackRef: string): string {
  return `${statusCallbackUrl(publicBaseUrl, callbackRef)}${STATUS_CALLBACK_CONNECTION_OVERRIDES}`;
}
