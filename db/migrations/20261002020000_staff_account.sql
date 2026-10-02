-- S01.05: staff accounts and the one-time bootstrap of the first two Admins,
-- owned by the identity module (AD-2, AD-4).
--
-- staff_account is the app's record of each person: a unique username, the
-- name the starting password is made from, the email as a contact detail only
-- (no mail is ever sent), the role and the status. Sign-in itself is Supabase
-- Auth's: auth_user_id links to the auth user, created with a login made from
-- the username (src/modules/identity/domain/username.ts). It is not a foreign
-- key, since the auth schema belongs to Supabase. Accounts are never deleted,
-- only marked removed, so audit records keep pointing at them.
--
-- staff_bootstrap has at most one row, written by scripts/create-first-admin
-- when the first Admin is created. It names the first Admin and, once created,
-- the one second Admin, and records when bootstrap completed (the second Admin
-- became usable). A trigger keeps it moving forward only: no field that is set
-- can change and the row can never be deleted, so bootstrap never returns.
-- Ids are UUIDv7, given by the app (src/platform/ids.ts).

create type staff_role as enum ('ambassador', 'coordinator', 'director', 'admin');
create type staff_status as enum ('active', 'locked_pending_reissue', 'suspended', 'removed');

create table staff_account (
  id uuid primary key,
  auth_user_id uuid not null unique,
  username text not null unique,
  first_name text not null,
  last_name text not null,
  email text not null,
  role staff_role not null,
  status staff_status not null default 'active',
  must_change_password boolean not null default true,
  -- When the current starting password was issued: it is valid for 24 hours
  -- from then (S01.07). Null once the person has chosen their own password.
  starting_password_issued_at timestamptz,
  created_at timestamptz not null default now(),
  -- Null when the system created the account (scripts/create-first-admin).
  created_by uuid references staff_account (id),
  constraint staff_account_username_format check (char_length(username) between 3 and 32 and username ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'),
  constraint staff_account_first_name_length check (char_length(btrim(first_name)) between 1 and 100),
  constraint staff_account_last_name_length check (char_length(btrim(last_name)) between 1 and 100),
  constraint staff_account_email_format check (char_length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint staff_account_starting_password_issued check (not must_change_password or starting_password_issued_at is not null)
);
alter table staff_account enable row level security;

create table staff_bootstrap (
  singleton boolean primary key default true,
  first_admin_id uuid not null unique references staff_account (id),
  second_admin_id uuid unique references staff_account (id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint staff_bootstrap_one_row check (singleton),
  constraint staff_bootstrap_two_admins check (second_admin_id is null or second_admin_id <> first_admin_id),
  constraint staff_bootstrap_completed_with_second_admin check (completed_at is null or second_admin_id is not null)
);
alter table staff_bootstrap enable row level security;

-- Forward only: the first Admin and the start never change, the second Admin
-- and the completion are set once, and the row is never deleted or truncated.
create function staff_bootstrap_forward_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op <> 'UPDATE' then
    raise exception 'staff_bootstrap: % is not allowed (bootstrap never returns)', tg_op
      using errcode = 'insufficient_privilege';
  end if;
  if new.singleton is distinct from old.singleton
     or new.first_admin_id is distinct from old.first_admin_id
     or new.started_at is distinct from old.started_at
     or (old.second_admin_id is not null and new.second_admin_id is distinct from old.second_admin_id)
     or (old.completed_at is not null and new.completed_at is distinct from old.completed_at) then
    raise exception 'staff_bootstrap only moves forward: a field that is set cannot change'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
revoke all on function staff_bootstrap_forward_only() from public, anon, authenticated, service_role;

create trigger staff_bootstrap_forward_only
  before update or delete on staff_bootstrap
  for each row execute function staff_bootstrap_forward_only();
create trigger staff_bootstrap_no_truncate
  before truncate on staff_bootstrap
  for each statement execute function staff_bootstrap_forward_only();

-- S01.04 left this for here: every audit record's actor is a staff account
-- (null is the system). No ON DELETE action: accounts are never deleted, and
-- SET NULL would be an UPDATE, which audit_event refuses.
alter table audit_event
  add constraint audit_event_actor_staff_id_fkey foreign key (actor_staff_id) references staff_account (id);
create index audit_event_actor_staff_id_idx on audit_event (actor_staff_id);

-- Clients never reach either table (Supabase's default privileges grant every
-- new table in public to them). The app reads, adds and changes accounts and
-- the bootstrap row; it never deletes either.
revoke all on table staff_account, staff_bootstrap from public, anon, authenticated, service_role;
grant select, insert, update on table staff_account, staff_bootstrap to cvh_app;
create policy staff_account_app_select on staff_account for select to cvh_app using (true);
create policy staff_account_app_insert on staff_account for insert to cvh_app with check (true);
create policy staff_account_app_update on staff_account for update to cvh_app using (true) with check (true);
create policy staff_bootstrap_app_select on staff_bootstrap for select to cvh_app using (true);
create policy staff_bootstrap_app_insert on staff_bootstrap for insert to cvh_app with check (true);
create policy staff_bootstrap_app_update on staff_bootstrap for update to cvh_app using (true) with check (true);
