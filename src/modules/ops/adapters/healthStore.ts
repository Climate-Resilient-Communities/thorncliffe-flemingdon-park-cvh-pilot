import { and, count, desc, eq, gt, inArray, max, sql, type SQL } from "drizzle-orm";
import type { DbExecutor, DbTransaction } from "../../../platform/db";
import type { ConditionState } from "../domain/health";
import type { HealthCondition } from "../domain/events";
import { healthCondition, healthHeartbeat, opsEvent } from "./schema";

/** Toronto time (E09 "Week"; the day of the transactional ceiling, the month of the spending cap). */
const TORONTO = "America/Toronto";

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

  /**
   * How many events of a kind were recorded after a point, and the newest one's id (null when none): the point is the last `withinMs`
   * milliseconds, the start of the current month in Toronto, or a given instant (null: since ever). By the database's clock.
   */
  async eventsAfter(executor: DbExecutor, kind: string, after: { withinMs: number } | { torontoMonth: true } | { at: Date | null }): Promise<{ count: number; newestId: number | null }> {
    const point: SQL | null =
      "withinMs" in after
        ? sql`now() - ${Math.trunc(after.withinMs)}::bigint * interval '1 millisecond'`
        : "torontoMonth" in after
          ? sql`(date_trunc('month', now() at time zone ${TORONTO}) at time zone ${TORONTO})`
          : after.at === null
            ? null
            : sql`${after.at.toISOString()}::timestamptz`;
    const [row] = await executor
      .select({ n: count(), newest: max(opsEvent.id) })
      .from(opsEvent)
      .where(point === null ? eq(opsEvent.kind, kind) : and(eq(opsEvent.kind, kind), gt(opsEvent.at, point)));
    return { count: Number(row?.n ?? 0), newestId: row?.newest === null || row?.newest === undefined ? null : Number(row.newest) };
  },

  /** The start of today in Toronto, by the database's clock (the transactional ceiling is per Toronto day). */
  async torontoDayStart(executor: DbExecutor): Promise<Date> {
    const [row] = await executor.execute<{ start: string | Date }>(sql`select (date_trunc('day', now() at time zone ${TORONTO}) at time zone ${TORONTO}) as start`);
    return new Date(row.start);
  },

  /** How many pg_cron runs failed, and how many job calls did not answer 2xx, in the last `withinMs` (the migration's `health_job_failures`). */
  async jobFailures(executor: DbExecutor, withinMs: number): Promise<number> {
    const [row] = await executor.execute<{ n: number }>(sql`select health_job_failures(${Math.trunc(withinMs)}::bigint) as n`);
    return Number(row?.n ?? 0);
  },

  /** Records that a run of the health job judged every condition (the heartbeat's time is the database's now()). */
  async beat(executor: DbExecutor): Promise<void> {
    await executor.update(healthHeartbeat).set({ completedAt: sql`now()` }).where(eq(healthHeartbeat.id, 1));
  },

  /** The heartbeat: when the health job last judged every condition (null: never), and the database's instant. */
  async heartbeat(executor: DbExecutor): Promise<{ completedAt: Date | null; now: Date }> {
    const [row] = await executor.select({ completedAt: healthHeartbeat.completedAt, now: sql<Date>`now()` }).from(healthHeartbeat).where(eq(healthHeartbeat.id, 1));
    return { completedAt: row?.completedAt ?? null, now: new Date(row?.now ?? Date.now()) };
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
