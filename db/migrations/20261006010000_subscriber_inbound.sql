-- S07.04: subscribers and the inbound router's tables (E07 definitions, AD-9, AD-13), owned by the subscriptions module (AD-2).
--
--  - `subscriber`: a number that replied YES to its confirmation, made from its pending sign-up in the YES transaction: the number (E.164,
--    one row per number), the language its texts are in, the neighbourhood (required), groups, the terms version it accepted
--    (`consent_version`), how it started (`web` or `staff`) and `retention_state` (`active`; E09 adds the re-consent states' use). No name,
--    unit, email or password. The number is personal data, protected as `pending_signup`'s (platform encryption at rest, RLS and grants to
--    cvh_app only): it is read by the ContactResolver's source at the hand-off point, by the inbound router and by the web sign-up's
--    "already subscribed" lookup (which answers yes or no), and never written to a log, an audit record, an `ops_event` or a `delivery` row.
--  - `subscriber_place`: the subscriber's buildings, one row per (building, floor), with a null floor for "no floor recorded there"
--    (src/contracts/audience.ts#AudienceProfile describes how S07.07's query reads them). A floor removed by an Admin sets its rows' floor to
--    null, so the subscriber keeps the building; a removed building is not possible (buildings are never deleted).
--  - `subscriber_topic_optout`: the topics (disruption types) the subscriber muted.
--  - `sms_prompt`: the one open prompt of a subscriber (S07.04: the "reply 0 again" confirmation of a deletion, 10 minutes; S07.05 adds the
--    menus' steps as other kinds). No number: it names the subscriber.
--  - `inbound_seen`: the sha256 of each inbound MessageSid and when it was received, so a retried webhook does nothing; kept 48 hours.
--  - `inbound_reply`: a number with no subscription and no pending sign-up, kept only until its one reply (`signup_info`) is handed to the
--    provider (the ContactResolver's source deletes the row in the hand-off transaction) or 30 minutes pass (the purge job). The only place a
--    number without a subscription is stored (E07 definitions).
--  - `inbound_keyword_count`: how many inbound messages carried each keyword per day (Toronto). The only trace of an inbound body.
--
-- Every subscriber table is deleted by STOP or a confirmed reply 0 (one transaction, subscriptions' `deleteNumber`); places, opt-outs and
-- prompts go with the subscriber row (ON DELETE CASCADE). Each recipient table carries `delivery_forget_recipient` (S06.01), the ON DELETE
-- SET NULL of `delivery.recipient_id`, created here with its table. Supabase's default privileges grant every new table to anon,
-- authenticated and service_role, so each is taken back.

create table subscriber (
  id uuid primary key,
  phone text not null,
  lang text not null,
  neighbourhood_id text not null references neighbourhood (id),
  groups text[] not null default '{}',
  consent_version text not null,
  started_by text not null,
  retention_state text not null default 'active',
  created_at timestamptz not null default now(),
  constraint subscriber_phone_format check (phone ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
  constraint subscriber_lang_known check (lang in ('en', 'ur', 'ps', 'tl', 'prs', 'gu', 'ta', 'el', 'sk', 'bn', 'hi', 'pa', 'zh', 'es', 'fr')),
  constraint subscriber_groups_known check (groups <@ array['seniors', 'newcomers', 'families', 'checkin']::text[] and cardinality(groups) <= 4),
  constraint subscriber_consent_version_format check (consent_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[1-9][0-9]*$'),
  constraint subscriber_started_by_known check (started_by in ('web', 'staff')),
  constraint subscriber_retention_state_known check (retention_state in ('active', 'reconsent_pending', 'retained'))
);
create unique index subscriber_phone_idx on subscriber (phone);
create index subscriber_neighbourhood_id_idx on subscriber (neighbourhood_id);
alter table subscriber enable row level security;
revoke all on table subscriber from public, anon, authenticated, service_role;
grant select, insert, delete on table subscriber to cvh_app;
-- The deletion locks the row FOR UPDATE (E07 "Deletion": after the deliveries, before check-ins), which Postgres allows only to a role that may
-- update a column of it: `retention_state` is the one column the app will change (E09's re-consent), so it is the only one granted.
grant update (retention_state) on table subscriber to cvh_app;
create policy subscriber_app_select on subscriber for select to cvh_app using (true);
create policy subscriber_app_insert on subscriber for insert to cvh_app with check (true);
create policy subscriber_app_update on subscriber for update to cvh_app using (true) with check (true);
create policy subscriber_app_delete on subscriber for delete to cvh_app using (true);
create trigger subscriber_forget_deliveries after delete on subscriber
  for each row execute function delivery_forget_recipient('subscriber');

create table subscriber_place (
  id uuid primary key,
  subscriber_id uuid not null references subscriber (id) on delete cascade,
  rsn text not null references building (rsn),
  floor_id uuid references building_floor (id) on delete set null
);
create index subscriber_place_subscriber_id_idx on subscriber_place (subscriber_id);
create index subscriber_place_rsn_idx on subscriber_place (rsn);
create index subscriber_place_floor_id_idx on subscriber_place (floor_id);
alter table subscriber_place enable row level security;
revoke all on table subscriber_place from public, anon, authenticated, service_role;
grant select, insert, delete on table subscriber_place to cvh_app;
create policy subscriber_place_app_select on subscriber_place for select to cvh_app using (true);
create policy subscriber_place_app_insert on subscriber_place for insert to cvh_app with check (true);
create policy subscriber_place_app_delete on subscriber_place for delete to cvh_app using (true);

create table subscriber_topic_optout (
  subscriber_id uuid not null references subscriber (id) on delete cascade,
  topic text not null references disruption_type (id) on delete cascade,
  primary key (subscriber_id, topic)
);
create index subscriber_topic_optout_topic_idx on subscriber_topic_optout (topic);
alter table subscriber_topic_optout enable row level security;
revoke all on table subscriber_topic_optout from public, anon, authenticated, service_role;
grant select, insert, delete on table subscriber_topic_optout to cvh_app;
create policy subscriber_topic_optout_app_select on subscriber_topic_optout for select to cvh_app using (true);
create policy subscriber_topic_optout_app_insert on subscriber_topic_optout for insert to cvh_app with check (true);
create policy subscriber_topic_optout_app_delete on subscriber_topic_optout for delete to cvh_app using (true);

-- One open prompt per subscriber. `kind` is a code (S07.04 writes `delete_confirm`; S07.05's menu steps are further codes, so its kinds need
-- no change to this table); `step` is the prompt's own state (empty for a deletion's confirmation). The app replaces a prompt by deleting it
-- and inserting the next one.
create table sms_prompt (
  subscriber_id uuid primary key references subscriber (id) on delete cascade,
  kind text not null,
  step jsonb not null default '{}'::jsonb,
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint sms_prompt_kind_format check (kind ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint sms_prompt_step_object check (jsonb_typeof(step) = 'object'),
  constraint sms_prompt_expires_after_sent check (expires_at > sent_at and expires_at <= sent_at + interval '1 hour')
);
create index sms_prompt_expires_at_idx on sms_prompt (expires_at);
alter table sms_prompt enable row level security;
revoke all on table sms_prompt from public, anon, authenticated, service_role;
grant select, insert, delete on table sms_prompt to cvh_app;
create policy sms_prompt_app_select on sms_prompt for select to cvh_app using (true);
create policy sms_prompt_app_insert on sms_prompt for insert to cvh_app with check (true);
create policy sms_prompt_app_delete on sms_prompt for delete to cvh_app using (true);

create table inbound_seen (
  sid_hash text primary key,
  received_at timestamptz not null default now(),
  constraint inbound_seen_sid_hash_format check (sid_hash ~ '^[0-9a-f]{64}$')
);
create index inbound_seen_received_at_idx on inbound_seen (received_at);
alter table inbound_seen enable row level security;
revoke all on table inbound_seen from public, anon, authenticated, service_role;
grant select, insert on table inbound_seen to cvh_app;
create policy inbound_seen_app_select on inbound_seen for select to cvh_app using (true);
create policy inbound_seen_app_insert on inbound_seen for insert to cvh_app with check (true);

create table inbound_reply (
  id uuid primary key,
  phone text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  constraint inbound_reply_phone_format check (phone ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
  constraint inbound_reply_expires_after_30_minutes check (expires_at = created_at + interval '30 minutes')
);
create index inbound_reply_phone_idx on inbound_reply (phone);
create index inbound_reply_expires_at_idx on inbound_reply (expires_at);
alter table inbound_reply enable row level security;
revoke all on table inbound_reply from public, anon, authenticated, service_role;
grant select, insert, delete on table inbound_reply to cvh_app;
create policy inbound_reply_app_select on inbound_reply for select to cvh_app using (true);
create policy inbound_reply_app_insert on inbound_reply for insert to cvh_app with check (true);
create policy inbound_reply_app_delete on inbound_reply for delete to cvh_app using (true);
create trigger inbound_reply_forget_deliveries after delete on inbound_reply
  for each row execute function delivery_forget_recipient('inbound_reply');

create table inbound_keyword_count (
  day date not null,
  keyword text not null,
  count integer not null default 1,
  primary key (day, keyword),
  constraint inbound_keyword_count_keyword_known check (keyword in ('stop', 'start', 'help', 'yes', '0', '1', '2', '3', 'other')),
  constraint inbound_keyword_count_positive check (count > 0)
);
alter table inbound_keyword_count enable row level security;
revoke all on table inbound_keyword_count from public, anon, authenticated, service_role;
grant select, insert, update on table inbound_keyword_count to cvh_app;
create policy inbound_keyword_count_app_select on inbound_keyword_count for select to cvh_app using (true);
create policy inbound_keyword_count_app_insert on inbound_keyword_count for insert to cvh_app with check (true);
create policy inbound_keyword_count_app_update on inbound_keyword_count for update to cvh_app using (true) with check (true);

-- The purge (pg_cron, every 15 minutes, as the tables' owner): message-id hashes after 48 hours, `inbound_reply` rows past their 30 minutes
-- (a reply still queued then has the same `send_by` and is skipped at the hand-off; the trigger above makes its delivery forget the row),
-- and prompts that have run out. Scheduling by name replaces the job if it exists.
select cron.schedule(
  'subscriptions-purge-inbound',
  '*/15 * * * *',
  $job$
    delete from public.inbound_seen where received_at <= now() - interval '48 hours';
    delete from public.inbound_reply where expires_at <= now();
    delete from public.sms_prompt where expires_at <= now();
  $job$
);
