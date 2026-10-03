import { and, count, eq, gt, sql } from "drizzle-orm";
import type { DbExecutor } from "@/platform/db";
import { toOpsEventRecord, type OpsEvent, type OpsEventKind } from "../domain/events";
import { opsEvent } from "../adapters/schema";

/** Writes one operational event with the given executor (the client, or a caller's transaction). Throws on an invalid event or a failed insert. */
export async function recordOpsEvent<K extends OpsEventKind>(executor: DbExecutor, event: OpsEvent<K>): Promise<void> {
  const row = toOpsEventRecord(event);
  await executor.insert(opsEvent).values(row);
}

/**
 * Writes the event unless `max` events of its kind were already recorded in the last `withinMs` (by the database's clock); returns
 * whether it was written. For an event anyone can cause (a webhook request whose signature is wrong), so that a flood of requests cannot
 * make the table grow without limit while a count past the alert's threshold is still recorded. The count and the insert are two
 * statements, so requests that overlap may record a few more than `max`; the limit bounds growth, it is not an exact count. Throws on an
 * invalid event or a failed statement.
 */
export async function recordOpsEventUnlessBusy<K extends OpsEventKind>(executor: DbExecutor, event: OpsEvent<K>, limit: { max: number; withinMs: number }): Promise<boolean> {
  const row = toOpsEventRecord(event);
  const [recent] = await executor
    .select({ n: count() })
    .from(opsEvent)
    .where(and(eq(opsEvent.kind, row.kind), gt(opsEvent.at, sql`now() - ${Math.trunc(limit.withinMs)}::bigint * interval '1 millisecond'`)));
  if (Number(recent?.n ?? 0) >= limit.max) return false;
  await executor.insert(opsEvent).values(row);
  return true;
}
