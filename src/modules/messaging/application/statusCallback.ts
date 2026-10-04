// Delivery status comes only from signed provider callbacks (S06.04, AD-8, AD-20 "Webhooks"). One use case, `handle`, for one request
// to `POST /api/twilio/status?ref={callback_ref}`:
//  1. With no Twilio account configured nothing can be validated, so nothing is done (`not_configured`).
//  2. The signature comes first, before any other work: `X-Twilio-Signature` is checked against the URL built from PUBLIC_BASE_URL
//     (the path and query string the dispatcher gave Twilio, `ref` included) and the form body. A wrong or missing signature is
//     refused (`rejected`, the route answers 403), writes nothing but one `webhook.signature_invalid` event (the health job alerts
//     the on-call Admin at more than 5 in 10 minutes, S06.07), and reads nothing of the body beyond what the signature needs.
//  3. A validly signed callback with no `ref`, a `ref` that matches no delivery, or no usable MessageSid and MessageStatus changes
//     nothing and is counted in ops_event (`delivery.callback_ignored`); the route still answers 200.
//  4. Otherwise ONE transaction locks the delivery row `FOR UPDATE` (the row the dispatcher's outcome, the sweep and a cancellation
//     also write, so whichever commits first wins and the others find the row as it then is), decides by the pure rules
//     (domain/statusCallback.ts) and applies the status by the transition table: a provider id the row lacks is stored with it, one it
//     has is never replaced (a different one is a mismatch: nothing changes, `delivery.provider_id_mismatch`), a terminal state never
//     changes, a repeat or a late non-terminal status changes nothing, and an `unknown` row that moves on is marked resolved
//     (`delivery.unknown_resolved`) in the same transaction. An `unknown` row that was once `submitted` (aged out after 24 hours) moves
//     only on a final status: a non-terminal one would only be undone by the next sweep, again and again.
// The callback is the only place a delivery reaches `delivered`, `undelivered` or a late `failed`. It never reads or logs a number or a
// text: the body's To, From and Body are not looked at, and the log lines hold the delivery's id, states and reasons only.
import type { Db, DbTransaction } from "../../../platform/db";
import type { DeliveryState } from "../domain/deliveryState";
import {
  STATUS_CALLBACK_PATH,
  decideCallback,
  parseCallbackPayload,
  readCallbackRef,
  type CallbackIgnoreReason,
  type CallbackIgnoredReason,
  type CallbackTarget,
  type SignatureFailureReason,
} from "../domain/statusCallback";
import { isValidTwilioSignature } from "../domain/twilioSignature";
import type { DeliveryView, MessagingLog } from "./deliveryPorts";
import type { MessagingOpsEvent, OpsRecorder } from "./dispatcherPorts";

/** The delivery table as the callbacks use it. Every call runs in the transaction it is given. */
export interface CallbackStore {
  /** The delivery whose `callback_ref` this is, locked `FOR UPDATE` (the hand-off's, the outcome write's and a cancellation's own lock); null when there is none. */
  lockByCallbackRef(tx: DbTransaction, ref: string): Promise<DeliveryView | null>;
  /**
   * Moves the row from `from` to `to`, storing the provider id it lacks (`providerMessageId`, null to leave it) and, for a failure, Twilio's
   * error code (null to leave it). Conditional on the state read under the lock (and, from `claimed`, on the hand-off); null when it
   * matched no row, which the lock makes impossible.
   */
  applyCallback(
    tx: DbTransaction,
    change: { id: string; from: DeliveryState; to: CallbackTarget; providerMessageId: string | null; errorCode: number | null },
  ): Promise<DeliveryView | null>;
}

/** The request as the route gives it, before anything of it is believed. */
export interface CallbackRequest {
  /** The `X-Twilio-Signature` header; null when there is none. */
  signature: string | null;
  /** The request URL's query string as received (`?ref=...`), or "" for none. */
  search: string;
  /** The raw form body (`application/x-www-form-urlencoded`). */
  body: string;
}

/** What the callback came to: the route answers 503 for `not_configured`, 403 for `rejected` and 200 for everything else. */
export type CallbackResult =
  | { kind: "not_configured" }
  | { kind: "rejected"; reason: SignatureFailureReason }
  | { kind: "applied"; from: DeliveryState; to: CallbackTarget }
  | { kind: "ignored"; reason: CallbackIgnoredReason | CallbackIgnoreReason }
  | { kind: "mismatch" };

export interface StatusCallbackDeps {
  db: Db;
  store: CallbackStore;
  /** Where the events are recorded (the composition root wires it to `ops`, as for the dispatcher). */
  ops: OpsRecorder;
  log: MessagingLog;
  /** The Twilio account's Auth Token, which signs every callback; undefined where there is no Twilio account (every environment but production). */
  authToken: string | undefined;
  /** PUBLIC_BASE_URL: an https origin with no path; the callback URL Twilio signed is this plus the path and query the dispatcher gave it. */
  publicBaseUrl: string;
  /**
   * S06.08's seam, the dispatcher's `afterOutcome` for the one case it never reaches: the callback that moves a `claimed` row (a callback
   * that arrived before the dispatcher recorded the provider's answer) is the first record that the provider accepted the text, so the
   * spend estimate is counted here, once, as the dispatcher would have counted it, with `'submitted'`. Called inside the callback's
   * transaction, in a savepoint: if it throws its own writes are undone, the status stays (who received an alert matters more than an
   * estimate, which the reconciliation corrects) and `callback.spend_hook_failed` is logged. Never called when the dispatcher wrote the outcome first.
   */
  afterOutcome?: (tx: DbTransaction, delivery: DeliveryView, outcome: "submitted") => Promise<void>;
  /**
   * S06.08's seam for its matching rule ("a delivery's provider id is recorded later, for example by a late callback"): called when the
   * callback has stored a provider id the delivery lacked (a `claimed` row, or an `unknown` one that never got an id), with the updated
   * row, so an actual price already imported for that MessageSid can retire the delivery's estimate. Same transaction and savepoint
   * rules as `afterOutcome`; called before it. Not called when the delivery already had the id.
   */
  afterProviderId?: (tx: DbTransaction, delivery: DeliveryView) => Promise<void>;
  /**
   * S07.02's seam, the dispatcher's `afterFailure` for a refusal the provider reports later: called when the callback moves the row to `failed`
   * or `undelivered`, with the updated row and the callback's error code (null when it had none), in a savepoint of the callback's
   * transaction (a hook that throws undoes only its own writes; the status stays and `callback.failure_hook_failed` is logged).
   */
  afterFailure?: (tx: DbTransaction, delivery: DeliveryView, errorCode: number | null) => Promise<void>;
}

export interface StatusCallbacks {
  handle(request: CallbackRequest): Promise<CallbackResult>;
}

const nameOf = (error: unknown) => (error instanceof Error ? error.name : "NonError");

export function createStatusCallbacks(deps: StatusCallbackDeps): StatusCallbacks {
  const { db, store, ops, log, authToken, publicBaseUrl } = deps;

  /** The URL Twilio was given, from the app's own base URL and the request's path and query (never the host header: a proxy can change it). */
  const signedUrl = (search: string) => `${publicBaseUrl.replace(/\/+$/, "")}${STATUS_CALLBACK_PATH}${search === "" || search === "?" ? "" : search.startsWith("?") ? search : `?${search}`}`;

  async function ignored(executor: Db | DbTransaction, reason: CallbackIgnoredReason, deliveryId?: string): Promise<CallbackResult> {
    const event: MessagingOpsEvent = deliveryId === undefined ? { kind: "delivery.callback_ignored", detail: { reason } } : { kind: "delivery.callback_ignored", deliveryId, detail: { reason } };
    await ops.record(executor, event);
    log.info("callback.ignored", { reason, ...(deliveryId === undefined ? {} : { delivery_id: deliveryId }) });
    return { kind: "ignored", reason };
  }

  async function handle(request: CallbackRequest): Promise<CallbackResult> {
    // 1. Without the account's token nothing can be validated, so nothing is believed or done.
    if (!authToken) return { kind: "not_configured" };

    // 2. The signature, before any other work.
    const params = new URLSearchParams(request.body);
    if (!isValidTwilioSignature(authToken, request.signature, signedUrl(request.search), [...params.entries()])) {
      const reason: SignatureFailureReason = request.signature === null || request.signature === "" ? "missing_signature" : "signature_mismatch";
      log.info("callback.signature_refused", { reason });
      // The refusal never depends on this write: a database that is down still answers 403.
      await ops.record(db, { kind: "webhook.signature_invalid", detail: { route: "twilio_status", reason } }).catch((error: unknown) => log.error("callback.ops_event_failed", { evt_kind: "webhook.signature_invalid", error: nameOf(error) }));
      return { kind: "rejected", reason };
    }

    // 3. What the signed callback is about: a delivery reference, and a message and a status this table knows.
    const ref = readCallbackRef(request.search);
    if (ref.kind === "none") return ignored(db, "no_ref");
    if (ref.kind === "unusable") return ignored(db, "unknown_ref");
    const payload = parseCallbackPayload(params);
    if (payload === null) return ignored(db, "invalid_payload");

    // 4. The delivery, under its lock, in one transaction with everything the callback changes and records.
    const outcome = await db.transaction(async (tx): Promise<CallbackResult & { deliveryId?: string }> => {
      const row = await store.lockByCallbackRef(tx, ref.ref);
      if (!row) {
        await ops.record(tx, { kind: "delivery.callback_ignored", detail: { reason: "unknown_ref" } });
        return { kind: "ignored", reason: "unknown_ref" };
      }
      const decision = decideCallback({ state: row.state, handedOff: row.handedOffAt !== null, submitted: row.submittedAt !== null, providerMessageId: row.providerMessageId }, payload);
      if (decision.kind === "mismatch") {
        await ops.record(tx, { kind: "delivery.provider_id_mismatch", deliveryId: row.id, detail: {} });
        return { kind: "mismatch", deliveryId: row.id };
      }
      if (decision.kind === "ignore") {
        if (decision.reason === "not_in_flight") await ops.record(tx, { kind: "delivery.callback_ignored", deliveryId: row.id, detail: { reason: "not_in_flight" } });
        return { kind: "ignored", reason: decision.reason, deliveryId: row.id };
      }
      const updated = await store.applyCallback(tx, {
        id: row.id,
        from: decision.from,
        to: decision.to,
        providerMessageId: decision.storeProviderId ? payload.messageSid : null,
        errorCode: decision.errorCode,
      });
      // The row is locked, so its state cannot have changed since it was read: no match is a bug, and rolling back is the safe answer.
      if (!updated) throw new Error("The callback's change matched no row although the row was locked");
      if (decision.resolvesUnknown) await ops.record(tx, { kind: "delivery.unknown_resolved", deliveryId: row.id, detail: { status: decision.to } });
      // S06.08's seams, each in a savepoint of its own: a hook that throws undoes only its own writes, and the status stays.
      const { afterProviderId, afterOutcome, afterFailure } = deps;
      if (decision.storeProviderId && afterProviderId) {
        try {
          await tx.transaction((savepoint) => afterProviderId(savepoint, updated));
        } catch (error) {
          log.error("callback.spend_hook_failed", { hook: "provider_id", delivery_id: row.id, error: nameOf(error) });
        }
      }
      if (decision.from === "claimed" && afterOutcome) {
        try {
          await tx.transaction((savepoint) => afterOutcome(savepoint, updated, "submitted"));
        } catch (error) {
          log.error("callback.spend_hook_failed", { hook: "outcome", delivery_id: row.id, error: nameOf(error) });
        }
      }
      if ((decision.to === "failed" || decision.to === "undelivered") && afterFailure) {
        try {
          await tx.transaction((savepoint) => afterFailure(savepoint, updated, decision.errorCode ?? null));
        } catch (error) {
          log.error("callback.failure_hook_failed", { delivery_id: row.id, error: nameOf(error) });
        }
      }
      return { kind: "applied", from: decision.from, to: decision.to, deliveryId: row.id };
    });

    // Said after the commit: a line about a change that was rolled back would be false.
    const { deliveryId, ...result } = outcome;
    if (result.kind === "applied") log.info("callback.applied", { delivery_id: deliveryId ?? null, from: result.from, to: result.to });
    else if (result.kind === "mismatch") log.error("callback.provider_id_mismatch", { delivery_id: deliveryId ?? null });
    else if (result.kind === "ignored") log.info("callback.ignored", { reason: result.reason, ...(deliveryId === undefined ? {} : { delivery_id: deliveryId }) });
    return result;
  }

  return { handle };
}
