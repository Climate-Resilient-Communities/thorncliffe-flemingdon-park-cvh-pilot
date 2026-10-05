// Cost per alert (S07.10, FR-M5), for the Hub's Admin and Director edition (AD-4: spend is seen by an Admin and a Director only; the caller asks the policy).
// Two readings, both SQL views that hold counts and amounts and nothing personal (db/migrations/20261006100100_delivery_measure_views.sql):
//  - `alert_cost`: per alert entry, drill flag and language, the text messages and their cost, ACTUAL where the provider's price was reported and an ESTIMATE
//    otherwise, labelled (`basis`). A cell of fewer than 5 texts shows "fewer than 5" and no amount. Drills are returned apart.
//  - `cohere_alert_share`: per Toronto month, the share of the vendor's usage (calls and billed tokens) that was made for alerts. A price that is not known
//    gives no amount: the usage is in calls and tokens and the cost reads "unknown".
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

export interface AlertCost {
  entryId: string;
  alertId: string;
  kind: string;
  approvedAt: Date | null;
  total: AlertCostRow;
  /** One row per language, in language order. */
  languages: AlertCostRow[];
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

const num = (value: string | number | null) => (value === null ? null : Number(value));
const isBasis = (value: string): value is CostBasis => (COST_BASES as readonly string[]).includes(value);

/** The latest `limit` alert entries with texts of real alerts and the latest `limit` of drills, newest approval first. */
export async function readAlertCost(executor: DbExecutor, limit = 20): Promise<AlertCostReport> {
  const rows = await executor.execute<CostViewRow>(sql`
    select c.entry_id, c.alert_id, c.kind, c.approved_at, c.is_drill, c.lang, c.texts, c.texts_shown, c.basis, c.actual_millicents, c.estimate_cents, c.counted_millicents
    from alert_cost c
    join (
      select entry_id, is_drill, row_number() over (partition by is_drill order by max(approved_at) desc nulls last, entry_id) as position
      from alert_cost
      group by entry_id, is_drill
    ) latest on latest.entry_id = c.entry_id and latest.is_drill = c.is_drill
    where latest.position <= ${limit}
    order by c.approved_at desc nulls last, c.entry_id, c.lang nulls first`);
  const report: AlertCostReport = { real: [], drills: [] };
  const byEntry = new Map<string, AlertCost>();
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
    const key = `${row.is_drill}:${row.entry_id}`;
    let entry = byEntry.get(key);
    if (!entry) {
      entry = { entryId: row.entry_id, alertId: row.alert_id, kind: row.kind, approvedAt: row.approved_at === null ? null : new Date(row.approved_at), total: cost, languages: [] };
      byEntry.set(key, entry);
      (row.is_drill ? report.drills : report.real).push(entry);
    }
    if (row.lang === null) entry.total = cost;
    else entry.languages.push(cost);
  }
  return report;
}

export interface CohereShare {
  /** The Toronto month, YYYY-MM. */
  month: string;
  allCalls: number;
  alertCalls: number;
  allTokens: number;
  alertTokens: number;
  /** The alerts' share of the billed tokens, a floor percentage; null while there are none. */
  alertTokenSharePercent: number | null;
  /** Whether some tokens were estimated (a call aborted before it answered). */
  tokensEstimated: boolean;
  /** Cents CAD; null while a price is unknown: shown as unknown, never as zero. */
  allCostCents: number | null;
  alertCostCents: number | null;
}

type ShareViewRow = {
  month: string;
  all_calls: string | number;
  alert_calls: string | number;
  all_tokens: string | number;
  alert_tokens: string | number;
  alert_token_share_percent: number | null;
  tokens_estimated: boolean | null;
  all_cost_cents: string | number | null;
  alert_cost_cents: string | number | null;
};

/** The vendor's usage of the months, newest first, and the part alerts made. */
export async function readCohereShare(executor: DbExecutor, months = 3): Promise<CohereShare[]> {
  const rows = await executor.execute<ShareViewRow>(sql`
    select month::text as month, all_calls, alert_calls, all_tokens, alert_tokens, alert_token_share_percent, tokens_estimated, all_cost_cents, alert_cost_cents
    from cohere_alert_share
    order by month desc
    limit ${months}`);
  return rows.map((row) => ({
    month: String(row.month).slice(0, 7),
    allCalls: Number(row.all_calls),
    alertCalls: Number(row.alert_calls),
    allTokens: Number(row.all_tokens),
    alertTokens: Number(row.alert_tokens),
    alertTokenSharePercent: row.alert_token_share_percent,
    tokensEstimated: row.tokens_estimated === true,
    allCostCents: num(row.all_cost_cents),
    alertCostCents: num(row.alert_cost_cents),
  }));
}
