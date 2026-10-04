-- S07.09: abuse of sign-up and texting is limited (AD-22, AR-20, NFR-N9).
--
--  - `inbound_limited_count`: per day (Toronto), how many inbound messages were left unanswered because their number sent more than 20 in an
--    hour (`messages`) and how many numbers reached that limit (`numbers`). Counts only: no number, hash or body. The limit itself is kept as
--    keyed hashes in `rate_limit` (scopes `inbound` and `inbound_mute`), which the purge below deletes after 24 hours.
--  - `health_condition` gains `messaging_settings` (the Messaging Service's geo permissions allow more than Canada, or SMS pumping protection is
--    off; found by the daily check, S06.02). The check of known codes is widened (expand-only: the previous release still writes only its ten rows);
--    the new one is added NOT VALID, and every existing row satisfies it.
--  - The purge of `rate_limit` (pg_cron, every hour, as the table's owner): a client's hash is deleted after 24 hours (AD-13) whether or not any
--    request comes in to delete it (the limiter also deletes as it counts).
--
-- Supabase's default privileges grant every new table to anon, authenticated and service_role, so each is taken back.

create table inbound_limited_count (
  day date primary key,
  messages integer not null default 0,
  numbers integer not null default 0,
  constraint inbound_limited_count_not_negative check (messages >= 0 and numbers >= 0)
);
alter table inbound_limited_count enable row level security;
revoke all on table inbound_limited_count from public, anon, authenticated, service_role;
grant select, insert, update on table inbound_limited_count to cvh_app;
create policy inbound_limited_count_app_select on inbound_limited_count for select to cvh_app using (true);
create policy inbound_limited_count_app_insert on inbound_limited_count for insert to cvh_app with check (true);
create policy inbound_limited_count_app_update on inbound_limited_count for update to cvh_app using (true) with check (true);

alter table health_condition drop constraint health_condition_known;
alter table health_condition add constraint health_condition_known check (condition in (
  'queue_stuck', 'delivery_unknown', 'sender_stalled', 'smart_encoding_on', 'signature_failures',
  'job_failed', 'translation_fallback', 'publish_failed', 'transactional_ceiling', 'cap_overrun', 'messaging_settings'
)) not valid;
insert into health_condition (condition) values ('messaging_settings');

select cron.schedule(
  'subscriptions-purge-rate-limit',
  '7 * * * *',
  $job$
    delete from public.rate_limit where at <= now() - interval '24 hours';
  $job$
);
