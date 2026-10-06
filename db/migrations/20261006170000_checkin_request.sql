-- S08.05: a subscribed resident asks for a check-in (E08 definitions "Check-in request", "Request during sign-up", "Round", "Closed stub", "Round
-- tally", AD-12, AD-13, AD-18). The rounds' tables are the checkins module's (AD-2); the request itself is on subscriptions' rows; the round types
-- are places'.
--
--  - `disruption_type.checkin`: the round types (pilot: heat and power). S08.06 lets an Admin change them; until then the app only reads them.
--  - The request (`subscriber`): `checkin_method` (`call` or `text`), the "where I live" place it is on (`where_i_live_rsn` and
--    `where_i_live_floor_id`: one of the subscriber's saved places, which must have a floor; the app checks that it is one of the
--    `subscriber_place` rows, in the transaction that writes both) and the version of the check-in consent wording the resident confirmed
--    (`checkin_consent_version`; `consent_version` stays the terms'). All four are set together or are all null: a withdrawn request keeps
--    nothing, so asking again needs the consent again. The floor has no foreign key: an Admin's removal of a floor never fails on a request
--    (the request then names a floor nobody covers, which the coverage view counts so the Hub can contact the resident). Personal data as the
--    rest of the row (AD-13), deleted with it.
--  - A request made during sign-up (`pending_signup`, the same four columns) waits there until YES and is activated then only if the floor is
--    still covered. Its place must be one of the sign-up's places with that floor (checked here on the JSON the form sent).
--  - `checkin`: one row per round thread and requester, `(round_ref, alert_id, subscriber_id, rsn, floor_id, method, status)`, never a phone
--    number. `round_ref` is a random UUID (version 4, checked: never derived from the subscriber, a time or a place), the only name the round
--    page and marks use. A row is live while it names its subscriber; when it leaves the round (withdrawal, deletion, a change of where the
--    resident lives, and later a close) its outcome is recorded once (`outcome`, `tallied_at`: the latest mark, else `withdrawn` or
--    `unmarked`) and it becomes a closed stub (`subscriber_id` and `method` null, `closed_at` set), which holds no resident data and is deleted
--    2 hours later by the purge job below. S08.08's rows kept after a close for the Hub's follow-up are tallied and keep their subscriber
--    until they become stubs, without being counted again. `subscriber_id` is ON DELETE CASCADE only as a backstop: the deletion turns the
--    rows into stubs first (checkins' `deleteForSubscriber`). A drill thread, or a closed one, never gets a row (insert guard).
--  - `checkin_tally`: counts per `(alert_id, rsn, floor_id, status)`. Kept by a trigger on `checkin` in the statement's own transaction, after
--    the row (AD-18's order: `checkin`, then `checkin_tally`): +1 `requested` when a row is made, never taken back, and +1 of the row's
--    outcome when it is tallied, once. So after a close, for each place, `requested` is the sum of the outcomes. No identifier of anyone.
--
-- The app may read and add rows and change only what a round changes; a guard keeps the rest as written. The tally is written by its trigger
-- alone (the app reads it). New tables, new columns, new checks NOT VALID: nothing here is destructive. Supabase's default privileges grant
-- every new table to anon, authenticated and service_role, so each is taken back.

alter table disruption_type add column checkin boolean not null default false;
update disruption_type set checkin = true where id in ('heat', 'power');

-- NOT VALID: the columns are new, so every existing row has them null and already passes; the checks apply to every row written from now on.
alter table subscriber
  add column checkin_method text,
  add column checkin_consent_version text,
  add column where_i_live_rsn text references building (rsn),
  add column where_i_live_floor_id uuid;
alter table subscriber
  add constraint subscriber_checkin_method_known check (checkin_method is null or checkin_method in ('call', 'text')) not valid,
  add constraint subscriber_checkin_consent_version_format check (checkin_consent_version is null or checkin_consent_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[1-9][0-9]*$') not valid,
  add constraint subscriber_checkin_request_whole check (
    (checkin_method is null and checkin_consent_version is null and where_i_live_rsn is null and where_i_live_floor_id is null)
    or (checkin_method is not null and checkin_consent_version is not null and where_i_live_rsn is not null and where_i_live_floor_id is not null)
  ) not valid;
create index subscriber_where_i_live_idx on subscriber (where_i_live_rsn, where_i_live_floor_id) where checkin_method is not null;
grant update (checkin_method, checkin_consent_version, where_i_live_rsn, where_i_live_floor_id) on table subscriber to cvh_app;

alter table pending_signup
  add column checkin_method text,
  add column checkin_consent_version text,
  add column where_i_live_rsn text,
  add column where_i_live_floor_id uuid;
alter table pending_signup
  add constraint pending_signup_checkin_method_known check (checkin_method is null or checkin_method in ('call', 'text')) not valid,
  add constraint pending_signup_checkin_consent_version_format check (checkin_consent_version is null or checkin_consent_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[1-9][0-9]*$') not valid,
  add constraint pending_signup_checkin_request_whole check (
    (checkin_method is null and checkin_consent_version is null and where_i_live_rsn is null and where_i_live_floor_id is null)
    or (checkin_method is not null and checkin_consent_version is not null and where_i_live_rsn is not null and where_i_live_floor_id is not null)
  ) not valid,
  add constraint pending_signup_where_i_live_saved check (
    where_i_live_rsn is null
    or places @> jsonb_build_array(jsonb_build_object('rsn', where_i_live_rsn, 'floors', jsonb_build_array(where_i_live_floor_id::text)))
  ) not valid;

create table checkin (
  id uuid primary key,
  round_ref uuid not null default gen_random_uuid(),
  alert_id uuid not null references alert (id),
  subscriber_id uuid references subscriber (id) on delete cascade,
  rsn text not null references building (rsn),
  floor_id uuid not null,
  method text,
  status text not null default 'pending',
  outcome text,
  created_at timestamptz not null default now(),
  tallied_at timestamptz,
  closed_at timestamptz,
  constraint checkin_round_ref_random check (substr(round_ref::text, 15, 1) = '4'),
  constraint checkin_method_known check (method is null or method in ('call', 'text')),
  constraint checkin_status_known check (status in ('pending', 'done', 'not_reached', 'needs_help')),
  constraint checkin_outcome_known check (outcome is null or outcome in ('done', 'not_reached', 'needs_help', 'withdrawn', 'unmarked')),
  -- The outcome is the row's latest mark, or `withdrawn` or `unmarked` when it has none; it is recorded once, with the time.
  constraint checkin_outcome_of_mark check (
    outcome is null or (status = 'pending' and outcome in ('withdrawn', 'unmarked')) or (status <> 'pending' and outcome = status)
  ),
  constraint checkin_tallied_with_outcome check ((outcome is null) = (tallied_at is null)),
  -- Live (or kept for the Hub's follow-up): it names its subscriber and method. A stub: nothing about anyone, tallied, closed.
  constraint checkin_live_or_stub check (
    (closed_at is null and subscriber_id is not null and method is not null)
    or (closed_at is not null and subscriber_id is null and method is null and tallied_at is not null)
  )
);
create unique index checkin_round_ref_idx on checkin (round_ref);
create unique index checkin_alert_subscriber_idx on checkin (alert_id, subscriber_id);
create index checkin_subscriber_id_idx on checkin (subscriber_id);
create index checkin_rsn_idx on checkin (rsn);
create index checkin_closed_at_idx on checkin (closed_at);
alter table checkin enable row level security;
revoke all on table checkin from public, anon, authenticated, service_role;
grant select, insert on table checkin to cvh_app;
grant update (subscriber_id, method, status, outcome, tallied_at, closed_at) on table checkin to cvh_app;
create policy checkin_app_select on checkin for select to cvh_app using (true);
create policy checkin_app_insert on checkin for insert to cvh_app with check (true);
create policy checkin_app_update on checkin for update to cvh_app using (true) with check (true);

create table checkin_tally (
  alert_id uuid not null references alert (id),
  rsn text not null,
  floor_id uuid not null,
  status text not null,
  n integer not null,
  primary key (alert_id, rsn, floor_id, status),
  constraint checkin_tally_status_known check (status in ('requested', 'done', 'not_reached', 'needs_help', 'withdrawn', 'unmarked')),
  constraint checkin_tally_n_positive check (n > 0)
);
alter table checkin_tally enable row level security;
revoke all on table checkin_tally from public, anon, authenticated, service_role;
grant select on table checkin_tally to cvh_app;
create policy checkin_tally_app_select on checkin_tally for select to cvh_app using (true);

-- A new row is a live, unmarked row of an open, non-drill thread (AD-6, AD-10: no drill check-ins; AD-18: a closed thread gets nothing).
create function checkin_insert_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  thread record;
begin
  if new.status <> 'pending' or new.outcome is not null or new.tallied_at is not null or new.closed_at is not null or new.subscriber_id is null then
    raise exception 'checkin: a new row is live and unmarked' using errcode = 'check_violation';
  end if;
  select a.status, a.is_drill into thread from public.alert a where a.id = new.alert_id;
  if thread.is_drill then
    raise exception 'checkin: a drill thread has no check-in round' using errcode = 'check_violation';
  end if;
  if thread.status <> 'open' then
    raise exception 'checkin: a closed thread gets no check-in row' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke all on function checkin_insert_guard() from public, anon, authenticated, service_role;
create trigger checkin_insert_guard before insert on checkin for each row execute function checkin_insert_guard();

-- What a row is never changes (its round, place and name in the round); it leaves its subscriber once and for all; its outcome is recorded
-- once; a stub never changes again; a method changes only while the row is live.
create function checkin_update_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.round_ref is distinct from old.round_ref or new.alert_id is distinct from old.alert_id
     or new.rsn is distinct from old.rsn or new.floor_id is distinct from old.floor_id or new.created_at is distinct from old.created_at then
    raise exception 'checkin: a row''s round, place and round_ref never change' using errcode = 'check_violation';
  end if;
  if old.closed_at is not null then
    raise exception 'checkin: a closed stub never changes' using errcode = 'check_violation';
  end if;
  if new.subscriber_id is not null and new.subscriber_id is distinct from old.subscriber_id then
    raise exception 'checkin: a row only ever leaves its subscriber' using errcode = 'check_violation';
  end if;
  if old.tallied_at is not null and (new.tallied_at is distinct from old.tallied_at or new.outcome is distinct from old.outcome or new.status is distinct from old.status) then
    raise exception 'checkin: a row is tallied once' using errcode = 'check_violation';
  end if;
  if old.subscriber_id is not null and new.subscriber_id is not null and new.method is distinct from old.method and old.tallied_at is not null then
    raise exception 'checkin: only a live row''s method changes' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke all on function checkin_update_guard() from public, anon, authenticated, service_role;
create trigger checkin_update_guard before update on checkin for each row execute function checkin_update_guard();

-- The round tally (E08 "Round tally"), in the statement's transaction, as the table's owner (the app only reads the counts).
create function checkin_tally_count() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  counted text;
begin
  if tg_op = 'INSERT' then
    counted := 'requested';
  elsif old.tallied_at is null and new.tallied_at is not null then
    counted := new.outcome;
  else
    return null;
  end if;
  insert into public.checkin_tally as t (alert_id, rsn, floor_id, status, n)
  values (new.alert_id, new.rsn, new.floor_id, counted, 1)
  on conflict (alert_id, rsn, floor_id, status) do update set n = t.n + 1;
  return null;
end
$$;
revoke all on function checkin_tally_count() from public, anon, authenticated, service_role;
create trigger checkin_tally_requested after insert on checkin for each row execute function checkin_tally_count();
create trigger checkin_tally_outcome after update of tallied_at on checkin for each row execute function checkin_tally_count();

-- The purge (pg_cron, every 15 minutes, as the table's owner): closed stubs 2 hours after they were closed (E08 "Closed stub"). Scheduling by
-- name replaces the job if it exists.
select cron.schedule(
  'checkins-purge-stubs',
  '*/15 * * * *',
  $job$
    delete from public.checkin where closed_at <= now() - interval '2 hours';
  $job$
);
