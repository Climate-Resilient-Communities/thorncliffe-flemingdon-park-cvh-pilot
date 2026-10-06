-- S07.06: the one-time web link a subscriber uses to change or delete their subscription (E07 definition "Edit link", AD-9, AD-13), owned by
-- the subscriptions module (AD-2).
--
--  - `subscription_edit_token`: one link of a subscriber, asked for by text (the menus' offer, S07.05) and texted as
--    `/{lang}/subscription/{token}`. Only the sha256 of the token is kept here (`token_hash`). The token itself is in the text, so also in
--    that text's `delivery.body` (the outbox keeps every body as queued; there it works for the link's 30 minutes and once, like the text
--    on the phone), and in the resident's browser; never in a log, an audit record or an `ops_event`. A link is valid for 30 minutes
--    (`expires_at` = `created_at` + 30 minutes, the same now() as the text's `send_by`, so a text still queued when its link expires is
--    skipped at the hand-off) and is used once: the change or the deletion sets `used_at` in its own transaction, only while it is null and
--    before `expires_at` (`update ... where used_at is null and expires_at > now()`), so two submissions of one link make one change. A
--    subscriber has at most one link (unique `subscriber_id`): a new one replaces the one before. Personal data (spine: the tables that hold
--    it): it names the subscriber. Deleted with the subscriber (ON DELETE CASCADE: STOP, a confirmed reply 0, or "Delete my subscription"
--    on the page itself), and by the purge job once it has run out.
--  - `subscriber`: the app may now update `groups` (the page changes them), besides `lang` and `neighbourhood_id` (S07.05) and
--    `retention_state` (S07.04). The number, `consent_version` and `started_by` stay unchangeable by the app.
--
-- The app's grants are select, insert and delete, and update of `used_at` only; a guard trigger keeps everything else of a row as it was
-- written and a used link used. A new table and a grant: nothing here is destructive. Supabase's default privileges grant every new table to
-- anon, authenticated and service_role, so it is taken back.

create table subscription_edit_token (
  id uuid primary key,
  subscriber_id uuid not null references subscriber (id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  used_at timestamptz,
  constraint subscription_edit_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint subscription_edit_token_expires_after_30_minutes check (expires_at = created_at + interval '30 minutes'),
  constraint subscription_edit_token_used_in_time check (used_at is null or (used_at >= created_at and used_at < expires_at))
);
create unique index subscription_edit_token_hash_idx on subscription_edit_token (token_hash);
create unique index subscription_edit_token_subscriber_id_idx on subscription_edit_token (subscriber_id);
create index subscription_edit_token_expires_at_idx on subscription_edit_token (expires_at);
alter table subscription_edit_token enable row level security;
revoke all on table subscription_edit_token from public, anon, authenticated, service_role;
grant select, insert, delete on table subscription_edit_token to cvh_app;
grant update (used_at) on table subscription_edit_token to cvh_app;
create policy subscription_edit_token_app_select on subscription_edit_token for select to cvh_app using (true);
create policy subscription_edit_token_app_insert on subscription_edit_token for insert to cvh_app with check (true);
create policy subscription_edit_token_app_update on subscription_edit_token for update to cvh_app using (true) with check (true);
create policy subscription_edit_token_app_delete on subscription_edit_token for delete to cvh_app using (true);

-- A link is used once: `used_at` is set from null and then never changes, and nothing else of the row ever does.
create function subscription_edit_token_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.subscriber_id is distinct from old.subscriber_id or new.token_hash is distinct from old.token_hash
     or new.created_at is distinct from old.created_at or new.expires_at is distinct from old.expires_at then
    raise exception 'subscription_edit_token: only used_at changes' using errcode = 'check_violation';
  end if;
  if old.used_at is not null or new.used_at is null then
    raise exception 'subscription_edit_token: a link is used once' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke all on function subscription_edit_token_guard() from public, anon, authenticated, service_role;
create trigger subscription_edit_token_guard
  before update on subscription_edit_token
  for each row execute function subscription_edit_token_guard();

grant update (groups) on table subscriber to cvh_app;

-- The purge (pg_cron, every 15 minutes, as the table's owner): links that have run out, used or not. A job of its own, so the inbound
-- purge (S07.04) is left as it is. Scheduling by name replaces the job if it exists.
select cron.schedule(
  'subscriptions-purge-edit-tokens',
  '*/15 * * * *',
  $job$
    delete from public.subscription_edit_token where expires_at <= now();
  $job$
);
