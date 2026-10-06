// The threads a check-in round can be on, as checkins asks for them through its RoundThreads port (S08.05, AD-12, AD-18): checkins may not
// read alerting's tables (AD-2), so this adapter answers and the composition root (src/app/checkins.ts) wires it. A thread is one when it is
// open, not a drill, and its latest approved, non-superseded substantive entry (an approved entry is never superseded: that is its status) is
// an acknowledgement, an update or a correction, the kinds whose approval starts or adds to a round (S08.06); that entry's types and audience
// are the thread's. A D-1 post web-published before its approval is not approved, so it never makes a thread a round's. checkins keeps the
// threads of a round type and matches the audience itself.
//
// S08.06: the candidates (`open`, read without a lock) also hold each open, non-drill thread whose acknowledgement, update or correction is
// waiting for approval, as that entry would make it. A request activated while that approval runs then locks the thread as well and waits
// for the approval, which holds the thread's lock from its first statement: either the approval commits first and the request, reading the
// thread again under its lock, joins the round, or the request commits first and the approval finds it among its requesters. Without them the
// two could each miss the other (the approval's requesters read before the request commits, the request's threads before the approval does).
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { AudienceSchema } from "../../../contracts/audience";
import type { RoundThread, RoundThreads } from "../../checkins";
import type { DbExecutor } from "../../../platform/db";
import { alert, alertEntry } from "./schema";

const ROUND_KINDS = ["ack", "update", "correction"];

/** The thread of a row whose audience is the stored one (a row whose audience does not parse is no round's). */
function threadOf(row: { alertId: string; types: string[]; audience: unknown }): RoundThread | null {
  const audience = AudienceSchema.safeParse(row.audience);
  return audience.success ? { alertId: row.alertId, types: row.types, audience: audience.data } : null;
}

/** The open, non-drill threads (all, or these) with their latest approved substantive entry's kind, types and audience. */
async function readThreads(executor: DbExecutor, alertIds: readonly string[] | null): Promise<RoundThread[]> {
  const latest = executor
    .select({ kind: alertEntry.kind, types: alertEntry.types, audience: alertEntry.audience })
    .from(alertEntry)
    .where(and(eq(alertEntry.alertId, alert.id), eq(alertEntry.status, "approved"), inArray(alertEntry.kind, ["ack", "update", "correction", "final"])))
    .orderBy(sql`${alertEntry.approvedAt} desc`, sql`${alertEntry.id} desc`)
    .limit(1)
    .as("latest");
  const rows = await executor
    .select({ alertId: alert.id, kind: latest.kind, types: latest.types, audience: latest.audience })
    .from(alert)
    .innerJoinLateral(latest, sql`true`)
    .where(and(eq(alert.status, "open"), eq(alert.isDrill, false), alertIds === null ? undefined : inArray(alert.id, [...alertIds])))
    .orderBy(asc(alert.id));
  return rows.flatMap((row) => {
    const thread = ROUND_KINDS.includes(row.kind) ? threadOf(row) : null;
    return thread ? [thread] : [];
  });
}

/** S08.06: the open, non-drill threads with an acknowledgement, update or correction waiting for approval, each as that entry would make it. */
async function waitingThreads(executor: DbExecutor): Promise<RoundThread[]> {
  const rows = await executor
    .select({ alertId: alert.id, types: alertEntry.types, audience: alertEntry.audience })
    .from(alertEntry)
    .innerJoin(alert, eq(alert.id, alertEntry.alertId))
    .where(and(eq(alert.status, "open"), eq(alert.isDrill, false), eq(alertEntry.status, "pending_approval"), inArray(alertEntry.kind, ROUND_KINDS)))
    .orderBy(asc(alert.id), asc(alertEntry.id));
  return rows.flatMap((row) => {
    const thread = threadOf(row);
    return thread ? [thread] : [];
  });
}

export const roundThreads: RoundThreads = {
  // The candidates: the round threads, then (S08.06) the threads an approval waiting may make one (a thread may come twice; checkins dedupes the ids it locks).
  open: async (executor) => [...(await readThreads(executor, null)), ...(await waitingThreads(executor))],
  async lock(tx, alertIds) {
    if (alertIds.length === 0) return [];
    // The threads' locks first, in the order given (the caller's id order), then what they are under the locks: approved entries only.
    for (const alertId of alertIds) await tx.select({ id: alert.id }).from(alert).where(eq(alert.id, alertId)).for("update");
    return readThreads(tx, alertIds);
  },
};
