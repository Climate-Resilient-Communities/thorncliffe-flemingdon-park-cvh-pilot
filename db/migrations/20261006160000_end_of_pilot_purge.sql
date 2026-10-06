-- S09.08: the pilot's resident data is deleted on schedule (FR-D-7, NFR-N5, AR-13; E09 definition "Campaign"; spine AD-9 D-7), owned by the subscriptions
-- module (AD-2).
--
-- After the real campaign's deadline (S09.07: `campaign.deadline`, the end of the Toronto day its text names, by the database's clock) and once the end job
-- has ended it (S09.07's `campaign.ended` audit then holds its counts of who stayed and who did not reply, taken before anyone is deleted), the purge job
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
--  - a purge of a rehearsal, of a cancelled campaign, before the campaign's deadline has passed by the database's clock, or before the end job has ended it;
--  - a change of the campaign or of when the purge began; a count that goes down;
--  - a completion while a `reconsent_pending` subscriber remains, a second completion, and any change after it. `completed_at` is the database's now() and
--    `retained` its own count, whatever the caller sends.
--
-- The measures are kept (the E09 acceptance: "the aggregate measures are kept for the MVP"). One of them would not survive the deletions:
-- `correction_reach` (S07.10, FR-M4; 20261006110100) matches a correction's, withdrawal's or final's recipients to the original's by
-- `delivery.recipient_id`, which the E07 deletion clears on every text of a deleted subscriber (AD-8), so after the purge it would count only the subscribers
-- who stayed. `correction_reach_kept` (owned by messaging, the view's reader) holds the view's rows as they stood when the purge began: an AFTER INSERT
-- trigger on `campaign_purge` copies them in the transaction that makes the record, before the first deletion, whoever makes it. Messaging's
-- `readCorrectionReach` (the Hub's Measures page and the final report) reads an entry's kept row instead of the view's; an entry measured later is read live.
-- The other measures need nothing: `subscriber_measure`, `subscriber_event_count`, `usage_count`, `alert_cost`, the Cohere views and the weekly review are
-- stored counts or read no recipient.
--
-- Additive only: two new tables, their trigger functions and triggers (the trigger on `campaign_purge` is created with the table). Supabase's default
-- privileges grant every new relation to anon, authenticated and service_role, so they are taken back.

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
    -- The end job's `campaign.ended` counts who stayed and who did not reply: it must have run before the first deletion.
    if run.state <> 'ended' then
      raise exception 'campaign_purge: the purge begins once the end job has ended the campaign' using errcode = 'check_violation';
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

-- The correction reach measure as it stood when the purge began (messaging's; see the header). What the view shows: counts (null when the small-number
-- rule hides them), the words shown for them, percentages, the ids of alert entries and alerts; never a number, a subscriber or recipient id or a body.
-- The app only reads it: `correction_reach_keep()` (security definer, so the rows are the view's whoever began the purge) is its one writer, and a row is
-- never changed (an entry kept already is left as it was).
create table correction_reach_kept (
  entry_id uuid primary key references alert_entry (id),
  alert_id uuid not null,
  kind text not null,
  is_drill boolean not null,
  approved_at timestamptz,
  original_recipients integer,
  original_recipients_shown text not null,
  attempted_reach integer,
  attempted_reach_shown text not null,
  confirmed_reach integer,
  confirmed_reach_shown text not null,
  attempted_percent integer,
  confirmed_percent integer,
  kept_at timestamptz not null default now()
);
alter table correction_reach_kept enable row level security;
revoke all on table correction_reach_kept from public, anon, authenticated, service_role;
grant select on table correction_reach_kept to cvh_app;
create policy correction_reach_kept_app_select on correction_reach_kept for select to cvh_app using (true);

create function correction_reach_keep() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.correction_reach_kept (entry_id, alert_id, kind, is_drill, approved_at, original_recipients, original_recipients_shown, attempted_reach,
                                            attempted_reach_shown, confirmed_reach, confirmed_reach_shown, attempted_percent, confirmed_percent)
  select r.entry_id, r.alert_id, r.kind, r.is_drill, r.approved_at, r.original_recipients, r.original_recipients_shown, r.attempted_reach,
         r.attempted_reach_shown, r.confirmed_reach, r.confirmed_reach_shown, r.attempted_percent, r.confirmed_percent
  from public.correction_reach r
  on conflict (entry_id) do nothing;
  return null;
end
$$;
revoke all on function correction_reach_keep() from public, anon, authenticated, service_role;

create trigger campaign_purge_keep_correction_reach after insert on campaign_purge
  for each row execute function correction_reach_keep();
