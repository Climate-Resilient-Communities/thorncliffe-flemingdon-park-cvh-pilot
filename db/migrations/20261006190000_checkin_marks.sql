-- S08.07: the round works without signal and leaves nothing on the phone (E08 definitions "Marks", "Late mark", "Closed stub", "Escalation",
-- AD-12, AD-18). The rows, their guards, the tally and the stubs' purge are S08.05's (20261006170000_checkin_request.sql); what a mark adds:
--
--  - `checkin.mark_ids`: the ids of the marks applied to the row (each made by the round page when the ambassador taps, and sent again with it
--    until an answer comes), so a mark sent twice is applied once: a mark whose id is here changes nothing. A later mark on the same row
--    replaces the earlier one (`status` is the latest; S08.05's tally records it as the row's outcome when the row leaves the round). The ids
--    are random and say nothing about anyone; they stay with the row while it is a stub (a mark sent again after the row closed still reads
--    as applied) and are deleted with it, 2 hours after it closed. At most the 50 latest are kept (the app keeps the window).
--  - `checkin_escalation`: one per `round_ref` and status (`not_reached` or `needs_help`), made in the mark's own transaction, from a mark on a
--    live row and from a late mark on a stub that has not expired. It holds the thread, the building, the floor, the staff member who marked
--    and whether the mark was late, never the subscriber, the method or a phone number: a late mark's escalation names the stub's building
--    and floor and the ambassador only. It has no foreign key to `alert` or `checkin`: it outlives the stub (deleted 2 hours after close), and
--    the database tests truncate the alert tables without naming it (as `correction_reach_kept`). The Hub's list (O-17), the text to the
--    on-duty Admin and the handling are S08.08's, which adds what it needs here.
--
-- The app may read and add escalations and change nothing of them yet. New column (with a default) and new table: nothing here is
-- destructive. Supabase's default privileges grant every new table to anon, authenticated and service_role, so it is taken back.

alter table checkin add column mark_ids uuid[] not null default '{}';
-- NOT VALID: the column is new, so every existing row has none and already passes.
alter table checkin add constraint checkin_mark_ids_bounded check (cardinality(mark_ids) <= 50) not valid;
grant update (mark_ids) on table checkin to cvh_app;

create table checkin_escalation (
  id uuid primary key,
  round_ref uuid not null,
  status text not null,
  alert_id uuid not null,
  rsn text not null references building (rsn),
  floor_id uuid not null,
  raised_by uuid not null references staff_account (id),
  late boolean not null,
  created_at timestamptz not null default now(),
  constraint checkin_escalation_status_known check (status in ('not_reached', 'needs_help'))
);
create unique index checkin_escalation_round_ref_status_idx on checkin_escalation (round_ref, status);
create index checkin_escalation_alert_id_idx on checkin_escalation (alert_id);
create index checkin_escalation_raised_by_idx on checkin_escalation (raised_by);
create index checkin_escalation_rsn_idx on checkin_escalation (rsn);
alter table checkin_escalation enable row level security;
revoke all on table checkin_escalation from public, anon, authenticated, service_role;
grant select, insert on table checkin_escalation to cvh_app;
create policy checkin_escalation_app_select on checkin_escalation for select to cvh_app using (true);
create policy checkin_escalation_app_insert on checkin_escalation for insert to cvh_app with check (true);
