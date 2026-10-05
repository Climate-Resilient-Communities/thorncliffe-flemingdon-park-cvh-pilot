-- S07.10: the Hub counts subscribers (FR-M1, subscribers): the daily measures of who is receiving texts, who is waiting to confirm, and how many people
-- confirmed or left each day. Counts only, no identifier (AD-13), by language and neighbourhood; a group of fewer than 5 is shown as "fewer than 5".
--
-- Two tables of the subscriptions module (AD-2) and one view:
--
--  - `subscriber_event_count`: how many subscribers were made (`confirmed`: a number replied YES, or a staff-assisted sign-up was confirmed) and how many
--    were deleted (`deleted`: STOP, a confirmed reply 0, the edit link, the end of the pilot) on each day (a Toronto date, never a time) by language and
--    neighbourhood. A deletion removes the row, so nothing could count it afterwards: a trigger on `subscriber` counts both, in the statement's own
--    transaction, so every way a subscriber is made or removed (the inbound router, the staff-assisted sign-up, the edit link, the end-of-pilot
--    deletion) is counted without each of them being told to. The trigger function runs as the table's owner (the app role may only read the counts),
--    and keeps nothing of the row but its language and neighbourhood.
--  - `subscriber_measure`: what the daily job stores for a day: receiving subscribers by state (`receiving_active`, `receiving_reconsent_pending`,
--    `receiving_retained`, the E07 definition of receiving), pending sign-ups that have not expired, and that day's confirmations and deletions, for every
--    launch language in every neighbourhood (a combination with none is stored as 0, so a re-run never leaves an old figure behind). A row is a day, a
--    measure, a language, a neighbourhood and a count. No identifier of any kind.
--  - `subscriber_measures` (view): what the Hub shows. Per day and measure, the counts by language and by neighbourhood and the total, with the small-number
--    rule (E09): a count of 1 to 4 is `n` null and `n_shown` 'fewer than 5'; and when a total and the visible cells of its split would reveal one hidden
--    cell, the smallest visible cell of 5 or more is hidden as well (a split with two hidden cells reveals neither; zero is shown as 0 and is never the
--    cell hidden for this, since a reader who knows the rule would then read the hidden total as the small cell). A drill reaches the drill roster, not a
--    subscriber, so no drill is in these counts.
--
-- Supabase's default privileges grant every new relation to anon, authenticated and service_role, so they are taken back. The view is `security_invoker`,
-- as the other views are: the reader's own rights and RLS apply.

create table subscriber_event_count (
  day date not null,
  event text not null,
  lang text not null,
  nbhd text not null,
  n integer not null default 1,
  primary key (day, event, lang, nbhd),
  constraint subscriber_event_count_event_known check (event in ('confirmed', 'deleted')),
  constraint subscriber_event_count_lang_known check (lang ~ '^[A-Za-z]{2,3}(-[A-Za-z]{4})?$'),
  constraint subscriber_event_count_nbhd_format check (nbhd ~ '^[A-Za-z0-9_]{1,16}$'),
  constraint subscriber_event_count_n_positive check (n > 0)
);
alter table subscriber_event_count enable row level security;
revoke all on table subscriber_event_count from public, anon, authenticated, service_role;
grant select on table subscriber_event_count to cvh_app;
create policy subscriber_event_count_app_select on subscriber_event_count for select to cvh_app using (true);

create function subscriber_count_event() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  counted record;
begin
  if tg_op = 'INSERT' then
    counted := new;
  else
    counted := old;
  end if;
  insert into public.subscriber_event_count as c (day, event, lang, nbhd)
  values ((now() at time zone 'America/Toronto')::date, case when tg_op = 'INSERT' then 'confirmed' else 'deleted' end, counted.lang, counted.neighbourhood_id)
  on conflict (day, event, lang, nbhd) do update set n = c.n + 1;
  return null;
end
$$;
revoke all on function subscriber_count_event() from public, anon, authenticated, service_role;

create trigger subscriber_count_confirmed after insert on subscriber for each row execute function subscriber_count_event();
create trigger subscriber_count_deleted after delete on subscriber for each row execute function subscriber_count_event();

create table subscriber_measure (
  day date not null,
  measure text not null,
  lang text not null,
  nbhd text not null,
  n integer not null,
  primary key (day, measure, lang, nbhd),
  constraint subscriber_measure_measure_known check (measure in
    ('receiving_active', 'receiving_reconsent_pending', 'receiving_retained', 'pending_signups', 'confirmations', 'deletions')),
  constraint subscriber_measure_lang_known check (lang ~ '^[A-Za-z]{2,3}(-[A-Za-z]{4})?$'),
  constraint subscriber_measure_nbhd_format check (nbhd ~ '^[A-Za-z0-9_]{1,16}$'),
  constraint subscriber_measure_n_not_negative check (n >= 0)
);
alter table subscriber_measure enable row level security;
revoke all on table subscriber_measure from public, anon, authenticated, service_role;
grant select, insert on table subscriber_measure to cvh_app;
grant update (n) on table subscriber_measure to cvh_app;
create policy subscriber_measure_app_select on subscriber_measure for select to cvh_app using (true);
create policy subscriber_measure_app_insert on subscriber_measure for insert to cvh_app with check (true);
create policy subscriber_measure_app_update on subscriber_measure for update to cvh_app using (true) with check (true);

create view subscriber_measures with (security_invoker = true) as
with
  cells as (
    select day, measure, 'language'::text as split, lang as key, sum(n)::integer as n from subscriber_measure group by day, measure, lang
    union all
    select day, measure, 'neighbourhood'::text, nbhd, sum(n)::integer from subscriber_measure group by day, measure, nbhd
  ),
  ranked as (
    select c.*,
           (c.n between 1 and 4) as small,
           count(*) filter (where c.n between 1 and 4) over (partition by c.day, c.measure, c.split) as small_cells,
           -- The smallest visible cell of 5 or more comes first; a zero is never the cell hidden for the sake of another.
           row_number() over (partition by c.day, c.measure, c.split order by (case when c.n >= 5 then 0 else 1 end), c.n, c.key) as complement_rank
    from cells c
  ),
  shown as (
    select r.day, r.measure, r.split, r.key,
           (r.small or (r.small_cells = 1 and r.complement_rank = 1 and r.n >= 5)) as hidden,
           r.n
    from ranked r
  )
select day, measure, split, key,
       case when hidden then null else n end as n,
       case when hidden then 'fewer than 5' else n::text end as n_shown
from shown
union all
select day, measure, split, null::text,
       case when sum(n) between 1 and 4 then null else sum(n)::integer end,
       case when sum(n) between 1 and 4 then 'fewer than 5' else sum(n)::text end
from cells
group by day, measure, split;

revoke all on table subscriber_measures from public, anon, authenticated, service_role;
grant select on table subscriber_measures to cvh_app;
