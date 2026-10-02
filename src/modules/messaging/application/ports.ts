import type { DbExecutor, DbTransaction } from "../../../platform/db";

/** What a text is sent with. `from` is the verified toll-free number (TWILIO_FROM_NUMBER). */
export interface OutboundText {
  to: string;
  from: string;
  body: string;
}

/**
 * What the provider answered. The text of a provider error can quote the number, so it is for the
 * screen only: never stored, never audited, never logged.
 *  - `accepted`: the provider took the text (HTTP 2xx) and gave it an id and a status word (`queued`);
 *  - `rejected`: the provider answered with an error (HTTP status, its numeric error code and message);
 *  - `unreachable`: no usable answer (the request failed or timed out): the text may or may not have been sent.
 */
export type ProviderAnswer =
  | { kind: "accepted"; httpStatus: number; status: string; messageId: string }
  | { kind: "rejected"; httpStatus: number; errorCode: number | null; message: string | null }
  | { kind: "unreachable" };

/** Port: the SMS provider (Twilio). One call, one text, never retried by the adapter. */
export interface SmsProvider {
  send(text: OutboundText): Promise<ProviderAnswer>;
}

/** A claim on the ledger: the right to send one test text, taken before the provider is called. */
export interface TestSendClaim {
  requestId: string;
  staffId: string;
  /** Keyed hash of the number (never the number). */
  numberHash: string;
  /** A claim on the same number within this long (by the database's clock) makes this one a duplicate. */
  windowMs: number;
}

export type ClaimResult = { kind: "claimed"; id: number } | { kind: "duplicate_request" } | { kind: "duplicate_number" };

/** What is recorded on a claim once the provider answered (or did not). The completion time is the database's. */
export interface TestSendResult {
  outcome: "sent" | "failed" | "unknown";
  httpStatus: number | null;
  providerStatus: string | null;
  messageId: string | null;
  errorCode: number | null;
}

/** A claim that never got its answer recorded (the app crashed, or recording failed): the text may or may not have gone. */
export interface PendingAttempt {
  id: number;
  claimedAt: Date;
}

/**
 * Port: the ledger of test sends (messaging's `sms_test_send`). The claim and the completion run in the
 * caller's transaction and read through it only; every time comparison is made by the database's clock.
 * `claim` must be race-safe: two claims on the same number or the same request id at once let at most one through.
 */
export interface TestSendStore {
  claim(tx: DbTransaction, claim: TestSendClaim): Promise<ClaimResult>;
  complete(tx: DbTransaction, id: number, result: TestSendResult): Promise<void>;
  /** Claims still `pending` after `olderThanMs` (the database's clock), newest first, at most `limit`. */
  listPending(executor: DbExecutor, olderThanMs: number, limit: number): Promise<PendingAttempt[]>;
}
