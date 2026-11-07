-- The Hub and partner space (PRD §6.3's F1–F13, the prototype's P-01 to P-16), built ahead of the MVP by the product owner's decision of
-- 2026-11-07 ("make up dummy data and do it"). Owned by the partners module (spine table ownership, AD-2). Every row the pilot holds here is
-- dummy data from data/partners/seed.json, loaded by the idempotent seed (scripts/seed/partners.mjs) as the migration role; people and numbers
-- in it are fictional (555 numbers, example.org addresses). Nothing here names a resident.
--
-- Two kinds of thing:
--  - a space (`space`): a room a partner opens for residents in a disruption (cooling, warming, clean air, charging), with its status (open,
--    full, closed, not activated), its capacity and when it was last confirmed. A space is at a place of the directory: `provider_id` is the
--    directory's catalogue id of that place (M052 Jenner Jean-Marie Community Centre), which is how the resident map and listing find it. It is
--    a plain checked text, not a foreign key: the directory's catalogue is loaded by its own seed and a space must not stop a provider from
--    leaving it. At most one space per place, so a pin has one status. Each change of a space is a row of `space_change` (who, when, what it
--    became) and an `audit_event` (`space.status_set`), in the same transaction.
--  - the coordination records: the organisations (`partner_org`), the shared space of a disruption (`shared_space`) and what is posted in it
--    (statements, decisions, handovers), what each organisation agreed in advance (`partner_commitment`), holds (`partner_supply`) and is
--    activated for (`partner_team`), the playbooks per disruption type, the exercises, the indicators and the look back with its actions.
--
-- Who writes what:
--  - the seed (migration role) writes every table.
--  - the app (cvh_app, through cvh_app_login) reads every table; of a space it may change only the status, purpose, the two capacities and the
--    confirmation (`space_update_columns`), and it may add `space_change` rows. Nothing else is written by the app in this release: the other
--    screens read the dummy data.
--  - residents read the open and full spaces through `GET /api/spaces` (public, the same for every visitor, AD-3), never these tables.
--
-- Supabase's default privileges grant every new table in public to anon, authenticated and service_role, so each table takes those back. No
-- table has a sequence (keys are text, or a uuid the database makes).

create table partner_org (
  id text primary key,
  name text not null,
  short_name text not null,
  -- hub, health (a community health centre), library, faith, tenants (a tenants' association), settlement, city, relief.
  kind text not null,
  sort_order smallint not null,
  -- The designated contact is a role, never a person (P-13); the number and address are fictional.
  contact_role text not null,
  contact_phone text not null,
  contact_email text not null,
  -- What the organisation said about its own capacity (P-05), null until it says.
  capacity text,
  capacity_set_at timestamptz,
  constraint partner_org_id_format check (id ~ '^[A-Z][A-Z0-9]{1,9}$'),
  constraint partner_org_kind_known check (kind in ('hub', 'health', 'library', 'faith', 'tenants', 'settlement', 'city', 'relief')),
  constraint partner_org_capacity_known check (capacity is null or capacity in ('available', 'stretched', 'at_capacity')),
  constraint partner_org_capacity_dated check ((capacity is null) = (capacity_set_at is null)),
  constraint partner_org_phone_fictional check (contact_phone ~ '^\(\d{3}\) 555-01\d{2}$'),
  constraint partner_org_email_fictional check (contact_email ~ '@([a-z0-9-]+\.)*example\.org$')
);

create table space (
  id text primary key,
  org_id text not null references partner_org (id),
  provider_id text,
  name text not null,
  -- The room inside the place, when it is not the whole place ("Community room").
  room text,
  street text not null,
  purpose text not null,
  status text not null default 'not_activated',
  capacity_max integer not null,
  -- People there now; null when nobody has counted.
  capacity_now integer,
  -- Today's hours as the organisation gave them ("09:00" to "21:00"), or null.
  opens_at text,
  closes_at text,
  -- The last time someone said the space is as shown, and who (a person and organisation, as words: a seeded partner contact or a Hub account's name).
  confirmed_at timestamptz,
  confirmed_by text,
  -- The Hub account that made the last change through the app; null for a seeded row.
  updated_by uuid references staff_account (id),
  updated_at timestamptz not null default now(),
  constraint space_id_format check (id ~ '^SP[0-9]{2,4}$'),
  constraint space_provider_id_format check (provider_id is null or provider_id ~ '^[A-Z][0-9]{3,6}$'),
  constraint space_purpose_known check (purpose in ('cooling', 'warming', 'clean_air', 'charging')),
  constraint space_status_known check (status in ('open', 'full', 'closed', 'not_activated')),
  constraint space_capacity_max_range check (capacity_max between 1 and 2000),
  constraint space_capacity_now_range check (capacity_now is null or capacity_now between 0 and capacity_max),
  -- A space that is not open has nobody counted in it.
  constraint space_capacity_now_when_open check (capacity_now is null or status in ('open', 'full')),
  -- An open or full space was confirmed by someone: residents are never shown a status nobody gave.
  constraint space_confirmed_when_open check (status not in ('open', 'full') or (confirmed_at is not null and confirmed_by is not null)),
  constraint space_hours_format check (
    (opens_at is null) = (closes_at is null) and (opens_at is null or (opens_at ~ '^[0-2][0-9]:[0-5][0-9]$' and closes_at ~ '^[0-2][0-9]:[0-5][0-9]$'))
  )
);
create unique index space_provider_id_idx on space (provider_id) where provider_id is not null;
create index space_org_id_idx on space (org_id);
create index space_updated_by_idx on space (updated_by);

-- One row per change of a space, newest last: what it became, who changed it and when. The status board's "who confirmed when" is the space's
-- own columns; this is the history P-06 lists.
create table space_change (
  id uuid primary key default gen_random_uuid(),
  space_id text not null references space (id),
  status text not null,
  purpose text not null,
  capacity_now integer,
  capacity_max integer not null,
  changed_by uuid references staff_account (id),
  changed_by_label text not null,
  changed_at timestamptz not null default now(),
  constraint space_change_status_known check (status in ('open', 'full', 'closed', 'not_activated')),
  constraint space_change_purpose_known check (purpose in ('cooling', 'warming', 'clean_air', 'charging'))
);
create index space_change_space_idx on space_change (space_id, changed_at);
create index space_change_changed_by_idx on space_change (changed_by);

-- The shared space of a disruption (P-01, P-02): one per disruption, with its type, level, place and purpose. Open while `closed_at` is null.
create table shared_space (
  id text primary key,
  hazard text not null,
  level smallint not null,
  location text not null,
  purpose text not null,
  opened_at timestamptz not null,
  opened_by text not null,
  closed_at timestamptz,
  constraint shared_space_hazard_known check (hazard in ('power', 'elevator', 'heat', 'smoke', 'flood', 'fire', 'water', 'winter', 'other')),
  constraint shared_space_level_range check (level in (1, 2)),
  constraint shared_space_purpose_known check (purpose in ('coordinate', 'shelter', 'welfare', 'recovery'))
);

-- What an organisation posts to a shared space (P-03): doing, can take on, cannot cover, need. `claimed_by` is the organisation that took a need
-- on; `answers` the statement it answers.
create table partner_statement (
  id text primary key,
  shared_space_id text not null references shared_space (id),
  org_id text not null references partner_org (id),
  person text not null,
  kind text not null,
  body text not null,
  posted_at timestamptz not null,
  claimed_by text references partner_org (id),
  answers text references partner_statement (id),
  constraint partner_statement_kind_known check (kind in ('doing', 'can_take', 'cannot_cover', 'need'))
);
create index partner_statement_space_idx on partner_statement (shared_space_id, posted_at);
create index partner_statement_org_idx on partner_statement (org_id);
create index partner_statement_claimed_by_idx on partner_statement (claimed_by);
create index partner_statement_answers_idx on partner_statement (answers);

-- What an organisation agreed to do before anything happened (P-11), by disruption type and mode, with the role that does it and the agreement
-- it comes from. `for_disruption` is its answer for the open disruption (P-02): null until it confirms or declines.
create table partner_commitment (
  id text primary key,
  org_id text not null references partner_org (id),
  hazard text not null,
  mode text not null,
  body text not null,
  role text not null,
  agreement text,
  review_due date not null,
  for_disruption text,
  constraint partner_commitment_mode_known check (mode in ('everyday', 'during', 'recovery')),
  constraint partner_commitment_for_disruption_known check (for_disruption is null or for_disruption in ('confirmed', 'declined'))
);
create index partner_commitment_org_idx on partner_commitment (org_id);

-- What each organisation holds, where and roughly how much (P-08).
create table partner_supply (
  id text primary key,
  org_id text not null references partner_org (id),
  item text not null,
  qty text not null,
  qty_num integer,
  unit text not null,
  location text not null,
  updated_at timestamptz not null,
  constraint partner_supply_item_known check (item in ('water', 'masks', 'power_banks', 'cots', 'blankets', 'interpreters', 'box_fans', 'flashlights', 'other')),
  constraint partner_supply_qty_known check (qty in ('few', 'some', 'plenty'))
);
create index partner_supply_org_idx on partner_supply (org_id);

-- The decision log of a shared space (P-09): who decided, when, what and why.
create table partner_decision (
  id text primary key,
  shared_space_id text not null references shared_space (id),
  org_id text not null references partner_org (id),
  person text not null,
  decided_at timestamptz not null,
  body text not null,
  why text not null
);
create index partner_decision_space_idx on partner_decision (shared_space_id, decided_at);
create index partner_decision_org_idx on partner_decision (org_id);

-- A handover note (P-10): who left, to whom, one line, and the statements still open.
create table partner_handover (
  id text primary key,
  shared_space_id text not null references shared_space (id),
  org_id text not null references partner_org (id),
  from_person text not null,
  to_person text,
  handed_at timestamptz not null,
  note text not null,
  open_items jsonb not null default '[]'::jsonb
);
create index partner_handover_space_idx on partner_handover (shared_space_id, handed_at);
create index partner_handover_org_idx on partner_handover (org_id);

-- One playbook per disruption type (P-12): agreed, proposed or a placeholder, with its day-one checklist (the steps) and version history.
create table playbook (
  hazard text primary key,
  state text not null,
  version text,
  agreed_on date,
  stale_after_mins integer not null,
  ambassador_posting text not null,
  -- Lists of words: who is activated, which spaces open, the alert templates, the day-one steps; `asks` maps an organisation's id to what it is
  -- asked; `history` is [{"version", "date", "by", "change"}], newest first.
  activated jsonb not null default '[]'::jsonb,
  spaces jsonb not null default '[]'::jsonb,
  templates jsonb not null default '[]'::jsonb,
  asks jsonb not null default '{}'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  history jsonb not null default '[]'::jsonb,
  constraint playbook_hazard_known check (hazard in ('power', 'elevator', 'heat', 'smoke', 'flood', 'fire', 'water', 'winter', 'other')),
  constraint playbook_state_known check (state in ('agreed', 'proposed', 'placeholder')),
  constraint playbook_agreed_dated check ((state = 'agreed') = (agreed_on is not null)),
  constraint playbook_posting_known check (ambassador_posting in ('direct', 'hub', 'none'))
);

-- Who is activated for a disruption type at a level (P-13), how they are reached and the event that starts it. A null team is a gap.
create table partner_team (
  hazard text not null,
  level smallint not null,
  team text,
  channels jsonb not null default '[]'::jsonb,
  trigger_event text,
  primary key (hazard, level),
  constraint partner_team_level_range check (level in (1, 2))
);

-- Exercises (P-14): scheduled ones and past ones (whose record is in the look back).
create table partner_exercise (
  id text primary key,
  hazard text not null,
  level smallint not null,
  title text not null,
  kind text not null,
  on_date date not null,
  repeats text not null default 'none',
  took_part integer,
  constraint partner_exercise_kind_known check (kind in ('scheduled', 'past')),
  constraint partner_exercise_repeats_known check (repeats in ('none', 'q', 'h', 'y')),
  constraint partner_exercise_level_range check (level in (1, 2))
);

-- The indicators (P-15): each one's figure for real disruptions, exercises and everyday, as words (counts and rates only; never fewer than 5).
create table partner_indicator (
  id text primary key,
  sort_order smallint not null,
  real_value text,
  exercise_value text,
  everyday_value text
);

-- Past records of closed shared spaces and exercises (P-16), with their lessons.
create table look_back_record (
  id text primary key,
  kind text not null,
  hazard text not null,
  place text not null,
  period text not null,
  title text not null,
  lessons jsonb not null default '[]'::jsonb,
  constraint look_back_record_kind_known check (kind in ('real', 'exercise')),
  constraint look_back_record_period_format check (period ~ '^[0-9]{4}-[0-9]{2}$')
);

-- The actions made from lessons (P-16): what will change, the owner role and when.
create table look_back_action (
  id text primary key,
  lesson text not null,
  body text not null,
  owner_role text not null,
  due date not null,
  status text not null,
  changed text,
  constraint look_back_action_status_known check (status in ('open', 'done'))
);

alter table partner_org enable row level security;
alter table space enable row level security;
alter table space_change enable row level security;
alter table shared_space enable row level security;
alter table partner_statement enable row level security;
alter table partner_commitment enable row level security;
alter table partner_supply enable row level security;
alter table partner_decision enable row level security;
alter table partner_handover enable row level security;
alter table playbook enable row level security;
alter table partner_team enable row level security;
alter table partner_exercise enable row level security;
alter table partner_indicator enable row level security;
alter table look_back_record enable row level security;
alter table look_back_action enable row level security;

revoke all on table partner_org, space, space_change, shared_space, partner_statement, partner_commitment, partner_supply, partner_decision,
  partner_handover, playbook, partner_team, partner_exercise, partner_indicator, look_back_record, look_back_action
  from public, anon, authenticated, service_role;

grant select on table partner_org, space, space_change, shared_space, partner_statement, partner_commitment, partner_supply, partner_decision,
  partner_handover, playbook, partner_team, partner_exercise, partner_indicator, look_back_record, look_back_action
  to cvh_app;
-- A space's status, purpose, capacities and confirmation are the only columns the app changes (P-01, P-06, P-07); its name, place and
-- organisation come only from the seed.
grant update (status, purpose, capacity_max, capacity_now, confirmed_at, confirmed_by, updated_by, updated_at) on table space to cvh_app;
grant insert on table space_change to cvh_app;

create policy partner_org_app_select on partner_org for select to cvh_app using (true);
create policy space_app_select on space for select to cvh_app using (true);
create policy space_app_update on space for update to cvh_app using (true) with check (true);
create policy space_change_app_select on space_change for select to cvh_app using (true);
create policy space_change_app_insert on space_change for insert to cvh_app with check (true);
create policy shared_space_app_select on shared_space for select to cvh_app using (true);
create policy partner_statement_app_select on partner_statement for select to cvh_app using (true);
create policy partner_commitment_app_select on partner_commitment for select to cvh_app using (true);
create policy partner_supply_app_select on partner_supply for select to cvh_app using (true);
create policy partner_decision_app_select on partner_decision for select to cvh_app using (true);
create policy partner_handover_app_select on partner_handover for select to cvh_app using (true);
create policy playbook_app_select on playbook for select to cvh_app using (true);
create policy partner_team_app_select on partner_team for select to cvh_app using (true);
create policy partner_exercise_app_select on partner_exercise for select to cvh_app using (true);
create policy partner_indicator_app_select on partner_indicator for select to cvh_app using (true);
create policy look_back_record_app_select on look_back_record for select to cvh_app using (true);
create policy look_back_action_app_select on look_back_action for select to cvh_app using (true);
