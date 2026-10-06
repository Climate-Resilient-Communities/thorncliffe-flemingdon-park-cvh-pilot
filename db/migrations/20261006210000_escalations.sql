-- S08.08: the Hub hears at once about anyone not reached or needing help (E08 definitions "On-duty Admin", "Escalation", "Closed stub", "Round
-- tally", AD-12, AD-13, AD-18). The escalation rows are S08.07's (20261006190000_checkin_marks.sql), made in the mark's own transaction; the
-- rows, their guards, the tally and the stubs' purge are S08.05's (20261006170000_checkin_request.sql). What this adds:
--
--  - The on-duty Admin (ops' `oncall_roster`, S06.07): an entry's `role` is `oncall` (every entry so far) or `on_duty`, and an on-duty entry names
--    the Admin account it belongs to (`staff_id`). At most one entry is on duty. It must be an active Admin account with an authenticator
--    (`factor_enrolled_at`) and its own password, so whoever receives an escalation's text can sign in at aal2 and open the resident's details:
--    the app checks it under the roster's lock, and the guard below refuses anything else, whoever writes. An account that stops being one later
--    (suspended, demoted, its authenticator reset) leaves the entry as it is; the app then treats nobody as on duty (the escalation goes to every
--    on-call number, and the approval view of a round-type alert says so). The app may change those two columns of an entry and nothing else of it.
--  - The handling of an escalation (`checkin_escalation`): when, by whom, and the Admin's note (one line, at most 300 characters, written by the
--    Admin: what the Hub did). The three are set together, once; nothing else of an escalation ever changes. The note is the only free text the
--    check-in tables hold; it is shown to Hub staff and to a resident's access request while the row names her, and is never audited or logged.
--  - The purge job (`checkins-purge-stubs`, every 15 minutes, as the table's owner) also turns a row kept for the Hub's follow-up into a closed
--    stub 24 hours after it was tallied at the close (its subscriber and method gone, `closed_at` now), without tallying it again (S08.05's
--    trigger counts only a row's first `tallied_at`); the stub is then deleted 2 hours after it was made, as every stub is.
--  - Rows left live in threads closed before this release (S08.06's rounds ended with no tally): tallied now as a close tallies them.
--
-- New columns (with a default, or null), new checks NOT VALID, column grants, update policies and guards: nothing here is destructive.

-- ---------------------------------------------------------------- the on-duty Admin
alter table oncall_roster
  add column role text not null default 'oncall',
  add column staff_id uuid references staff_account (id);
-- NOT VALID: the columns are new, so every existing row is an `oncall` entry with no account and already passes.
alter table oncall_roster
  add constraint oncall_roster_role_known check (role in ('oncall', 'on_duty')) not valid,
  add constraint oncall_roster_on_duty_linked check ((role = 'on_duty') = (staff_id is not null)) not valid;
create unique index oncall_roster_one_on_duty_idx on oncall_roster (role) where role = 'on_duty';
create index oncall_roster_staff_id_idx on oncall_roster (staff_id);
grant update (role, staff_id) on table oncall_roster to cvh_app;
create policy oncall_roster_app_update on oncall_roster for update to cvh_app using (true) with check (true);

-- What an entry is (its label, number and who added it) never changes; an on-duty entry is an active Admin's with an authenticator.
create function oncall_roster_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.id is distinct from old.id or new.label is distinct from old.label or new.phone is distinct from old.phone
     or new.added_by is distinct from old.added_by or new.created_at is distinct from old.created_at) then
    raise exception 'oncall_roster: only an entry''s role and account change' using errcode = 'check_violation';
  end if;
  if new.role = 'on_duty' and not exists (
    select 1 from public.staff_account s
     where s.id = new.staff_id and s.role = 'admin' and s.status = 'active' and s.factor_enrolled_at is not null and not s.must_change_password
  ) then
    raise exception 'oncall_roster: an on-duty entry is an active Admin account''s with an authenticator' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke all on function oncall_roster_guard() from public, anon, authenticated, service_role;
create trigger oncall_roster_guard before insert or update on oncall_roster for each row execute function oncall_roster_guard();

-- ---------------------------------------------------------------- the handling of an escalation
alter table checkin_escalation
  add column handled_at timestamptz,
  add column handled_by uuid references staff_account (id),
  add column handled_note text;
-- NOT VALID: the columns are new, so every existing escalation is open and already passes.
alter table checkin_escalation
  add constraint checkin_escalation_handled_whole check ((handled_at is null) = (handled_by is null) and (handled_at is null) = (handled_note is null)) not valid,
  add constraint checkin_escalation_note_format check (
    handled_note is null or (btrim(handled_note) <> '' and char_length(handled_note) <= 300 and handled_note !~ '[[:cntrl:]]')
  ) not valid;
create index checkin_escalation_handled_by_idx on checkin_escalation (handled_by);
create index checkin_escalation_open_idx on checkin_escalation (created_at) where handled_at is null;
grant update (handled_at, handled_by, handled_note) on table checkin_escalation to cvh_app;
create policy checkin_escalation_app_update on checkin_escalation for update to cvh_app using (true) with check (true);

-- What an escalation is never changes, and it is handled once.
create function checkin_escalation_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.round_ref is distinct from old.round_ref or new.status is distinct from old.status
     or new.alert_id is distinct from old.alert_id or new.rsn is distinct from old.rsn or new.floor_id is distinct from old.floor_id
     or new.raised_by is distinct from old.raised_by or new.late is distinct from old.late or new.created_at is distinct from old.created_at then
    raise exception 'checkin_escalation: what an escalation is never changes' using errcode = 'check_violation';
  end if;
  if old.handled_at is not null then
    raise exception 'checkin_escalation: an escalation is handled once' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke all on function checkin_escalation_guard() from public, anon, authenticated, service_role;
create trigger checkin_escalation_guard before update on checkin_escalation for each row execute function checkin_escalation_guard();

-- ---------------------------------------------------------------- the purge: kept rows become stubs 24 hours after the close
-- Scheduling by name replaces S08.05's job. A kept row is tallied and not closed; it becomes a stub with no resident data (S08.05's update guard
-- lets it leave its subscriber once), and every stub is deleted 2 hours after it was made.
select cron.schedule(
  'checkins-purge-stubs',
  '*/15 * * * *',
  $job$
    update public.checkin set subscriber_id = null, method = null, closed_at = now()
     where closed_at is null and tallied_at <= now() - interval '24 hours';
    delete from public.checkin where closed_at <= now() - interval '2 hours';
  $job$
);

-- ---------------------------------------------------------------- rows left live in threads already closed
-- As a close tallies them (checkins' `closeRound`): each live row's latest mark, else `unmarked`; a `not_reached` or `needs_help` row with an
-- escalation the Hub has not handled is kept for the follow-up, every other row becomes a stub.
with ended as (
  select c.id,
         c.status in ('not_reached', 'needs_help')
           and exists (select 1 from checkin_escalation e where e.round_ref = c.round_ref and e.handled_at is null) as kept
    from checkin c join alert a on a.id = c.alert_id
   where a.status = 'closed' and c.closed_at is null and c.tallied_at is null
)
update checkin c
   set outcome = case when c.status = 'pending' then 'unmarked' else c.status end,
       tallied_at = now(),
       subscriber_id = case when ended.kept then c.subscriber_id end,
       method = case when ended.kept then c.method end,
       closed_at = case when ended.kept then null else now() end
  from ended
 where c.id = ended.id;
