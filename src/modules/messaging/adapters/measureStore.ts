import { eq, inArray } from "drizzle-orm";
import type { MeasureStore } from "../application/deliveryMeasures";
import type { DeliveryState } from "../domain/deliveryState";
import { delivery } from "./schema";

/** The outbox's rows for the pilot measures (S06.08): ids, states, languages and instants only, never a number or a body. */
export const drizzleMeasureStore: MeasureStore = {
  async entryRows(executor, entryId) {
    const rows = await executor
      .select({ lang: delivery.lang, recipientKind: delivery.recipientKind, state: delivery.state, handedOffAt: delivery.handedOffAt, completedAt: delivery.completedAt })
      .from(delivery)
      .where(eq(delivery.entryId, entryId));
    return rows.map((row) => ({ ...row, state: row.state as DeliveryState }));
  },

  async reachRows(executor, entryIds) {
    if (entryIds.length === 0) return [];
    const rows = await executor
      .select({ entryId: delivery.entryId, recipientId: delivery.recipientId, recipientKind: delivery.recipientKind, state: delivery.state, handedOffAt: delivery.handedOffAt })
      .from(delivery)
      .where(inArray(delivery.entryId, [...entryIds]));
    return rows.flatMap((row) => (row.entryId === null ? [] : [{ ...row, entryId: row.entryId, state: row.state as DeliveryState }]));
  },
};
