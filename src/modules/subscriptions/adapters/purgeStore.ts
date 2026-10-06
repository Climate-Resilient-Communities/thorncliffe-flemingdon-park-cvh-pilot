// The statements of the end-of-pilot purge (S09.08). Every one runs in the caller's transaction or executor and judges the deadline by the database's clock
// (`now()`), the clock `campaignStore.retain` uses for a YES, never the app's. Only `numberOfPurgeable` selects a number, for the deletion of the number's
// `inbound_reply` rows and its lock; nothing here logs or returns it otherwise.
import { and, asc, eq, gt, isNotNull, sql } from "drizzle-orm";
import type { DbExecutor, DbTransaction } from "../../../platform/db";
import { lapsedSql } from "./campaignStore";
import { campaign, campaignPurge, subscriber } from "./schema";
import type { SubscriberRow } from "./subscriberStore";

/** The purge's record as the use case reads it: counts and times, no id but the campaign's. */
export interface PurgeRow {
  campaignId: string;
  deleted: number;
  completedAt: Date | null;
  retained: number | null;
}

/**
 * A subscriber the purge deletes: `reconsent_pending` past the real campaign's deadline (S09.07's `lapsedSql`), the campaign not cancelled (the owner's
 * cancellation stops the purge too: those subscribers stay until the owner decides).
 */
export function purgeableSql(state: unknown) {
  return sql`(${lapsedSql(state)} and not exists (select 1 from campaign c where not c.rehearsal and c.state = 'cancelled'))`;
}

const PURGEABLE = purgeableSql(subscriber.retentionState);

const purgeColumns = { campaignId: campaignPurge.campaignId, deleted: campaignPurge.deleted, completedAt: campaignPurge.completedAt, retained: campaignPurge.retained };

export const purgeStore = {
  /**
   * The real campaign whose subscribers the purge deletes now: its deadline has passed by the database's clock and the end job has ended it (so S09.07's
   * `campaign.ended` audit has counted who stayed and who did not reply before anyone is deleted; a cancelled campaign is never ended); else null.
   */
  async dueCampaign(executor: DbExecutor): Promise<string | null> {
    const [row] = await executor
      .select({ id: campaign.id })
      .from(campaign)
      .where(and(eq(campaign.rehearsal, false), eq(campaign.state, "ended"), sql`${campaign.deadline} <= now()`));
    return row?.id ?? null;
  },

  /**
   * The campaign's purge record, made the first time (the database refuses one before the deadline or the end, for a rehearsal or a cancelled campaign).
   * Making it keeps the correction reach measure as it stands (a trigger: `correction_reach_kept`), before the first deletion.
   */
  async begin(executor: DbExecutor, campaignId: string): Promise<PurgeRow> {
    await executor.insert(campaignPurge).values({ campaignId }).onConflictDoNothing();
    return (await purgeStore.find(executor, campaignId))!;
  },

  async find(executor: DbExecutor, campaignId: string): Promise<PurgeRow | null> {
    const [row] = await executor.select(purgeColumns).from(campaignPurge).where(eq(campaignPurge.campaignId, campaignId));
    return row ?? null;
  },

  /** The next subscribers to delete, after `after` in id order (one walk through them per run), ids only. Reads and locks nothing else. */
  async purgeableIds(executor: DbExecutor, input: { after: string | null; limit: number }): Promise<string[]> {
    const rows = await executor
      .select({ id: subscriber.id })
      .from(subscriber)
      .where(input.after === null ? PURGEABLE : and(PURGEABLE, gt(subscriber.id, input.after)))
      .orderBy(asc(subscriber.id))
      .limit(input.limit);
    return rows.map((row) => row.id);
  },

  /** The number of a subscriber the purge deletes (for its lock and its `inbound_reply` rows), or null when they are not one now. Locks nothing. */
  async numberOfPurgeable(tx: DbTransaction, id: string): Promise<string | null> {
    const [row] = await tx.select({ phone: subscriber.phone }).from(subscriber).where(and(eq(subscriber.id, id), PURGEABLE));
    return row?.phone ?? null;
  },

  /**
   * The subscriber's row locked `FOR UPDATE`, only if they are still one the purge deletes: `reconsent_pending` and the deadline passed, judged again under the
   * lock by the database's clock. A YES that holds the row (`campaignStore.retain`, one conditional update) is waited for, and the row is judged as it committed:
   * kept, it is not returned. Null when they are not (any more), or gone.
   */
  async lockPurgeable(tx: DbTransaction, id: string): Promise<SubscriberRow | null> {
    const [row] = await tx.select({ id: subscriber.id, lang: subscriber.lang }).from(subscriber).where(and(eq(subscriber.id, id), PURGEABLE)).for("update");
    return row ?? null;
  },

  /** One more subscriber deleted, in the deletion's own transaction. */
  async countDeleted(tx: DbTransaction, campaignId: string): Promise<void> {
    await tx
      .update(campaignPurge)
      .set({ deleted: sql`${campaignPurge.deleted} + 1` })
      .where(eq(campaignPurge.campaignId, campaignId));
  },

  /** The purge record locked `FOR UPDATE` (the completion: one run records it, once). */
  async lock(tx: DbTransaction, campaignId: string): Promise<PurgeRow | null> {
    const [row] = await tx.select(purgeColumns).from(campaignPurge).where(eq(campaignPurge.campaignId, campaignId)).for("update");
    return row ?? null;
  },

  /** Whether a subscriber is left for the purge to delete. */
  async anyPurgeable(executor: DbExecutor): Promise<boolean> {
    const [row] = await executor.select({ id: subscriber.id }).from(subscriber).where(PURGEABLE).limit(1);
    return row !== undefined;
  },

  /** Records the completion: the database stamps its now() and counts the subscribers who stayed (and refuses while one is left to delete). */
  async complete(tx: DbTransaction, campaignId: string): Promise<PurgeRow> {
    const [row] = await tx
      .update(campaignPurge)
      .set({ completedAt: sql`now()` as unknown as Date, retained: 0 })
      .where(eq(campaignPurge.campaignId, campaignId))
      .returning(purgeColumns);
    return row!;
  },

  /** The Toronto day the purge completed (`YYYY-MM-DD`), the date the terms page states that resident data was deleted; null until it has. */
  async completedOn(executor: DbExecutor): Promise<string | null> {
    const [row] = await executor
      .select({ day: sql<string>`to_char(${campaignPurge.completedAt} at time zone 'America/Toronto', 'YYYY-MM-DD')` })
      .from(campaignPurge)
      .where(isNotNull(campaignPurge.completedAt))
      .orderBy(asc(campaignPurge.completedAt))
      .limit(1);
    return row?.day ?? null;
  },
};

export type PurgeStore = typeof purgeStore;
