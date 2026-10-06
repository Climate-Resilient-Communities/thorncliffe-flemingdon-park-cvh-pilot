-- S09.05: the pilot measures for the week-8 go / no-go review (FR-M1 to FR-M5, D-8, NFR-N9): the SQL views for the Section 9 measures that no earlier story
-- made. Views only: they create no table, so they add nothing to the spine's table ownership, and nothing here is destructive. They are read by the ops
-- module's measures export (scripts/export-measures), as the app's own role, and hold counts, times, codes, places and the ids of alerts and alert entries:
-- never a phone number, a subscriber or recipient id, a name or a message body.
--
-- The measures that exist already are read where they are: subscribers (S07.10's `subscriber_measures`), correction reach (`correction_reach` and S09.08's
-- `correction_reach_kept`), cost per alert (`alert_cost`, `cohere_alert_entry`, `cohere_alert_share`), total spend (S07.08's spend view, spend's
-- readSpendOverview), the approval timings (S04.07's `alert_approval_timing`) and the delivery times by language (S09.04's `weekly_review`, section
-- `entry_timing`). Coverage is identity's rule (`coversFloor`, the only coverage test, AD-12), read by the export through identity and places, not copied here.
--
-- These views give the counts by language and neighbourhood (and building and floor) as they are; the export applies the small-number rule (E09) to every
-- count and percentage it writes (src/modules/ops/domain/smallNumbers.ts), because some measures are added up only after the alerts sent for a rehearsal
-- (docs/procedures/rehearsals.md, S09.03's seam) are left out, and the translation survey is a file, not a table. The views are per alert entry, per week or
-- per place so that leaving an alert out never needs a figure the view already added up.
-- A drill is reported apart: `is_drill` is on every row about an alert and nothing is ever counted across it.
--
--   usage_week_count          S02.15's daily counts (installs, directory, listing, map, guide and numbers views) by week (the Monday, Toronto: usage_count's
--                             day is a Toronto date), event, page language and neighbourhood ('' for a page about neither).
--   search_measure            S03.04's search log by week (null: the pilot to date) and page language (null: every language): searches, those with no
--                             clear match, those that failed (unavailable or an error), and the median time of an answered search (ok or no clear match).
--   alert_delivery_timing     per approved alert entry, every language together: texts handed off (never cancelled, skipped or skipped_env), delivered, the
--                             seconds from approval to the first hand-off and to the moment delivered texts reach 90% of those handed off (null: not reached),
--                             the rules of messaging's entryTimings (S06.08) and of weekly_review's entry_timing, which has the same by language.
--   alert_translation_outcome per approved alert entry and translated language (S04.02): whether the language fell back to English.
--   checkin_round_count       S08.05's round tally (`checkin_tally`) of closed, non-drill threads, by building and floor, with the building's neighbourhood and
--                             address and the floor's label (null when the floor was removed since). After a close, for each place, `requested` is the sum
--                             of the outcomes (E08 "Round tally"). Counts only.
--   drill_measure             per drill thread with an approved entry: when its first entry was approved, the entries approved, and its texts to the drill
--                             roster (S06.05) handed off, delivered, undelivered or failed, of unknown outcome, and not sent.
--
-- Supabase's default privileges grant every new relation to anon, authenticated and service_role, so they are taken back. Every view is `security_invoker`,
-- as the other views are: the reader's own rights and RLS apply (cvh_app has select and policies on every table they read).

create view usage_week_count with (security_invoker = true) as
select (date_trunc('week', u.day))::date as week_start, u.evt, u.lang, u.nbhd, sum(u.n)::bigint as n
from usage_count u
group by 1, 2, 3, 4;

revoke all on table usage_week_count from public, anon, authenticated, service_role;
grant select on table usage_week_count to cvh_app;

create view search_measure with (security_invoker = true) as
select s.week_start,
       s.lang,
       count(*)::integer as searches,
       (count(*) filter (where s.status = 'no_clear_match'))::integer as no_clear_match,
       (count(*) filter (where s.status in ('unavailable', 'error')))::integer as failed,
       (percentile_cont(0.5) within group (order by s.ms) filter (where s.status in ('ok', 'no_clear_match')))::integer as median_ms
from (
  select (date_trunc('week', l.at at time zone 'America/Toronto'))::date as week_start, l.lang, l.status, l.ms
  from search_log l
) s
group by grouping sets ((s.week_start, s.lang), (s.week_start), (s.lang), ());

revoke all on table search_measure from public, anon, authenticated, service_role;
grant select on table search_measure to cvh_app;

create view alert_delivery_timing with (security_invoker = true) as
with
  sent as (
    select d.entry_id, d.handed_off_at, d.completed_at, d.state, (d.recipient_kind = 'roster') as roster
    from delivery d
    where d.kind = 'alert' and d.entry_id is not null and d.handed_off_at is not null and d.state not in ('cancelled', 'skipped', 'skipped_env')
  ),
  per_entry as (
    select s.entry_id, bool_or(s.roster) as roster,
           count(*)::integer as handed_off,
           (count(*) filter (where s.state = 'delivered' and s.completed_at is not null))::integer as delivered,
           min(s.handed_off_at) as first_hand_off,
           (array_agg(s.completed_at order by s.completed_at) filter (where s.state = 'delivered' and s.completed_at is not null)) as delivered_at
    from sent s
    group by s.entry_id
  )
select p.entry_id, e.alert_id, e.kind, (p.roster or a.is_drill) as is_drill, e.approved_at,
       p.handed_off, p.delivered,
       extract(epoch from (p.first_hand_off - e.approved_at))::bigint as first_hand_off_seconds,
       case when p.delivered >= ceil(0.9 * p.handed_off)
         then extract(epoch from (p.delivered_at[ceil(0.9 * p.handed_off)::integer] - e.approved_at))::bigint end as ninety_percent_seconds
from per_entry p
join alert_entry e on e.id = p.entry_id
join alert a on a.id = e.alert_id
where e.approved_at is not null;

revoke all on table alert_delivery_timing from public, anon, authenticated, service_role;
grant select on table alert_delivery_timing to cvh_app;

create view alert_translation_outcome with (security_invoker = true) as
select t.entry_id, e.alert_id, e.kind, a.is_drill, e.approved_at, t.lang, (t.status = 'fallback_en') as fell_back
from alert_entry_translation t
join alert_entry e on e.id = t.entry_id
join alert a on a.id = e.alert_id
where e.approved_at is not null;

revoke all on table alert_translation_outcome from public, anon, authenticated, service_role;
grant select on table alert_translation_outcome to cvh_app;

create view checkin_round_count with (security_invoker = true) as
select t.alert_id, a.closed_at, t.rsn, b.neighbourhood_id as nbhd, b.address, t.floor_id, f.label as floor_label, f.sort_order as floor_order, t.status, t.n
from checkin_tally t
join alert a on a.id = t.alert_id
join building b on b.rsn = t.rsn
left join building_floor f on f.id = t.floor_id
where a.status = 'closed' and not a.is_drill;

revoke all on table checkin_round_count from public, anon, authenticated, service_role;
grant select on table checkin_round_count to cvh_app;

create view drill_measure with (security_invoker = true) as
with
  approved as (
    select e.alert_id, min(e.approved_at) as first_approved_at, count(*)::integer as entries_approved
    from alert_entry e
    join alert a on a.id = e.alert_id
    where a.is_drill and e.approved_at is not null
    group by e.alert_id
  ),
  texts as (
    select r.alert_id,
           sum(r.handed_off)::integer as handed_off,
           sum(r.delivered)::integer as delivered,
           sum(r.undelivered + r.failed)::integer as not_delivered,
           sum(r.unknown)::integer as unknown,
           sum(r.not_sent)::integer as not_sent
    from drill_delivery_result r
    group by r.alert_id
  )
select p.alert_id, p.first_approved_at, p.entries_approved,
       coalesce(t.handed_off, 0) as handed_off, coalesce(t.delivered, 0) as delivered, coalesce(t.not_delivered, 0) as not_delivered,
       coalesce(t.unknown, 0) as unknown, coalesce(t.not_sent, 0) as not_sent
from approved p
left join texts t on t.alert_id = p.alert_id;

revoke all on table drill_measure from public, anon, authenticated, service_role;
grant select on table drill_measure to cvh_app;
