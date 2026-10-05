import { sql } from "drizzle-orm";
import type { DbExecutor } from "../../../platform/db";
import { WEEKLY_SECTIONS, type WeeklyRow, type WeeklySection } from "../domain/weeklyReview";

type ViewRow = {
  week_start: string | Date;
  section: string;
  is_drill: boolean;
  lang: string | null;
  reason: string | null;
  entry_id: string | null;
  started_at: string | Date | null;
  ended_at: string | Date | null;
  duration_seconds: string | number | null;
  first_hand_off_seconds: string | number | null;
  ninety_percent_seconds: string | number | null;
  ninety_percent_status: string | null;
  delivered_share_percent: number | null;
  amount_cents: number | null;
  n: number | null;
  n_shown: string | null;
};

const date = (value: string | Date | null) => (value === null ? null : new Date(value));
const num = (value: string | number | null) => (value === null ? null : Number(value));
const isSection = (value: string): value is WeeklySection => (WEEKLY_SECTIONS as readonly string[]).includes(value);

/** Reads the view `weekly_review` for a week. The view holds no personal data and has applied the small-number rule. */
export const weeklyReviewStore = {
  async week(executor: DbExecutor, weekStart: string): Promise<WeeklyRow[]> {
    const rows = await executor.execute<ViewRow>(sql`
      select week_start::text as week_start, section, is_drill, lang, reason, entry_id, started_at, ended_at, duration_seconds,
             first_hand_off_seconds, ninety_percent_seconds, ninety_percent_status, delivered_share_percent, amount_cents, n, n_shown
      from weekly_review
      where week_start = ${weekStart}::date`);
    return rows.map((row) => {
      if (!isSection(row.section)) throw new Error(`weekly_review: unknown section ${row.section.slice(0, 40)}`);
      return {
        weekStart: String(row.week_start).slice(0, 10),
        section: row.section,
        isDrill: row.is_drill,
        lang: row.lang,
        reason: row.reason,
        entryId: row.entry_id,
        startedAt: date(row.started_at),
        endedAt: date(row.ended_at),
        durationSeconds: num(row.duration_seconds),
        firstHandOffSeconds: num(row.first_hand_off_seconds),
        ninetyPercentSeconds: num(row.ninety_percent_seconds),
        ninetyPercentStatus: row.ninety_percent_status,
        deliveredSharePercent: row.delivered_share_percent,
        amountCents: row.amount_cents,
        n: row.n,
        nShown: row.n_shown,
      };
    });
  },
};
