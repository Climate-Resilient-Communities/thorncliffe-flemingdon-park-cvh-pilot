import { and, asc, eq, inArray, or, type SQL } from "drizzle-orm";
import type { DbExecutor } from "../../../platform/db";
import type { RecipientKind } from "../domain/deliveryRules";
import { delivery } from "./schema";

/**
 * One text the CVH holds a record of for a recipient, as a resident's access request reads it back (S09.03): what it was, when, in which language and what
 * became of it. Never the body, the provider's message id or the idempotency key (the key names the recipient): a resident is told that a text was sent, not
 * shown it again, and the provider's id would find the body in Twilio's logs.
 */
export interface RecipientText {
  createdAt: Date;
  kind: string;
  /** The transactional purpose (`confirmation`, `welcome`, ...); null for an alert text. */
  purpose: string | null;
  lang: string;
  state: string;
  segments: number;
  /** Which resend of its chain this is (S09.02), or null. */
  resendN: number | null;
  /** The provider's error code of a text that did not arrive, or null. */
  providerErrorCode: number | null;
  completedAt: Date | null;
}

/**
 * The texts held for the given recipients (a subscriber, a pending sign-up, `inbound_reply` rows), oldest first, read through the executor given. Ids only go
 * in: the number is never read. A recipient deleted since has a null id on its texts (AD-8), so nothing of a deleted number is found.
 */
export async function textsToRecipients(executor: DbExecutor, recipients: readonly { kind: RecipientKind; id: string }[]): Promise<RecipientText[]> {
  if (recipients.length === 0) return [];
  const byKind = new Map<RecipientKind, string[]>();
  for (const recipient of recipients) byKind.set(recipient.kind, [...(byKind.get(recipient.kind) ?? []), recipient.id]);
  const matches: SQL[] = [...byKind].map(([kind, ids]) => and(eq(delivery.recipientKind, kind), inArray(delivery.recipientId, ids)) as SQL);
  return executor
    .select({
      createdAt: delivery.createdAt,
      kind: delivery.kind,
      purpose: delivery.purpose,
      lang: delivery.lang,
      state: delivery.state,
      segments: delivery.segments,
      resendN: delivery.resendN,
      providerErrorCode: delivery.providerErrorCode,
      completedAt: delivery.completedAt,
    })
    .from(delivery)
    .where(or(...matches))
    .orderBy(asc(delivery.createdAt), asc(delivery.id));
}
