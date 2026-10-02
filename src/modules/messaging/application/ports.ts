import type { DbTransaction } from "../../../platform/db";

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
  claimedAt: Date;
  /** A claim on the same number at or after this time makes this one a duplicate. */
  windowStart: Date;
}

export type ClaimResult = { kind: "claimed"; id: number } | { kind: "duplicate_request" } | { kind: "duplicate_number" };

/** What is recorded on a claim once the provider answered (or did not). */
export interface TestSendResult {
  outcome: "sent" | "failed" | "unknown";
  httpStatus: number | null;
  providerStatus: string | null;
  messageId: string | null;
  errorCode: number | null;
  completedAt: Date;
}

/**
 * Port: the ledger of test sends (messaging's `sms_test_send`). Both calls run in the caller's
 * transaction and read through it only. `claim` must be race-safe: two claims on the same number
 * or the same request id at once let at most one through.
 */
export interface TestSendStore {
  claim(tx: DbTransaction, claim: TestSendClaim): Promise<ClaimResult>;
  complete(tx: DbTransaction, id: number, result: TestSendResult): Promise<void>;
}
