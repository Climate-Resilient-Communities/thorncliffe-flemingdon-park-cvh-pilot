-- S01.15: the first-text spike's ledger, owned by the messaging module (AD-2, AD-8). One row per
-- press of "Send test text" that got past the guard, the allowlist and the duplicate checks; the
-- row is committed BEFORE Twilio is called, so a crash between the claim and the answer leaves a
-- `pending` row that still blocks a second text to that number for 5 minutes (nothing is retried
-- automatically). E06's outbound queue replaces this table and the page that uses it.
--
-- request_id (unique) makes a repeated request id a duplicate: the second insert finds the first.
-- number_hash is an HMAC-SHA-256 (hex) of the E.164 number under a server-only key, never the
-- number itself; the 5-minute rule is checked per number_hash under an advisory lock taken by the
-- app (pg_advisory_xact_lock on the hash), so two presses at once send at most one text: the
-- second waits for the first's claim to commit, sees it and refuses. The clock is the database's:
-- claimed_at defaults to now() and the window is compared in SQL, never with the app server's time.
-- outcome: pending (claimed, no answer yet), sent (Twilio accepted it), failed (Twilio answered with
-- an error), unknown (the request failed before an answer: the text may or may not have been sent).
-- Neither the number, the text nor Twilio's error message is stored: only the message id (a Twilio
-- SID), the HTTP status, Twilio's status word and its numeric error code.
create table sms_test_send (
  id bigint generated always as identity primary key,
  request_id uuid not null unique,
  staff_account_id uuid not null references staff_account (id),
  number_hash text not null,
  claimed_at timestamptz not null default now(),
  outcome text not null default 'pending',
  http_status integer,
  provider_status text,
  provider_message_id text,
  provider_error_code integer,
  completed_at timestamptz,
  constraint sms_test_send_number_hash_format check (number_hash ~ '^[0-9a-f]{64}$'),
  constraint sms_test_send_outcome check (outcome in ('pending', 'sent', 'failed', 'unknown')),
  constraint sms_test_send_http_status check (http_status is null or http_status between 100 and 599),
  constraint sms_test_send_provider_status check (provider_status is null or provider_status ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint sms_test_send_message_id_format check (provider_message_id is null or provider_message_id ~ '^(SM|MM)[0-9a-f]{32}$'),
  constraint sms_test_send_pending_has_no_answer check (outcome <> 'pending' or completed_at is null)
);
create index sms_test_send_number_idx on sms_test_send (number_hash, claimed_at);
alter table sms_test_send enable row level security;

-- Clients never reach it (Supabase's default privileges grant every new table and sequence in
-- public to them). The app adds a claim and records the answer on it; it never deletes a row, and it can
-- change only the answer's columns (never the request id, the number hash, the staff member or the claim time).
revoke all on table sms_test_send from public, anon, authenticated, service_role;
revoke all on sequence sms_test_send_id_seq from public, anon, authenticated, service_role;
grant select, insert on table sms_test_send to cvh_app;
grant update (outcome, http_status, provider_status, provider_message_id, provider_error_code, completed_at) on table sms_test_send to cvh_app;
create policy sms_test_send_app_select on sms_test_send for select to cvh_app using (true);
create policy sms_test_send_app_insert on sms_test_send for insert to cvh_app with check (true);
create policy sms_test_send_app_update on sms_test_send for update to cvh_app using (true) with check (true);
