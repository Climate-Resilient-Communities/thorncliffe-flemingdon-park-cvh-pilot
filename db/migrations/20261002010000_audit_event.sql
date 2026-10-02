-- S01.04: the audit trail (AD-14), owned by the audit module, and the app's
-- own database role.
--
-- audit_event is append-only. Every staff action writes one row: `ok` inside
-- the change's own transaction, `refused` in a separate transaction after a
-- refusal. It holds no personal data (AD-13): the person is identified only by
-- actor_staff_id (null for the system: scripts and jobs) and the subject by its
-- type and id; `meta` holds only allow-listed fields per action
-- (src/modules/audit/domain/actions.ts).
--
-- actor_staff_id has no foreign key yet: staff_account arrives in S01.05,
-- which adds `foreign key (actor_staff_id) references staff_account (id)`
-- with no ON DELETE action (staff accounts are never deleted, only marked
-- removed; a SET NULL would be an UPDATE, which the trigger below refuses).

create type audit_outcome as enum ('ok', 'refused');

create table audit_event (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_staff_id uuid,
  action text not null,
  subject_type text not null,
  subject_id text,
  outcome audit_outcome not null,
  is_drill boolean not null default false,
  meta jsonb not null default '{}'::jsonb,
  constraint audit_event_meta_is_object check (jsonb_typeof(meta) = 'object')
);
create index audit_event_at_idx on audit_event (at);
create index audit_event_subject_idx on audit_event (subject_type, subject_id);
alter table audit_event enable row level security;

-- Append-only for everyone, the owner included: UPDATE, DELETE and TRUNCATE
-- raise. (Only a superuser or the table owner disabling the trigger could get
-- round it, which is a reviewed migration, not something the app can do.)
create function audit_event_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_event is append-only: % is not allowed', tg_op
    using errcode = 'insufficient_privilege';
end
$$;
revoke all on function audit_event_append_only() from public, anon, authenticated, service_role;

create trigger audit_event_no_update_or_delete
  before update or delete on audit_event
  for each row execute function audit_event_append_only();
create trigger audit_event_no_truncate
  before truncate on audit_event
  for each statement execute function audit_event_append_only();

-- Clients never reach the table: Supabase's default privileges grant every new
-- table in public to anon, authenticated and service_role, so take them back.
revoke all on table audit_event from public, anon, authenticated, service_role;

-- The app's own database role. Migrations run as the owner (postgres); the
-- app connects as cvh_app_login, a member of cvh_app, which holds only the
-- privileges each table grants it and, not being the owner and lacking
-- BYPASSRLS, reaches rows only through policies written for it. Roles belong
-- to the server, not the database, so they are created only if missing.
-- cvh_app_login is created without a password, so it cannot sign in until
-- the project owner sets one (never in a migration or the repository).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'cvh_app') then
    create role cvh_app nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'cvh_app_login') then
    create role cvh_app_login login inherit;
  end if;
end
$$;
grant cvh_app to cvh_app_login;
grant usage on schema public to cvh_app;

-- The app may add and read audit records, never change or remove them.
grant select, insert on table audit_event to cvh_app;
create policy audit_event_app_insert on audit_event for insert to cvh_app with check (true);
create policy audit_event_app_select on audit_event for select to cvh_app using (true);
