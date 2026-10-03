import type { DbTransaction } from "../../../platform/db";
import type { CreatingModule, DeliveryKind, DeliveryRefusal, RecipientKind } from "../domain/deliveryRules";
import type { DeliveryState } from "../domain/deliveryState";

/** An expected outcome as a value (spine: Errors). */
export type DeliveryResult<T> = { ok: true; value: T } | { ok: false; error: DeliveryRefusal };

/**
 * One `delivery` row as the app reads it. It never holds a phone number (AD-13): the number is resolved at the
 * hand-off point and kept in memory only.
 */
export interface DeliveryView {
  id: string;
  kind: DeliveryKind;
  recipientKind: RecipientKind;
  /** Null once the recipient was deleted. */
  recipientId: string | null;
  entryId: string | null;
  campaignId: string | null;
  createdByModule: CreatingModule;
  purpose: string | null;
  lang: string;
  /** The frozen body, sent byte for byte. */
  body: string;
  segments: number;
  costEstimateCents: number;
  idempotencyKey: string;
  /** The opaque random reference the provider's status callback carries. */
  callbackRef: string;
  state: DeliveryState;
  attempts: number;
  dueAt: Date;
  sendBy: Date | null;
  claimedAt: Date | null;
  claimedBy: string | null;
  claimToken: string | null;
  handedOffAt: Date | null;
  submittedAt: Date | null;
  providerMessageId: string | null;
  providerErrorCode: number | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** When a text must be sent by: an instant (a recipient row's own expiry), or a window from the database's now(). */
export type SendBy = { at: Date } | { withinMs: number };

/** A row to add; the database gives its state (`queued`), its callback reference and its times. */
export interface NewDelivery {
  id: string;
  kind: DeliveryKind;
  recipientKind: RecipientKind;
  recipientId: string;
  entryId: string | null;
  campaignId: string | null;
  createdByModule: CreatingModule;
  purpose: string | null;
  lang: string;
  body: string;
  segments: number;
  costEstimateCents: number;
  idempotencyKey: string;
  sendBy: SendBy | null;
}

/** A row the queue holds for a key, and whether this call made it (false: it was there already, and is returned as it is). */
export interface Enqueued {
  delivery: DeliveryView;
  created: boolean;
}

/** What a recipient's deletion left of their rows: `skipped` is how many it stopped, `inFlight` how many were already handed off. */
export interface SkippedForRecipient {
  skipped: number;
  inFlight: number;
}

/**
 * Port: the outbox's table (messaging's `delivery`). Every call runs in the caller's transaction and reads and writes
 * through it only. `insert` is idempotent on the key: a row whose key exists is returned as it is, with no error, even
 * when the other insert is still running (the second waits for the first to commit).
 */
export interface DeliveryStore {
  insert(tx: DbTransaction, rows: readonly NewDelivery[]): Promise<Enqueued[]>;
  /** Sets the transaction-local marker the database requires of an alert delivery (cvh.approval_entry_id). */
  markApproval(tx: DbTransaction, entryId: string): Promise<void>;
  /** Sets the recipient's `queued` and claimed-but-not-handed-off rows to `skipped`; rows already handed off are left. */
  skipForRecipient(tx: DbTransaction, recipient: { kind: RecipientKind; id: string }): Promise<SkippedForRecipient>;
}

/** Where messaging reports what it did, with no personal data: structured, one JSON line per event (spine: Logging). */
export interface MessagingLog {
  info(evt: string, fields: Record<string, string | number | boolean | null>): void;
  error(evt: string, fields: Record<string, string | number | boolean | null>): void;
}

/** A delivery's recipient as the hand-off point asks for its number. */
export interface DeliveryRecipient {
  deliveryId: string;
  kind: RecipientKind;
  /** Null once the recipient was deleted: there is no number to find. */
  id: string | null;
}

/** The number, in memory, or that the recipient is gone (deleted, expired, left the roster): the caller then skips the row. */
export type ResolvedContact = { found: true; number: string } | { found: false; reason: "recipient_gone" };

/**
 * Port: the phone number of a delivery's recipient, asked for at the hand-off point only, inside the hand-off
 * transaction `tx`, and never stored (AD-8, AD-13). The composition root wires it to the module that owns each kind of
 * recipient (src/app/messaging.ts). For an `inbound_reply` recipient the number is taken: the row is deleted in this
 * transaction, so the number then exists only in the sender's memory until the provider call.
 */
export interface ContactResolver {
  resolve(tx: DbTransaction, recipient: DeliveryRecipient): Promise<ResolvedContact>;
}

/**
 * Port, implemented by each module that owns recipients (subscriptions, identity, ops): the E.164 number held for one
 * recipient id, read through `tx`, or null when the recipient no longer exists or is no longer eligible. With
 * `consume`, the source locks the row `FOR UPDATE`, reads the number and deletes the row in `tx` (the
 * `inbound_reply` rule). The number is the source's own data: messaging never writes it anywhere.
 */
export interface RecipientNumberSource {
  numberOf(tx: DbTransaction, recipientId: string, options: { consume: boolean }): Promise<string | null>;
}

/** Which source answers for each kind of recipient; a kind with none cannot be resolved (and says so loudly). */
export type RecipientNumberSources = Partial<Record<RecipientKind, RecipientNumberSource>>;
