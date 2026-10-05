// How far corrections, withdrawals and finals reached, for the Hub (S07.10, FR-M4): the rows of the SQL view `correction_reach`
// (db/migrations/20261006110100_delivery_measure_views.sql), one per correction, withdrawal or final that had texts to send, against the recipients of the
// original with the S06.08 definitions (src/modules/messaging/domain/deliveryMeasures.ts): attempted reach is the original's recipients whose text of the
// entry was handed to the provider, confirmed reach those whose text is delivered. The view applies the small-number rule and holds no personal data (only
// counts and the ids of alert entries). Drills are reported apart: the view flags them and they are returned in a list of their own.
import { sql } from "drizzle-orm";
import type { DbExecutor } from "../../../platform/db";

export const CORRECTION_REACH_KINDS = ["correction", "withdrawal", "final"] as const;
export type CorrectionReachKind = (typeof CORRECTION_REACH_KINDS)[number];

export interface CorrectionReachRow {
  entryId: string;
  alertId: string;
  kind: CorrectionReachKind;
  /** When the entry was approved. */
  approvedAt: Date | null;
  /** The original's recipients: null when the small-number rule hides it; `shown` is what to print either way. */
  originalRecipients: { n: number | null; shown: string };
  attemptedReach: { n: number | null; shown: string };
  confirmedReach: { n: number | null; shown: string };
  /** Floor percentages of the original's recipients; null when the rule (or an empty original) leaves no percentage to give. */
  attemptedPercent: number | null;
  confirmedPercent: number | null;
}

export interface CorrectionReachReport {
  /** Real alerts, newest approval first. */
  real: CorrectionReachRow[];
  /** Drills, apart: never added to the real ones. */
  drills: CorrectionReachRow[];
}

type ViewRow = {
  entry_id: string;
  alert_id: string;
  kind: string;
  is_drill: boolean;
  approved_at: string | Date | null;
  original_recipients: number | null;
  original_recipients_shown: string;
  attempted_reach: number | null;
  attempted_reach_shown: string;
  confirmed_reach: number | null;
  confirmed_reach_shown: string;
  attempted_percent: number | null;
  confirmed_percent: number | null;
};

const isKind = (value: string): value is CorrectionReachKind => (CORRECTION_REACH_KINDS as readonly string[]).includes(value);

/** The latest `limit` measured entries of real alerts and the latest `limit` of drills (newest approval first). */
export async function readCorrectionReach(executor: DbExecutor, limit = 20): Promise<CorrectionReachReport> {
  const rows = await executor.execute<ViewRow>(sql`
    select entry_id, alert_id, kind, is_drill, approved_at, original_recipients, original_recipients_shown, attempted_reach, attempted_reach_shown,
           confirmed_reach, confirmed_reach_shown, attempted_percent, confirmed_percent
    from (
      select r.*, row_number() over (partition by r.is_drill order by r.approved_at desc nulls last, r.entry_id) as position
      from correction_reach r
    ) latest
    where position <= ${limit}
    order by approved_at desc nulls last, entry_id`);
  const report: CorrectionReachReport = { real: [], drills: [] };
  for (const row of rows) {
    if (!isKind(row.kind)) throw new Error(`correction_reach: unknown kind ${row.kind.slice(0, 20)}`);
    const reach: CorrectionReachRow = {
      entryId: row.entry_id,
      alertId: row.alert_id,
      kind: row.kind,
      approvedAt: row.approved_at === null ? null : new Date(row.approved_at),
      originalRecipients: { n: row.original_recipients, shown: row.original_recipients_shown },
      attemptedReach: { n: row.attempted_reach, shown: row.attempted_reach_shown },
      confirmedReach: { n: row.confirmed_reach, shown: row.confirmed_reach_shown },
      attemptedPercent: row.attempted_percent,
      confirmedPercent: row.confirmed_percent,
    };
    (row.is_drill ? report.drills : report.real).push(reach);
  }
  return report;
}
