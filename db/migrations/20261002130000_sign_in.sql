-- S01.07: staff sign-in, the starting password's one use, and the failed-sign-in throttle, owned
-- by the identity module (AD-2, AD-4, AD-13).
--
-- staff_account.starting_password_used_at records the starting password's one successful sign-in
-- (it is valid once and for 24 hours from issue). It is cleared when the person chooses their own
-- password or an Admin re-issues the starting password, and is only ever set while
-- must_change_password is true.
--
-- sign_in_failure holds one row per failed sign-in that was checked (wrong password, unknown
-- username, an account that may not sign in). Attempts refused during a lock are audited but not
-- stored, so a lock ends on time. sign_in_lock holds the locks those failures started:
--   username: 5 failures within 15 minutes lock that username for 15 minutes;
--   client:   20 failures within an hour block that client for an hour.
-- Neither table holds a username or an IP address: both are stored only as keyed hashes
-- (HMAC-SHA-256 with a server-only key, src/app/staff/identity.ts), the spine's "salted IP hash".
-- Rows are kept at most 24 hours: the app deletes older failures and ended locks whenever it
-- records a failure.

alter table staff_account add column starting_password_used_at timestamptz;
alter table staff_account
  add constraint staff_account_starting_password_used check (starting_password_used_at is null or must_change_password);

create table sign_in_failure (
  id bigint generated always as identity primary key,
  at timestamptz not null,
  username_hash text not null,
  client_hash text not null,
  constraint sign_in_failure_username_hash_format check (username_hash ~ '^[0-9a-f]{64}$'),
  constraint sign_in_failure_client_hash_format check (client_hash ~ '^[0-9a-f]{64}$')
);
create index sign_in_failure_username_idx on sign_in_failure (username_hash, at);
create index sign_in_failure_client_idx on sign_in_failure (client_hash, at);
create index sign_in_failure_at_idx on sign_in_failure (at);
alter table sign_in_failure enable row level security;

create table sign_in_lock (
  kind text not null,
  key_hash text not null,
  locked_until timestamptz not null,
  primary key (kind, key_hash),
  constraint sign_in_lock_kind check (kind in ('username', 'client')),
  constraint sign_in_lock_key_hash_format check (key_hash ~ '^[0-9a-f]{64}$')
);
create index sign_in_lock_locked_until_idx on sign_in_lock (locked_until);
alter table sign_in_lock enable row level security;

-- Clients never reach either table (Supabase's default privileges grant every new table and
-- sequence in public to them). The app records and reads failures and locks, and deletes them
-- once older than 24 hours; it never changes a failure.
revoke all on table sign_in_failure, sign_in_lock from public, anon, authenticated, service_role;
revoke all on sequence sign_in_failure_id_seq from public, anon, authenticated, service_role;
grant select, insert, delete on table sign_in_failure to cvh_app;
grant select, insert, update, delete on table sign_in_lock to cvh_app;
create policy sign_in_failure_app_select on sign_in_failure for select to cvh_app using (true);
create policy sign_in_failure_app_insert on sign_in_failure for insert to cvh_app with check (true);
create policy sign_in_failure_app_delete on sign_in_failure for delete to cvh_app using (true);
create policy sign_in_lock_app_select on sign_in_lock for select to cvh_app using (true);
create policy sign_in_lock_app_insert on sign_in_lock for insert to cvh_app with check (true);
create policy sign_in_lock_app_update on sign_in_lock for update to cvh_app using (true) with check (true);
create policy sign_in_lock_app_delete on sign_in_lock for delete to cvh_app using (true);
