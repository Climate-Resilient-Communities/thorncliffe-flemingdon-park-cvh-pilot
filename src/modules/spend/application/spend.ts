import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { Db, DbExecutor, DbTransaction } from "@/platform/db";
import { spendEvent } from "../adapters/schema";
import { toSpendEvent, type SpendEventInput, type SpendPurpose } from "../domain/events";

/**
 * The one advisory lock that serialises deciding on a paid call and recording it: whoever checks an allowance and then
 * records the usage does both under it (withSpendLock), so two callers cannot both see the last call as free.
 */
export const SPEND_LOCK_KEY = 4417203116;

/** Runs `work` in a transaction that holds the spend lock until it commits; what it records is visible to the next holder. */
export async function withSpendLock<T>(db: Db, work: (tx: DbTransaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SPEND_LOCK_KEY})`);
    return work(tx);
  });
}

/** Writes one spend event with the given executor (the client, or a caller's transaction). Throws on an invalid event or a failed insert. */
export async function recordSpendEvent(executor: DbExecutor, input: SpendEventInput): Promise<void> {
  const event = toSpendEvent(input);
  await executor.insert(spendEvent).values({
    kind: event.kind,
    purpose: event.purpose,
    model: event.model,
    releaseV: event.releaseV,
    calls: event.calls,
    tokens: event.tokens,
    tokensEstimated: event.tokensEstimated,
    ms: event.ms,
    pricePerMillionTokensCad: event.pricePerMillionTokensCad === null ? null : String(event.pricePerMillionTokensCad),
  });
}

export interface MonthlyUsage {
  calls: number;
  tokens: number;
}

/**
 * What a kind of usage has used so far in the calendar month (America/Toronto) that `now` falls in, in calls and tokens.
 * With `purpose` only the usage made for that purpose counts (the publish allowance is not eaten by questions or test-set
 * runs); without it, whoever made the calls. Units, not money: a price may not be known.
 */
export async function monthlyUsage(executor: DbExecutor, kind: string, now: Date, purpose?: SpendPurpose): Promise<MonthlyUsage> {
  const [row] = await executor
    .select({
      calls: sql<string>`coalesce(sum(${spendEvent.calls}), 0)`,
      tokens: sql<string>`coalesce(sum(${spendEvent.tokens}), 0)`,
    })
    .from(spendEvent)
    .where(
      and(
        eq(spendEvent.kind, kind),
        purpose === undefined ? undefined : eq(spendEvent.purpose, purpose),
        gte(spendEvent.at, sql`(date_trunc('month', ${now.toISOString()}::timestamptz at time zone 'America/Toronto') at time zone 'America/Toronto')`),
        lt(spendEvent.at, sql`((date_trunc('month', ${now.toISOString()}::timestamptz at time zone 'America/Toronto') + interval '1 month') at time zone 'America/Toronto')`),
      ),
    );
  return { calls: Number(row?.calls ?? 0), tokens: Number(row?.tokens ?? 0) };
}
