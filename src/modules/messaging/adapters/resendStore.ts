import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { ChainText } from "../domain/resend";
import type { DeliveryState } from "../domain/deliveryState";
import type { ResendStore, RootText } from "../application/resend";
import { delivery } from "./schema";

const chainTextOf = (row: typeof delivery.$inferSelect): ChainText => ({
  id: row.id,
  state: row.state as DeliveryState,
  resendN: row.resendN,
  providerErrorCode: row.providerErrorCode,
  attempts: row.attempts,
});

/**
 * The statements of a resend (S09.02), every one in the caller's transaction. Ids, states, languages and error codes only: a delivery row has no phone number, and
 * none is read here.
 */
export const drizzleResendStore: ResendStore = {
  async locate(tx, deliveryId) {
    const [row] = await tx
      .select({ id: delivery.id, resendOf: delivery.resendOf, entryId: delivery.entryId, kind: delivery.kind })
      .from(delivery)
      .where(eq(delivery.id, deliveryId));
    if (!row) return null;
    return { rootId: row.resendOf ?? row.id, entryId: row.entryId, kind: row.kind };
  },

  async bulkCandidates(tx, entryId, lang, states, limit) {
    // The latest text of each chain of the entry and language, when it failed or was undelivered (never `unknown`): a text that has been resent since is not the
    // latest. Ordered by the chain's root so that two Admins pressing at once lock the roots in the same order.
    // (The outer row is named in full: Drizzle leaves a column unqualified in a single-table select, and the subquery's own columns would then be read instead.)
    const root = sql<string>`coalesce("delivery"."resend_of", "delivery"."id")`;
    const newer = sql`exists (
      select 1 from delivery as r
      where r.resend_of = coalesce("delivery"."resend_of", "delivery"."id") and coalesce(r.resend_n, 0) > coalesce("delivery"."resend_n", 0)
    )`;
    const rows = await tx
      .select({ id: delivery.id, rootId: root })
      .from(delivery)
      .where(
        and(
          eq(delivery.entryId, entryId),
          eq(delivery.lang, lang),
          eq(delivery.kind, "alert"),
          eq(delivery.recipientKind, "subscriber"),
          inArray(delivery.state, [...states]),
          sql`not ${newer}`,
        ),
      )
      .orderBy(asc(root), asc(delivery.id))
      .limit(limit + 1);
    return { texts: rows.slice(0, limit).map((row) => ({ id: row.id, rootId: row.rootId })), more: rows.length > limit };
  },

  async lockChain(tx, rootId): Promise<{ root: RootText; chain: ChainText[] } | null> {
    // The root first, alone (E09: the chain's root is locked FOR UPDATE), then the rest of the chain, so a callback that resolves a text of it waits and the states
    // read below stay what they are until this transaction ends.
    const [root] = await tx.select().from(delivery).where(and(eq(delivery.id, rootId), isNull(delivery.resendOf))).for("update");
    if (!root) return null;
    const rest = await tx.select().from(delivery).where(eq(delivery.resendOf, rootId)).orderBy(asc(delivery.resendN)).for("update");
    return {
      root: {
        id: root.id,
        kind: root.kind,
        entryId: root.entryId,
        recipientKind: root.recipientKind,
        recipientId: root.recipientId,
        lang: root.lang,
        body: root.body,
        segments: root.segments,
        costEstimateCents: root.costEstimateCents,
      },
      chain: [root, ...rest].map(chainTextOf),
    };
  },

  async insertResend(tx, input) {
    await tx.insert(delivery).values({
      id: input.id,
      kind: "alert",
      recipientKind: input.root.recipientKind,
      recipientId: input.root.recipientId,
      entryId: input.root.entryId,
      createdByModule: "alerting",
      lang: input.root.lang,
      body: input.root.body,
      segments: input.root.segments,
      costEstimateCents: input.root.costEstimateCents,
      idempotencyKey: input.key,
      resendOf: input.root.id,
      resendN: input.n,
    });
  },
};
