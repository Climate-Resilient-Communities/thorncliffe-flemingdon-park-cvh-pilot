// The statements of the one-time web links (S07.06, `subscription_edit_token`). Every one runs in the caller's transaction and names a link
// by the sha256 of its token, never the token: the token is in the text and the resident's browser only.
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { DbTransaction } from "../../../platform/db";
import { subscriptionEditToken } from "./schema";

/** A link as the use cases read it: its subscriber, and whether it can still be used (unused and not run out, by the database's clock). */
export interface EditTokenRow {
  id: string;
  subscriberId: string;
  usable: boolean;
}

export const editTokenStore = {
  /**
   * The subscriber's new link, replacing any link it had (one per subscriber): valid 30 minutes from the database's now(), the same now()
   * the text's `send_by` is measured from in this transaction.
   */
  async replace(tx: DbTransaction, row: { id: string; subscriberId: string; tokenHash: string }): Promise<void> {
    await tx.delete(subscriptionEditToken).where(eq(subscriptionEditToken.subscriberId, row.subscriberId));
    await tx.insert(subscriptionEditToken).values(row);
  },

  /** The link with this hash, or null; read without a lock (a change takes its own, `consume`). */
  async find(tx: DbTransaction, tokenHash: string): Promise<EditTokenRow | null> {
    const [row] = await tx
      .select({
        id: subscriptionEditToken.id,
        subscriberId: subscriptionEditToken.subscriberId,
        usable: sql<boolean>`${subscriptionEditToken.usedAt} is null and ${subscriptionEditToken.expiresAt} > now()`,
      })
      .from(subscriptionEditToken)
      .where(eq(subscriptionEditToken.tokenHash, tokenHash));
    return row ?? null;
  },

  /**
   * Uses the link: sets `used_at` only while it is null and the link has not run out, by the database's clock, and says whether it did. The
   * update locks the row, so a second submission of the same link waits for the first and then finds it used (Postgres reads the row again
   * once the first commits): of two, exactly one gets true.
   */
  async consume(tx: DbTransaction, id: string): Promise<boolean> {
    const used = await tx
      .update(subscriptionEditToken)
      .set({ usedAt: sql`now()` })
      .where(and(eq(subscriptionEditToken.id, id), isNull(subscriptionEditToken.usedAt), gt(subscriptionEditToken.expiresAt, sql`now()`)))
      .returning({ id: subscriptionEditToken.id });
    return used.length > 0;
  },
};

export type EditTokenStore = typeof editTokenStore;
