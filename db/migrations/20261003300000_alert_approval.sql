-- S04.07: a second person approves exactly what they reviewed (AD-5, AD-14, AD-18), owned by the alerting module.
--
-- What this adds to the tables S04.03 and S04.05 created:
--  1. `alert_entry.returned_note`: the note an approver writes when they send an entry back to its author ("Return to author with a
--     note"). The return keeps the text and clears the approval binding (S04.03); the note is what the author reads, on their
--     incidents list and on the composer, until they submit again. It exists exactly while `returned_for = 'return'`: the entry
--     guard requires it for that return, refuses it for the others (`edit`, `retranslate`), and a submit clears it together with
--     `returned_for`. It is free text typed by a person (at most 500 characters): it is never written to the audit trail, which
--     holds no free text (AD-13).
--  2. `alert_approval_timing` and `alert_approval_timing_summary`: the pilot's timings (FR-M2, AD-14: "Section 9 timings are SQL
--     views"). For every approved entry, the time from the author's first save (the draft's creation) to its approval; for the
--     first approved acknowledgement of a thread, the time from `alert.reported_at` to its approval. Both read the database's own
--     clock (`approved_at` is set by the entry guard to now(), never by the app), and both keep drills apart: every row says
--     whether its thread is a drill, and the summary is grouped by it, so a rehearsal never counts as a real response.
--
-- New constraints on tables that already exist are NOT VALID (expand-only; see 20261002290000_alert_audience_shape.sql for why none is
-- validated here): no entry has been returned with a note before this migration (an earlier return without one is made a plain draft below,
-- because a NOT VALID check still binds every insert and update, rows already there included). The entry guard is replaced, not duplicated
-- (a new trigger on a table the previous release writes is a destructive change).
--
-- Supabase's default privileges grant every new relation in public to anon, authenticated and service_role, so the views take those
-- back; only cvh_app (S01.04) reads them.

-- ---------------------------------------------------------------------------------------------
-- 1. alert_entry.returned_note
-- ---------------------------------------------------------------------------------------------
alter table alert_entry add column returned_note text;
-- A NOT VALID check still binds every UPDATE of every row, so a row that already breaks the check below could no longer be saved or discarded.
-- An entry an approver sent back before this migration (`returned_for = 'return'`: S04.03's use case existed, no screen did; none outside development
-- databases) has no note, because the column is new. It becomes a plain draft: its text stays, only the mark of that return goes. The entry guard of
-- S04.05 refuses a change of `returned_for` on a draft, so it is off for this one statement and back on, in this same transaction, before anything else
-- can write (the guard replaced below is then the one that runs).
alter table alert_entry disable trigger alert_entry_guard;
update alert_entry set returned_for = null where returned_for = 'return';
alter table alert_entry enable trigger alert_entry_guard;
alter table alert_entry add constraint alert_entry_returned_note_valid check (returned_note is null or (btrim(returned_note) <> '' and char_length(returned_note) <= 500)) not valid;
-- The note and the reason go together: an approver's return (`return`) has a note, every other state of the entry has none.
alter table alert_entry add constraint alert_entry_return_has_note check (((returned_for = 'return') is true) = (returned_note is not null)) not valid;
grant update (returned_note) on table alert_entry to cvh_app;

-- The entry guard of S04.05 with the note's rules added (everything else is that function, unchanged):
--  - a new entry has no note;
--  - a draft's note does not change by saving it (only the return that makes it a draft sets it, and the submit that freezes it clears it);
--  - an approver's return carries a non-blank note, and an edit or a re-translation carries none;
--  - a submit carries none (the note is cleared with `returned_for`), and a discard changes nothing else, the note included.
create or replace function alert_entry_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor_text text := nullif(current_setting('cvh.actor_id', true), '');
  actor uuid;
  thread_status text;
  content_changed boolean;
  bad_type text;
begin
  if actor_text is not null and actor_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    actor := actor_text::uuid;
  end if;

  select a.status into thread_status from public.alert a where a.id = new.alert_id;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'alert_entry: a new entry starts as a draft, not %', new.status using errcode = 'check_violation';
    end if;
    if thread_status is distinct from 'open' then
      raise exception 'ALERT_CLOSED: an entry cannot be added to a closed thread' using errcode = 'check_violation';
    end if;
    if actor is null then
      raise exception 'alert_entry: the acting account (cvh.actor_id) is required' using errcode = 'check_violation';
    end if;
    if actor <> new.author_id then
      raise exception 'alert_entry: the author must be the acting account' using errcode = 'check_violation';
    end if;
    if new.version <> 0 or new.web_published_at is not null then
      raise exception 'alert_entry: a new entry has no version and is not web-published' using errcode = 'check_violation';
    end if;
    if new.returned_note is not null then
      raise exception 'alert_entry: a new entry has no return note' using errcode = 'check_violation';
    end if;
    -- The table's check already allows the kinds E05 adds (correction, withdrawal, final), but only
    -- ack and update are authored here; E05 widens this list together with its use cases.
    if new.kind not in ('ack', 'update') then
      raise exception 'alert_entry: only an ack or an update is created in this epic, not %', new.kind using errcode = 'check_violation';
    end if;
    new.editor_ids := array[new.author_id];
    select t into bad_type from unnest(new.types) t where not exists (select 1 from public.disruption_type d where d.id = t) limit 1;
    if bad_type is not null then
      raise exception 'alert_entry: unknown type of disruption' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.id is distinct from old.id
     or new.alert_id is distinct from old.alert_id
     or new.kind is distinct from old.kind
     or new.author_id is distinct from old.author_id
     or new.created_at is distinct from old.created_at then
    raise exception 'alert_entry: id, alert_id, kind, author_id and created_at never change' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  content_changed := new.original_text is distinct from old.original_text
    or new.types is distinct from old.types
    or new.audience is distinct from old.audience
    or new.phase is distinct from old.phase
    or new.valid_until is distinct from old.valid_until
    or new.valid_until_mode is distinct from old.valid_until_mode;

  if new.status = old.status then
    -- No transition: only a draft can change, and only its content.
    if old.status <> 'draft' then
      raise exception 'alert_entry: a % entry cannot be changed; return it to draft first', old.status using errcode = 'check_violation';
    end if;
    if thread_status is distinct from 'open' then
      raise exception 'ALERT_CLOSED: a closed thread''s draft cannot be changed' using errcode = 'check_violation';
    end if;
    if actor is null then
      raise exception 'alert_entry: the acting account (cvh.actor_id) is required to change a draft' using errcode = 'check_violation';
    end if;
    if new.version is distinct from old.version
       or new.content_hash is distinct from old.content_hash
       or new.sms_bodies is distinct from old.sms_bodies
       or new.submitted_at is distinct from old.submitted_at
       or new.returned_for is distinct from old.returned_for
       or new.returned_note is distinct from old.returned_note
       or new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at
       or new.approved_version is distinct from old.approved_version
       or new.approved_hash is distinct from old.approved_hash
       or new.web_published_at is distinct from old.web_published_at
       or new.possible_duplicate_of is distinct from old.possible_duplicate_of then
      raise exception 'alert_entry: a draft''s frozen fields, approval and publication do not change' using errcode = 'check_violation';
    end if;
    new.editor_ids := old.editor_ids;
    if content_changed then
      if not (actor = any (old.editor_ids)) then
        new.editor_ids := old.editor_ids || actor;
      end if;
      select t into bad_type from unnest(new.types) t where not exists (select 1 from public.disruption_type d where d.id = t) limit 1;
      if bad_type is not null then
        raise exception 'alert_entry: unknown type of disruption' using errcode = 'check_violation';
      end if;
    end if;
    return new;
  end if;

  -- A transition. Only these exist in this epic (lifecycle.ts mirrors them).
  if not ((old.status = 'draft' and new.status in ('pending_approval', 'discarded'))
          or (old.status = 'pending_approval' and new.status in ('draft', 'discarded', 'approved'))) then
    raise exception 'alert_entry: % to % is not an allowed transition', old.status, new.status using errcode = 'check_violation';
  end if;
  -- A closed thread's entry changes only by a discard made while the thread is closing (AD-18).
  if thread_status is distinct from 'open'
     and not (new.status = 'discarded' and coalesce(current_setting('cvh.closing', true), '') = 'on') then
    raise exception 'ALERT_CLOSED: a closed thread''s entry can only be discarded by its close' using errcode = 'check_violation';
  end if;
  if actor is null then
    raise exception 'alert_entry: the acting account (cvh.actor_id) is required' using errcode = 'check_violation';
  end if;
  if content_changed then
    raise exception 'alert_entry: a transition does not change the content' using errcode = 'check_violation';
  end if;
  if new.web_published_at is distinct from old.web_published_at and new.status <> 'approved' then
    raise exception 'alert_entry: only approval publishes an entry' using errcode = 'check_violation';
  end if;
  new.editor_ids := old.editor_ids;

  if old.status = 'draft' and new.status = 'pending_approval' then
    -- Only an editor submits: someone who returned the entry without editing it (an approver) cannot
    -- re-freeze its content and then approve it.
    if not (actor = any (old.editor_ids)) then
      raise exception 'alert_entry: only an editor submits' using errcode = 'check_violation';
    end if;
    if new.version <> old.version + 1 then
      raise exception 'alert_entry: submit raises the version by one' using errcode = 'check_violation';
    end if;
    if new.content_hash is null or new.sms_bodies is null or new.submitted_at is null or not (new.sms_bodies ? 'en') then
      raise exception 'alert_entry: submit freezes the hash, the SMS bodies and the time' using errcode = 'check_violation';
    end if;
    if new.returned_for is not null or new.returned_note is not null or new.approved_by is not null then
      raise exception 'alert_entry: submit clears the return and its note and holds no approval' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.alert_entry_translation x where x.entry_id = new.id) then
      raise exception 'alert_entry: submit freezes the translations' using errcode = 'check_violation';
    end if;
  elsif old.status = 'pending_approval' and new.status = 'draft' then
    if old.web_published_at is not null then
      raise exception 'alert_entry: a web-published entry never returns to draft' using errcode = 'check_violation';
    end if;
    if new.returned_for is null then
      raise exception 'alert_entry: returning to draft names why (edit, return or retranslate)' using errcode = 'check_violation';
    end if;
    -- The return clears the approval binding; the version only ever goes up.
    if new.content_hash is not null or new.sms_bodies is not null or new.submitted_at is not null or new.approved_by is not null
       or new.possible_duplicate_of is not null or new.version <> old.version then
      raise exception 'alert_entry: returning to draft clears the hash, the SMS bodies, the time and the possible-duplicate link, and keeps the version' using errcode = 'check_violation';
    end if;
    -- An approver's return carries the note the author will read; an edit or a re-translation carries none.
    if new.returned_for = 'return' and (new.returned_note is null or btrim(new.returned_note) = '') then
      raise exception 'alert_entry: returning an entry to its author carries a note' using errcode = 'check_violation';
    end if;
    if new.returned_for <> 'return' and new.returned_note is not null then
      raise exception 'alert_entry: only an approver''s return carries a note' using errcode = 'check_violation';
    end if;
    -- Whoever edits or re-translates becomes an editor; an approver who only returns it does not.
    if new.returned_for in ('edit', 'retranslate') and not (actor = any (old.editor_ids)) then
      new.editor_ids := old.editor_ids || actor;
    end if;
  elsif new.status = 'discarded' then
    if old.web_published_at is not null then
      raise exception 'alert_entry: a web-published entry is withdrawn, not discarded' using errcode = 'check_violation';
    end if;
    if new.version is distinct from old.version
       or new.content_hash is distinct from old.content_hash
       or new.sms_bodies is distinct from old.sms_bodies
       or new.submitted_at is distinct from old.submitted_at
       or new.returned_for is distinct from old.returned_for
       or new.returned_note is distinct from old.returned_note
       or new.possible_duplicate_of is distinct from old.possible_duplicate_of
       or new.approved_by is not null then
      raise exception 'alert_entry: discarding changes nothing else' using errcode = 'check_violation';
    end if;
  else
    -- pending_approval to approved
    if new.approved_by is distinct from actor then
      raise exception 'alert_entry: the approver must be the acting account' using errcode = 'check_violation';
    end if;
    if new.approved_by = any (old.editor_ids) then
      raise exception 'alert_entry: an editor of the entry cannot approve it' using errcode = 'check_violation';
    end if;
    if old.content_hash is null
       or new.approved_version is distinct from old.version
       or new.approved_hash is distinct from old.content_hash
       or new.version is distinct from old.version
       or new.content_hash is distinct from old.content_hash
       or new.sms_bodies is distinct from old.sms_bodies
       or new.submitted_at is distinct from old.submitted_at
       or new.possible_duplicate_of is distinct from old.possible_duplicate_of then
      raise exception 'alert_entry: the approval must name the version and hash that are pending' using errcode = 'check_violation';
    end if;
    -- The database's clock times the approval and the publication, whatever the app sent: the two
    -- are the same instant, and neither can be backdated or set in the future.
    new.approved_at := now();
    new.web_published_at := new.approved_at;
  end if;
  return new;
end
$$;
revoke all on function alert_entry_guard() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. The pilot's approval timings (FR-M2)
-- ---------------------------------------------------------------------------------------------
-- One row per approved entry (`approved_at` is set only by an approval, and by the database's clock). `first_saved_at` is when the
-- author first saved the draft: the entry's creation (a logged disruption is saved with its suggested text at once). `reported_to_first_ack_ms`
-- is set only on the first approved acknowledgement of its thread: from `alert.reported_at` (when the first report reached the Hub, as
-- the author entered it) to that approval. A returned entry keeps its creation time, so the time from the first save includes the
-- time it spent going back and forth.
create view alert_approval_timing with (security_invoker = true) as
  with approved as (
    select
      e.id as entry_id,
      e.alert_id,
      e.kind,
      a.is_drill,
      a.reported_at,
      e.created_at as first_saved_at,
      e.approved_at,
      row_number() over (partition by e.alert_id, (e.kind = 'ack') order by e.approved_at, e.id) as nth_of_its_kind
    from alert_entry e
    join alert a on a.id = e.alert_id
    where e.approved_at is not null
  )
  select
    entry_id,
    alert_id,
    kind,
    is_drill,
    reported_at,
    first_saved_at,
    approved_at,
    round(extract(epoch from (approved_at - first_saved_at)) * 1000)::bigint as first_save_to_approval_ms,
    case when kind = 'ack' and nth_of_its_kind = 1 then round(extract(epoch from (approved_at - reported_at)) * 1000)::bigint end as reported_to_first_ack_ms
  from approved;
revoke all on table alert_approval_timing from public, anon, authenticated, service_role;
grant select on table alert_approval_timing to cvh_app;

-- The pilot measure itself, drills kept apart: one row for the real threads and one for the drills (a group with no entry has no row).
create view alert_approval_timing_summary with (security_invoker = true) as
  select
    is_drill,
    count(*)::int as entries_approved,
    count(reported_to_first_ack_ms)::int as first_acks,
    percentile_cont(0.5) within group (order by reported_to_first_ack_ms) as median_reported_to_first_ack_ms,
    percentile_cont(0.5) within group (order by first_save_to_approval_ms) as median_first_save_to_approval_ms
  from alert_approval_timing
  group by is_drill;
revoke all on table alert_approval_timing_summary from public, anon, authenticated, service_role;
grant select on table alert_approval_timing_summary to cvh_app;
