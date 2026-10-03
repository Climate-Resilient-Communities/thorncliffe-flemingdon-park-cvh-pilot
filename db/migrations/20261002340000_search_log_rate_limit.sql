-- S03.04: search_log (owned by directory) and rate_limit (owned by subscriptions, created here because E07 has not yet).
--
-- search_log: one row for every search that was answered or failed (a question that is rejected as invalid, or refused
-- by the rate limit, is not a search). It holds only counts and codes, never the question, its translation or anything
-- that could identify the resident (AD-3, AD-13): when it happened, the page language, the language the answer is shown
-- in, the release the search used, how long it took, how many providers it returned, how it ended, the best similarity,
-- and what the translated-question leg did (S03.05 writes `used`, `failed` and `timed_out`; S03.04 has no such leg).
--
-- rate_limit: one row for every request a client is allowed in a window, keyed by the scope (`search`) and a keyed hash
-- of the client's IP address (HMAC-SHA-256 with a server-only secret, hex), never the address. The row is deleted after
-- 24 hours (the application purges as it counts); the window the limit looks at is 10 minutes.
--
-- The app (cvh_app) inserts search_log and never changes it; it reads, inserts and deletes rate_limit. Supabase's default
-- privileges grant every new table to anon, authenticated and service_role, so each is taken back.

create table search_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  -- The language of the page the question was asked from.
  lang text not null,
  -- The language the answer is shown in.
  query_lang text not null,
  -- The current release when the search ran; null when there was none.
  release_v integer,
  ms integer not null,
  result_count integer not null,
  status text not null,
  top_score double precision,
  translated_leg text not null default 'not_needed',
  constraint search_log_lang_format check (lang ~ '^[A-Za-z]{2,3}(-[A-Za-z]{4})?$'),
  constraint search_log_query_lang_format check (query_lang ~ '^[A-Za-z]{2,3}(-[A-Za-z]{4})?$'),
  constraint search_log_release_v_positive check (release_v is null or release_v > 0),
  constraint search_log_ms_not_negative check (ms >= 0),
  constraint search_log_result_count_range check (result_count between 0 and 5),
  constraint search_log_status check (status in ('ok', 'no_clear_match', 'unavailable', 'error')),
  constraint search_log_translated_leg check (translated_leg in ('not_needed', 'used', 'failed', 'timed_out'))
);
create index search_log_at_idx on search_log (at);
alter table search_log enable row level security;

revoke all on table search_log from public, anon, authenticated, service_role;
revoke all on sequence search_log_id_seq from public, anon, authenticated, service_role;
grant select, insert on table search_log to cvh_app;
create policy search_log_app_select on search_log for select to cvh_app using (true);
create policy search_log_app_insert on search_log for insert to cvh_app with check (true);

create table rate_limit (
  id bigint generated always as identity primary key,
  scope text not null,
  client_hash text not null,
  at timestamptz not null default now(),
  constraint rate_limit_scope_format check (scope ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint rate_limit_client_hash_format check (client_hash ~ '^[0-9a-f]{64}$')
);
create index rate_limit_client_idx on rate_limit (scope, client_hash, at);
create index rate_limit_at_idx on rate_limit (at);
alter table rate_limit enable row level security;

revoke all on table rate_limit from public, anon, authenticated, service_role;
revoke all on sequence rate_limit_id_seq from public, anon, authenticated, service_role;
grant select, insert, delete on table rate_limit to cvh_app;
create policy rate_limit_app_select on rate_limit for select to cvh_app using (true);
create policy rate_limit_app_insert on rate_limit for insert to cvh_app with check (true);
create policy rate_limit_app_delete on rate_limit for delete to cvh_app using (true);
