import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { DbExecutor } from "@/platform/db";
import { spendEvent } from "../adapters/schema";
import { toSpendEvent, type SpendEventInput } from "../domain/events";

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
 * What a kind of usage has used so far in the calendar month (America/Toronto) that `now` falls in, in calls and tokens,
 * whoever made the calls (a publish, a question, a test-set run). Units, not money: a price may not be known.
 */
export async function monthlyUsage(executor: DbExecutor, kind: string, now: Date): Promise<MonthlyUsage> {
  const [row] = await executor
    .select({
      calls: sql<string>`coalesce(sum(${spendEvent.calls}), 0)`,
      tokens: sql<string>`coalesce(sum(${spendEvent.tokens}), 0)`,
    })
    .from(spendEvent)
    .where(
      and(
        eq(spendEvent.kind, kind),
        gte(spendEvent.at, sql`(date_trunc('month', ${now.toISOString()}::timestamptz at time zone 'America/Toronto') at time zone 'America/Toronto')`),
        lt(spendEvent.at, sql`((date_trunc('month', ${now.toISOString()}::timestamptz at time zone 'America/Toronto') + interval '1 month') at time zone 'America/Toronto')`),
      ),
    );
  return { calls: Number(row?.calls ?? 0), tokens: Number(row?.tokens ?? 0) };
}
