// Cost per alert (S07.10, FR-M5), for the Hub's Admin and Director edition (AD-4: spend is seen by an Admin and a Director only; the caller asks the policy).
// Two readings, both SQL views that hold counts and amounts and nothing personal (db/migrations/20261006110100_delivery_measure_views.sql):
//  - `alert_cost`: per alert entry, drill flag and language, the text messages and their cost, ACTUAL where the provider's price was reported and an ESTIMATE
//    otherwise, labelled (`basis`). A cell of fewer than 5 texts shows "fewer than 5" and no amount; when any language cell is hidden the entry's total is
//    hidden too ("not shown", no amount: 20261007030000), so it cannot give the hidden cells away. Drills are returned apart.
//  - `cohere_alert_entry`: per alert entry (drills apart), the vendor calls and billed tokens made for it (the translation at submit) and its share of all the
//    vendor's billed tokens of the month; `cohere_alert_share`: the same per month, real alerts and drills apart. A price that is not known gives no amount:
//    the usage is in calls and tokens and the cost reads "unknown".
import { sql } from "drizzle-orm";
import type { DbExecutor } from "../../../platform/db";

export const COST_BASES = ["actual", "estimate", "mixed"] as const;
export type CostBasis = (typeof COST_BASES)[number];

export interface AlertCostRow {
  /** A language code; null is the entry's total. */
  lang: string | null;
  texts: { n: number | null; shown: string };
  /** Null with the texts when they are fewer than 5. */
  basis: CostBasis | null;
  /** Thousandths of a cent CAD, counted at the actual where the provider reported one and at the estimate otherwise. */
  countedMillicents: number | null;
  actualMillicents: number | null;
  /** Whole cents CAD: the estimates still standing. */
  estimateCents: number | null;
}

/** What an alert entry's translation used of the vendor (S07.10, FR-M5), in one Toronto month: its own calls and billed tokens and its share of all the vendor's tokens of the month. */
export interface CohereEntryShare {
  /** The Toronto month, YYYY-MM. */
  month: string;
  calls: number;
  tokens: number;
  /** The entry's share of the month's billed tokens, a floor percentage; null while the month has none. */
  tokenSharePercent: number | null;
  tokensEstimated: boolean;
  /** Cents CAD; null while a price is unknown: shown as unknown, never as zero. */
  costCents: number | null;
}

export interface AlertCost {
  entryId: string;
  alertId: string;
  kind: string;
  approvedAt: Date | null;
  /** The entry's texts; null for an entry that has none yet (its translation may have cost something already). */
  total: AlertCostRow | null;
  /** One row per language, in language order. */
  languages: AlertCostRow[];
  /** The entry's share of the vendor's usage, one per month it was used in (normally one). Empty where nothing was recorded for the entry. */
  cohere: CohereEntryShare[];
}

export interface AlertCostReport {
  /** Real alerts, newest approval first. */
  real: AlertCost[];
  /** Drills, apart: never added to the real ones. */
  drills: AlertCost[];
}

type CostViewRow = {
  entry_id: string;
  alert_id: string;
  kind: string;
  approved_at: string | Date | null;
  is_drill: boolean;
  lang: string | null;
  texts: number | null;
  texts_shown: string;
  basis: string | null;
  actual_millicents: string | number | null;
  estimate_cents: number | null;
  counted_millicents: string | number | null;
};

type EntryShareViewRow = {
  entry_id: string;
  alert_id: string;
  kind: string;
  approved_at: string | Date | null;
  is_drill: boolean;
  month: string;
  calls: string | number;
  tokens: string | number;
  token_share_percent: number | null;
  tokens_estimated: boolean | null;
  cost_cents: string | number | null;
};

const num = (value: string | number | null) => (value === null ? null : Number(value));
const isBasis = (value: string): value is CostBasis => (COST_BASES as readonly string[]).includes(value);
const uuidList = (ids: readonly string[]) => sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);

/**
 * The latest `limit` alert entries of real alerts and the latest `limit` of drills that have texts or vendor usage, newest approval first, each with its
 * texts by language and its share of the vendor's usage.
 */
export async function readAlertCost(executor: DbExecutor, limit = 20): Promise<AlertCostReport> {
  const latest = await executor.execute<{ entry_id: string }>(sql`
    select entry_id from (
      select entry_id, is_drill, row_number() over (partition by is_drill order by max(approved_at) desc nulls last, entry_id) as position
      from (
        select entry_id, is_drill, approved_at from alert_cost
        union all
        select entry_id, is_drill, approved_at from cohere_alert_entry
      ) u
      group by entry_id, is_drill
    ) ranked
    where position <= ${limit}`);
  const report: AlertCostReport = { real: [], drills: [] };
  if (latest.length === 0) return report;
  const wanted = uuidList(latest.map((row) => row.entry_id));
  const rows = await executor.execute<CostViewRow>(sql`
    select entry_id, alert_id, kind, approved_at, is_drill, lang, texts, texts_shown, basis, actual_millicents, estimate_cents, counted_millicents
    from alert_cost
    where entry_id in (${wanted})`);
  const shares = await executor.execute<EntryShareViewRow>(sql`
    select entry_id, alert_id, kind, approved_at, is_drill, month::text as month, calls, tokens, token_share_percent, tokens_estimated, cost_cents
    from cohere_alert_entry
    where entry_id in (${wanted})
    order by month`);

  const byEntry = new Map<string, AlertCost>();
  const entryOf = (row: { entry_id: string; alert_id: string; kind: string; approved_at: string | Date | null; is_drill: boolean }): AlertCost => {
    const key = `${row.is_drill}:${row.entry_id}`;
    let entry = byEntry.get(key);
    if (!entry) {
      entry = { entryId: row.entry_id, alertId: row.alert_id, kind: row.kind, approvedAt: row.approved_at === null ? null : new Date(row.approved_at), total: null, languages: [], cohere: [] };
      byEntry.set(key, entry);
      (row.is_drill ? report.drills : report.real).push(entry);
    }
    return entry;
  };
  for (const row of rows) {
    if (row.basis !== null && !isBasis(row.basis)) throw new Error(`alert_cost: unknown basis ${row.basis.slice(0, 20)}`);
    const cost: AlertCostRow = {
      lang: row.lang,
      texts: { n: row.texts, shown: row.texts_shown },
      basis: row.basis,
      countedMillicents: num(row.counted_millicents),
      actualMillicents: num(row.actual_millicents),
      estimateCents: row.estimate_cents,
    };
    const entry = entryOf(row);
    if (row.lang === null) entry.total = cost;
    else entry.languages.push(cost);
  }
  for (const row of shares) {
    entryOf(row).cohere.push({
      month: String(row.month).slice(0, 7),
      calls: Number(row.calls),
      tokens: Number(row.tokens),
      tokenSharePercent: row.token_share_percent,
      tokensEstimated: row.tokens_estimated === true,
      costCents: num(row.cost_cents),
    });
  }
  const newestFirst = (a: AlertCost, b: AlertCost) => (b.approvedAt?.getTime() ?? -Infinity) - (a.approvedAt?.getTime() ?? -Infinity) || a.entryId.localeCompare(b.entryId);
  report.real.sort(newestFirst);
  report.drills.sort(newestFirst);
  for (const entry of [...report.real, ...report.drills]) entry.languages.sort((a, b) => (a.lang ?? "").localeCompare(b.lang ?? ""));
  return report;
}

export interface CohereShare {
  /** The Toronto month, YYYY-MM. */
  month: string;
  allCalls: number;
  /** Made for real alerts (an event that does not say is counted here). */
  alertCalls: number;
  /** Made for drills, apart: never added to the real alerts'. */
  drillCalls: number;
  allTokens: number;
  alertTokens: number;
  drillTokens: number;
  /** The real alerts' share of the billed tokens, a floor percentage; null while there are none. */
  alertTokenSharePercent: number | null;
  drillTokenSharePercent: number | null;
  /** Whether some tokens were estimated (a call aborted before it answered). */
  tokensEstimated: boolean;
  /** Cents CAD; null while a price is unknown: shown as unknown, never as zero. */
  allCostCents: number | null;
  alertCostCents: number | null;
  drillCostCents: number | null;
}

type ShareViewRow = {
  month: string;
  all_calls: string | number;
  alert_calls: string | number;
  drill_calls: string | number;
  all_tokens: string | number;
  alert_tokens: string | number;
  drill_tokens: string | number;
  alert_token_share_percent: number | null;
  drill_token_share_percent: number | null;
  tokens_estimated: boolean | null;
  all_cost_cents: string | number | null;
  alert_cost_cents: string | number | null;
  drill_cost_cents: string | number | null;
};

/** The vendor's usage of the months, newest first, and the part alerts made. */
export async function readCohereShare(executor: DbExecutor, months = 3): Promise<CohereShare[]> {
  const rows = await executor.execute<ShareViewRow>(sql`
    select month::text as month, all_calls, alert_calls, drill_calls, all_tokens, alert_tokens, drill_tokens, alert_token_share_percent, drill_token_share_percent, tokens_estimated, all_cost_cents, alert_cost_cents, drill_cost_cents
    from cohere_alert_share
    order by month desc
    limit ${months}`);
  return rows.map((row) => ({
    month: String(row.month).slice(0, 7),
    allCalls: Number(row.all_calls),
    alertCalls: Number(row.alert_calls),
    drillCalls: Number(row.drill_calls),
    allTokens: Number(row.all_tokens),
    alertTokens: Number(row.alert_tokens),
    drillTokens: Number(row.drill_tokens),
    alertTokenSharePercent: row.alert_token_share_percent,
    drillTokenSharePercent: row.drill_token_share_percent,
    tokensEstimated: row.tokens_estimated === true,
    allCostCents: num(row.all_cost_cents),
    alertCostCents: num(row.alert_cost_cents),
    drillCostCents: num(row.drill_cost_cents),
  }));
}
