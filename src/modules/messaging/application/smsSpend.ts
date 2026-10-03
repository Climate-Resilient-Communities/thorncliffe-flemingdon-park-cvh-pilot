// The spend seams of the sender and the status callbacks (S06.08, AD-8): what each text costs, counted once.
//
// `afterOutcome(tx, delivery, outcome)` runs inside the transaction that first records a provider's answer of `submitted` or `unknown`
// (the dispatcher's outcome write, the sweep that makes a handed-off text with no outcome `unknown`, and the callback that moves a `claimed`
// row, which is the first record that the provider accepted the text). It writes the text's estimate to `spend_event`, once: segments x the
// configured price per segment, in whole cents CAD (rounded up), with kind `sms`, the language, the alert entry (alerts only) and whether
// the text went to the drill roster. The estimate therefore commits with the outcome or not at all. A text that was not accepted and goes
// back to the queue (HTTP 429, a connection that failed before sending) has no such outcome, so it writes nothing and a retried text is
// counted once, when it is finally accepted; a text that never is writes nothing. The spend module's unique estimate per delivery makes a
// replay harmless.
//
// `afterProviderId(tx, delivery)` runs when a delivery's provider id is recorded later than its outcome (a late callback stored the id an
// `unknown` row never got, or a slow response was written onto a row the sweep had already made `unknown`): it runs the matching rule for
// that delivery, so an actual already imported for that MessageSid retires the delivery's estimate. `afterOutcome` runs it too, for the
// delivery it has just counted, because an actual imported earlier may already answer for it (a reconciliation can run between a text's
// acceptance and its first callback).
//
// The provider id is always read from the delivery row in the same transaction, never taken from what a caller passes: the delivery
// table is where it is recorded, and the hook is then right whichever path wrote it. A drill text is one sent to the drill roster: the
// hand-off sends a drill entry to `roster` recipients only and a real entry never to one (`drill_recipient_mismatch`), so for a text that
// reached the provider the recipient kind says whether it was a drill.
import type { DbTransaction } from "../../../platform/db";
import { recordSmsEstimate, retireSmsEstimates } from "../../spend";
import { estimateSmsCost, priceInThousandthsOfCent } from "../domain/smsCost";
import type { DeliveryView } from "./deliveryPorts";

/** The provider id a delivery carries now, read in the caller's transaction. */
export interface ProviderIdReader {
  providerIdOf(tx: DbTransaction, deliveryId: string): Promise<string | null>;
}

export interface SmsSpendDeps {
  store: ProviderIdReader;
  /** Cents CAD per segment (SMS_PRICE_PER_SEGMENT_CENTS, at most three decimals); a price that is not valid fails here, at start-up, not at the first text. */
  pricePerSegmentCents: number;
  /** A test seam: the instant stamped on an estimate. Production leaves it out, and the estimate takes the database's clock. */
  now?: () => Date;
}

export interface SmsSpendHooks {
  afterOutcome(tx: DbTransaction, delivery: DeliveryView, outcome: "submitted" | "unknown"): Promise<void>;
  afterProviderId(tx: DbTransaction, delivery: DeliveryView): Promise<void>;
}

/** The estimate of one text in whole cents CAD: its segments x the price per segment, rounded up. */
export function smsEstimateCents(segments: number, lang: string, pricePerSegmentCents: number): number {
  return estimateSmsCost({ segmentsByLanguage: { [lang]: segments }, recipientsByLanguage: { [lang]: 1 }, pricePerSegmentCents, basis: "snapshot" }).cents;
}

export function createSmsSpendHooks(deps: SmsSpendDeps): SmsSpendHooks {
  // Checked once, so a misconfigured price stops the app where it starts and not in the middle of an outcome write.
  priceInThousandthsOfCent(deps.pricePerSegmentCents);

  async function retireFor(tx: DbTransaction, deliveryId: string): Promise<void> {
    const messageSid = await deps.store.providerIdOf(tx, deliveryId);
    if (messageSid !== null) await retireSmsEstimates(tx, [{ deliveryId, messageSid }]);
  }

  return {
    async afterOutcome(tx, delivery) {
      await recordSmsEstimate(tx, {
        deliveryId: delivery.id,
        entryId: delivery.entryId,
        lang: delivery.lang,
        isDrill: delivery.recipientKind === "roster",
        segments: delivery.segments,
        costCents: smsEstimateCents(delivery.segments, delivery.lang, deps.pricePerSegmentCents),
        purpose: delivery.kind,
        ...(deps.now ? { at: deps.now() } : {}),
      });
      await retireFor(tx, delivery.id);
    },

    async afterProviderId(tx, delivery) {
      await retireFor(tx, delivery.id);
    },
  };
}
