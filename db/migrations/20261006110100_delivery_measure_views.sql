-- S07.10: how far corrections, withdrawals and finals reached (FR-M4) and what each alert cost (FR-M5). Views only: they create no table, so they add nothing
-- to the spine's table ownership. `correction_reach` is read by messaging (its S06.08 delivery measures), `alert_cost`, `cohere_alert_entry` and `cohere_alert_share` by spend. Each
-- holds counts, amounts and the ids of alert entries (not personal data) and never a phone number, a subscriber or recipient id or a message body.
-- A drill is reported apart: `is_drill` is on every row and nothing is ever counted across it.
--
-- The small-number rule (E09) is applied here, as in `weekly_review`: a count of 1 to 4 is null with the text 'fewer than 5'; a percentage whose numerator or
-- denominator is 1 to 4 is null; and when a total and the visible cells of its group would reveal one hidden cell, the smallest visible cell of 5 or more is
-- hidden as well; that cell is not "fewer than 5" (it may be 5 or more), so it reads 'not shown'. Supabase's default privileges grant every new relation to anon, authenticated and service_role, so they are taken back; the views are
-- `security_invoker`, so the reader's own rights and RLS apply.
--
-- correction_reach: one row per correction, withdrawal or final that has texts to send, against the recipients of the original, with messaging's definitions
-- (S06.08, src/modules/messaging/domain/deliveryMeasures.ts):
--   original_recipients  the recipients the original had a text for, whatever became of the text. For a correction or a withdrawal the original is the entry
--                        it replaces (`supersedes_id`), for a final every other entry of its thread (S07.07: the final goes to all of them). A recipient deleted
--                        since has no id and cannot be matched, so is not counted.
--   attempted_reach      of them, the recipients whose text of this entry was handed to the provider (never `cancelled`, `skipped` or `skipped_env`).
--   confirmed_reach      of them, the recipients whose text of this entry is `delivered`.
-- A recipient is counted once. The shares are floor percentages of the original's recipients. The difference between two figures that are both shown is not
-- itself hidden: a reader may subtract (open for the owner).
--
-- alert_cost: per alert entry, drill flag and language, the texts counted in `spend_event` (kind `sms`, written when the provider accepts a text or its outcome is
-- ambiguous) and their cost: an estimate retired by an actual (S06.08) is counted at the actual, any other at its estimate, and `basis` says which ('actual' when
-- every text is, 'estimate' when none is, else 'mixed'). A row with `lang` null is the entry's total. Amounts: `actual_millicents` in thousandths of a cent CAD,
-- `estimate_cents` in whole cents CAD, `counted_millicents` their sum. A cell of fewer than 5 texts has no amount (the amount would give the count away).
-- Messages the provider billed that no estimate answers for belong to no alert, so they are in the month's report (smsMonthReport) and not here.
--
-- cohere_alert_entry: per alert entry, drill flag and Toronto month, the vendor calls and billed tokens made for that entry (purpose `alert`: the translation of
-- the alert at submit, whose `spend_event` rows carry the entry and its drill flag since 20261006110200), that entry's share of ALL the vendor's billed tokens of
-- the month, and its cost where every price is known. A price that is not known gives no amount: the usage stays in calls and tokens, shown as unknown. A drill
-- entry is a row of its own with `is_drill` true; nothing adds it to a real alert. Events written before the entry was recorded have none and are in the month's
-- figures only.
--
-- cohere_alert_share: per Toronto month, the vendor's calls and billed tokens (every `spend_event` that is not a text message), the part made for real alerts
-- (purpose `alert` and not a drill; an event without an entry is counted here, as it cannot be told) and the part made for drills, each with its share of the
-- month's tokens, and whether every price is known.

create view correction_reach with (security_invoker = true) as
with
  measured as (
    select e.id as entry_id, e.alert_id, e.kind, e.supersedes_id, e.approved_at, a.is_drill
    from alert_entry e
    join alert a on a.id = e.alert_id
    where e.kind in ('correction', 'withdrawal', 'final')
      and exists (select 1 from delivery d where d.entry_id = e.id and d.kind = 'alert')
  ),
  original as (
    select m.entry_id, d.recipient_id
    from measured m
    join alert_entry o on o.alert_id = m.alert_id and o.id <> m.entry_id and (m.kind = 'final' or o.id = m.supersedes_id)
    join delivery d on d.entry_id = o.id and d.kind = 'alert' and d.recipient_id is not null
    group by m.entry_id, d.recipient_id
  ),
  counts as (
    select m.entry_id, m.alert_id, m.kind, m.is_drill, m.approved_at,
           (select count(*) from original o where o.entry_id = m.entry_id)::integer as original_recipients,
           (select count(distinct d.recipient_id)
              from delivery d
              join original o on o.entry_id = m.entry_id and o.recipient_id = d.recipient_id
             where d.entry_id = m.entry_id and d.kind = 'alert' and d.handed_off_at is not null and d.state not in ('cancelled', 'skipped', 'skipped_env'))::integer as attempted,
           (select count(distinct d.recipient_id)
              from delivery d
              join original o on o.entry_id = m.entry_id and o.recipient_id = d.recipient_id
             where d.entry_id = m.entry_id and d.kind = 'alert' and d.state = 'delivered')::integer as confirmed
    from measured m
  )
select entry_id, alert_id, kind, is_drill, approved_at,
       case when original_recipients between 1 and 4 then null else original_recipients end as original_recipients,
       case when original_recipients between 1 and 4 then 'fewer than 5' else original_recipients::text end as original_recipients_shown,
       case when attempted between 1 and 4 then null else attempted end as attempted_reach,
       case when attempted between 1 and 4 then 'fewer than 5' else attempted::text end as attempted_reach_shown,
       case when confirmed between 1 and 4 then null else confirmed end as confirmed_reach,
       case when confirmed between 1 and 4 then 'fewer than 5' else confirmed::text end as confirmed_reach_shown,
       case when original_recipients = 0 or original_recipients between 1 and 4 or attempted between 1 and 4 then null
            else floor(100.0 * attempted / original_recipients)::integer end as attempted_percent,
       case when original_recipients = 0 or original_recipients between 1 and 4 or confirmed between 1 and 4 then null
            else floor(100.0 * confirmed / original_recipients)::integer end as confirmed_percent
from counts;

revoke all on table correction_reach from public, anon, authenticated, service_role;
grant select on table correction_reach to cvh_app;

create view alert_cost with (security_invoker = true) as
with
  cells as (
    select s.entry_id, s.is_drill, s.lang,
           count(*)::integer as texts,
           (count(r.estimate_id))::integer as actual_texts,
           coalesce(sum(a.cad_millicents), 0)::bigint as actual_millicents,
           coalesce(sum(s.cost_estimate_cents) filter (where r.estimate_id is null), 0)::integer as estimate_cents
    from spend_event s
    left join sms_estimate_retirement r on r.estimate_id = s.id
    left join sms_actual a on a.message_sid = r.message_sid
    where s.kind = 'sms' and s.entry_id is not null
    group by s.entry_id, s.is_drill, s.lang
  ),
  ranked as (
    select c.*,
           (c.texts between 1 and 4) as small,
           count(*) filter (where c.texts between 1 and 4) over (partition by c.entry_id, c.is_drill) as small_cells,
           row_number() over (partition by c.entry_id, c.is_drill order by (case when c.texts >= 5 then 0 else 1 end), c.texts, c.lang) as complement_rank
    from cells c
  ),
  totals as (
    select entry_id, is_drill, null::text as lang,
           sum(texts)::integer as texts, sum(actual_texts)::integer as actual_texts,
           sum(actual_millicents)::bigint as actual_millicents, sum(estimate_cents)::integer as estimate_cents
    from cells
    group by entry_id, is_drill
  ),
  everything as (
    select entry_id, is_drill, lang, texts, actual_texts, actual_millicents, estimate_cents,
           (small or (small_cells = 1 and complement_rank = 1 and texts >= 5)) as hidden, small
    from ranked
    union all
    select entry_id, is_drill, lang, texts, actual_texts, actual_millicents, estimate_cents, (texts between 1 and 4) as hidden, (texts between 1 and 4) as small from totals
  )
select x.entry_id, e.alert_id, e.kind, e.approved_at, x.is_drill, x.lang,
       case when x.hidden then null else x.texts end as texts,
       case when not x.hidden then x.texts::text when x.small then 'fewer than 5' else 'not shown' end as texts_shown,
       case when x.hidden then null
            when x.actual_texts = x.texts then 'actual'
            when x.actual_texts = 0 then 'estimate'
            else 'mixed' end as basis,
       case when x.hidden then null else x.actual_millicents end as actual_millicents,
       case when x.hidden then null else x.estimate_cents end as estimate_cents,
       case when x.hidden then null else x.actual_millicents + x.estimate_cents::bigint * 1000 end as counted_millicents
from everything x
join alert_entry e on e.id = x.entry_id;

revoke all on table alert_cost from public, anon, authenticated, service_role;
grant select on table alert_cost to cvh_app;

create view cohere_alert_share with (security_invoker = true) as
select (date_trunc('month', s.at at time zone 'America/Toronto'))::date as month,
       sum(s.calls)::bigint as all_calls,
       (coalesce(sum(s.calls) filter (where s.purpose = 'alert' and s.is_drill is not true), 0))::bigint as alert_calls,
       (coalesce(sum(s.calls) filter (where s.purpose = 'alert' and s.is_drill), 0))::bigint as drill_calls,
       sum(s.tokens)::bigint as all_tokens,
       (coalesce(sum(s.tokens) filter (where s.purpose = 'alert' and s.is_drill is not true), 0))::bigint as alert_tokens,
       (coalesce(sum(s.tokens) filter (where s.purpose = 'alert' and s.is_drill), 0))::bigint as drill_tokens,
       case when sum(s.tokens) > 0 then floor(100.0 * coalesce(sum(s.tokens) filter (where s.purpose = 'alert' and s.is_drill is not true), 0) / sum(s.tokens))::integer end as alert_token_share_percent,
       case when sum(s.tokens) > 0 then floor(100.0 * coalesce(sum(s.tokens) filter (where s.purpose = 'alert' and s.is_drill), 0) / sum(s.tokens))::integer end as drill_token_share_percent,
       bool_or(s.tokens_estimated) as tokens_estimated,
       bool_and(s.price_per_million_tokens_cad is not null) as price_known,
       case when bool_and(s.price_per_million_tokens_cad is not null)
            then round(sum(s.tokens * s.price_per_million_tokens_cad) * 100 / 1000000, 3) end as all_cost_cents,
       case when coalesce(bool_and(s.price_per_million_tokens_cad is not null) filter (where s.purpose = 'alert' and s.is_drill is not true), true)
            then round(coalesce(sum(s.tokens * s.price_per_million_tokens_cad) filter (where s.purpose = 'alert' and s.is_drill is not true), 0) * 100 / 1000000, 3) end as alert_cost_cents,
       case when coalesce(bool_and(s.price_per_million_tokens_cad is not null) filter (where s.purpose = 'alert' and s.is_drill), true)
            then round(coalesce(sum(s.tokens * s.price_per_million_tokens_cad) filter (where s.purpose = 'alert' and s.is_drill), 0) * 100 / 1000000, 3) end as drill_cost_cents
from spend_event s
where s.kind <> 'sms'
group by 1;

revoke all on table cohere_alert_share from public, anon, authenticated, service_role;
grant select on table cohere_alert_share to cvh_app;

create view cohere_alert_entry with (security_invoker = true) as
with
  month_tokens as (
    select (date_trunc('month', s.at at time zone 'America/Toronto'))::date as month, sum(s.tokens)::bigint as tokens
    from spend_event s
    where s.kind <> 'sms'
    group by 1
  ),
  per_entry as (
    select s.entry_id, s.is_drill, (date_trunc('month', s.at at time zone 'America/Toronto'))::date as month,
           sum(s.calls)::bigint as calls, sum(s.tokens)::bigint as tokens,
           bool_or(s.tokens_estimated) as tokens_estimated,
           bool_and(s.price_per_million_tokens_cad is not null) as price_known,
           sum(s.tokens * s.price_per_million_tokens_cad) as amount
    from spend_event s
    where s.kind <> 'sms' and s.purpose = 'alert' and s.entry_id is not null
    group by s.entry_id, s.is_drill, 3
  )
select p.entry_id, e.alert_id, e.kind, e.approved_at, p.is_drill, p.month,
       p.calls, p.tokens, m.tokens as month_tokens,
       case when m.tokens > 0 then floor(100.0 * p.tokens / m.tokens)::integer end as token_share_percent,
       p.tokens_estimated, p.price_known,
       case when p.price_known then round(p.amount * 100 / 1000000, 3) end as cost_cents
from per_entry p
join alert_entry e on e.id = p.entry_id
join month_tokens m on m.month = p.month;

revoke all on table cohere_alert_entry from public, anon, authenticated, service_role;
grant select on table cohere_alert_entry to cvh_app;
