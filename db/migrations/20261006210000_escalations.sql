-- S08.08: the Hub hears at once about anyone not reached or needing help (E08 definitions "On-duty Admin", "Escalation", "Closed stub", "Round
-- tally", AD-12, AD-13, AD-15, AD-18). The escalation rows are S08.07's (20261006190000_checkin_marks.sql), made in the mark's own transaction; the
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
--  - At most one open escalation per row and status: a `not_reached` or `needs_help` mark after the Hub handled the earlier one of that status is a
--    new escalation, with its own text (review round 1). S08.07's release, in production when this applies, inserts escalations with
--    `ON CONFLICT (round_ref, status) DO NOTHING`, which needs a unique index on exactly those two columns (a partial index is never its arbiter),
--    so `checkin_escalation_round_ref_status_idx` stays as it is and an escalation leaves its key when handled: the guard moves its `round_ref` to
--    `handled_ref` (a unique index never compares nulls). The row an escalation is about is its `round_ref` while open, its `handled_ref` once
--    handled. `mark_id` is the mark that raised it, so a late mark sent again after its escalation was handled is still the one mark (a stub never
--    changes, so a late mark's id cannot be kept on the row as a live mark's is).
--  - The purge job (`checkins-purge-stubs`, every 15 minutes, as the table's owner) also (a) tallies, as a close does, each row still live in a
--    closed thread: the rows S08.06's rounds left before this release, and any that a close of the previous release leaves while it still serves
--    (the deploy's window, a rollback: AD-15), tallied as of the thread's close; (b) turns a row kept for the Hub's follow-up into a closed stub
--    23 hours 45 minutes after the close (its subscriber and method gone, `closed_at` now), one run early, so the resident's number is gone within
--    24 hours of the close as the terms say, without tallying it again (S08.05's trigger counts only a row's first `tallied_at`); the stub is then
--    deleted 2 hours after it was made, as every stub is.
--
-- New columns (with a default, or null), `round_ref` no longer not null, new checks NOT VALID, column grants, update policies and two guards. The
-- guards are new triggers on tables the release in production writes (`oncall_roster`, S06.07; `checkin_escalation`, S08.07). That release inserts
-- roster entries without naming `role` (so the default `oncall`, which `oncall_roster_guard` accepts) and never updates one, and it has no UPDATE
-- on `checkin_escalation` (`checkin_escalation_guard` runs before an update only), so neither guard can raise on its writes; nor can the new
-- checks (its escalations are open, with `round_ref` set and nothing handled).
-- contract: 75df200ee0266f06a62fef18677a16169e97905e

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
  add column handled_note text,
  add column handled_ref uuid,
  add column mark_id uuid;
-- An open escalation names its row in `round_ref` (the unique index's key), a handled one in `handled_ref`.
alter table checkin_escalation alter column round_ref drop not null;
-- NOT VALID: the columns are new, so every existing escalation is open, names its row in `round_ref` and already passes.
alter table checkin_escalation
  add constraint checkin_escalation_handled_whole check ((handled_at is null) = (handled_by is null) and (handled_at is null) = (handled_note is null)) not valid,
  add constraint checkin_escalation_note_format check (
    handled_note is null or (btrim(handled_note) <> '' and char_length(handled_note) <= 300 and handled_note !~ '[[:cntrl:]]')
  ) not valid,
  add constraint checkin_escalation_ref_while_open check ((handled_at is null) = (round_ref is not null) and (handled_at is null) = (handled_ref is null)) not valid;
create index checkin_escalation_handled_by_idx on checkin_escalation (handled_by);
create index checkin_escalation_handled_ref_idx on checkin_escalation (handled_ref);
create index checkin_escalation_open_idx on checkin_escalation (created_at) where handled_at is null;
grant update (handled_at, handled_by, handled_note) on table checkin_escalation to cvh_app;
create policy checkin_escalation_app_update on checkin_escalation for update to cvh_app using (true) with check (true);

-- What an escalation is never changes, and it is handled once; the handling moves the row it is about out of the unique index's key (`round_ref` to
-- `handled_ref`), so the next mark of its status on that row makes a new one.
create function checkin_escalation_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.round_ref is distinct from old.round_ref or new.status is distinct from old.status
     or new.alert_id is distinct from old.alert_id or new.rsn is distinct from old.rsn or new.floor_id is distinct from old.floor_id
     or new.raised_by is distinct from old.raised_by or new.late is distinct from old.late or new.created_at is distinct from old.created_at
     or new.handled_ref is distinct from old.handled_ref or new.mark_id is distinct from old.mark_id then
    raise exception 'checkin_escalation: what an escalation is never changes' using errcode = 'check_violation';
  end if;
  if old.handled_at is not null then
    raise exception 'checkin_escalation: an escalation is handled once' using errcode = 'check_violation';
  end if;
  if new.handled_at is not null then
    new.handled_ref := old.round_ref;
    new.round_ref := null;
  end if;
  return new;
end
$$;
revoke all on function checkin_escalation_guard() from public, anon, authenticated, service_role;
create trigger checkin_escalation_guard before update on checkin_escalation for each row execute function checkin_escalation_guard();

-- ---------------------------------------------------------------- the purge: rows left live in closed threads, kept rows within 24 hours of the close
-- Scheduling by name replaces S08.05's job. Its statements run in one transaction, in this order:
--  1. A row still live in a closed thread is tallied as a close tallies it (checkins' `closeRound`): its latest mark, else `unmarked`; a `not_reached`
--     or `needs_help` row with an escalation the Hub has not handled is kept for the follow-up, every other row becomes a stub. Its `tallied_at` is
--     the thread's close, so its 24 hours run from there. A row a mark, a handling or a deletion holds is left for the next run (SKIP LOCKED: the job
--     never waits on a row while it holds others).
--  2. A kept row (tallied, not closed) becomes a stub with no resident data 23 hours 45 minutes after the close (S08.05's update guard lets it leave
--     its subscriber once): with a run every 15 minutes, none keeps the number past 24 hours. A row someone holds is left for the next run.
--  3. Every stub is deleted 2 hours after it was made (S08.05's).
select cron.schedule(
  'checkins-purge-stubs',
  '*/15 * * * *',
  $job$
    with ended as (
      select c.id, coalesce(a.closed_at, now()) as closed_at,
             c.status in ('not_reached', 'needs_help')
               and exists (select 1 from public.checkin_escalation e where e.round_ref = c.round_ref and e.handled_at is null) as kept
        from public.checkin c join public.alert a on a.id = c.alert_id
       where a.status = 'closed' and c.closed_at is null and c.tallied_at is null
       order by c.id
         for update of c skip locked
    )
    update public.checkin c
       set outcome = case when c.status = 'pending' then 'unmarked' else c.status end,
           tallied_at = ended.closed_at,
           subscriber_id = case when ended.kept then c.subscriber_id end,
           method = case when ended.kept then c.method end,
           closed_at = case when ended.kept then null else now() end
      from ended
     where c.id = ended.id;
    update public.checkin set subscriber_id = null, method = null, closed_at = now()
     where id in (
       select id from public.checkin where closed_at is null and tallied_at <= now() - interval '23 hours 45 minutes' order by id for update skip locked
     );
    delete from public.checkin where closed_at <= now() - interval '2 hours';
  $job$
);
