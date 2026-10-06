// The statement that reads the round tally back (S08.09, E08 "Round tally"). The tally is written only by the migrations' trigger on `checkin`; the app
// reads it. Counts per thread, building, floor and status: nothing about anyone.
import { asc, inArray } from "drizzle-orm";
import type { DbExecutor } from "../../../platform/db";
import { isTallyStatus, type TallyCount } from "../domain/tally";
import { checkinTally } from "./schema";

export const tallyStore = {
  /** The tally of these threads, by thread, building, floor and status. Read without a lock: the counts as they are now. */
  async ofThreads(executor: DbExecutor, alertIds: readonly string[]): Promise<TallyCount[]> {
    if (alertIds.length === 0) return [];
    const rows = await executor
      .select({ alertId: checkinTally.alertId, rsn: checkinTally.rsn, floorId: checkinTally.floorId, status: checkinTally.status, n: checkinTally.n })
      .from(checkinTally)
      .where(inArray(checkinTally.alertId, [...alertIds]))
      .orderBy(asc(checkinTally.alertId), asc(checkinTally.rsn), asc(checkinTally.floorId), asc(checkinTally.status));
    // The table's check keeps `status` to the six; a row with another would be a schema the app does not know, and is left out.
    return rows.flatMap((row) => (isTallyStatus(row.status) ? [{ ...row, status: row.status }] : []));
  },
};

export type TallyStore = typeof tallyStore;
