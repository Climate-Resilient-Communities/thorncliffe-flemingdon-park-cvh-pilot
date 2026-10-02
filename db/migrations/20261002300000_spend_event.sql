-- S03.02: spend_event (owned by the spend module, AD-8, AD-10, AD-11): one row for every call to a paid vendor
-- that is counted against the pilot's budget. This story writes the first kind, `embed` (Cohere embeddings,
-- one row per call: the model, the billed input tokens, the release the call was made for); later stories add
-- the question embeddings and translations (E03, E04) and the SMS estimates (E06) as their own kinds, each with
-- the columns it needs.
--
--  - `kind` and `purpose` are lower_snake_case codes (`embed`; `publish`, `query`, `test_set`), not text a person
--    typed, and nothing here can hold a question, a provider's text or a phone number.
--  - `tokens` are the vendor's billed units, or our own estimate when the vendor did not say (`tokens_estimated`).
--  - the price is left null while Cohere has not published it (`price_per_million_tokens_cad`): the usage allowance
--    counts calls and tokens, never money, until a price is recorded. A price recorded later is a correction by
--    IT (the owner role); the app only inserts.
--  - `at` is the moment the call returned. The monthly allowance counts the calendar month in America/Toronto.
--
-- Who writes what: the app (cvh_app, through cvh_app_login) reads and inserts, and changes or deletes nothing.
-- Supabase's default privileges grant every new table to anon, authenticated and service_role, so each is taken back.

create table spend_event (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null,
  purpose text not null,
  model text not null,
  -- The directory release the call was made for, when it was made for one.
  release_v integer,
  calls integer not null default 1,
  tokens bigint not null default 0,
  tokens_estimated boolean not null default false,
  -- How long the call took, in milliseconds, when it was measured.
  ms integer,
  price_per_million_tokens_cad numeric,
  constraint spend_event_kind_format check (kind ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint spend_event_purpose_format check (purpose ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint spend_event_model_format check (model ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  constraint spend_event_release_v_positive check (release_v is null or release_v > 0),
  constraint spend_event_calls_positive check (calls >= 1),
  constraint spend_event_tokens_not_negative check (tokens >= 0),
  constraint spend_event_ms_not_negative check (ms is null or ms >= 0),
  constraint spend_event_price_not_negative check (price_per_million_tokens_cad is null or price_per_million_tokens_cad >= 0)
);
create index spend_event_kind_at_idx on spend_event (kind, at);
alter table spend_event enable row level security;

revoke all on table spend_event from public, anon, authenticated, service_role;
revoke all on sequence spend_event_id_seq from public, anon, authenticated, service_role;
grant select, insert on table spend_event to cvh_app;

create policy spend_event_app_select on spend_event for select to cvh_app using (true);
create policy spend_event_app_insert on spend_event for insert to cvh_app with check (true);
