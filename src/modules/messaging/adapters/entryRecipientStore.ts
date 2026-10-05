import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { DbExecutor } from "../../../platform/db";
import { delivery } from "./schema";

/**
 * The subscribers an alert's entries were queued to text (S07.07): the distinct `recipient_id` of the entries' alert deliveries to subscribers, in whatever state the
 * text is in now (a cancelled or skipped text still records who the entry was for, which is what a correction, a withdrawal and a final reach). Ids only, never a
 * number; a recipient deleted since has a null id and is not here. Drill-roster texts are not subscribers and are left out.
 */
export async function subscribersQueuedFor(executor: DbExecutor, entryIds: readonly string[]): Promise<string[]> {
  if (entryIds.length === 0) return [];
  const rows = await executor
    .selectDistinct({ id: delivery.recipientId })
    .from(delivery)
    .where(and(eq(delivery.kind, "alert"), eq(delivery.recipientKind, "subscriber"), isNotNull(delivery.recipientId), inArray(delivery.entryId, [...entryIds])));
  return rows.flatMap((row) => (row.id === null ? [] : [row.id]));
}
