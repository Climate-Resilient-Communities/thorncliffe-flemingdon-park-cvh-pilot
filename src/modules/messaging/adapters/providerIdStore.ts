import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { DbTransaction } from "../../../platform/db";
import type { ProviderIdReader } from "../application/smsSpend";
import { delivery } from "./schema";

/**
 * The provider ids of deliveries (S06.08), read from messaging's own `delivery` table in the caller's transaction. It answers two ports: this
 * module's `ProviderIdReader` (the id one delivery carries now, for the spend hooks) and the spend module's `DeliveryProviderIds` (the ids of
 * many deliveries, for the matching rule of a reconciliation, wired in the composition root: spend may not import messaging).
 */
export const drizzleProviderIds: ProviderIdReader & {
  ofDeliveries(tx: DbTransaction, deliveryIds: readonly string[]): Promise<{ deliveryId: string; messageSid: string }[]>;
} = {
  async providerIdOf(tx, deliveryId) {
    const [row] = await tx.select({ providerMessageId: delivery.providerMessageId }).from(delivery).where(eq(delivery.id, deliveryId));
    return row?.providerMessageId ?? null;
  },

  async ofDeliveries(tx, deliveryIds) {
    if (deliveryIds.length === 0) return [];
    const rows = await tx
      .select({ id: delivery.id, providerMessageId: delivery.providerMessageId })
      .from(delivery)
      .where(and(inArray(delivery.id, [...deliveryIds]), isNotNull(delivery.providerMessageId)));
    return rows.flatMap((row) => (row.providerMessageId === null ? [] : [{ deliveryId: row.id, messageSid: row.providerMessageId }]));
  },
};
