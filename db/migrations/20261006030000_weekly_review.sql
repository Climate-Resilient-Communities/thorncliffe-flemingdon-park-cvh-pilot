-- S09.04: the weekly reliability review (NFR-N4, AR-21 weekly view, AR-18): one SQL view, `weekly_review`, over `ops_event`, `delivery`, `audit_event`
-- and (for the language of a translation fallback, the entry's drill flag and its approval) `alert_entry_translation`, `alert_entry` and `alert`.
-- A view creates no table, so it adds nothing to the spine's table ownership; it is read by the ops module's weekly review (the export script) and
-- by an Admin or Director with the app's own role. The pilot has no screen for it (deferred to the MVP): `scripts/export-weekly` writes it as a CSV.
--
-- One row is one line of the review, tagged by `section` and `week_start` (the Monday of the week in America/Toronto; a week is Monday 00:00 to Sunday
-- 23:59 Toronto time). Ongoing episodes are listed only in the week they began, and events outside the sections above (callback_ignored, search.unavailable and
-- the like) are in no section: a deliberate gap, open for the owner. Sections:
--   health_condition        one row per episode of a health condition (`reason` is the condition's code): `started_at`, `ended_at` (null while it still
--                           holds) and `duration_seconds`. An episode begins at `health.condition_alerted` with `first` and ends at the next
--                           `health.condition_recovered` of the same condition. The week is the week it began.
--   delivery_problem        failed, undelivered and unknown texts by language and reason (`unknown:{cause}`, `undelivered:{provider error code}`,
--                           `failed:{provider error code | no_code}`), with a total row per reason (`lang` null).
--   resend                  resends (deliveries keyed `resend:{root}:{n}`, S09.02) by language and reason (`resend_1`, `resend_2`), with a total row.
--   pause                   one row per pause of all texts (`sending.paused` to the next `sending.resumed`, in the audit trail): start, end, duration.
--   cap_overrun             one row per spending cap overrun (`spend.cap_overrun`): `amount_cents` is by how much the cap was passed.
--   translation_fallback    alert entries whose language fell back to English, by language (with a total row), counted once per entry and language.
--   publish_failure         one row per failed directory publish (`reason` is its code).
--   entry_timing            per alert entry and language: texts handed off (`n`), the seconds from approval to the first hand-off, to the moment delivered
--                           texts reach 90% of those handed off (or `ninety_percent_status` 'not reached', with the delivered share), the same rule as
--                           messaging's entryTimings (S06.08).
--   slow_delivery           texts delivered more than 10 minutes after they were handed to the provider, by language (with a total row).
--   access_request_overdue  one row per access request (audit actions `access_request.received` and `access_request.closed`, S09.03) for each week
--                           in which it was open for longer than 25 days (the 30-day limit is PIPEDA's).
-- A drill is reported apart: `is_drill` is on every row and nothing is ever counted across it (a delivery to the drill roster, an entry of a drill thread, an
-- audit record of a drill).
--
-- The small-number rule (E09): a count of 1 to 4 in a language is `n` null and `n_shown` 'fewer than 5'; a percentage (the delivered share) whose numerator or
-- denominator is 1 to 4 is null; and when a total and the visible cells of its group would reveal one hidden cell, the smallest visible cell is hidden as
-- well (a group with two hidden cells reveals neither). Zero is shown as 0. Times and durations are not counts and are always shown.
--
-- No personal data: the view reads no phone number, no subscriber or recipient id and no message body. Its rows hold codes, counts, times and the ids of alert
-- entries. Supabase's default privileges grant every new relation to anon, authenticated and service_role, so they are taken back. The view is
-- `security_invoker`, as the other views are: the reader's own rights and RLS apply (cvh_app has select and policies on every table it reads).
-- Rules shared with messaging's entryTimings (S06.08, src/modules/messaging/domain/deliveryMeasures.ts): the hand-off denominator and ceil(0.9 * n).
-- The view reads all history on every read (window functions keep the week filter from being pushed in); accepted at pilot scale.

create view weekly_review with (security_invoker = true) as
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
from timing;

revoke all on table weekly_review from public, anon, authenticated, service_role;
grant select on table weekly_review to cvh_app;
