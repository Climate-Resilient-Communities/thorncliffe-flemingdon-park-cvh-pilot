-- S07.02: the pending sign-up (E07 definitions, AD-9, AD-13, AD-22), owned by the subscriptions module (AD-2).
--
-- A `pending_signup` is a number that asked for text alerts and has not yet replied YES: the number, the language the texts will be in,
-- the neighbourhood (required), the optional places (buildings by rsn, each with floor ids), groups and muted topics, the terms version the
-- form showed (`consent_version`), how it started (`web`, or `staff` for S07.03) and when it expires (48 hours after it was made). YES before
-- `expires_at` turns it into a subscriber (S07.04); after it, the row is gone or going, and the purge job below deletes it.
--
--  - At most one per number at a time (the unique index on `phone`): a second sign-up for a number with an unexpired pending sign-up
--    changes nothing and sends nothing.
--  - The number is personal data (AD-13). It is the one thing the confirmation text needs, so it is kept as typed into E.164 and not
--    hashed: the dispatcher's ContactResolver reads it at the hand-off point (subscriptions' `pendingSignupNumberSource`), and S07.04's
--    inbound router finds the pending sign-up of the number that replied. It is not encrypted by the application: like every other table of
--    personal data (oncall_roster, S06.07), the database is encrypted at rest by the platform, only the app's role can read the table (RLS,
--    grants to cvh_app only) and no use case selects the number for any other purpose. It is never written to a log, an audit record, an
--    `ops_event` or a `delivery` row (a delivery names this row's id, never the number). The row lives at most 48 hours.
--  - The app adds and deletes rows and never changes one: a changed sign-up is a new one after the old one is gone.
--  - `delivery_forget_recipient('pending_signup')` (S06.01) is this table's ON DELETE SET NULL for `delivery.recipient_id`: the trigger
--    belongs here, in the migration that creates the table.
--  - `places` is a JSON array of `{rsn, floors: [floor id, ...]}` as the form sent it, checked by the application against the building list
--    in the transaction that inserts it; S07.04 turns it into `subscriber_place` rows (a building or floor removed in between is dropped then).
--
-- Supabase's default privileges grant every new table to anon, authenticated and service_role, so each is taken back.

create table pending_signup (
  id uuid primary key,
  phone text not null,
  lang text not null,
  neighbourhood_id text not null references neighbourhood (id),
  places jsonb not null default '[]'::jsonb,
  groups text[] not null default '{}',
  topics text[] not null default '{}',
  consent_version text not null,
  started_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '48 hours',
  constraint pending_signup_phone_format check (phone ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
  constraint pending_signup_lang_known check (lang in ('en', 'ur', 'ps', 'tl', 'prs', 'gu', 'ta', 'el', 'sk', 'bn', 'hi', 'pa', 'zh', 'es', 'fr')),
  constraint pending_signup_places_array check (jsonb_typeof(places) = 'array' and jsonb_array_length(places) <= 60),
  constraint pending_signup_groups_known check (groups <@ array['seniors', 'newcomers', 'families', 'checkin']::text[] and cardinality(groups) <= 4),
  constraint pending_signup_topics_format check (cardinality(topics) <= 40 and array_to_string(topics, ',') ~ '^([a-z][a-z_]{1,19}(,[a-z][a-z_]{1,19})*)?$'),
  constraint pending_signup_consent_version_format check (consent_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[1-9][0-9]*$'),
  constraint pending_signup_started_by_known check (started_by in ('web', 'staff')),
  constraint pending_signup_expires_after_48_hours check (expires_at = created_at + interval '48 hours')
);
create unique index pending_signup_phone_idx on pending_signup (phone);
create index pending_signup_expires_at_idx on pending_signup (expires_at);
create index pending_signup_neighbourhood_id_idx on pending_signup (neighbourhood_id);
alter table pending_signup enable row level security;
revoke all on table pending_signup from public, anon, authenticated, service_role;
grant select, insert, delete on table pending_signup to cvh_app;
create policy pending_signup_app_select on pending_signup for select to cvh_app using (true);
create policy pending_signup_app_insert on pending_signup for insert to cvh_app with check (true);
create policy pending_signup_app_delete on pending_signup for delete to cvh_app using (true);

create trigger pending_signup_forget_deliveries after delete on pending_signup
  for each row execute function delivery_forget_recipient('pending_signup');

-- The purge (pg_cron, every 15 minutes, as the table's owner): a pending sign-up whose 48 hours have passed. Its confirmation, if it was
-- still queued, had the same `send_by` and is skipped at the hand-off; the trigger above makes its delivery forget the row. The sign-up
-- itself also clears an expired row for its own number before it inserts. Scheduling by name replaces the job if it exists.
select cron.schedule(
  'subscriptions-purge-pending-signup',
  '*/15 * * * *',
  $job$
    delete from public.pending_signup where expires_at <= now();
  $job$
);
