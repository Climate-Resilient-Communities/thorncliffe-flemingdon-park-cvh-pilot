// The end-of-pilot purge (S09.08; FR-D-7, NFR-N5, AR-13; E09 definition "Campaign"; spine AD-9 D-7): everyone who did not say YES is deleted when the
// campaign text said they would be. `/api/jobs/end-of-pilot-purge` (pg_cron every 15 minutes, composed in src/app/purge.ts) runs `run()`:
//
//  1. Due? The real campaign whose deadline (`campaign.deadline`, S09.07: the end of the Toronto day its text names) has passed by the database's clock
//     and which the end job has ended (its `campaign.ended` audit counts who stayed and who did not reply before anyone is deleted; a cancelled campaign
//     never ends). Before that, or with no campaign, the run does nothing.
//  2. The purge's record (`campaign_purge`), made the first time; making it keeps the correction reach measure as it stands (`correction_reach_kept`, a
//     trigger in the same transaction), since the deletions clear the recipient ids it is counted from. A purge that has completed does nothing more.
//  3. The subscribers still `reconsent_pending` (S09.07's `lapsedSql`), read 100 ids at a time in id order, each deleted in ONE SHORT TRANSACTION OF ITS
//     OWN, so a large purge never holds one long transaction (the deletion counter of S07.10 and the number's lock are held only for one subscriber):
//       a. the number, read only while they are still one the purge deletes, and the number's lock (the lock a YES, a STOP and a sign-up take), so a
//          reply from the number that is under way finishes first;
//       b. their round threads locked (checkins' `lockRounds`, S08.05: the E07 deletion's first step, so a thread lock is never taken after the
//          subscriber's row) and their waiting texts skipped, so the deletion's lock order holds (threads, delivery rows, then the subscriber's row);
//       c. their row locked `FOR UPDATE` and the condition judged again under the lock with the database's clock: still `reconsent_pending` and the
//          deadline passed. A YES (`campaignStore.retain`: one conditional update under the same row lock and clock) that committed first, or before
//          the deadline, has made them `retained`: the transaction is rolled back, the skip with it, and they are kept. A YES after the deadline changed
//          nothing (S09.07's reply) and they are deleted;
//       d. the full E07 deletion (the inbound router's, `SubscriberDeletion`: the waiting texts skipped again under the lock, check-ins, the row, a
//          pending sign-up of the number, its `inbound_reply` rows), and the purge's count raised by one in the same transaction.
//     An interrupted run (a crash, the time limit, a subscriber whose transaction failed) leaves every committed deletion counted and every other
//     subscriber as they were; the next run goes on from what is left. A `retained` or `active` subscriber is never selected, and never deleted.
//  4. Completion, once none is left: under the record's lock, the database stamps the time and counts who stayed, and the aggregate ops event
//     `campaign.purge_completed` (deleted, retained: counts, no id, no number) is written in the same transaction, once.
//
// Nothing here logs, audits or returns a number or a subscriber's id; the answer and the log lines are counts.
import type { Db, DbExecutor, DbTransaction } from "../../../platform/db";
import type { RecipientKind, SkippedForRecipient } from "../../messaging";
import { pendingSignupStore, type PendingSignupStore } from "../adapters/pendingSignupStore";
import { purgeStore, type PurgeStore } from "../adapters/purgeStore";
import type { SubscriberDeletion } from "./inbound";

/** How many subscribers' ids a run reads at a time. */
export const PURGE_PAGE = 100;

/** How long a run starts new deletions for: the route's `maxDuration` is 60 s, and the next run (15 minutes later) goes on. */
export const PURGE_BUDGET_MS = 40_000;

/** Where the purge reports a subscriber whose deletion failed: the error's class only, never a number, an id or a message. */
export interface PurgeLog {
  error(evt: string, fields: Record<string, string | number>): void;
}

export interface PurgeDeps {
  db: Db;
  /** The E07 deletion: the inbound router's `deleteSubscriber` (the composition root's). */
  deletion: SubscriberDeletion;
  /**
   * checkins' `lockRounds` (S08.05): the subscriber's round threads locked before their texts and their row, as the E07 deletion takes it first; the
   * deletion is then told not to take it again. Without it the deletion takes it itself, after the purge's row lock.
   */
  checkins?: { lockRounds(subscriberId: string, tx: DbTransaction): Promise<void> };
  /** messaging's `skipRecipientDeliveries`: the deletion's first step, taken before the row lock. */
  skipRecipientDeliveries: (tx: DbTransaction, recipient: { kind: RecipientKind; id: string }) => Promise<SkippedForRecipient>;
  /** Writes the aggregate ops event `campaign.purge_completed` in the completion's transaction (ops' `recordOpsEvent`, wired by the composition root). */
  recordCompleted: (tx: DbTransaction, counts: { deleted: number; retained: number }) => Promise<void>;
  log?: PurgeLog;
  stores?: { purge?: PurgeStore; pending?: PendingSignupStore };
  pageSize?: number;
  budgetMs?: number;
  /** The clock of the time budget only (milliseconds); the deadline is always the database's. */
  clock?: () => number;
}

/** What one run did: counts only. */
export interface PurgeReport {
  /** The real campaign's deadline has passed and the end job has ended it. */
  due: boolean;
  /** Subscribers this run deleted. */
  deleted: number;
  /** Subscribers this run found kept under the lock (a YES first) or already gone. */
  skipped: number;
  /** Subscribers whose deletion failed in this run (rolled back; the next run tries them again). */
  failed: number;
  /** The run stopped at its time budget with subscribers left. */
  more: boolean;
  /** The purge has completed (in this run or an earlier one); `completedNow`: in this run. */
  completed: boolean;
  completedNow: boolean;
}

export interface EndOfPilotPurge {
  run(): Promise<PurgeReport>;
}

/** The run of a subscriber found kept (or gone) under the lock: the transaction is rolled back and nothing it did is kept. */
class NotPurgeable extends Error {
  override name = "NotPurgeable";
}

const errorClass = (error: unknown): string => (error instanceof Error ? error.name : "NonError");

export function createEndOfPilotPurge(deps: PurgeDeps): EndOfPilotPurge {
  const { db } = deps;
  const store = deps.stores?.purge ?? purgeStore;
  const pending = deps.stores?.pending ?? pendingSignupStore;
  const pageSize = deps.pageSize ?? PURGE_PAGE;
  const budgetMs = deps.budgetMs ?? PURGE_BUDGET_MS;
  const clock = deps.clock ?? (() => Date.now());

  /** One subscriber, in a transaction of its own (step 3). */
  async function purgeOne(campaignId: string, id: string): Promise<"deleted" | "skipped" | "failed"> {
    try {
      return await db.transaction(async (tx) => {
        const phone = await store.numberOfPurgeable(tx, id);
        if (phone === null) return "skipped";
        await pending.lockNumber(tx, phone);
        await deps.checkins?.lockRounds(id, tx);
        await deps.skipRecipientDeliveries(tx, { kind: "subscriber", id });
        const row = await store.lockPurgeable(tx, id);
        if (row === null) throw new NotPurgeable();
        const deleted = await deps.deletion.deleteSubscriber(tx, phone, row, { roundsLocked: deps.checkins !== undefined });
        if (!deleted.subscriber) throw new NotPurgeable();
        await store.countDeleted(tx, campaignId);
        return "deleted";
      });
    } catch (error) {
      if (error instanceof NotPurgeable) return "skipped";
      deps.log?.error("purge.subscriber_failed", { error: errorClass(error) });
      return "failed";
    }
  }

  /** Step 4: once none is left, the completion and its ops event, once. True when this call recorded it. */
  async function complete(campaignId: string): Promise<boolean> {
    return db.transaction(async (tx) => {
      const record = await store.lock(tx, campaignId);
      if (record === null || record.completedAt !== null) return false;
      if (await store.anyPurgeable(tx)) return false;
      const done = await store.complete(tx, campaignId);
      await deps.recordCompleted(tx, { deleted: done.deleted, retained: done.retained ?? 0 });
      return true;
    });
  }

  return {
    async run() {
      const report: PurgeReport = { due: false, deleted: 0, skipped: 0, failed: 0, more: false, completed: false, completedNow: false };
      const campaignId = await store.dueCampaign(db);
      if (campaignId === null) return report;
      report.due = true;
      const record = await store.begin(db, campaignId);
      if (record.completedAt !== null) return { ...report, completed: true };

      const started = clock();
      let after: string | null = null;
      for (;;) {
        const ids: string[] = await store.purgeableIds(db, { after, limit: pageSize });
        if (ids.length === 0) break;
        for (const id of ids) {
          if (clock() - started >= budgetMs) return { ...report, more: true };
          report[await purgeOne(campaignId, id)] += 1;
          after = id;
        }
      }
      // A subscriber whose deletion failed is still there: the next run tries again, and the purge completes only once none is left.
      if (report.failed > 0) return report;
      const completedNow = await complete(campaignId);
      // Another run may have recorded it first.
      const completed = completedNow || ((await store.find(db, campaignId))?.completedAt ?? null) !== null;
      return { ...report, completed, completedNow };
    },
  };
}

/** The Toronto day resident data was deleted (`YYYY-MM-DD`: the day the purge completed), for the terms page (S07.01); null until it has. */
export function residentDataDeletedOn(executor: DbExecutor, store: Pick<PurgeStore, "completedOn"> = purgeStore): Promise<string | null> {
  return store.completedOn(executor);
}
