// The expire job (S05.04, FR-A7, AD-5 "System entries", AD-18): every open thread whose covering entry is past its valid-until is closed `expired`, each in its own
// transaction. Called every minute by pg_cron through `/api/jobs/expire` (the job secret), so a thread that could not be closed this minute is the next minute's.
//
// One thread, one transaction, in the order of AD-18: the thread's lock, every entry of it (locked as they are read), then the system final is made and
// `closeAlert(alertId, 'expired', keepEntryId = that final)` closes the thread (it locks `feed_version` and the delivery rows after, and cancels the queued texts of
// every other entry). The decision is made after the locks from rows read under them, so a run that overlaps another, or an update's approval that renewed the
// valid-until a moment earlier, is judged on what is true then: the thread is closed once, with one final, whoever got there first, and a retry after a failure
// finds the thread as it was (the transaction rolled back) or closed (nothing to do).
//
// The system final is `published_system`: web-only (it is never approved, so no delivery is queued or captured for it), published at the database's clock, with the
// catalog's words and the audience, types and phase of the entry that covered the thread. The entry trigger makes it only while the session variable
// `cvh.system_actor` is `expire` (set here, transaction-local) and only beside an expired covering entry (db/migrations/20261004070000_alert_expiry.sql); the
// thread's own trigger lets a thread close as expired only beside such a final made in the same transaction (20261004050000_alert_close.sql).
import { eq, sql } from "drizzle-orm";
import type { Db, DbTransaction } from "../../../platform/db";
import { uuidv7 } from "../../../platform/ids";
import { classifyError } from "../../../platform/safeError";
import type { OpsEvent } from "../../ops";
import { alert, alertEntry } from "../adapters/schema";
import { expiryOf, isLate } from "../domain/expiry";
import type { CloseAlert } from "./closeAlert";
import type { AlertAudit } from "./ports";
import { publishedSummaries } from "./threads";

/** The most threads one run closes (the rest wait for the next run, a minute later): a run is one function invocation with a time limit. */
export const EXPIRE_BATCH_LIMIT = 100;

export interface ExpireDeps {
  db: Db;
  closeAlert: CloseAlert;
  audit: AlertAudit;
  /** The catalog's words of the system final ("This alert has expired without a further update. ..."), in English: the web shows them as the entry's original. */
  finalText: () => string;
  /** Operational events (AD-23): a thread that could not be closed, a thread closed late. Never throws into the run: a failed write is the caller's to log. */
  ops: { record(event: OpsEvent): Promise<void> };
  /** Test seam: the clock. Left out, the decision uses the database's `now()`, the clock the entry trigger judges by. */
  now?: () => Date;
  newId?: () => string;
  batchLimit?: number;
}

/** What one run did: counts only. */
export interface ExpireReport {
  /** Open threads found past their valid-until. */
  due: number;
  /** Threads this run closed. */
  closed: number;
  /** Threads that were due when listed and no longer were when locked (closed by another run, or renewed by an approved update): nothing was done. */
  skipped: number;
  /** Threads whose transaction failed (rolled back, an ops event recorded): the next run tries them again. */
  failed: number;
}

export interface Expirer {
  run(): Promise<ExpireReport>;
}

/** `expireOverdue` bound to its seams. */
export function createExpirer(deps: ExpireDeps): Expirer {
  const newId = deps.newId ?? (() => uuidv7());
  const limit = deps.batchLimit ?? EXPIRE_BATCH_LIMIT;

  /** The open threads whose covering entry is past its valid-until, oldest first. A cheap pre-filter: each is judged again under its lock. */
  async function overdueThreadIds(): Promise<string[]> {
    const at = deps.now ? sql`${deps.now().toISOString()}::timestamptz` : sql`now()`;
    const rows = await deps.db.execute<{ id: string }>(sql`
      select a.id
      from alert a
      cross join lateral (
        select e.valid_until
        from alert_entry e
        where e.alert_id = a.id
          and e.web_published_at is not null
          and e.status not in ('draft', 'discarded', 'superseded')
          and e.kind in ('ack', 'update', 'correction', 'final')
        order by e.web_published_at desc, e.id desc
        limit 1
      ) covering
      where a.status = 'open' and covering.valid_until <= ${at}
      order by covering.valid_until, a.id
      limit ${limit}`);
    return [...rows].map((row) => row.id);
  }

  /** Closes one thread if it is still overdue under its lock. Returns how late it was, or null when there was nothing to do. */
  async function expireOne(alertId: string): Promise<{ lateMs: number } | null> {
    return deps.db.transaction(async (tx: DbTransaction) => {
      // The expire job's identity for the entry trigger: transaction-local, so it ends with this transaction.
      await tx.execute(sql`select set_config('cvh.system_actor', 'expire', true)`);
      const [thread] = await tx.select().from(alert).where(eq(alert.id, alertId)).for("update");
      if (!thread || thread.status !== "open") return null;
      const rows = await tx.select().from(alertEntry).where(eq(alertEntry.alertId, thread.id)).for("update");
      const now = deps.now ? deps.now() : await databaseNow(tx);
      const decision = expiryOf(publishedSummaries(rows), now);
      if (!decision.expired) return null;
      const covering = decision.covering;

      const finalId = newId();
      await tx.insert(alertEntry).values({
        id: finalId,
        alertId: thread.id,
        kind: "final",
        status: "published_system",
        // The column is required and names an account: the thread's own author stands in as the entry's author; nobody acts as them (no `cvh.actor_id`), and the audit
        // trail records the close with no actor (the system).
        authorId: thread.createdBy,
        editorIds: [thread.createdBy],
        originalText: deps.finalText(),
        types: [...covering.types],
        audience: covering.audience,
        phase: covering.phase,
        validUntil: covering.validUntil,
        validUntilMode: "at",
      });
      await deps.closeAlert(tx, { staffId: null }, { alertId: thread.id, reason: "expired", keepEntryId: finalId });
      return { lateMs: decision.lateMs };
    });
  }

  return {
    async run(): Promise<ExpireReport> {
      const report: ExpireReport = { due: 0, closed: 0, skipped: 0, failed: 0 };
      let ids: string[];
      try {
        ids = await overdueThreadIds();
      } catch (error) {
        // The run as a whole failed (the listing could not be read): an event with no subject, best-effort, then the route answers 500.
        await record({ kind: "alert.expire_failed", detail: { error: classifyError(error) } });
        throw error;
      }
      report.due = ids.length;
      for (const alertId of ids) {
        try {
          const done = await expireOne(alertId);
          if (done === null) {
            report.skipped += 1;
            continue;
          }
          report.closed += 1;
          if (isLate(done.lateMs)) await record({ kind: "alert.expire_late", subjectType: "alert", subjectId: alertId, detail: { minutes_late: Math.floor(done.lateMs / 60_000) } });
        } catch (error) {
          report.failed += 1;
          await record({ kind: "alert.expire_failed", subjectType: "alert", subjectId: alertId, detail: { error: classifyError(error) } });
        }
      }
      return report;
    },
  };

  /** An ops event is a report about the run: it never turns the run into a failure, and one thread's trouble never stops the others. */
  async function record(event: OpsEvent): Promise<void> {
    try {
      await deps.ops.record(event);
    } catch {
      // The ops log being unreachable is the database being unreachable: the next run finds the same overdue threads and tries again.
    }
  }
}

async function databaseNow(tx: DbTransaction): Promise<Date> {
  const rows = await tx.execute<{ now: Date | string }>(sql`select now() as now`);
  return new Date([...rows][0].now);
}
