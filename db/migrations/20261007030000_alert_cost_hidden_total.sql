-- Review fix (S07.10's `alert_cost`, read by S09.05's export): an entry's total no longer gives away the language cells the small-number rule hid.
--
-- In 20261006110100 a hidden language cell had no count and no amount, but the entry's total kept both. With two cells hidden (one of 1 to 4 texts and the
-- smallest visible one hidden with it), the total less the visible cells left the two hidden cells' combined count and combined cost: two equations that a
-- reader who knows each language's price per text (its segments) can solve for each count. For example en 50, sk 3 and pa 20: sk is "fewer than 5", pa is
-- "not shown", and 73 texts with the total's cost less en's give sk's 3 and pa's 20 when sk's texts cost more segments than pa's.
--
-- Now, when any language cell of an entry (and drill flag) is hidden, the entry's total is hidden as well: no count (`texts` null, `texts_shown` 'not shown',
-- or 'fewer than 5' when the total itself is 1 to 4), no basis and no amount. An entry whose language cells are all shown keeps its total as before.
--
-- The view keeps its name, columns, column types and order, `security_invoker` and grants (create or replace keeps the grants; they are stated again), so
-- the release before this one reads it unchanged: it already reads a total with no count or amount (an entry of fewer than 5 texts has one).

create or replace view alert_cost with (security_invoker = true) as
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
  languages as (
    select entry_id, is_drill, lang, texts, actual_texts, actual_millicents, estimate_cents,
           (small or (small_cells = 1 and complement_rank = 1 and texts >= 5)) as hidden, small
    from ranked
  ),
  totals as (
    select entry_id, is_drill, null::text as lang,
           sum(texts)::integer as texts, sum(actual_texts)::integer as actual_texts,
           sum(actual_millicents)::bigint as actual_millicents, sum(estimate_cents)::integer as estimate_cents,
           bool_or(hidden) as language_hidden
    from languages
    group by entry_id, is_drill
  ),
  everything as (
    select entry_id, is_drill, lang, texts, actual_texts, actual_millicents, estimate_cents, hidden, small
    from languages
    union all
    select entry_id, is_drill, lang, texts, actual_texts, actual_millicents, estimate_cents,
           ((texts between 1 and 4) or language_hidden) as hidden, (texts between 1 and 4) as small
    from totals
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
