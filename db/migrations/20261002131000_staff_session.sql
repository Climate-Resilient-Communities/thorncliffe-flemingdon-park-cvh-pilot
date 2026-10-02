-- S01.07: the app's record of every staff session it opened, owned by the identity module (AD-2,
-- AD-4), and the hourly purge of the sign-in tables.
--
-- A staff request is signed in only when Supabase Auth verifies its access token AND this table
-- has an unrevoked row for that session. Rows are written only by the app's sign-in, so a session
-- opened at Supabase Auth directly (a password grant with the public key, outside the app's
-- valid-once, 24-hour, throttle and audit rules) is never accepted.
--
-- id is the SHA-256 (hex) of the access token's session_id claim (Supabase Auth's id of the
-- session, the same across refreshes), or of the access token itself when it has no session_id.
-- Neither can be turned back into a token. revoked_at ends a row: a re-issued starting password
-- revokes every row of the account, a chosen password every other row, a sign-out its own row.
-- S01.08 adds the idle and absolute limits on created_at and last_seen_at.
create table staff_session (
  id text primary key,
  staff_account_id uuid not null references staff_account (id),
  created_at timestamptz not null,
  last_seen_at timestamptz not null,
  revoked_at timestamptz,
  constraint staff_session_id_format check (id ~ '^[0-9a-f]{64}$'),
  constraint staff_session_seen_after_created check (last_seen_at >= created_at)
);
create index staff_session_account_idx on staff_session (staff_account_id) where revoked_at is null;
create index staff_session_created_at_idx on staff_session (created_at);
alter table staff_session enable row level security;

-- Clients never reach it (Supabase's default privileges grant every new table in public to them).
-- The app reads, adds and revokes rows, and deletes none: old rows go by the purge job below.
revoke all on table staff_session from public, anon, authenticated, service_role;
grant select, insert, update on table staff_session to cvh_app;
create policy staff_session_app_select on staff_session for select to cvh_app using (true);
create policy staff_session_app_insert on staff_session for insert to cvh_app with check (true);
create policy staff_session_app_update on staff_session for update to cvh_app using (true) with check (true);

-- The purge (pg_cron, every hour, as the tables' owner): failed sign-ins and ended locks older than
-- 24 hours (so the throttle keeps nothing longer, even when nobody fails to sign in), and staff
-- sessions revoked, or started (so long ended: a session lasts 12 hours at most), over 30 days ago.
-- The app still purges the throttle tables whenever it records a failure. Scheduling by name
-- replaces the job if it exists, so applying this again changes nothing.
select cron.schedule(
  'identity-purge-sign-in',
  '23 * * * *',
  $job$
    delete from public.sign_in_failure where at < now() - interval '24 hours';
    delete from public.sign_in_lock where locked_until < now() - interval '24 hours';
    delete from public.staff_session
      where revoked_at < now() - interval '30 days' or created_at < now() - interval '30 days';
  $job$
);
