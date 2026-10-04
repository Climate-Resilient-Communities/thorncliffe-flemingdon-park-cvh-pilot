import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { ProgressStore } from "../application/sendingProgress";
import type { ProblemState } from "../domain/sendingProgress";
import { delivery } from "./schema";

/**
 * The outbox's rows for the sending progress (S06.09): counts, ids, states, languages and instants only, never a number or a body. Only `subscriber`
 * recipients are counted: a real alert's texts go to subscribers and a drill's to the roster (the insert guard enforces it), so a drill's texts are in
 * no count here (S06.05 reads them apart).
 */
export const drizzleProgressStore: ProgressStore = {
  async languageCounts(executor, entryId) {
    const count = (condition: ReturnType<typeof sql>) => sql<number>`count(*) filter (where ${condition})::int`;
    const handedOff = sql`${delivery.handedOffAt} is not null`;
    const state = (...names: string[]) => sql`${delivery.state} in (${sql.join(names.map((name) => sql`${name}`), sql`, `)})`;
    const rows = await executor
      .select({
        lang: delivery.lang,
        waiting: count(sql`${delivery.state} = 'queued' or (${delivery.state} = 'claimed' and not ${handedOff})`),
        inFlight: count(sql`${delivery.state} = 'submitted' or (${delivery.state} = 'claimed' and ${handedOff})`),
        delivered: count(state("delivered")),
        undelivered: count(state("undelivered")),
        failed: count(state("failed")),
        unknown: count(state("unknown")),
        cancelled: count(state("cancelled")),
        skipped: count(state("skipped", "skipped_env")),
        handedOff: count(handedOff),
      })
      .from(delivery)
      .where(and(eq(delivery.entryId, entryId), eq(delivery.recipientKind, "subscriber")))
      .groupBy(delivery.lang)
      .orderBy(asc(delivery.lang));
    return {
      languages: rows.map((row) => ({ lang: row.lang, waiting: row.waiting, inFlight: row.inFlight, delivered: row.delivered, undelivered: row.undelivered, failed: row.failed, unknown: row.unknown, cancelled: row.cancelled, skipped: row.skipped })),
      handedOff: rows.reduce((sum, row) => sum + row.handedOff, 0),
    };
  },

  async problemRows(executor, entryId, states, limit) {
    const rows = await executor
      .select({
        id: delivery.id,
        lang: delivery.lang,
        state: delivery.state,
        providerErrorCode: delivery.providerErrorCode,
        attempts: delivery.attempts,
        at: delivery.updatedAt,
      })
      .from(delivery)
      .where(and(eq(delivery.entryId, entryId), eq(delivery.recipientKind, "subscriber"), inArray(delivery.state, [...states])))
      .orderBy(desc(delivery.updatedAt), asc(delivery.id))
      .limit(limit);
    return rows.map((row) => ({ ...row, state: row.state as ProblemState }));
  },
};
