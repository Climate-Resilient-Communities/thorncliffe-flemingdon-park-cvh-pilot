-- S08.09: the Hub sees round counts by building and floor (E08 definitions "Round tally", "Closed stub"). The tally is S08.05's (`checkin_tally`,
-- 20261006170000_checkin_request.sql), kept by its trigger in the statement's own transaction: +1 `requested` when a row is made, +1 of the row's outcome
-- when it is tallied (its latest mark, else `withdrawn` or `unmarked`), once. Every way a row leaves its round goes through that: a withdrawal, a change of
-- where the resident lives and a deletion (checkins' `leaveRounds`), a close (`closeRound`, S08.08), and a kept row's handling or purge, which add nothing.
--
-- One way did not: `checkin.subscriber_id` is ON DELETE CASCADE as a backstop (the app's deletion turns the rows into stubs first, S08.05), and a live
-- row deleted with its subscriber left its round with no outcome, so its place's `requested` stayed one more than the sum of its outcomes for good. The
-- tally's function now also counts a row deleted before it was tallied, as a withdrawal counts it: its latest mark, else `withdrawn`. A stub and a row
-- kept for the Hub were tallied already, so deleting them (the purge job) adds nothing, as before.
--
-- A replaced function and a new trigger on an existing table, which only counts and never refuses a write (its contract note is below the function).

create or replace function checkin_tally_count() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  counted text;
  counted_row record;
begin
  if tg_op = 'INSERT' then
    counted := 'requested';
    counted_row := new;
  elsif tg_op = 'UPDATE' and old.tallied_at is null and new.tallied_at is not null then
    counted := new.outcome;
    counted_row := new;
  elsif tg_op = 'DELETE' and old.tallied_at is null then
    counted := case when old.status = 'pending' then 'withdrawn' else old.status end;
    counted_row := old;
  else
    return null;
  end if;
  insert into public.checkin_tally as t (alert_id, rsn, floor_id, status, n)
  values (counted_row.alert_id, counted_row.rsn, counted_row.floor_id, counted, 1)
  on conflict (alert_id, rsn, floor_id, status) do update set n = t.n + 1;
  return null;
end
$$;
revoke all on function checkin_tally_count() from public, anon, authenticated, service_role;

-- The release in production when this applies never deletes a row that is not yet tallied (the app has no delete on `checkin`, the purge job deletes
-- tallied stubs only, and its deletions turn the rows into stubs first), and a row it deletes with its subscriber names a thread (`alert`, which the tally
-- refers to) that exists: this trigger never raises on its writes.
-- contract: de7abfe9271cd826090c4d5b8b515679d6e905e6
create trigger checkin_tally_left after delete on checkin for each row execute function checkin_tally_count();
