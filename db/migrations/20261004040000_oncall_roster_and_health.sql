-- S06.07: the on-call roster and the health job's memory (AD-8, AD-23), owned by the ops module (AD-2).
--
--  - `oncall_roster`: the phone numbers of the Admins who are texted when sending is stuck or failing. A row is a label (what the Hub calls
--    the number: a role or a first name, at most 40 characters) and a Canadian +1 number in E.164. The number is personal data
--    (AD-13): it is read only by the sender's ContactResolver (at the hand-off point) and by the roster screen, which shows it masked to its
--    last two digits; it is never written to a log, an audit record, an `ops_event` or a `delivery` row (AR-12, AR-17: a delivery names
--    this row's id, never the number). It is not encrypted by the application: like every other table of personal data, the project's
--    database is encrypted at rest by the platform, the app's role is the only one that can read it (RLS, grants to cvh_app only) and
--    no use case selects it for any purpose other than the two above (decision recorded in the spine, AD-23 as built).
--    The app may add and delete a row and may not change one: a number is replaced by removing and adding. `delivery_forget_recipient`
--    (S06.01) is this table's `ON DELETE SET NULL`: the trigger belongs here, in the migration that creates the table.
--  - `health_condition`: one row per condition the health job watches (`/api/jobs/health`): whether it holds now, since when, when the
--    on-call Admins were last texted about it and up to which `ops_event` it has told them (so a delivery that became `unknown` is texted
--    about once, not every half hour). It holds no personal data. The job locks the row (`FOR UPDATE`) for the condition it is judging,
--    so two overlapping runs never text twice. The five rows are made here, once; the app reads them and changes their state, and cannot
--    insert or delete a row.
--
-- Supabase's default privileges grant every new table to anon, authenticated and service_role, so each is taken back.

create table oncall_roster (
  id uuid primary key,
  label text not null,
  phone text not null,
  added_by uuid not null references staff_account (id),
  created_at timestamptz not null default now(),
  constraint oncall_roster_label_format check (btrim(label) <> '' and char_length(label) <= 40 and label !~ '[[:cntrl:]]'),
  constraint oncall_roster_phone_format check (phone ~ '^\+1[2-9][0-9]{9}$')
);
create unique index oncall_roster_phone_idx on oncall_roster (phone);
create index oncall_roster_added_by_idx on oncall_roster (added_by);
alter table oncall_roster enable row level security;
revoke all on table oncall_roster from public, anon, authenticated, service_role;
grant select, insert, delete on table oncall_roster to cvh_app;
create policy oncall_roster_app_select on oncall_roster for select to cvh_app using (true);
create policy oncall_roster_app_insert on oncall_roster for insert to cvh_app with check (true);
create policy oncall_roster_app_delete on oncall_roster for delete to cvh_app using (true);

create trigger oncall_roster_forget_deliveries after delete on oncall_roster
  for each row execute function delivery_forget_recipient('oncall');

create table health_condition (
  condition text primary key,
  active boolean not null default false,
  since timestamptz,
  last_alerted_at timestamptz,
  last_event_id bigint,
  checked_at timestamptz,
  constraint health_condition_known check (condition in ('queue_stuck', 'delivery_unknown', 'sender_stalled', 'smart_encoding_on', 'signature_failures')),
  constraint health_condition_since_stated check (active = (since is not null))
);
insert into health_condition (condition) values ('queue_stuck'), ('delivery_unknown'), ('sender_stalled'), ('smart_encoding_on'), ('signature_failures');
alter table health_condition enable row level security;
revoke all on table health_condition from public, anon, authenticated, service_role;
grant select on table health_condition to cvh_app;
grant update (active, since, last_alerted_at, last_event_id, checked_at) on table health_condition to cvh_app;
create policy health_condition_app_select on health_condition for select to cvh_app using (true);
create policy health_condition_app_update on health_condition for update to cvh_app using (true) with check (true);
