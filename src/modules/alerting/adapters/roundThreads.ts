// The threads a check-in round can be on, as checkins asks for them through its RoundThreads port (S08.05, AD-12, AD-18): checkins may not
// read alerting's tables (AD-2), so this adapter answers and the composition root (src/app/checkins.ts) wires it. A thread is one when it is
// open, not a drill, and its latest approved, non-superseded substantive entry (an approved entry is never superseded: that is its status) is
// an acknowledgement, an update or a correction, the kinds whose approval starts or adds to a round (S08.06); that entry's types and audience
// are the thread's. A D-1 post web-published before its approval is not approved, so it never makes a thread a round's. checkins keeps the
// threads of a round type and matches the audience itself.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { AudienceSchema } from "../../../contracts/audience";
import type { RoundThread, RoundThreads } from "../../checkins";
import type { DbExecutor } from "../../../platform/db";
import { alert, alertEntry } from "./schema";

const ROUND_KINDS = ["ack", "update", "correction"];

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
  const threads: RoundThread[] = [];
  for (const row of rows) {
    const audience = AudienceSchema.safeParse(row.audience);
    if (!ROUND_KINDS.includes(row.kind) || !audience.success) continue;
    threads.push({ alertId: row.alertId, types: row.types, audience: audience.data });
  }
  return threads;
}

export const roundThreads: RoundThreads = {
  open: (executor) => readThreads(executor, null),
  async lock(tx, alertIds) {
    if (alertIds.length === 0) return [];
    // The threads' locks first, in the order given (the caller's id order), then what they are under the locks.
    for (const alertId of alertIds) await tx.select({ id: alert.id }).from(alert).where(eq(alert.id, alertId)).for("update");
    return readThreads(tx, alertIds);
  },
};
