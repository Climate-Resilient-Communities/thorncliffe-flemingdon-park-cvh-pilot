// The spend view's figures (S07.08, FR-G6): read with the executor given, nothing written. Give it a transaction at repeatable read (the seam does) for one consistent reading. The Toronto calendar month is the month
// everywhere (`inCalendarMonth`'s rule, here as the month's exact UTC interval); the pilot to date is every month that has a text message
// estimate, a reconciliation, or is the current month.
import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/platform/db";
import { TORONTO, monthInterval, monthOf, type MonthKey } from "../domain/reconciliation";
import { SMS_KIND } from "../domain/smsEstimate";
import { buildCohereSpend, buildOverview, buildPeriod, summariseSms, type CohereFigures, type SpendOverview } from "../domain/spendOverview";
import { readSpendCap } from "./spendCap";
import { smsMonthReport } from "./smsSpend";

/** The months of the pilot up to and including `current`, oldest first: those with an estimate or a reconciliation, and the current one. */
async function pilotMonths(executor: DbExecutor, current: MonthKey): Promise<MonthKey[]> {
  const rows = await executor.execute<{ month: string }>(sql`
    select distinct month from (
      select to_char(e.at at time zone ${TORONTO}::text, 'YYYY-MM') as month from spend_event e where e.kind = ${SMS_KIND}
      union
      select substr(r.id, 7) as month from sms_reconciliation r
    ) m
    where month <= ${current}
    order by 1`);
  const months = new Set(rows.map((row) => row.month));
  months.add(current);
  return [...months].sort();
}

/** Cohere's usage (every kind but text messages) in a period: from `from` up to, not including, `to`; either may be left off. */
async function cohereFigures(executor: DbExecutor, period: { from?: Date; to?: Date }): Promise<CohereFigures> {
  const [row] = await executor.execute<{
    calls: string;
    tokens: string;
    estimated: boolean;
    priced_calls: string;
    priced_micro: string;
    unpriced_calls: string;
    unpriced_tokens: string;
  }>(sql`
    select
      coalesce(sum(calls), 0)::text as calls,
      coalesce(sum(tokens), 0)::text as tokens,
      coalesce(bool_or(tokens_estimated), false) as estimated,
      coalesce(sum(calls) filter (where price_per_million_tokens_cad is not null), 0)::text as priced_calls,
      coalesce(sum(tokens::numeric * price_per_million_tokens_cad) filter (where price_per_million_tokens_cad is not null), 0)::text as priced_micro,
      coalesce(sum(calls) filter (where price_per_million_tokens_cad is null), 0)::text as unpriced_calls,
      coalesce(sum(tokens) filter (where price_per_million_tokens_cad is null), 0)::text as unpriced_tokens
    from spend_event
    where kind <> ${SMS_KIND}
      and (${period.from ? period.from.toISOString() : null}::timestamptz is null or at >= ${period.from ? period.from.toISOString() : null}::timestamptz)
      and (${period.to ? period.to.toISOString() : null}::timestamptz is null or at < ${period.to ? period.to.toISOString() : null}::timestamptz)`);
  return {
    calls: Number(row?.calls ?? 0),
    tokens: Number(row?.tokens ?? 0),
    tokensEstimated: row?.estimated ?? false,
    pricedCalls: Number(row?.priced_calls ?? 0),
    pricedMicroCad: Number(row?.priced_micro ?? 0),
    unpricedCalls: Number(row?.unpriced_calls ?? 0),
    unpricedTokens: Number(row?.unpriced_tokens ?? 0),
  };
}

export interface SpendOverviewOptions {
  now: Date;
  /** The pilot budget in cents CAD (config). */
  budgetCents: number;
  /** An estimate rate for Cohere usage whose price is unknown, in CAD per million tokens (config); null when none is configured. */
  cohereEstimateCadPerMillionTokens: number | null;
}

/** The spend view's figures: this month and the pilot to date, text messages and Cohere, the budget and the cap. */
export async function readSpendOverview(executor: DbExecutor, options: SpendOverviewOptions): Promise<SpendOverview> {
  const current = monthOf(options.now);
  const months = await pilotMonths(executor, current);
  const reports = [];
  for (const month of months) reports.push(await smsMonthReport(executor, month));
  const interval = monthInterval(current);
  const rate = options.cohereEstimateCadPerMillionTokens;
  const thisMonth = buildPeriod(
    summariseSms(reports.filter((report) => report.month === current)),
    buildCohereSpend(await cohereFigures(executor, { from: interval.startUtc, to: interval.endUtc }), rate),
  );
  const pilot = buildPeriod(summariseSms(reports), buildCohereSpend(await cohereFigures(executor, { to: interval.endUtc }), rate));
  const cap = await readSpendCap(executor);
  return buildOverview({ month: current, thisMonth, pilot, budgetCents: options.budgetCents, capCents: cap.monthlyCents, capSetAt: cap.setAt });
}
