-- S02.09: the six guides and the essential numbers page, loaded from data/catalogue/
-- (guides.json, numbers.json and translations/content/<lang>.json) by the idempotent
-- seed (scripts/seed/guides.mjs). Owned by the directory module (spine table ownership).
--
-- `texts` holds, per text key, the English and the translations the seed accepted
-- (reviewed and current): {"title": {"en": "...", "ur": "..."}, "before.0": {...}}.
-- A language missing from a text means English with translation.unavailable.
-- `translations` records where each loaded translation came from (model, review,
-- source hash, and the OpenCC version and configuration for zh-Hant).
--
-- Residents read these tables later through the server's own connection (the
-- cvh_app role of S01.04's migration 20261002010000_audit_event.sql), which may
-- only select; the seed writes as the migration role. Supabase's default
-- privileges grant every new table in public to anon, authenticated and
-- service_role, so each table takes those back.

create table guide (
  id text primary key,
  read_mins smallint not null,
  owner text not null,
  last_updated date not null,
  english_reviewer text not null,
  english_reviewed_on date not null,
  texts jsonb not null,
  translations jsonb not null default '{}'::jsonb
);
alter table guide enable row level security;
revoke all on table guide from public, anon, authenticated, service_role;
grant select on table guide to cvh_app;
create policy guide_app_select on guide for select to cvh_app using (true);

create table essential_number (
  id text primary key,
  sort_order smallint not null,
  number text not null,
  emergency boolean not null default false,
  owner text not null,
  last_updated date not null,
  english_reviewer text not null,
  english_reviewed_on date not null,
  last_checked date not null,
  texts jsonb not null,
  translations jsonb not null default '{}'::jsonb
);
alter table essential_number enable row level security;
revoke all on table essential_number from public, anon, authenticated, service_role;
grant select on table essential_number to cvh_app;
create policy essential_number_app_select on essential_number for select to cvh_app using (true);
