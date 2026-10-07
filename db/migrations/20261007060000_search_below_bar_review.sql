-- S03.09: the weekly review (S09.04's `weekly_review`) lists the search test set's manual runs that measured search below the launch bar.
--
-- A run the team makes by hand (the week before launch, week 4 of the pilot) records each measure of the evaluation subset that is below its minimum
-- in `data/search-test-set/bar.json` as an `ops_event` of kind `search.below_bar` (detail: `measure` hit_rate, no_match_accuracy or
-- emergency_accuracy, `lang` for a hit rate, the observed share and the minimum in thousandths, and the checkpoint). The view gains one section:
--   search_below_bar        one row per such event: `reason` is the measure, `lang` the language of a hit rate (null for the two accuracies),
--                           `started_at` the time of the run. The numbers are in the run's report (data/search-test-set/reports), committed with it.
-- No count is shown, so the small-number rule has nothing to hide, and the row holds no question and no personal data.
--
-- The view keeps its name, columns, column types and order, `security_invoker` and grants (create or replace keeps the grants; they are stated again).
-- The definition changes, which the check counts as destructive. The release in production when this was written (065188be) reads only these columns, and its
-- reader refuses a section it does not know; no `search.below_bar` event can exist before this release is deployed, because only this release's
-- search guard writes them, so nothing it does can fail on the new definition.
-- contract: 065188bef644a73914cf8ea183037d8c4c57041a

create or replace view weekly_review with (security_invoker = true) as
with
  health_episode as (
    select (date_trunc('week', e.at at time zone 'America/Toronto'))::date as week_start,
           'health_condition'::text as section,
           false as is_drill,
           e.detail ->> 'condition' as reason,
           e.at as started_at,
           r.ended_at
    from ops_event e
    left join lateral (
      select min(x.at) as ended_at
      from ops_event x
      where x.kind in ('health.condition_recovered', 'health.condition_alerted') and x.detail ->> 'condition' = e.detail ->> 'condition' and x.id > e.id
        and (x.kind = 'health.condition_recovered' or x.detail ->> 'first' = 'true')
    ) r on true
    where e.kind = 'health.condition_alerted' and e.detail ->> 'first' = 'true'
  ),
  pause_episode as (
    select (date_trunc('week', p.at at time zone 'America/Toronto'))::date as week_start,
           'pause'::text as section,
           p.is_drill,
           null::text as reason,
           p.at as started_at,
           r.ended_at
    from audit_event p
    left join lateral (
      select min(x.at) as ended_at
      from audit_event x
      where x.action = 'sending.resumed' and x.outcome = 'ok' and x.id > p.id
    ) r on true
    where p.action = 'sending.paused' and p.outcome = 'ok'
  ),
  overrun as (
    select (date_trunc('week', e.at at time zone 'America/Toronto'))::date as week_start,
           'cap_overrun'::text as section,
           false as is_drill,
           null::text as reason,
           e.at as started_at,
           null::timestamptz as ended_at,
           case when e.detail ->> 'over_cents' ~ '^[0-9]{1,9}$' then (e.detail ->> 'over_cents')::integer end as amount_cents
    from ops_event e
    where e.kind = 'spend.cap_overrun'
  ),
  publish_failure as (
    select (date_trunc('week', e.at at time zone 'America/Toronto'))::date as week_start,
           'publish_failure'::text as section,
           false as is_drill,
           e.detail ->> 'reason' as reason,
           e.at as started_at
    from ops_event e
    where e.kind = 'directory.publish_failed'
  ),
  access_open as (
    select r.at as received_at, c.at as closed_at, r.is_drill
    from audit_event r
    left join lateral (
      select min(x.at) as at
      from audit_event x
      where x.action = 'access_request.closed' and x.outcome = 'ok' and x.subject_type = 'access_request' and x.subject_id = r.subject_id and x.at >= r.at
    ) c on true
    where r.action = 'access_request.received' and r.outcome = 'ok'
      and coalesce(c.at, now()) > r.at + interval '25 days'
  ),
  access_overdue as (
    select w::date as week_start,
           'access_request_overdue'::text as section,
           a.is_drill,
           case when a.closed_at is null then 'open' else 'closed_late' end as reason,
           a.received_at as started_at,
           a.closed_at as ended_at
    from access_open a
    cross join lateral generate_series(
      (date_trunc('week', (a.received_at + interval '25 days') at time zone 'America/Toronto'))::date,
      (date_trunc('week', coalesce(a.closed_at, now()) at time zone 'America/Toronto'))::date,
      interval '7 days'
    ) w
  ),
  -- Counts that are cells of a language (and a reason), before the small-number rule.
  problem_cells as (
    select (date_trunc('week', coalesce(d.completed_at, d.updated_at) at time zone 'America/Toronto'))::date as week_start,
           'delivery_problem'::text as section,
           (d.recipient_kind = 'roster') as is_drill,
           d.lang,
           d.state || ':' || case
             when d.state = 'unknown' then coalesce(
               (select x.detail ->> 'cause' from ops_event x where x.kind = 'delivery.unknown' and x.subject_type = 'delivery' and x.subject_id = d.id::text order by x.id desc limit 1), 'unknown')
             else coalesce(d.provider_error_code::text, 'no_code')
           end as reason,
           count(*)::integer as n
    from delivery d
    where d.state in ('failed', 'undelivered', 'unknown')
    group by 1, 3, 4, 5
  ),
  resend_cells as (
    select (date_trunc('week', d.created_at at time zone 'America/Toronto'))::date as week_start,
           'resend'::text as section,
           (d.recipient_kind = 'roster') as is_drill,
           d.lang,
           'resend_' || split_part(d.idempotency_key, ':', 3) as reason,
           count(*)::integer as n
    from delivery d
    where d.idempotency_key ~ '^resend:[^:]+:[0-9]+$'
    group by 1, 3, 4, 5
  ),
  fallback_once as (
    select t.entry_id, t.lang, min(e.at) as at
    from ops_event e
    join alert_entry_translation t on t.entry_id = case when e.subject_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then e.subject_id::uuid end
    where e.kind = 'alert.translation_fallback' and t.status = 'fallback_en'
    group by t.entry_id, t.lang
  ),
  fallback_cells as (
    select (date_trunc('week', f.at at time zone 'America/Toronto'))::date as week_start,
           'translation_fallback'::text as section,
           a.is_drill,
           f.lang,
           null::text as reason,
           count(*)::integer as n
    from fallback_once f
    join alert_entry en on en.id = f.entry_id
    join alert a on a.id = en.alert_id
    group by 1, 3, 4
  ),
  slow_cells as (
    select (date_trunc('week', d.completed_at at time zone 'America/Toronto'))::date as week_start,
           'slow_delivery'::text as section,
           (d.recipient_kind = 'roster') as is_drill,
           d.lang,
           null::text as reason,
           count(*)::integer as n
    from delivery d
    where d.state = 'delivered' and d.handed_off_at is not null and d.completed_at > d.handed_off_at + interval '10 minutes'
    group by 1, 3, 4
  ),
  cells as (
    select * from problem_cells
    union all select * from resend_cells
    union all select * from fallback_cells
    union all select * from slow_cells
  ),
  ranked as (
    select c.*,
           (c.n between 1 and 4) as small,
           count(*) filter (where c.n between 1 and 4) over (partition by c.week_start, c.section, c.is_drill, c.reason) as small_cells,
           row_number() over (partition by c.week_start, c.section, c.is_drill, c.reason order by (c.n between 1 and 4), c.n, c.lang) as visible_rank
    from cells c
  ),
  counted as (
    select week_start, section, is_drill, lang, reason,
           case when small or (small_cells = 1 and visible_rank = 1) then null else n end as n,
           case when small or (small_cells = 1 and visible_rank = 1) then 'fewer than 5' else n::text end as n_shown
    from ranked
    union all
    select c.week_start, c.section, c.is_drill, null::text, c.reason,
           case when sum(c.n) between 1 and 4 then null else sum(c.n)::integer end,
           case when sum(c.n) between 1 and 4 then 'fewer than 5' else sum(c.n)::text end
    from cells c
    group by c.week_start, c.section, c.is_drill, c.reason
  ),
  -- Per entry and language, as messaging's entryTimings: the rows handed off (never cancelled, skipped or skipped_env) are the denominator.
  sent as (
    select d.entry_id, d.lang, d.handed_off_at, d.completed_at, d.state, (d.recipient_kind = 'roster') as drill
    from delivery d
    where d.kind = 'alert' and d.entry_id is not null and d.handed_off_at is not null and d.state not in ('cancelled', 'skipped', 'skipped_env')
  ),
  timing_by_lang as (
    select s.entry_id, s.lang, bool_or(s.drill) as is_drill,
           count(*)::integer as handed_off,
           (count(*) filter (where s.state = 'delivered' and s.completed_at is not null))::integer as delivered,
           min(s.handed_off_at) as first_hand_off,
           (array_agg(s.completed_at order by s.completed_at) filter (where s.state = 'delivered' and s.completed_at is not null)) as delivered_at
    from sent s
    group by s.entry_id, s.lang
  ),
  timing as (
    select (date_trunc('week', en.approved_at at time zone 'America/Toronto'))::date as week_start,
           'entry_timing'::text as section,
           (t.is_drill or a.is_drill) as is_drill,
           t.lang,
           t.entry_id,
           t.handed_off,
           t.delivered,
           extract(epoch from (t.first_hand_off - en.approved_at))::bigint as first_hand_off_seconds,
           case when t.delivered >= ceil(0.9 * t.handed_off)
             then extract(epoch from (t.delivered_at[ceil(0.9 * t.handed_off)::integer] - en.approved_at))::bigint end as ninety_percent_seconds,
           (t.delivered >= ceil(0.9 * t.handed_off)) as reached
    from timing_by_lang t
    join alert_entry en on en.id = t.entry_id
    join alert a on a.id = en.alert_id
    where en.approved_at is not null
  ),
  -- S03.09: a manual run of the search test set measured the evaluation subset below a minimum of the launch bar (`reason` is the measure, `lang`
  -- the language of a hit rate). One row per event; the week is the week of the run.
  search_below_bar as (
    select (date_trunc('week', e.at at time zone 'America/Toronto'))::date as week_start,
           'search_below_bar'::text as section,
           false as is_drill,
           e.detail ->> 'lang' as lang,
           e.detail ->> 'measure' as reason,
           e.at as started_at
    from ops_event e
    where e.kind = 'search.below_bar'
  )
select week_start, section, is_drill, lang, reason,
       null::uuid as entry_id,
       null::timestamptz as started_at, null::timestamptz as ended_at,
       null::bigint as duration_seconds, null::bigint as first_hand_off_seconds, null::bigint as ninety_percent_seconds,
       null::text as ninety_percent_status, null::integer as delivered_share_percent, null::integer as amount_cents,
       n, n_shown
from counted
union all
select week_start, section, is_drill, null, reason, null,
       started_at, ended_at, (extract(epoch from (ended_at - started_at)))::bigint, null, null, null, null, null, null, null
from health_episode
union all
select week_start, section, is_drill, null, reason, null,
       started_at, ended_at, (extract(epoch from (ended_at - started_at)))::bigint, null, null, null, null, null, null, null
from pause_episode
union all
select week_start, section, is_drill, null, reason, null, started_at, ended_at, null, null, null, null, null, amount_cents, null, null
from overrun
union all
select week_start, section, is_drill, null, reason, null, started_at, null, null, null, null, null, null, null, null, null
from publish_failure
union all
select week_start, section, is_drill, null, reason, null,
       started_at, ended_at, (extract(epoch from (coalesce(ended_at, now()) - started_at)))::bigint, null, null, null, null, null, null, null
from access_overdue
union all
select week_start, section, is_drill, lang, null, entry_id, null, null, null,
       first_hand_off_seconds,
       -- The 90% reading is a percentage of 1 to 4 texts when fewer than 5 were handed off, so it is not shown.
       case when handed_off between 1 and 4 then null else ninety_percent_seconds end,
       case when handed_off between 1 and 4 then null when reached then 'reached' else 'not reached' end,
       -- The delivered share only when not reached (reached means at least 90%), and never from a numerator or denominator of 1 to 4.
       case when reached or handed_off between 1 and 4 or delivered between 1 and 4 then null else floor(100.0 * delivered / handed_off)::integer end,
       null,
       case when handed_off between 1 and 4 then null else handed_off end,
       case when handed_off between 1 and 4 then 'fewer than 5' else handed_off::text end
from timing
union all
select week_start, section, is_drill, lang, reason, null, started_at, null, null, null, null, null, null, null, null, null
from search_below_bar;

revoke all on table weekly_review from public, anon, authenticated, service_role;
grant select on table weekly_review to cvh_app;
