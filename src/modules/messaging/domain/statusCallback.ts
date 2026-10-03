/**
 * What a signed status callback means for a delivery (S06.04, AD-8, E06 "State transitions"), pure: no I/O, no clock. Delivery
 * status comes only from Twilio's signed callbacks: the use case (../application/statusCallback.ts) checks the signature, reads
 * the request with `readCallbackRef` and `parseCallbackPayload`, locks the delivery row and asks `decideCallback` what to do; the
 * `delivery_guard` trigger refuses anything the transition table does not have, so these rules can only be stricter than the table.
 *
 * The rules:
 *  - a provider id never changes: a callback whose MessageSid differs from the one the row already has changes nothing (a mismatch);
 *  - a terminal state never changes, so a repeat, a late non-terminal status and any status after a final one change nothing;
 *  - a callback moves a row only where the table has the move: `claimed` (after its hand-off), `submitted` or `unknown` to
 *    `delivered`, `undelivered` or `failed` for a terminal status, and `claimed` or `unknown` to `submitted` for a non-terminal one;
 *  - a row the provider cannot have a text for (`queued`, claimed with no hand-off, or finished without ever having an id) is not moved;
 *  - an `unknown` row that was once `submitted` (the sweep gave up on it after 24 hours with no final status) is moved only by a final
 *    status: a non-terminal one would put it back in `submitted` with its old `submitted_at`, which the next sweep turns `unknown` again,
 *    so every replay of one would change the row and write a false recovery.
 */
import { canTransition, isTerminal, type DeliveryState } from "./deliveryState";

/** The path of the callback route (`src/app/api/twilio/status`), the one the dispatcher puts in `StatusCallback`. */
export const STATUS_CALLBACK_PATH = "/api/twilio/status";

/** The statuses that say Twilio has the text and is still working on it (E06: `queued`, `sending`, `sent`; `accepted` and `scheduled` are the Messaging Service's own first words). */
export const NON_TERMINAL_CALLBACK_STATUSES = ["accepted", "scheduled", "queued", "sending", "sent"] as const;
/** The statuses that end a text's story. */
export const TERMINAL_CALLBACK_STATUSES = ["delivered", "undelivered", "failed"] as const;

/** The state a callback asks for. */
export type CallbackTarget = "submitted" | "delivered" | "undelivered" | "failed";
export const CALLBACK_TARGETS: readonly CallbackTarget[] = ["submitted", "delivered", "undelivered", "failed"];

/** The state a Twilio `MessageStatus` stands for, or null for a word this table does not know (`read`, `canceled`, an inbound status, anything else). */
export function callbackTarget(status: string): CallbackTarget | null {
  if ((TERMINAL_CALLBACK_STATUSES as readonly string[]).includes(status)) return status as CallbackTarget;
  if ((NON_TERMINAL_CALLBACK_STATUSES as readonly string[]).includes(status)) return "submitted";
  return null;
}

/** Why a webhook's signature is refused: no header, or a header that is not the request's signature. (ops' SIGNATURE_FAILURE_REASONS is the same list; a test compares them.) */
export const SIGNATURE_FAILURE_REASONS = ["missing_signature", "signature_mismatch"] as const;
export type SignatureFailureReason = (typeof SIGNATURE_FAILURE_REASONS)[number];

/** Why a validly signed callback changes nothing and is counted in ops_event (ops' CALLBACK_IGNORED_REASONS is the same list). */
export const CALLBACK_IGNORED_REASONS = ["no_ref", "unknown_ref", "invalid_payload", "not_in_flight"] as const;
export type CallbackIgnoredReason = (typeof CALLBACK_IGNORED_REASONS)[number];

// --- reading the request -----------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The same shape the database's `delivery_provider_message_id_format` accepts. */
const MESSAGE_SID = /^(SM|MM)[0-9a-f]{32}$/;
const ERROR_CODE = /^[0-9]{1,5}$/;

export type CallbackRefReading =
  /** Exactly one `ref`, shaped like a delivery reference (lower-cased). */
  | { kind: "ref"; ref: string }
  /** No `ref` (or an empty one): a callback from somewhere that was not given one, for example a Messaging Service's own callback URL. */
  | { kind: "none" }
  /** A `ref` that cannot be a delivery's: repeated, or not shaped like a UUID. */
  | { kind: "unusable" };

/** The `ref` of the callback URL's query string (`search`, with or without its `?`). */
export function readCallbackRef(search: string): CallbackRefReading {
  const refs = new URLSearchParams(search).getAll("ref");
  if (refs.length === 0 || (refs.length === 1 && refs[0] === "")) return { kind: "none" };
  if (refs.length > 1 || !UUID.test(refs[0])) return { kind: "unusable" };
  return { kind: "ref", ref: refs[0].toLowerCase() };
}

/** What a status callback says about one text: its provider id, the state it asks for and, for a failure, Twilio's error code. */
export interface CallbackPayload {
  messageSid: string;
  target: CallbackTarget;
  /** Twilio's `ErrorCode` for `failed` and `undelivered` (1 to 99999, what the table keeps), else null. */
  errorCode: number | null;
}

/**
 * The fields of a status callback that matter: exactly one `MessageSid` shaped as the database holds it, and exactly one
 * `MessageStatus` this table knows. null when either is missing, repeated or not understood (the callback is then ignored and
 * counted). Nothing else of the body is read: the number and the text it carries are never looked at.
 */
export function parseCallbackPayload(params: URLSearchParams): CallbackPayload | null {
  const sids = params.getAll("MessageSid");
  const statuses = params.getAll("MessageStatus");
  if (sids.length !== 1 || statuses.length !== 1 || !MESSAGE_SID.test(sids[0])) return null;
  const target = callbackTarget(statuses[0]);
  if (target === null) return null;
  const codes = params.getAll("ErrorCode");
  const code = codes.length === 1 && ERROR_CODE.test(codes[0]) ? Number(codes[0]) : null;
  return { messageSid: sids[0], target, errorCode: code !== null && code >= 1 ? code : null };
}

// --- what a callback does to a row ---------------------------------------------------------------------------

/** What the decision needs of the delivery row, read under its lock. */
export interface CallbackRow {
  state: DeliveryState;
  /** Whether `handed_off_at` is set: only a text handed to the provider can have a callback. */
  handedOff: boolean;
  /** Whether `submitted_at` is set: the row was `submitted` once (the database keeps the first time, so it stays set when the sweep makes the row `unknown`). */
  submitted: boolean;
  providerMessageId: string | null;
}

/** Why a callback changes nothing. `final`: the row is finished and has this id. `no_change`: the status adds nothing (a repeat, a non-terminal status after `submitted`, or one for an `unknown` row that was already `submitted`). `not_in_flight`: the row was never handed to the provider, or finished without an id. */
export const CALLBACK_IGNORE_REASONS = ["final", "no_change", "not_in_flight"] as const;
export type CallbackIgnoreReason = (typeof CALLBACK_IGNORE_REASONS)[number];

export type CallbackDecision =
  | {
      kind: "apply";
      from: DeliveryState;
      to: CallbackTarget;
      /** The row has no provider id yet: the callback's MessageSid is stored with the new state. */
      storeProviderId: boolean;
      /** The row was `unknown`: the callback resolves it, and ops_event says so. */
      resolvesUnknown: boolean;
      /** Stored with a `failed` or `undelivered` state; null otherwise. */
      errorCode: number | null;
    }
  /** The row already has a different provider id: nothing changes, and ops_event records it. */
  | { kind: "mismatch" }
  | { kind: "ignore"; reason: CallbackIgnoreReason };

/** The provider's callback for a delivery, decided by the rules at the top of this file. */
export function decideCallback(row: CallbackRow, payload: CallbackPayload): CallbackDecision {
  if (row.providerMessageId !== null && row.providerMessageId !== payload.messageSid) return { kind: "mismatch" };
  // A finished row never changes. One that never had an id was never accepted by the provider, so a callback for it is not a repeat but a surprise.
  if (isTerminal(row.state)) return { kind: "ignore", reason: row.providerMessageId === null ? "not_in_flight" : "final" };
  // The provider calls back only about a text it was handed.
  if (row.state === "queued" || (row.state === "claimed" && !row.handedOff)) return { kind: "ignore", reason: "not_in_flight" };
  if (!canTransition(row.state, payload.target)) return { kind: "ignore", reason: "no_change" };
  // An unknown row that was submitted aged out of it: it is waiting for a final status, and `submitted_at` (kept by the database) is
  // already past the sweep's 24-hour limit, so moving it back to `submitted` would only make the next sweep flip it again.
  if (row.state === "unknown" && row.submitted && payload.target === "submitted") return { kind: "ignore", reason: "no_change" };
  return {
    kind: "apply",
    from: row.state,
    to: payload.target,
    storeProviderId: row.providerMessageId === null,
    resolvesUnknown: row.state === "unknown",
    errorCode: payload.target === "failed" || payload.target === "undelivered" ? payload.errorCode : null,
  };
}
