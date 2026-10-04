// Usage counts (S02.15, AR-26, FR-M1, FR-M3): what a valid usage event does to the database. It raises the day's count for
// (day, evt, lang, nbhd) and writes nothing else: no address, no user agent, no identifier, no time finer than the day. The
// event comes in as the contract's value, so nothing else could be passed. The route (src/app/api/metrics) has already
// refused anything that is not exactly {evt, lang, nbhd?}.
import { sql } from "drizzle-orm";
import type { UsageEvent } from "@/contracts/usage";
import type { Db } from "@/platform/db";
import { usageCount } from "../adapters/schema";
import { torontoDate } from "../domain/providerState";

/** The day an event is counted on: the Toronto date, as the Hub reads its days. */
export const usageDay = (now: Date): string => torontoDate(now);

/**
 * Counts one event: a new row for the first event of the day for this combination, or one more on the row that is there. One
 * statement, so two events at once are both counted. Throws when the database cannot be reached; the caller decides what that
 * means (the phone does not retry: counts are approximate by design).
 */
export async function recordUsage(db: Pick<Db, "insert">, event: UsageEvent, now: Date = new Date()): Promise<void> {
  await db
    .insert(usageCount)
    .values({ day: usageDay(now), evt: event.evt, lang: event.lang, nbhd: event.nbhd ?? "" })
    .onConflictDoUpdate({ target: [usageCount.day, usageCount.evt, usageCount.lang, usageCount.nbhd], set: { n: sql`${usageCount.n} + 1` } });
}
