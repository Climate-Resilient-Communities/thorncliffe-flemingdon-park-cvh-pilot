import type { DbExecutor } from "@/platform/db";
import { toOpsEventRecord, type OpsEvent, type OpsEventKind } from "../domain/events";
import { opsEvent } from "../adapters/schema";

/** Writes one operational event with the given executor (the client, or a caller's transaction). Throws on an invalid event or a failed insert. */
export async function recordOpsEvent<K extends OpsEventKind>(executor: DbExecutor, event: OpsEvent<K>): Promise<void> {
  const row = toOpsEventRecord(event);
  await executor.insert(opsEvent).values(row);
}
