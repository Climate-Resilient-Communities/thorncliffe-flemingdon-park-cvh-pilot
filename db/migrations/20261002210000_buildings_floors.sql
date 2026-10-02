-- S01.13: the neighbourhoods, the pilot buildings and their floors, owned by the places
-- module (AD-2, AD-25).
--
-- `building` is keyed by the City register's `rsn` (the building's primary key everywhere,
-- spine: IDs), held as text of 1 to 9 digits. It holds facts only (AD-19: status is derived,
-- never stored): the address, the coordinates, the neighbourhood and the six D4-P facts of
-- the register (storeys, elevators, emergency power, cooling room, air conditioning, barrier
-- free entrance), with the time they last changed. A null fact is "not known".
-- `not_in_register_since` flags a building the latest import no longer finds, for an Admin
-- to review; buildings are never deleted.
-- `floors_confirmed_at` / `floors_confirmed_by` record that an Admin checked the floors.
--
-- `building_floor` gives every floor a stable id (UUIDv7, given by the app) that survives
-- renames: assignments and check-ins refer to it. The label is what people see: 1 to 8
-- letters, digits, spaces and hyphens, with at least one letter or digit, no spaces at either
-- end and no two spaces in a row, and unique within the
-- building ignoring case and spaces (`label_key`, compared by the unique constraint).
-- `sort_order` orders the floors in lists, lowest first.
--
-- The seed (scripts/seed/buildings.mjs) runs as the migrating role and writes all three
-- tables. The app's role (cvh_app, S01.04) reads them, confirms a building (two columns) and
-- adds, deletes and updates floors (only label, sort_order and confirmed: never the rsn or the id);
-- it can add or delete no building and no neighbourhood. No table here has a
-- sequence. Supabase's default privileges grant every new table in public to anon,
-- authenticated and service_role, so each table takes those back.

create table neighbourhood (
  id text primary key,
  name text not null,
  fsa text not null unique,
  constraint neighbourhood_id_format check (id ~ '^[A-Z]{2,6}$'),
  constraint neighbourhood_name_present check (btrim(name) <> ''),
  constraint neighbourhood_fsa_format check (fsa ~ '^[A-Z][0-9][A-Z]$')
);
alter table neighbourhood enable row level security;
revoke all on table neighbourhood from public, anon, authenticated, service_role;
grant select on table neighbourhood to cvh_app;
create policy neighbourhood_app_select on neighbourhood for select to cvh_app using (true);

create table building (
  rsn text primary key,
  neighbourhood_id text not null references neighbourhood (id),
  address text not null,
  latitude double precision not null,
  longitude double precision not null,
  storeys smallint,
  elevators smallint,
  emergency_power boolean,
  cooling_room boolean,
  air_conditioning text,
  barrier_free_entrance boolean,
  facts_updated_at timestamptz not null,
  not_in_register_since timestamptz,
  floors_confirmed_at timestamptz,
  floors_confirmed_by uuid references staff_account (id),
  created_at timestamptz not null default now(),
  constraint building_rsn_format check (rsn ~ '^[0-9]{1,9}$'),
  constraint building_address_present check (btrim(address) <> ''),
  constraint building_coordinates_valid check (latitude between -90 and 90 and longitude between -180 and 180),
  constraint building_storeys_valid check (storeys is null or storeys between 1 and 150),
  constraint building_elevators_valid check (elevators is null or elevators >= 0),
  constraint building_confirmation_complete check ((floors_confirmed_at is null) = (floors_confirmed_by is null))
);
create index building_neighbourhood_id_idx on building (neighbourhood_id);
create index building_floors_confirmed_by_idx on building (floors_confirmed_by);
alter table building enable row level security;
revoke all on table building from public, anon, authenticated, service_role;
grant select on table building to cvh_app;
grant update (floors_confirmed_at, floors_confirmed_by) on table building to cvh_app;
create policy building_app_select on building for select to cvh_app using (true);
create policy building_app_update on building for update to cvh_app using (true) with check (true);

create table building_floor (
  id uuid primary key,
  rsn text not null references building (rsn),
  label text not null,
  label_key text generated always as (lower(replace(label, ' ', ''))) stored,
  sort_order integer not null,
  confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint building_floor_label_format check (label ~ '^[A-Za-z0-9 -]{1,8}$' and label ~ '[A-Za-z0-9]' and label = btrim(label) and label !~ '  '),
  constraint building_floor_label_unique unique (rsn, label_key)
);
alter table building_floor enable row level security;
revoke all on table building_floor from public, anon, authenticated, service_role;
grant select, insert, delete on table building_floor to cvh_app;
grant update (label, sort_order, confirmed) on table building_floor to cvh_app;
create policy building_floor_app_select on building_floor for select to cvh_app using (true);
create policy building_floor_app_insert on building_floor for insert to cvh_app with check (true);
create policy building_floor_app_update on building_floor for update to cvh_app using (true) with check (true);
create policy building_floor_app_delete on building_floor for delete to cvh_app using (true);
