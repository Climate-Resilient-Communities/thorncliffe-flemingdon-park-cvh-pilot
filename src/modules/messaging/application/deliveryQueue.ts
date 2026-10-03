// The outbox's use cases (S06.01, AD-8): every outbound text is one `delivery` row, written before anything is sent and
// never holding a phone number. The three kinds are created the way the database allows (a trigger refuses the rest):
//  - `alert`: only inside the approval transaction of its entry (`markApprovalTransaction`, then `enqueueAlertDeliveries`);
//  - `transactional`: by `alerting`, `subscriptions`, `checkins` or `ops`, for a purpose on that module's allow-list,
//    with a `send_by` (`enqueueTransactional`);
//  - `campaign`: only for a campaign started by an Admin at aal2, to a subscriber (`enqueueCampaignDelivery`). No campaign exists
//    until S09.07, so the database refuses every campaign row until then; S09.07 makes the trigger read the campaign row, and the
//    use case needs no marker (a caller's own word about who started a campaign, or at which assurance level, is never trusted).
// Every insert is idempotent on its key: a second insert of the same key returns the first row, with no error.
//
// Everything runs in the caller's transaction (the approval's, the sign-up's), so a delivery is written exactly when the
// change that needs it commits. Locks follow AD-18: the approval locks `alert`, `alert_entry` and `feed_version` before it
// writes deliveries here.
import type { DbTransaction } from "../../../platform/db";
import { uuidv7 } from "../../../platform/ids";
import {
  alertKey,
  alertRecipientRefusal,
  campaignRefusal,
  contentRefusal,
  isUuid,
  outboundKey,
  purposeRule,
  transactionalRefusal,
  type CreatingModule,
  type DeliveryContent,
  type RecipientKind,
} from "../domain/deliveryRules";
import type { DeliveryResult, DeliveryStore, Enqueued, NewDelivery, SkippedForRecipient } from "./deliveryPorts";

/** One alert text: whom it goes to and the entry's frozen SMS body for the language, with its segments and cost estimate. */
export interface AlertTextInput extends DeliveryContent {
  recipient: { kind: "subscriber" | "roster"; id: string };
}

export interface TransactionalInput extends DeliveryContent {
  /** The module creating the text: the allow-list is checked against it. */
  module: CreatingModule;
  purpose: string;
  recipient: { kind: RecipientKind; id: string };
  /** What the text is about, and a nonce that tells two texts about it apart: parts of the key, never a phone number. */
  subject: string;
  nonce: string;
  /**
   * Required where the recipient's row sets the limit (`signup_info`: the `inbound_reply` row's `expires_at`); otherwise the
   * text is due by the purpose's window from the database's clock.
   */
  sendBy?: Date;
}

export interface CampaignTextInput extends DeliveryContent {
  campaignId: string;
  purpose: string;
  recipient: { kind: RecipientKind; id: string };
}

export interface DeliveryQueueDeps {
  store: DeliveryStore;
  newId?: () => string;
  /** Test seam: the clock a given `send_by` is checked against. */
  now?: () => Date;
}

export interface DeliveryQueue {
  /**
   * Called first by the approval use case (S04.07) in its transaction, with the entry being approved: it states, for this
   * transaction only, that the alert deliveries about to be written belong to this entry's approval.
   */
  markApprovalTransaction(tx: DbTransaction, entryId: string): Promise<DeliveryResult<void>>;
  /**
   * Writes the entry's alert deliveries, called by the approval (`alerting`) with the recipients that `captureRecipients` (S06.05 for drills, E07 for subscribers) returned: each in the entry's
   * frozen SMS body for the recipient's language. All or none: one refused text refuses the batch. A recipient already
   * given a text for this entry is returned as it is.
   */
  enqueueAlertDeliveries(tx: DbTransaction, entryId: string, texts: readonly AlertTextInput[]): Promise<DeliveryResult<Enqueued[]>>;
  enqueueTransactional(tx: DbTransaction, input: TransactionalInput): Promise<DeliveryResult<Enqueued>>;
  /**
   * One campaign text to a subscriber (S09.07, in the transaction that starts the campaign). The database accepts it only for a
   * campaign started by an Admin at aal2; until S09.07 creates campaigns it refuses every one, as an error from the insert.
   */
  enqueueCampaignDelivery(tx: DbTransaction, input: CampaignTextInput): Promise<DeliveryResult<Enqueued>>;
  /**
   * A recipient's deletion (S07.04 for subscribers, S06.05 and S06.07 for roster and on-call numbers) calls this in its own
   * transaction, before it deletes the recipient: the recipient's `queued` and claimed-but-not-handed-off rows become
   * `skipped`; rows already handed to the provider are left, and counted as in flight.
   */
  skipRecipientDeliveries(tx: DbTransaction, recipient: { kind: RecipientKind; id: string }): Promise<SkippedForRecipient>;
}

export function createDeliveryQueueService(deps: DeliveryQueueDeps): DeliveryQueue {
  const { store } = deps;
  const newId = deps.newId ?? (() => uuidv7());
  const now = deps.now ?? (() => new Date());

  return {
    async markApprovalTransaction(tx, entryId) {
      if (!isUuid(entryId)) return { ok: false, error: "ID_INVALID" };
      await store.markApproval(tx, entryId);
      return { ok: true, value: undefined };
    },

    async enqueueAlertDeliveries(tx, entryId, texts) {
      if (!isUuid(entryId)) return { ok: false, error: "ID_INVALID" };
      const rows: NewDelivery[] = [];
      for (const text of texts) {
        const refusal = alertRecipientRefusal(text.recipient) ?? contentRefusal(text);
        if (refusal) return { ok: false, error: refusal };
        rows.push({
          id: newId(),
          kind: "alert",
          recipientKind: text.recipient.kind,
          recipientId: text.recipient.id,
          entryId,
          campaignId: null,
          createdByModule: "alerting",
          purpose: null,
          lang: text.lang,
          body: text.body,
          segments: text.segments,
          costEstimateCents: text.costEstimateCents,
          idempotencyKey: alertKey(entryId, text.recipient.id),
          sendBy: null,
        });
      }
      return { ok: true, value: rows.length === 0 ? [] : await store.insert(tx, rows) };
    },

    async enqueueTransactional(tx, input) {
      const refusal =
        transactionalRefusal({ module: input.module, purpose: input.purpose, recipient: input.recipient, sendBy: input.sendBy ?? null, now: now() }) ?? contentRefusal(input);
      if (refusal) return { ok: false, error: refusal };
      const key = outboundKey({ kind: "transactional", subject: input.subject, purpose: input.purpose, nonce: input.nonce });
      if (key === null) return { ok: false, error: "KEY_PART_INVALID" };
      // transactionalRefusal found the purpose, so the rule exists.
      const rule = purposeRule(input.module, input.purpose)!;
      const [row] = await store.insert(tx, [
        {
          id: newId(),
          kind: "transactional",
          recipientKind: input.recipient.kind,
          recipientId: input.recipient.id,
          entryId: null,
          campaignId: null,
          createdByModule: input.module,
          purpose: input.purpose,
          lang: input.lang,
          body: input.body,
          segments: input.segments,
          costEstimateCents: input.costEstimateCents,
          idempotencyKey: key,
          sendBy: input.sendBy ? { at: input.sendBy } : { withinMs: rule.windowMs },
        },
      ]);
      return { ok: true, value: row };
    },

    async enqueueCampaignDelivery(tx, input) {
      const refusal = campaignRefusal(input) ?? contentRefusal(input);
      if (refusal) return { ok: false, error: refusal };
      // One text per campaign, purpose and recipient: starting a campaign again adds nothing.
      const key = outboundKey({ kind: "campaign", subject: input.campaignId, purpose: input.purpose, nonce: input.recipient.id });
      if (key === null) return { ok: false, error: "KEY_PART_INVALID" };
      const [row] = await store.insert(tx, [
        {
          id: newId(),
          kind: "campaign",
          recipientKind: input.recipient.kind,
          recipientId: input.recipient.id,
          entryId: null,
          campaignId: input.campaignId,
          createdByModule: "subscriptions",
          purpose: input.purpose,
          lang: input.lang,
          body: input.body,
          segments: input.segments,
          costEstimateCents: input.costEstimateCents,
          idempotencyKey: key,
          sendBy: null,
        },
      ]);
      return { ok: true, value: row };
    },

    skipRecipientDeliveries(tx, recipient) {
      return store.skipForRecipient(tx, recipient);
    },
  };
}
