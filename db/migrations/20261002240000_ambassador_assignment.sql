-- S01.14: which Ambassador covers which building and floors, owned by the identity module
-- (AD-4, AD-12, AR-16). The only coverage test is identity's `coversFloor(rsn, floor_id)`.
--
-- `ambassador_assignment` is one row per Ambassador and building: `all_floors` is true for every
-- floor of the building (the spine's `floors = null`, also for floors added later), false for the
-- listed floors, which `ambassador_assignment_floor` holds one row each, by floor id. Floors are
-- referred to by id, never by label, so a renamed label stays covered; the spine's `floors:
-- number[]` is pending an owner decision and this follows the floor-id model of S01.13.
--
-- `ambassador_assignment_floor` refers to `building_floor` with `on delete restrict`: the database
-- itself refuses to delete a floor any assignment lists, whoever runs the delete and whatever the
-- app checked. A trigger on insert makes a floor of another building impossible (building_floor is not
-- altered: a new key on it would be a destructive change for the release still serving).
-- The app lists who blocks a removal first (identity's reader, wired into places' removal guard).
--
-- An assignment is either "all floors" with no floor rows, or listed floors with at least one row.
-- A deferred constraint trigger checks that when the transaction ends, so the app can replace an
-- assignment's floors in one transaction. Only an Ambassador can be assigned (a trigger on insert).
-- Whether an assignment covers anything is decided when asked (an active Ambassador), not stored:
-- a suspended, locked or removed account keeps its rows but covers nothing.
--
-- The app's role (cvh_app) reads and writes both tables; it updates only all_floors, assigned_by
-- and assigned_at of an assignment, never who or where. Supabase's default privileges grant every new
-- table in public to anon, authenticated and service_role, so each table takes those back.

create table ambassador_assignment (
  staff_id uuid not null references staff_account (id),
  rsn text not null references building (rsn),
  all_floors boolean not null,
  assigned_by uuid not null references staff_account (id),
  assigned_at timestamptz not null default now(),
  primary key (staff_id, rsn)
);
create index ambassador_assignment_rsn_idx on ambassador_assignment (rsn);
create index ambassador_assignment_assigned_by_idx on ambassador_assignment (assigned_by);
alter table ambassador_assignment enable row level security;
revoke all on table ambassador_assignment from public, anon, authenticated, service_role;
grant select, insert, delete on table ambassador_assignment to cvh_app;
grant update (all_floors, assigned_by, assigned_at) on table ambassador_assignment to cvh_app;
create policy ambassador_assignment_app_select on ambassador_assignment for select to cvh_app using (true);
create policy ambassador_assignment_app_insert on ambassador_assignment for insert to cvh_app with check (true);
create policy ambassador_assignment_app_update on ambassador_assignment for update to cvh_app using (true) with check (true);
create policy ambassador_assignment_app_delete on ambassador_assignment for delete to cvh_app using (true);

create table ambassador_assignment_floor (
  staff_id uuid not null,
  rsn text not null,
  floor_id uuid not null,
  primary key (staff_id, floor_id),
  constraint ambassador_assignment_floor_assignment_fk foreign key (staff_id, rsn) references ambassador_assignment (staff_id, rsn) on delete cascade,
  constraint ambassador_assignment_floor_floor_fk foreign key (floor_id) references building_floor (id) on delete restrict
);
create index ambassador_assignment_floor_floor_idx on ambassador_assignment_floor (floor_id);
alter table ambassador_assignment_floor enable row level security;
revoke all on table ambassador_assignment_floor from public, anon, authenticated, service_role;
grant select, insert, delete on table ambassador_assignment_floor to cvh_app;
create policy ambassador_assignment_floor_app_select on ambassador_assignment_floor for select to cvh_app using (true);
create policy ambassador_assignment_floor_app_insert on ambassador_assignment_floor for insert to cvh_app with check (true);
create policy ambassador_assignment_floor_app_delete on ambassador_assignment_floor for delete to cvh_app using (true);

-- Only an Ambassador can be assigned. The role of an account that is assigned later changes is
-- not followed here: its rows stay, and it covers nothing while it is not an active Ambassador.
create function ambassador_assignment_ambassadors_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.staff_account where id = new.staff_id and role = 'ambassador') then
    raise exception 'Only an Ambassador can be assigned to a building'
      using errcode = 'check_violation', constraint = 'ambassador_assignment_ambassadors_only';
  end if;
  return new;
end
$$;
revoke all on function ambassador_assignment_ambassadors_only() from public, anon, authenticated, service_role;

create trigger ambassador_assignment_ambassadors_only
  before insert on ambassador_assignment
  for each row execute function ambassador_assignment_ambassadors_only();

-- A listed floor must be a floor of the assignment's own building. (A floor never changes building: the
-- app cannot update building_floor.rsn.)
create function ambassador_assignment_floor_same_building() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.building_floor where id = new.floor_id and rsn = new.rsn) then
    raise exception 'A listed floor must be a floor of the assigned building'
      using errcode = 'foreign_key_violation', constraint = 'ambassador_assignment_floor_same_building';
  end if;
  return new;
end
$$;
revoke all on function ambassador_assignment_floor_same_building() from public, anon, authenticated, service_role;

create trigger ambassador_assignment_floor_same_building
  before insert on ambassador_assignment_floor
  for each row execute function ambassador_assignment_floor_same_building();

-- "All floors" has no floor rows; listed floors have at least one. Checked when the transaction
-- ends, after the app has replaced an assignment's rows. An assignment deleted in the transaction
-- (its floor rows go with it) has nothing left to check.
create function ambassador_assignment_floors_shape() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  who uuid;
  where_rsn text;
  whole boolean;
  listed boolean;
begin
  if tg_op = 'DELETE' then
    who := old.staff_id;
    where_rsn := old.rsn;
  else
    who := new.staff_id;
    where_rsn := new.rsn;
  end if;
  select all_floors into whole from public.ambassador_assignment where staff_id = who and rsn = where_rsn;
  if not found then
    return null;
  end if;
  select exists (select 1 from public.ambassador_assignment_floor where staff_id = who and rsn = where_rsn) into listed;
  if whole = listed then
    raise exception 'An assignment is either every floor of the building or a list of at least one floor'
      using errcode = 'check_violation', constraint = 'ambassador_assignment_floors_shape';
  end if;
  return null;
end
$$;
revoke all on function ambassador_assignment_floors_shape() from public, anon, authenticated, service_role;

create constraint trigger ambassador_assignment_floors_shape
  after insert or update on ambassador_assignment
  deferrable initially deferred
  for each row execute function ambassador_assignment_floors_shape();

create constraint trigger ambassador_assignment_floor_shape
  after insert or delete on ambassador_assignment_floor
  deferrable initially deferred
  for each row execute function ambassador_assignment_floors_shape();
