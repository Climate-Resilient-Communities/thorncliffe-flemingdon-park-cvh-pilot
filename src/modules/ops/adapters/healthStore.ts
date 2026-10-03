import { and, count, desc, eq, gt, inArray, max, sql } from "drizzle-orm";
import type { DbExecutor, DbTransaction } from "../../../platform/db";
import type { ConditionState } from "../domain/health";
import type { HealthCondition } from "../domain/events";
import { healthCondition, opsEvent } from "./schema";

const stateOf = (row: typeof healthCondition.$inferSelect): ConditionState => ({
  active: row.active,
  since: row.since,
  lastAlertedAt: row.lastAlertedAt,
  lastEventId: row.lastEventId,
});

/** What the health job reads and writes: its own memory of each condition, and the `ops_event` rows it judges by. Codes, counts and ids only. */
export const healthStore = {
  /** Locks the condition's row for this transaction (two overlapping runs wait for each other) and gives it with the database's instant. */
  async lock(tx: DbTransaction, condition: HealthCondition): Promise<{ state: ConditionState; now: Date } | null> {
    const [row] = await tx
      .select({ row: healthCondition, now: sql<Date>`now()` })
      .from(healthCondition)
      .where(eq(healthCondition.condition, condition))
      .for("update");
    return row ? { state: stateOf(row.row), now: new Date(row.now) } : null;
  },

  /** Writes what a run decided. `since` and `alertedAt` are the database's now() when set. */
  async save(tx: DbTransaction, condition: HealthCondition, change: { active: boolean; keepSince: boolean; alerted: boolean; eventId: number | null }): Promise<void> {
    await tx
      .update(healthCondition)
      .set({
        active: change.active,
        since: !change.active ? null : change.keepSince ? sql`${healthCondition.since}` : sql`now()`,
        ...(change.alerted ? { lastAlertedAt: sql`now()` } : {}),
        ...(change.eventId === null ? {} : { lastEventId: change.eventId }),
        checkedAt: sql`now()`,
      })
      .where(eq(healthCondition.condition, condition));
  },

  /** The conditions that hold now (the Hub's banner and its checks read this). */
  async active(executor: DbExecutor): Promise<{ condition: string; since: Date }[]> {
    const rows = await executor
      .select({ condition: healthCondition.condition, since: healthCondition.since })
      .from(healthCondition)
      .where(eq(healthCondition.active, true));
    return rows.flatMap((row) => (row.since === null ? [] : [{ condition: row.condition, since: row.since }]));
  },

  /** The highest `delivery.unknown` event id among these deliveries (null when none has one). */
  async latestUnknownEvent(executor: DbExecutor, deliveryIds: readonly string[]): Promise<number | null> {
    if (deliveryIds.length === 0) return null;
    const [row] = await executor
      .select({ id: max(opsEvent.id) })
      .from(opsEvent)
      .where(and(eq(opsEvent.kind, "delivery.unknown"), eq(opsEvent.subjectType, "delivery"), inArray(opsEvent.subjectId, [...deliveryIds])));
    return row?.id === null || row === undefined ? null : Number(row.id);
  },

  /** The newest of the given kinds: its id and kind (the daily Smart Encoding check records "on" or "off"). */
  async latestOfKinds(executor: DbExecutor, kinds: readonly string[]): Promise<{ id: number; kind: string } | null> {
    const [row] = await executor
      .select({ id: opsEvent.id, kind: opsEvent.kind })
      .from(opsEvent)
      .where(inArray(opsEvent.kind, [...kinds]))
      .orderBy(desc(opsEvent.id))
      .limit(1);
    return row ? { id: Number(row.id), kind: row.kind } : null;
  },

  /** How many events of a kind were recorded in the last `withinMs`, by the database's clock. */
  async countRecent(executor: DbExecutor, kind: string, withinMs: number): Promise<number> {
    const [row] = await executor
      .select({ n: count() })
      .from(opsEvent)
      .where(and(eq(opsEvent.kind, kind), gt(opsEvent.at, sql`now() - ${Math.trunc(withinMs)}::bigint * interval '1 millisecond'`)));
    return Number(row?.n ?? 0);
  },
};
