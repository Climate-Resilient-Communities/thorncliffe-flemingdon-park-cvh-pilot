-- S06.08: what each text costs (AD-8, AD-2), owned by the spend module.
--
--  - `spend_event` gets the columns of a text message's estimate: the delivery it was made for (`delivery_id`, unique among the rows
--    that have one, so a delivery is counted once whatever calls the hook), its language, the alert entry (alerts only), whether it
--    went to the drill roster, its segments and the estimate in whole cents CAD (segments x the configured price per segment, rounded
--    up). The rows are still insert-only for the app: nothing about an estimate is ever updated. A text that is not accepted writes no
--    row, so a retried text is counted once, when the provider accepts it or its outcome becomes `unknown`.
--    Expand-only: every column is nullable, the new constraint is NOT VALID (the previous release writes only rows of other kinds, which
--    hold none of these columns), and no trigger is added to the table.
--  - `sms_reconciliation`: one row per reconciliation, by a stable id (`month:{YYYY-MM}`). Its interval is exact and stated in UTC: the
--    first instant of the Toronto calendar month to the first instant of the next, which a check recomputes from the id, so no row can
--    hold another. It is `pending` until a listing has completed with every message priced, and then `complete`, which never changes again.
--    A pending reconciliation records nothing but why it is pending and how often it was tried.
--  - `sms_actual`: the price the provider billed for one message, keyed by its MessageSid (unique across every reconciliation, so a
--    message is imported once), as the provider reported it, the rate it was converted at and the amount in thousandths of a cent CAD.
--    Insert-only. The trigger refuses an actual outside its reconciliation's interval.
--  - `sms_estimate_retirement`: which actual retired which estimate. An estimate is retired at most once (its id is the key) and an actual
--    retires at most one estimate (its MessageSid is unique); a row is never changed or removed, so what an actual retired stays retired.
--    Estimates and actuals are not changed to say so: an estimate that has a row here is no longer counted.
--
-- Who writes what: the app (cvh_app) reads and inserts, and changes only the reconciliation row's own columns. Supabase's default
-- privileges grant every new table to anon, authenticated and service_role, so each is taken back.

alter table spend_event
  add column delivery_id uuid,
  add column lang text,
  add column entry_id uuid,
  add column is_drill boolean,
  add column segments integer,
  add column cost_estimate_cents integer;

alter table spend_event add constraint spend_event_sms_shape check (
  (kind = 'sms'
    and delivery_id is not null and lang is not null and is_drill is not null
    and segments is not null and segments between 1 and 24
    and cost_estimate_cents is not null and cost_estimate_cents >= 0
    and purpose in ('alert', 'transactional', 'campaign')
    and (entry_id is not null) = (purpose = 'alert'))
  or (kind <> 'sms'
    and delivery_id is null and lang is null and entry_id is null and is_drill is null
    and segments is null and cost_estimate_cents is null)
) not valid;
alter table spend_event add constraint spend_event_lang_format check (lang is null or lang ~ '^[A-Za-z]{2,3}(-[A-Za-z]{2,8})?$') not valid;
-- One estimate per delivery: the hook may be called again (a replay, two paths to the same outcome) and still counts the text once.
create unique index spend_event_delivery_id_idx on spend_event (delivery_id) where delivery_id is not null;
-- The cost of an alert by language (S07.10) reads the estimates by entry.
create index spend_event_entry_id_idx on spend_event (entry_id) where entry_id is not null;

create table sms_reconciliation (
  id text primary key,
  interval_start timestamptz not null,
  interval_end timestamptz not null,
  state text not null default 'pending',
  pending_reason text,
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  usd_to_cad_rate numeric,
  messages integer,
  imported integer,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint sms_reconciliation_id_month check (id ~ '^month:[0-9]{4}-(0[1-9]|1[0-2])$'),
  -- The interval is the Toronto calendar month the id names, from its first instant to the first instant of the next, in UTC.
  constraint sms_reconciliation_interval_exact check (
    case
      when id ~ '^month:[0-9]{4}-(0[1-9]|1[0-2])$' then
        interval_start = (make_timestamp(substr(id, 7, 4)::int, substr(id, 12, 2)::int, 1, 0, 0, 0) at time zone 'America/Toronto')
        and interval_end = ((make_timestamp(substr(id, 7, 4)::int, substr(id, 12, 2)::int, 1, 0, 0, 0) + interval '1 month') at time zone 'America/Toronto')
      else false
    end
  ),
  constraint sms_reconciliation_state_valid check (state in ('pending', 'complete')),
  constraint sms_reconciliation_reason_valid check (
    pending_reason is null
    or pending_reason in ('listing_failed', 'cut_short', 'message_without_price', 'price_unusable', 'message_malformed')
  ),
  constraint sms_reconciliation_coherent check (
    (state = 'pending' and completed_at is null and messages is null and imported is null and usd_to_cad_rate is null)
    or (state = 'complete' and completed_at is not null and messages is not null and imported is not null and usd_to_cad_rate is not null and pending_reason is null)
  ),
  constraint sms_reconciliation_counts check (attempts >= 0 and (messages is null or messages >= 0) and (imported is null or (imported >= 0 and imported <= messages))),
  constraint sms_reconciliation_rate_positive check (usd_to_cad_rate is null or usd_to_cad_rate > 0)
);
alter table sms_reconciliation enable row level security;
revoke all on table sms_reconciliation from public, anon, authenticated, service_role;
grant select, insert on table sms_reconciliation to cvh_app;
grant update (state, pending_reason, attempts, last_attempt_at, usd_to_cad_rate, messages, imported, completed_at) on table sms_reconciliation to cvh_app;
create policy sms_reconciliation_app_select on sms_reconciliation for select to cvh_app using (true);
create policy sms_reconciliation_app_insert on sms_reconciliation for insert to cvh_app with check (true);
create policy sms_reconciliation_app_update on sms_reconciliation for update to cvh_app using (true) with check (true);

-- A complete reconciliation never changes, and a new one starts pending (it is completed in the transaction that imports its actuals).
create function sms_reconciliation_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.state <> 'pending' then
      raise exception 'sms_reconciliation: a reconciliation starts pending and is completed with its import' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if old.state = 'complete' then
    raise exception 'sms_reconciliation: a complete reconciliation never changes' using errcode = 'check_violation';
  end if;
  if new.id is distinct from old.id or new.interval_start is distinct from old.interval_start or new.interval_end is distinct from old.interval_end then
    raise exception 'sms_reconciliation: the id and the interval never change' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke all on function sms_reconciliation_guard() from public, anon, authenticated, service_role;
create trigger sms_reconciliation_guard before insert or update on sms_reconciliation for each row execute function sms_reconciliation_guard();

create table sms_actual (
  message_sid text primary key,
  reconciliation_id text not null references sms_reconciliation (id),
  sent_at timestamptz not null,
  price_text text not null,
  price_unit text not null,
  rate numeric not null,
  cad_millicents bigint not null,
  created_at timestamptz not null default now(),
  constraint sms_actual_sid_format check (message_sid ~ '^(SM|MM)[0-9a-f]{32}$'),
  constraint sms_actual_price_format check (price_text ~ '^-?[0-9]{1,9}(\.[0-9]{1,8})?$'),
  constraint sms_actual_unit_format check (price_unit ~ '^[A-Z]{3}$'),
  constraint sms_actual_rate_positive check (rate > 0),
  constraint sms_actual_cad_not_negative check (cad_millicents >= 0)
);
create index sms_actual_reconciliation_id_idx on sms_actual (reconciliation_id);
alter table sms_actual enable row level security;
revoke all on table sms_actual from public, anon, authenticated, service_role;
grant select, insert on table sms_actual to cvh_app;
create policy sms_actual_app_select on sms_actual for select to cvh_app using (true);
create policy sms_actual_app_insert on sms_actual for insert to cvh_app with check (true);

-- An actual belongs to the interval of the reconciliation that imports it, and only to one that is still pending.
create function sms_actual_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  recon public.sms_reconciliation%rowtype;
begin
  select * into recon from public.sms_reconciliation where id = new.reconciliation_id;
  if recon.id is null or recon.state <> 'pending' then
    raise exception 'sms_actual: an actual is imported by a pending reconciliation' using errcode = 'check_violation';
  end if;
  if new.sent_at < recon.interval_start or new.sent_at >= recon.interval_end then
    raise exception 'sms_actual: the message was sent outside the reconciliation''s interval' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke all on function sms_actual_guard() from public, anon, authenticated, service_role;
create trigger sms_actual_guard before insert on sms_actual for each row execute function sms_actual_guard();

create table sms_estimate_retirement (
  estimate_id bigint primary key references spend_event (id),
  message_sid text not null unique references sms_actual (message_sid),
  retired_at timestamptz not null default now()
);
alter table sms_estimate_retirement enable row level security;
revoke all on table sms_estimate_retirement from public, anon, authenticated, service_role;
grant select, insert on table sms_estimate_retirement to cvh_app;
create policy sms_estimate_retirement_app_select on sms_estimate_retirement for select to cvh_app using (true);
create policy sms_estimate_retirement_app_insert on sms_estimate_retirement for insert to cvh_app with check (true);

-- Only a text message's estimate is retired by a text message's actual.
create function sms_estimate_retirement_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.spend_event where id = new.estimate_id and kind = 'sms') then
    raise exception 'sms_estimate_retirement: only the estimate of a text message is retired by an actual' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke all on function sms_estimate_retirement_guard() from public, anon, authenticated, service_role;
create trigger sms_estimate_retirement_guard before insert on sms_estimate_retirement for each row execute function sms_estimate_retirement_guard();
