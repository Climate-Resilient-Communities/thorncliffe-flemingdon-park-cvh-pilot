import { sql } from "drizzle-orm";
import type { DbExecutor } from "../../../platform/db";
import { SUBSCRIBER_LANGS, type MeasureViewRow, type MeasuredDay } from "../domain/subscriberMeasures";

const LANG_ARRAY = sql.raw(`array[${SUBSCRIBER_LANGS.map((lang) => `'${lang}'`).join(", ")}]::text[]`);

/**
 * The daily measures job's statement and the Hub's reading of them. What is stored for a day is counted from the subscribers, the unexpired pending sign-ups
 * and the day's event counts (`subscriber_event_count`, kept by a trigger on `subscriber`): counts by language and neighbourhood, never a row's contents.
 */
export const subscriberMeasureStore = {
  /**
   * Stores (or, when the day was stored before, replaces) every cell of the day: every launch language in every neighbourhood for every measure, 0 where
   * there is none, so a re-run cannot leave an old figure behind. The day is judged by the database's clock (Toronto). Returns the day and the cells written.
   */
  async record(executor: DbExecutor, day: MeasuredDay): Promise<{ day: string; cells: number }> {
    const rows = await executor.execute<{ day: string; cells: number }>(sql`
      with measured as (
        select case when ${day}::text = 'today' then (now() at time zone 'America/Toronto')::date else (now() at time zone 'America/Toronto')::date - 1 end as day
      ),
      grid as (
        select l.lang, n.id as nbhd
        from unnest(${LANG_ARRAY}) as l(lang)
        cross join neighbourhood n
      ),
      measures(measure) as (
        values ('receiving_active'), ('receiving_reconsent_pending'), ('receiving_retained'), ('pending_signups'), ('confirmations'), ('deletions')
      ),
      written as (
        insert into subscriber_measure (day, measure, lang, nbhd, n)
        select m.day, k.measure, g.lang, g.nbhd,
               case k.measure
                 when 'receiving_active' then (select count(*) from subscriber s where s.lang = g.lang and s.neighbourhood_id = g.nbhd and s.retention_state = 'active')
                 when 'receiving_reconsent_pending' then (select count(*) from subscriber s where s.lang = g.lang and s.neighbourhood_id = g.nbhd and s.retention_state = 'reconsent_pending')
                 when 'receiving_retained' then (select count(*) from subscriber s where s.lang = g.lang and s.neighbourhood_id = g.nbhd and s.retention_state = 'retained')
                 when 'pending_signups' then (select count(*) from pending_signup p where p.lang = g.lang and p.neighbourhood_id = g.nbhd and p.expires_at > now())
                 when 'confirmations' then coalesce((select c.n from subscriber_event_count c where c.day = m.day and c.event = 'confirmed' and c.lang = g.lang and c.nbhd = g.nbhd), 0)
                 else coalesce((select c.n from subscriber_event_count c where c.day = m.day and c.event = 'deleted' and c.lang = g.lang and c.nbhd = g.nbhd), 0)
               end::integer
        from measured m cross join grid g cross join measures k
        on conflict (day, measure, lang, nbhd) do update set n = excluded.n
        returning day
      )
      select (select day from measured)::text as day, (select count(*) from written)::integer as cells`);
    const row = rows[0];
    return { day: String(row?.day).slice(0, 10), cells: Number(row?.cells ?? 0) };
  },

  /** The most recent day with measures, or null when the job has never run. */
  async latestDay(executor: DbExecutor): Promise<string | null> {
    const rows = await executor.execute<{ day: string | null }>(sql`select (max(day))::text as day from subscriber_measure`);
    const day = rows[0]?.day;
    return day ? String(day).slice(0, 10) : null;
  },

  /** The view's rows of a day: the small-number rule is applied by the view. */
  async day(executor: DbExecutor, day: string): Promise<MeasureViewRow[]> {
    const rows = await executor.execute<{ day: string; measure: string; split: string; key: string | null; n: number | null; n_shown: string }>(sql`
      select day::text as day, measure, split, key, n, n_shown from subscriber_measures where day = ${day}::date`);
    return rows.map((row) => ({ day: String(row.day).slice(0, 10), measure: row.measure, split: row.split, key: row.key, n: row.n, nShown: row.n_shown }));
  },
};
