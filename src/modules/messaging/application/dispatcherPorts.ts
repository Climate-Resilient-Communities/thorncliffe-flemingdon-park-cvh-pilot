// The ports of the sender (S06.02, AD-8): everything the dispatcher needs from outside its own rules. The provider, the
// clock, the sender lease and the outbox's table are ports so that tests run the whole path with fakes (AD-24: Twilio is
// reached only through a port fake), and so the real adapters are the only code that calls a provider or reads a credential.
import type { Db, DbTransaction } from "../../../platform/db";
import type { AlertStanding, NotSendable, SubmitAnswer, SubmitOutcome, UnknownCause } from "../domain/dispatchRules";
import type { CallbackIgnoredReason, CallbackTarget, SignatureFailureReason } from "../domain/statusCallback";
import type { DeliveryView, MessagingLog } from "./deliveryPorts";
import type { ContactResolver } from "./deliveryPorts";

/**
 * The dispatcher's clock. `now` and `sleep` are the app's (a fake clock in tests jumps instead of waiting). `skewMs` is how far
 * the clock is from the database's: 0 in production, where every decision about the lease, a claim's age, a backoff or a
 * `send_by` is made by the database's own `now()`; a test with a fake clock gives the difference, so a stall of a minute is a
 * jump of the clock and not a minute of waiting.
 */
export interface DispatcherClock {
  now(): Date;
  sleep(ms: number): Promise<void>;
  skewMs(): number;
}

/** One text for the provider: the frozen body byte for byte, the Messaging Service to send it through, and where the status goes. */
export interface MessageSubmission {
  to: string;
  body: string;
  messagingServiceSid: string;
  statusCallback: string;
}

/**
 * Port: the SMS provider's Messaging Service (Twilio). One call, one text, never retried by the adapter; an answer is data, not
 * an error. The adapter sets `SmartEncoded=false` on every request, whatever the caller does (AD-21: the frozen body is sent
 * byte for byte), so the caller has no way to turn Smart Encoding on.
 */
export interface MessageSubmitter {
  submit(submission: MessageSubmission): Promise<SubmitAnswer>;
}

/** What the Messaging Service's settings say about Smart Encoding (the one setting the daily check reads). */
export type SmartEncodingReading = { kind: "read"; smartEncoding: boolean } | { kind: "unreadable"; reason: string };

/** Port: reads the Messaging Service's Smart Encoding setting (the Twilio adapter; nothing else about the service is read or changed). */
export interface MessagingServiceReader {
  readSmartEncoding(messagingServiceSid: string): Promise<SmartEncodingReading>;
}

/** Where the dispatcher sends: a provider (production, with its credentials), or nowhere (`SMS_MODE=log`: no provider, no credentials). */
export type DispatcherConfig =
  | { mode: "log" }
  | { mode: "live"; submitter: MessageSubmitter; messagingServiceSid: string; publicBaseUrl: string };

/** The lease a run holds: its ownership token, and how long the previous holder's pace still binds. */
export interface Lease {
  token: string;
  paceBarrierMs: number;
}

/** A delivery row locked for the hand-off, with what the database's clock says about its `send_by`. */
export interface LockedDelivery {
  row: DeliveryView;
  sendByPassed: boolean;
}

export type ClaimResult = { kind: "claimed"; rows: DeliveryView[] } | { kind: "lease_lost" };

export interface SweepResult {
  /** Rows claimed for 5 minutes and never handed off, back in the queue with no attempt counted. */
  requeued: number;
  /** Rows that became `unknown`, by cause (each is recorded in ops_event by the same transaction). */
  unknown: { id: string; cause: UnknownCause }[];
  /**
   * Rows the sweep could not settle this time: the row's own transaction (the change and its ops_event) rolled back and the row is
   * left as it was, to be tried again at the next run. One such row never stops the others, and never stops the run from sending.
   * `error` is the error's name only.
   */
  failed: { id: string; cause: UnknownCause; error: string }[];
  /** Rows that became `unknown` whose `afterUnknown` hook failed (its writes were undone, the row and its ops_event were kept). */
  hookFailed: { id: string; error: string }[];
}

/** The state a row not sent at the hand-off point goes to (the transition table's `claimed` rows). */
export type StoppedState = "queued" | "cancelled" | "skipped" | "skipped_env" | "failed";

/**
 * Port: the outbox's table and the sender lease as the dispatcher uses them (messaging's `delivery`, `dispatcher_lease` and
 * `messaging_control`). Every change is a conditional update that names the row's state and the run's claim token, so a row a
 * callback, a cancellation or a replacement already moved is left as it is. `skewMs` is DispatcherClock's.
 */
export interface DispatchStore {
  /** Takes the lease if the previous one has expired (a conditional update that writes a new token and an expiry 60 s ahead); null when another holds it. */
  acquireLease(db: Db, input: { holder: string; ttlMs: number; skewMs: number }): Promise<Lease | null>;
  /** Renews it only while it is still this token's and unexpired; false means the lease was lost and the run must stop. */
  renewLease(db: Db, input: { token: string; ttlMs: number; skewMs: number; paceDebtMs: number }): Promise<boolean>;
  /** Gives the lease up (expires it now) if it is still this token's, leaving the pace for the next holder. */
  releaseLease(db: Db, input: { token: string; skewMs: number; paceDebtMs: number }): Promise<void>;
  /** Whether the lease is still this token's and unexpired, read inside the caller's transaction. */
  leaseHeld(tx: DbTransaction, token: string, skewMs: number): Promise<boolean>;
  /** Whether the pause is on; a missing control row counts as paused (fail closed). */
  isPaused(tx: DbTransaction): Promise<boolean>;
  /**
   * Rows claimed under a token that is no longer current and not handed off return to `queued` (no attempt counted): the new
   * lease holder requeues what the old one claimed. Rows already handed off are left for their callback or the sweep. The statement
   * names the lease (`token = mine and expires_at > now()`), so a worker whose lease was taken requeues nothing of the new holder's.
   */
  requeueOrphans(db: Db, input: { token: string; skewMs: number }): Promise<number>;
  /** Whether any text a claim could take now is queued and due (while paused only those to on-call numbers): a holder whose queue ran dry asks it once after giving up the lease, so a kick that found the lease held is not lost. */
  hasDueRows(db: Db, input: { skewMs: number }): Promise<boolean>;
  /**
   * Claims at most `maxRows` queued, due rows in claim order (`FOR UPDATE SKIP LOCKED`, re-checked still queued and due), and no
   * more than `maxSegments` segments of them, committing `claimed` with this worker and lease token in its own short transaction.
   * While the pause is on only the rows it does not apply to are claimed. A claim whose lease is not this token's claims nothing.
   */
  claim(db: Db, input: { token: string; workerId: string; skewMs: number; maxRows: number; maxSegments: number }): Promise<ClaimResult>;
  /**
   * The expiry rules: unhanded claims past 5 minutes return to `queued` (one statement); handed-off rows with no outcome for 5 minutes
   * and `submitted` rows with no terminal status for 24 hours become `unknown`, at most `maxRows` of them, each in its own transaction
   * with `recordUnknown` (the row as it is now), so a row that cannot be recorded rolls back alone and is reported in `failed`. Inside that
   * transaction `afterUnknown` (when given) runs in a savepoint: if it throws, only its own writes are undone and the row stays `unknown`
   * with its event (reported in `hookFailed`).
   */
  sweep(
    db: Db,
    input: {
      skewMs: number;
      maxRows: number;
      recordUnknown(tx: DbTransaction, row: DeliveryView, cause: UnknownCause): Promise<void>;
      afterUnknown?(tx: DbTransaction, row: DeliveryView, cause: UnknownCause): Promise<void>;
    },
  ): Promise<SweepResult>;
  /** Puts back the rows this token claimed and never handed off (a pause, the end of the run's time, a lost lease); no attempt counted. */
  releaseClaims(db: Db, input: { token: string }): Promise<number>;
  /** Locks the delivery row `FOR UPDATE` (the hand-off's first step); null when it does not exist. */
  lockForHandOff(tx: DbTransaction, id: string, skewMs: number): Promise<LockedDelivery | null>;
  /** Moves a claimed, not handed-off row of this token to a state the transition table allows without a hand-off; false when the row is no longer this token's claim. */
  stopBeforeHandOff(tx: DbTransaction, input: { id: string; token: string; to: StoppedState; errorCode?: number | null }): Promise<boolean>;
  /** Commits `handed_off_at` for a claimed row of this token, once; false when the row is no longer this token's claim. */
  markHandedOff(tx: DbTransaction, input: { id: string; token: string }): Promise<boolean>;
  /** Writes the provider's outcome only while the row is still claimed by this token (and handed off); false when a callback or the sweep already moved it. */
  recordOutcome(tx: DbTransaction, input: { id: string; token: string; outcome: SubmitOutcome; skewMs: number }): Promise<boolean>;
  /** After a refused outcome: fills a missing provider id on this token's row (never one that is there, never a terminal row). */
  fillProviderId(tx: DbTransaction, input: { id: string; token: string; providerMessageId: string }): Promise<"filled" | "same" | "different" | "not_fillable">;
}

/**
 * Port, implemented by `alerting` and wired in the composition root (messaging may not import alerting, AD-2): what the hand-off
 * reads about an alert delivery's entry and thread, inside the hand-off transaction. null when the entry does not exist.
 */
export interface AlertStandingReader {
  /** `skewMs` is DispatcherClock's: the reader asks the database whether the valid-until has passed, moved by it (0 in production). */
  standingOf(tx: DbTransaction, entryId: string, skewMs: number): Promise<AlertStanding | null>;
}

/**
 * Port, implemented by `subscriptions` (S09.07) and wired in the composition root: whether a campaign text is still sendable
 * (the campaign was started by an Admin at aal2 and is not cancelled, and the recipient is still in the campaign's target
 * state). Until campaigns exist the database refuses every campaign row, so none is ever handed off; a campaign row found
 * with no reader wired fails loudly instead of being sent unchecked.
 */
export interface CampaignStandingReader {
  sendable(tx: DbTransaction, input: { campaignId: string; recipientId: string | null }): Promise<boolean>;
}

/** No reader of campaigns is wired, yet a campaign text reached the hand-off point. */
export class CampaignReaderNotWired extends Error {
  constructor() {
    super("No campaign reader is wired, so a campaign text cannot be checked at the hand-off point");
    this.name = "CampaignReaderNotWired";
  }
}

/** The operational events messaging records (no personal data: codes and counts only). `ops` owns their schema (its OPS_EVENT_KINDS). */
export const MESSAGING_OPS_EVENT_KINDS = [
  "delivery.unknown",
  "dispatch.provider_auth_failed",
  "messaging.smart_encoding_on",
  "messaging.smart_encoding_off",
  "messaging.service_check_failed",
  // The status callbacks (S06.04).
  "delivery.unknown_resolved",
  "delivery.callback_ignored",
  "delivery.provider_id_mismatch",
  "webhook.signature_invalid",
] as const;
export type MessagingOpsEventKind = (typeof MESSAGING_OPS_EVENT_KINDS)[number];

export type MessagingOpsEvent =
  | { kind: "delivery.unknown"; deliveryId: string; detail: { cause: UnknownCause; http_status?: number } }
  | { kind: "dispatch.provider_auth_failed"; detail: { http_status: number } }
  | { kind: "messaging.smart_encoding_on"; detail: Record<string, never> }
  | { kind: "messaging.smart_encoding_off"; detail: Record<string, never> }
  | { kind: "messaging.service_check_failed"; detail: { reason: string } }
  | { kind: "delivery.unknown_resolved"; deliveryId: string; detail: { status: CallbackTarget } }
  /** `deliveryId` when the callback named a delivery that exists. */
  | { kind: "delivery.callback_ignored"; deliveryId?: string; detail: { reason: CallbackIgnoredReason } }
  | { kind: "delivery.provider_id_mismatch"; deliveryId: string; detail: Record<string, never> }
  | { kind: "webhook.signature_invalid"; detail: { route: "twilio_status" | "twilio_inbound"; reason: SignatureFailureReason } };

/**
 * Port: where messaging records operational events, in the caller's transaction when it has one. `messaging` may not import
 * `ops` (the spine's graph has `ops` depend on `messaging`), so the composition root wires this to `ops`' `recordOpsEvent`.
 */
export interface OpsRecorder {
  record(executor: Db | DbTransaction, event: MessagingOpsEvent): Promise<void>;
}

export interface DispatcherDeps {
  db: Db;
  store: DispatchStore;
  resolver: ContactResolver;
  alerts: AlertStandingReader;
  campaigns?: CampaignStandingReader;
  ops: OpsRecorder;
  log: MessagingLog;
  clock: DispatcherClock;
  config: DispatcherConfig;
  /** Segments per second (default 3, Twilio's default toll-free rate). */
  segmentsPerSecond?: number;
  /** A run's time limit and the margin it keeps (defaults 60 s and 10 s); a test seam, as are the next two. */
  runLimitMs?: number;
  marginMs?: number;
  /** Rows claimed at a time (default 10). */
  batchRows?: number;
  /** How long since its last renewal a holder renews the lease (default 20 s). */
  leaseRenewAfterMs?: number;
  /** The worker's id in `claimed_by` (default `dispatch-` and 8 random hex digits). */
  workerId?: () => string;
  /**
   * S06.08's seam: called inside the transaction that records an outcome the first time it is written, for the outcomes the
   * spend estimate is counted at (`submitted` and `unknown`, never a requeue), so the estimate commits with the outcome or not at all.
   * The sweep calls it with `unknown` for a text handed off with no outcome, in a savepoint of that row's own transaction: if it
   * throws there, its writes are undone and the row still becomes `unknown` with its ops_event, so a failing hook never stops the
   * queue and never hides an unknown text (the spend is then counted by the reconciliation, as an unmatched actual).
   */
  afterOutcome?: (tx: DbTransaction, delivery: DeliveryView, outcome: "submitted" | "unknown") => Promise<void>;
  /**
   * S06.08's seam for its matching rule: called, in a savepoint of the outcome's transaction, when a slow provider response is written onto a
   * row the sweep had already made `unknown` and so fills the provider id that row never got (`fillProviderId`), with the row and the id it
   * now has. A hook that throws loses only its own writes: the id stays, and `dispatch.spend_hook_failed` is logged (the next
   * reconciliation re-runs the matching over every unretired estimate). Not called when the row already had the id.
   */
  afterProviderId?: (tx: DbTransaction, delivery: DeliveryView) => Promise<void>;
  /**
   * S07.02's seam: called, in a savepoint of the transaction that records it, when the provider refused a text for good (`failed`: a
   * permanent error, or the retries ran out), with the row and the provider's error code (null when there was none). The module that owns the
   * recipient decides what that means: a confirmation refused because the number earlier texted STOP (Twilio 21610) deletes its pending
   * sign-up. A hook that throws loses only its own writes (the outcome stays) and `dispatch.failure_hook_failed` is logged.
   */
  afterFailure?: (tx: DbTransaction, delivery: DeliveryView, errorCode: number | null) => Promise<void>;
}

/** What a run did, with no personal data: counts and a status the job route returns. */
export interface DispatchReport {
  /** `ok`; `lease_held` (another dispatcher holds the lease, nothing was claimed); `lease_lost`; `provider_auth_failed` (the credentials are wrong: the run stopped). */
  status: "ok" | "lease_held" | "lease_lost" | "provider_auth_failed";
  claimed: number;
  handedOff: number;
  submitted: number;
  requeued: number;
  failed: number;
  unknown: number;
  skippedEnv: number;
  /** Not sent at the hand-off point: cancelled, skipped, or put back by the pause. */
  stopped: number;
  /** Segments the provider was handed (what the pace counts). */
  segments: number;
  /** What the sweep did at the start of the run (`failed`: rows it could not settle and will try again; it never stops the run). */
  sweep: { requeued: number; unknown: number; failed: number };
}

export interface Dispatcher {
  /** One run: takes the sender lease or exits without claiming, sweeps, then claims, hands off and submits until the queue is idle or its time is up. */
  run(): Promise<DispatchReport>;
}

/** A reason a row was stopped at the hand-off, for the log. */
export type StopReason = NotSendable["reason"] | "number_invalid" | "sms_mode_log";
