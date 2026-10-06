// The one deletion of everything held for a number (E07 "Deletion", S07.04): STOP and a confirmed reply 0 run it from the inbound router, and a deletion
// on a resident's behalf after verified control (S09.03, `accessRequest.ts`) runs the very same steps. In the caller's transaction, with nothing kept:
// the subscriber (its places, muted topics and prompt go with it, ON DELETE CASCADE), any pending sign-up and any `inbound_reply` rows of the number. Each
// recipient's `queued` and claimed-but-not-handed-off texts are set `skipped` first (`skipRecipientDeliveries`), and the delete's trigger makes the texts
// already handed off forget the recipient (AD-8). Lock order (E07, E08 "Request lock order"): the subscriber's round threads (`checkins.lockRounds`,
// S08.05), delivery rows, then the subscriber row, then its check-in rows (`checkins.deleteForSubscriber`: tallied and closed into stubs). Nothing is
// sent afterwards: no record could resolve the number. The number is never logged, audited or returned.
import type { DbTransaction } from "../../../platform/db";
import type { RecipientKind, SkippedForRecipient } from "../../messaging";
import { inboundStore, type InboundStore } from "../adapters/inboundStore";
import { pendingSignupStore, type PendingSignupRow, type PendingSignupStore } from "../adapters/pendingSignupStore";
import { subscriberStore, type SubscriberRow, type SubscriberStore } from "../adapters/subscriberStore";

/** What a deletion removed: counts only. */
export interface Deleted {
  subscriber: boolean;
  pendingSignup: boolean;
  inboundReplies: number;
  skippedTexts: number;
}

export interface NumberDeletionDeps {
  /** messaging's `skipRecipientDeliveries`. */
  skipRecipientDeliveries: (tx: DbTransaction, recipient: { kind: RecipientKind; id: string }) => Promise<SkippedForRecipient>;
  /** `checkins`' port (E07 handoffs, S08.05): `lockRounds` first, `deleteForSubscriber` after the subscriber's row is locked and before it is deleted. */
  checkins: { lockRounds?(subscriberId: string, tx: DbTransaction): Promise<void>; deleteForSubscriber(subscriberId: string, tx: DbTransaction): Promise<void> };
  stores?: { pending?: PendingSignupStore; subscribers?: SubscriberStore; inbound?: InboundStore };
}

export interface NumberDeletion {
  /** Deletes what the caller found for the number, which it holds the number's lock for (the inbound router: it read the rows to decide). */
  deleteFound(tx: DbTransaction, phone: string, found: { subscriber: SubscriberRow | null; pending: PendingSignupRow | null }): Promise<Deleted>;
  /** Takes the number's lock (the sign-up's and the router's), finds its subscriber and its pending sign-up, and deletes everything held for it. */
  deleteNumber(tx: DbTransaction, phone: string): Promise<Deleted>;
}

export function createNumberDeletion(deps: NumberDeletionDeps): NumberDeletion {
  const pending = deps.stores?.pending ?? pendingSignupStore;
  const subscribers = deps.stores?.subscribers ?? subscriberStore;
  const inbound = deps.stores?.inbound ?? inboundStore;
  const skip = async (tx: DbTransaction, kind: RecipientKind, id: string) => (await deps.skipRecipientDeliveries(tx, { kind, id })).skipped;

  async function deleteFound(tx: DbTransaction, phone: string, found: { subscriber: SubscriberRow | null; pending: PendingSignupRow | null }): Promise<Deleted> {
    let skippedTexts = 0;
    let deletedSubscriber = false;
    if (found.subscriber) {
      const id = found.subscriber.id;
      await deps.checkins.lockRounds?.(id, tx);
      skippedTexts += await skip(tx, "subscriber", id);
      if (await subscribers.lock(tx, id)) {
        // Again under the row's lock: a text an approval committed while this waited for the lock is stopped too.
        skippedTexts += await skip(tx, "subscriber", id);
        await deps.checkins.deleteForSubscriber(id, tx);
        deletedSubscriber = await subscribers.delete(tx, id);
      }
    }
    let deletedPending = false;
    if (found.pending) {
      skippedTexts += await skip(tx, "pending_signup", found.pending.id);
      deletedPending = await pending.delete(tx, found.pending.id);
    }
    const replies = await inbound.replyIdsOf(tx, phone);
    for (const id of replies) {
      skippedTexts += await skip(tx, "inbound_reply", id);
      await inbound.deleteReply(tx, id);
    }
    return { subscriber: deletedSubscriber, pendingSignup: deletedPending, inboundReplies: replies.length, skippedTexts };
  }

  return {
    deleteFound,
    async deleteNumber(tx, phone) {
      await pending.lockNumber(tx, phone);
      // Both, unlike the router (which never reads a pending sign-up beside a subscriber): a deletion on a resident's behalf leaves nothing of the number.
      const subscriber = await subscribers.ofNumber(tx, phone);
      return deleteFound(tx, phone, { subscriber, pending: await pending.ofNumber(tx, phone) });
    },
  };
}
