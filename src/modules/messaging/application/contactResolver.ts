// The ContactResolver port's implementation (S06.01, AD-2, AD-8, AD-13): the dispatcher asks for a recipient's phone
// number at the hand-off point, inside the hand-off transaction, and the number is never stored. messaging holds no
// numbers and may not import the modules that do, so each module that owns recipients (subscriptions, identity, ops)
// gives a RecipientNumberSource and the composition root (src/app/messaging.ts) hands them to `createContactResolver`.
//
//  - The number is returned to the caller and goes nowhere else: no write, no cache, no audit. The one log line shows it
//    masked to its last two digits.
//  - For an `inbound_reply` recipient the source is asked to take the number: it locks the row `FOR UPDATE`, reads the
//    number and deletes the row in the same transaction. The hand-off commits `handed_off_at` in that transaction, so after
//    it the number exists only in the sender's memory until the provider call; if the worker stops in between, the row is
//    `unknown` by lease expiry and nothing is sent (E06 definitions).
//  - A recipient that no longer exists (a null id, or a source that finds nothing) is reported as gone, so the hand-off point
//    skips the row. A kind with no source wired is a configuration error and fails loudly instead of skipping texts.
import { isConsumedAtHandOff, type RecipientKind } from "../domain/deliveryRules";
import { isE164, maskForLog } from "../domain/phoneNumber";
import type { ContactResolver, MessagingLog, RecipientNumberSources } from "./deliveryPorts";

/** No module has been wired to answer for this kind of recipient yet. */
export class ContactSourceNotWired extends Error {
  constructor(readonly recipientKind: RecipientKind) {
    super(`No phone number source is wired for ${recipientKind} recipients`);
    this.name = "ContactSourceNotWired";
  }
}

/** A source gave something that is not an E.164 number. The message never quotes it. */
export class ContactNumberInvalid extends Error {
  constructor(readonly recipientKind: RecipientKind) {
    super(`The phone number source for ${recipientKind} recipients returned a value that is not an E.164 number`);
    this.name = "ContactNumberInvalid";
  }
}

export function createContactResolver(deps: { sources: RecipientNumberSources; log: MessagingLog }): ContactResolver {
  const { sources, log } = deps;
  return {
    async resolve(tx, recipient) {
      if (recipient.id === null) return { found: false, reason: "recipient_gone" };
      const source = sources[recipient.kind];
      if (!source) throw new ContactSourceNotWired(recipient.kind);
      const consume = isConsumedAtHandOff(recipient.kind);
      const number = await source.numberOf(tx, recipient.id, { consume });
      if (number === null) {
        log.info("contact.recipient_gone", { module: "messaging", delivery_id: recipient.deliveryId, recipient_kind: recipient.kind });
        return { found: false, reason: "recipient_gone" };
      }
      if (!isE164(number)) throw new ContactNumberInvalid(recipient.kind);
      log.info("contact.resolved", {
        module: "messaging",
        delivery_id: recipient.deliveryId,
        recipient_kind: recipient.kind,
        number: maskForLog(number),
        consumed: consume,
      });
      return { found: true, number };
    },
  };
}
