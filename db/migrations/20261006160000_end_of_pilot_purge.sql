-- S09.08: the pilot's resident data is deleted on schedule (FR-D-7, NFR-N5, AR-13; E09 definition "Campaign"; spine AD-9 D-7), owned by the subscriptions
-- module (AD-2).
--
-- After the real campaign's deadline (S09.07: `campaign.deadline`, the end of the Toronto day its text names, by the database's clock), the purge job
-- (`/api/jobs/end-of-pilot-purge`) deletes every subscriber still `reconsent_pending`, one transaction per subscriber, each with the full E07 deletion (the
-- subscriber's waiting texts skipped, its row locked and the state and the deadline checked again under the lock, check-ins, the row and the number's
-- `inbound_reply` rows deleted). This table is the purge's own record, one row for the real campaign:
--
--  - `deleted`: how many subscribers the purge has deleted, raised in the transaction of each deletion, so a purge that is interrupted and resumed counts
--    each subscriber once (no id is kept: a count only);
--  - `completed_at`: when the purge found no subscriber left to delete (the date the terms page states, S07.01), and `retained`: how many subscribers had
--    said YES and stayed at that moment, counted by the database. The aggregate `ops_event` `campaign.purge_completed` is written in the same transaction.
--
-- What the database refuses, whoever asks, in `campaign_purge_guard()`:
--  - a purge of a rehearsal, of a cancelled campaign, or before the campaign's deadline has passed by the database's clock;
--  - a change of the campaign or of when the purge began; a count that goes down;
--  - a completion while a `reconsent_pending` subscriber remains, a second completion, and any change after it. `completed_at` is the database's now() and
--    `retained` its own count, whatever the caller sends.
--
-- Additive only: a new table, its trigger function and its trigger. Supabase's default privileges grant every new relation to anon, authenticated and
-- service_role, so they are taken back.

create table campaign_purge (
  campaign_id uuid primary key references campaign (id),
  started_at timestamptz not null default now(),
  deleted integer not null default 0,
  completed_at timestamptz,
  retained integer,
  constraint campaign_purge_deleted_not_negative check (deleted >= 0),
  constraint campaign_purge_retained_not_negative check (retained is null or retained >= 0),
  constraint campaign_purge_completed_shape check ((completed_at is null) = (retained is null))
);
alter table campaign_purge enable row level security;
revoke all on table campaign_purge from public, anon, authenticated, service_role;
-- The app begins the purge, counts each deletion and records the completion; it never deletes the record.
grant select, insert on table campaign_purge to cvh_app;
grant update (deleted, completed_at, retained) on table campaign_purge to cvh_app;
create policy campaign_purge_app_select on campaign_purge for select to cvh_app using (true);
create policy campaign_purge_app_insert on campaign_purge for insert to cvh_app with check (true);
create policy campaign_purge_app_update on campaign_purge for update to cvh_app using (true) with check (true);

create function campaign_purge_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  run record;
begin
  if tg_op = 'INSERT' then
    select c.rehearsal, c.state, c.deadline into run from public.campaign c where c.id = new.campaign_id;
    if not found or run.rehearsal then
      raise exception 'campaign_purge: only the real campaign is purged' using errcode = 'check_violation';
    end if;
    if run.state = 'cancelled' then
      raise exception 'campaign_purge: a cancelled campaign is not purged' using errcode = 'check_violation';
    end if;
    if now() < run.deadline then
      raise exception 'campaign_purge: the purge begins once the campaign''s deadline has passed' using errcode = 'check_violation';
    end if;
    new.started_at := now();
    new.deleted := 0;
    new.completed_at := null;
    new.retained := null;
    return new;
  end if;

  if old.completed_at is not null then
    raise exception 'campaign_purge: a completed purge never changes' using errcode = 'check_violation';
  end if;
  if new.campaign_id is distinct from old.campaign_id or new.started_at is distinct from old.started_at then
    raise exception 'campaign_purge: the campaign and the start of its purge never change' using errcode = 'check_violation';
  end if;
  if new.deleted < old.deleted then
    raise exception 'campaign_purge: the count of deleted subscribers never goes down' using errcode = 'check_violation';
  end if;
  if new.completed_at is not null then
    -- After the deadline every `reconsent_pending` subscriber is one the purge deletes: none may remain.
    if exists (select 1 from public.subscriber s where s.retention_state = 'reconsent_pending') then
      raise exception 'campaign_purge: the purge completes once no subscriber is left to delete' using errcode = 'check_violation';
    end if;
    new.completed_at := now();
    new.retained := (select count(*) from public.subscriber s where s.retention_state = 'retained');
  else
    new.retained := null;
  end if;
  return new;
end
$$;
revoke all on function campaign_purge_guard() from public, anon, authenticated, service_role;

create trigger campaign_purge_guard before insert or update on campaign_purge
  for each row execute function campaign_purge_guard();
