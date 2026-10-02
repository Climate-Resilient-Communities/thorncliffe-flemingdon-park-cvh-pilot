-- S02.05: the directory release (AD-11, AD-20) and the operational event log (AD-23).
--
-- directory_release (owned by the directory module) is one numbered, complete set of listing
-- files: one per launch language plus zh-Hant, written to the private Storage bucket by the
-- publish job (src/modules/directory/application/publishDirectory.ts). A release is built in
-- `building`, is `complete` only when every file is stored, and only a complete release is ever
-- current. Nothing about a complete release changes afterwards except whether it is the current
-- one: a later change is a new release with a new number (trigger below).
--
--  - `files` maps a language to {path, sha256, bytes, stored_at}: stored_at is null until that
--    file is in Storage. A job stopped part way resumes from the first file without it.
--  - `staged` holds the files' text while the release is being built, so a resumed job writes the
--    very same bytes (the snapshot of the providers is taken once); it is cleared when the release
--    completes or fails.
--  - `lease_token` / `lease_until` is the claim of the job running now; a second publish while the
--    lease is live is refused, and a job whose lease was taken over stops (it checks the token
--    under the row lock before every step).
--  - `is_current` is the current-release pointer. At most one release has it (unique partial
--    index), and it moves in one transaction: the old release's flag is cleared and the new one's
--    set together, so every reader sees either release, never none and never two.
--  - `catalogue_hash` (sha256 of the committed data/catalogue/ files) and `git_commit` record the
--    source version of the release; `search` is E03's search data (null until then, and the
--    manifest then says search is unavailable). The publish job takes its snapshot from the provider
--    rows in Postgres, which the seed (`npm run seed:providers`) loaded from the catalogue files, so
--    it records a catalogue_hash only if `catalogue_load` says those rows came from the same files.
--
-- ops_event (owned by the ops module) is the log the health job and the weekly review read:
-- failed publishes now, other conditions in later stories. No personal data: `detail` is checked
-- per kind in the app (src/modules/ops/domain/events.ts).
--
-- catalogue_load (owned by the directory module) is one row per run of the provider seed, written in the
-- seed's own transaction: the sha256 of the data/catalogue/ files it loaded (the same catalogueHash() the
-- publish job computes from the deployed files) and the commit it ran from. The job refuses to publish
-- when the latest load is not the hash of the deployed catalogue, so a release never claims a
-- catalogue_hash that the database does not hold.
--
-- Who writes what: the app (cvh_app, through cvh_app_login) inserts and updates the columns the
-- job moves and nothing else, and deletes nothing. The seed runs as the migration role: it alone
-- writes catalogue_load and provider.withheld; the app only reads them. Supabase's default privileges grant every new
-- table to anon, authenticated and service_role, so each table takes those back.

create table directory_release (
  number integer primary key,
  status text not null,
  catalogue_hash text not null,
  git_commit text,
  started_by uuid,
  started_at timestamptz not null default now(),
  published_at timestamptz,
  counts jsonb not null,
  -- Texts shown in English although a translation exists, and why: the stale ones by provider and language.
  report jsonb not null,
  files jsonb not null,
  staged jsonb,
  search jsonb,
  attempts smallint not null default 1,
  lease_token uuid,
  lease_until timestamptz,
  failure text,
  is_current boolean not null default false,
  current_since timestamptz,
  constraint directory_release_number_positive check (number > 0),
  constraint directory_release_status check (status in ('building', 'complete', 'failed')),
  constraint directory_release_catalogue_hash check (catalogue_hash ~ '^[0-9a-f]{64}$'),
  constraint directory_release_git_commit check (git_commit is null or git_commit ~ '^[0-9a-f]{7,40}$'),
  constraint directory_release_counts_object check (jsonb_typeof(counts) = 'object'),
  constraint directory_release_report_object check (jsonb_typeof(report) = 'object'),
  constraint directory_release_files_object check (jsonb_typeof(files) = 'object'),
  constraint directory_release_staged_object check (staged is null or jsonb_typeof(staged) = 'object'),
  constraint directory_release_search_object check (search is null or jsonb_typeof(search) = 'object'),
  constraint directory_release_attempts check (attempts between 1 and 3),
  constraint directory_release_failure_code check (failure is null or failure ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint directory_release_published_when_complete check ((status = 'complete') = (published_at is not null)),
  constraint directory_release_failure_when_failed check ((status = 'failed') = (failure is not null)),
  constraint directory_release_current_is_complete check (not is_current or status = 'complete'),
  constraint directory_release_current_since_when_current check (not is_current or current_since is not null),
  constraint directory_release_staged_only_while_building check (staged is null or status = 'building'),
  constraint directory_release_lease_pair check ((lease_token is null) = (lease_until is null))
);
alter table directory_release enable row level security;

-- One current release at most.
create unique index directory_release_one_current on directory_release (is_current) where is_current;
create index directory_release_building_idx on directory_release (number) where status = 'building';

revoke all on table directory_release from public, anon, authenticated, service_role;
grant select, insert on table directory_release to cvh_app;
grant update (status, files, staged, search, attempts, lease_token, lease_until, failure, published_at, is_current, current_since)
  on table directory_release to cvh_app;

create policy directory_release_app_select on directory_release for select to cvh_app using (true);
create policy directory_release_app_insert on directory_release for insert to cvh_app with check (true);
create policy directory_release_app_update on directory_release for update to cvh_app using (true) with check (true);

-- A release is born `building` and not current. It becomes `complete` or `failed` once, and a
-- complete release keeps everything it was published with: only the current-release pointer moves.
-- A failed one is closed. Nothing is ever deleted, for anyone (the owner included).
create function directory_release_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'directory_release: releases are never deleted'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'building' or new.is_current then
      raise exception 'directory_release: a release is born building and not current'
        using errcode = 'check_violation', constraint = 'directory_release_born_building';
    end if;
    return new;
  end if;

  if new.number is distinct from old.number
     or new.catalogue_hash is distinct from old.catalogue_hash
     or new.git_commit is distinct from old.git_commit
     or new.started_by is distinct from old.started_by
     or new.started_at is distinct from old.started_at
     or new.counts is distinct from old.counts
     or new.report is distinct from old.report then
    raise exception 'directory_release: the number, source version, counts and report of a release never change'
      using errcode = 'check_violation', constraint = 'directory_release_immutable';
  end if;
  if old.status <> 'building' then
    -- complete or failed: only the pointer moves, and only a complete release can hold it.
    if new.status is distinct from old.status
       or new.files is distinct from old.files
       or new.search is distinct from old.search
       or new.published_at is distinct from old.published_at
       or new.failure is distinct from old.failure
       or new.staged is distinct from old.staged
       or new.attempts is distinct from old.attempts
       or new.lease_token is distinct from old.lease_token
       or new.lease_until is distinct from old.lease_until then
      raise exception 'directory_release: a % release cannot be changed (publish a new release instead)', old.status
        using errcode = 'check_violation', constraint = 'directory_release_immutable';
    end if;
  end if;
  return new;
end
$$;
revoke all on function directory_release_guard() from public, anon, authenticated, service_role;

create trigger directory_release_guard
  before insert or update or delete on directory_release
  for each row execute function directory_release_guard();
create trigger directory_release_no_truncate
  before truncate on directory_release
  for each statement execute function directory_release_guard();

-- The building -> complete move needs every file stored (and none missing), checked where it
-- cannot be skipped.
create function directory_release_complete_needs_files() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'complete' and old.status = 'building' then
    if exists (
      select 1 from jsonb_each(new.files) f
      where jsonb_typeof(f.value -> 'stored_at') is distinct from 'string'
    ) or new.files = '{}'::jsonb then
      raise exception 'directory_release: a release is complete only when every file is stored'
        using errcode = 'check_violation', constraint = 'directory_release_complete_needs_files';
    end if;
  end if;
  return new;
end
$$;
revoke all on function directory_release_complete_needs_files() from public, anon, authenticated, service_role;

create trigger directory_release_complete_needs_files
  before update on directory_release
  for each row execute function directory_release_complete_needs_files();

create table ops_event (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  -- A lower_snake_case code with dots, like directory.publish_failed.
  kind text not null,
  severity text not null,
  subject_type text,
  subject_id text,
  detail jsonb not null default '{}'::jsonb,
  constraint ops_event_kind_format check (kind ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){0,3}$' and char_length(kind) <= 64),
  constraint ops_event_severity check (severity in ('info', 'warning', 'error')),
  constraint ops_event_subject_type_format check (subject_type is null or subject_type ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint ops_event_subject_id_format check (subject_id is null or subject_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  constraint ops_event_detail_object check (jsonb_typeof(detail) = 'object')
);
create index ops_event_kind_at_idx on ops_event (kind, at);
alter table ops_event enable row level security;

revoke all on table ops_event from public, anon, authenticated, service_role;
revoke all on sequence ops_event_id_seq from public, anon, authenticated, service_role;
grant select, insert on table ops_event to cvh_app;

create policy ops_event_app_select on ops_event for select to cvh_app using (true);
create policy ops_event_app_insert on ops_event for insert to cvh_app with check (true);

-- The seed's record of what it loaded. Written only by the seed (the owner role); the app reads the
-- latest row (order by id desc) before every publish. Rows are kept: the history of loads.
create table catalogue_load (
  id bigint generated always as identity primary key,
  -- sha256 of the data/catalogue/ files (scripts and the app share catalogueHash()).
  hash text not null,
  -- The commit the seed ran from, when known.
  git_commit text,
  loaded_at timestamptz not null default now(),
  constraint catalogue_load_hash check (hash ~ '^[0-9a-f]{64}$'),
  constraint catalogue_load_git_commit check (git_commit is null or git_commit ~ '^[0-9a-f]{7,40}$')
);
alter table catalogue_load enable row level security;

revoke all on table catalogue_load from public, anon, authenticated, service_role;
revoke all on sequence catalogue_load_id_seq from public, anon, authenticated, service_role;
grant select on table catalogue_load to cvh_app;

create policy catalogue_load_app_select on catalogue_load for select to cvh_app using (true);

-- S02.04's provider table gains the translations the seed withheld: {"services": {"ur": "stale"}}, by text
-- key and language, with why (stale, machine, review_incomplete, ...). The seed loads only reviewed,
-- current translations, so a stale one is never in `texts`; this is the only place the release report
-- can learn that it exists. Null until the seed has run again; written only by the seed.
alter table provider add column withheld jsonb;
-- NOT VALID: the column is new, so every existing row has it null and already passes; the check
-- applies to every row written from now on, without a validation scan of the existing ones.
alter table provider
  add constraint provider_withheld_object check (withheld is null or jsonb_typeof(withheld) = 'object') not valid;
