/**
 * The delivery state machine (AD-8, E06 "State transitions"): the only place that says which state changes of a
 * `delivery` row exist. The `delivery_guard` trigger (db/migrations/20261003100000_delivery_outbox.sql) mirrors it and
 * refuses any other change, whoever asks; test/db/delivery.db.test.ts checks every pair of states against both.
 *
 * Pure: no I/O, no clock. The dispatcher, the callbacks and the cancellations (S06.02 to S06.04) ask here before they
 * write.
 *
 * ```mermaid
 * stateDiagram-v2
 *   [*] --> queued
 *   queued --> claimed: claim
 *   queued --> cancelled: cancelQueued
 *   queued --> skipped: recipient deleted
 *   claimed --> queued: not accepted, pause, claim expired, lease token no longer current
 *   claimed --> cancelled: cancelQueued, or not sendable at the hand-off point
 *   claimed --> skipped: recipient deleted, or not sendable at the hand-off point
 *   claimed --> skipped_env: SMS_MODE=log
 *   claimed --> submitted: provider accepted, or a non-terminal callback
 *   claimed --> failed: permanent error, retries exhausted, or a callback
 *   claimed --> unknown: ambiguous outcome, or no outcome 5 minutes after hand-off
 *   claimed --> delivered: callback
 *   claimed --> undelivered: callback
 *   submitted --> delivered: callback
 *   submitted --> undelivered: callback
 *   submitted --> failed: callback
 *   submitted --> unknown: no terminal status after 24 hours
 *   unknown --> submitted: non-terminal callback
 *   unknown --> delivered: callback
 *   unknown --> undelivered: callback
 *   unknown --> failed: callback
 * ```
 */

export const DELIVERY_STATES = ["queued", "claimed", "submitted", "unknown", "delivered", "undelivered", "failed", "cancelled", "skipped", "skipped_env"] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

/** `unknown` means the outcome is unclear; a late callback can still resolve it. */
export const UNRESOLVED_STATES = ["queued", "claimed", "submitted", "unknown"] as const satisfies readonly DeliveryState[];

/** A terminal state never changes. A resend (E09) creates a new row. */
export const TERMINAL_STATES = ["delivered", "undelivered", "failed", "cancelled", "skipped", "skipped_env"] as const satisfies readonly DeliveryState[];

export function isTerminal(state: DeliveryState): boolean {
  return (TERMINAL_STATES as readonly string[]).includes(state);
}

/** One row of the transition table: every `from` to every `to`, for this cause. */
export interface TransitionRow {
  from: readonly DeliveryState[];
  to: readonly DeliveryState[];
  cause: string;
}

/** The transition table of the E06 definitions, row by row. Anything not listed is refused here and by the trigger. */
export const TRANSITION_TABLE: readonly TransitionRow[] = [
  { from: ["queued"], to: ["claimed"], cause: "claim" },
  { from: ["queued"], to: ["cancelled"], cause: "cancelQueued in the transaction of a correction, withdrawal, discard or close" },
  { from: ["queued"], to: ["skipped"], cause: "recipient deletion, in the deletion's transaction" },
  { from: ["claimed"], to: ["queued"], cause: "not accepted (retry with backoff), pause before hand-off, claim expired before hand-off, or claimed under a lease token that is no longer current" },
  { from: ["claimed"], to: ["cancelled"], cause: "cancelQueued before hand-off, or not sendable at the hand-off point" },
  { from: ["claimed"], to: ["skipped"], cause: "recipient deletion before hand-off, or not sendable at the hand-off point (recipient no longer eligible, valid-until or send_by passed, campaign cancelled)" },
  { from: ["claimed"], to: ["skipped_env"], cause: "SMS_MODE=log" },
  { from: ["claimed"], to: ["submitted"], cause: "provider accepted" },
  { from: ["claimed"], to: ["failed"], cause: "permanent error, or retries exhausted" },
  { from: ["claimed"], to: ["unknown"], cause: "ambiguous outcome, or no outcome 5 minutes after hand-off" },
  { from: ["claimed", "submitted", "unknown"], to: ["delivered", "undelivered", "failed"], cause: "signed callback with a terminal status" },
  { from: ["claimed", "unknown"], to: ["submitted"], cause: "signed callback with a non-terminal status (queued, sending, sent)" },
  { from: ["submitted"], to: ["unknown"], cause: "no terminal status after 24 hours" },
];

const ALLOWED: ReadonlySet<string> = new Set(TRANSITION_TABLE.flatMap((row) => row.from.flatMap((from) => row.to.map((to) => `${from}>${to}`))));

/** Whether the table has this change of state. A row never "changes" to the state it is in. */
export function canTransition(from: DeliveryState, to: DeliveryState): boolean {
  return ALLOWED.has(`${from}>${to}`);
}

/**
 * Whether a cancellation or a recipient's deletion may still stop a row: only a `queued` row, or a `claimed` one that
 * has not been handed to the provider. A row already handed off is in flight and is left as it is.
 */
export function canStopBeforeHandOff(state: DeliveryState, handedOff: boolean): boolean {
  return !handedOff && (state === "queued" || state === "claimed");
}
