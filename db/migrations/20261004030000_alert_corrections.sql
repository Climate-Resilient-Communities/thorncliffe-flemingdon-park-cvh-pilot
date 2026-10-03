-- S05.02: Hub staff correct or withdraw what residents saw, in the open (AD-5 "Supersession", owned by the alerting module).
--
-- What this adds to the tables the earlier stories created:
--  1. `alert_entry.supersedes_id`: the one entry a `correction` or a `withdrawal` replaces (the target), and `alert_entry.withdrawal_reason`: why a
--     withdrawal was made, from the fixed catalog (wrong place, wrong information, duplicate, other). Both are set when the entry is made and never change.
--     A correction or a withdrawal has a target; no other entry has one; only a withdrawal has a reason. The constraints are NOT VALID (expand-only: no
--     entry of either kind exists before this migration, and a NOT VALID check still binds every insert and update).
--  2. The entry guard (S04.07's, replaced, not duplicated): a correction or a withdrawal can now be made (a draft that names a valid target of its own alert),
--     is approved only while its target is still a valid target (approved, or pending approval and web-published, and not a withdrawal notice), and the
--     target becomes `superseded` only by a change that happens in the same transaction as the approval of a correction or a withdrawal that names it.
--     So a direct `update alert_entry set status = 'superseded'` with the app's credentials is refused, and two corrections of one entry cannot both be
--     approved, whatever the use case did. `superseded` is final: no transition leaves it.
--  3. The resident view `nondrill_alert_entry` gains `supersedes_id` (appended: a view the previous release reads keeps its columns). The web shows the
--     correction above the original marked "Corrected", and a withdrawn entry as "Withdrawn" with the reason in its place (the withdrawal's own text,
--     which is why the reason code itself stays out of the view and out of the feed: phones in the field parse the feed strictly).

alter table alert_entry add column supersedes_id uuid references alert_entry (id);
alter table alert_entry add column withdrawal_reason text;
create index alert_entry_supersedes_id_idx on alert_entry (supersedes_id);
alter table alert_entry add constraint alert_entry_supersedes_kind check ((kind in ('correction', 'withdrawal')) = (supersedes_id is not null)) not valid;
alter table alert_entry add constraint alert_entry_supersedes_not_self check (supersedes_id is null or supersedes_id <> id) not valid;
alter table alert_entry add constraint alert_entry_withdrawal_reason_valid check (withdrawal_reason is null or withdrawal_reason in ('wrong_place', 'wrong_information', 'duplicate', 'other')) not valid;
alter table alert_entry add constraint alert_entry_withdrawal_reason_kind check ((kind = 'withdrawal') = (withdrawal_reason is not null)) not valid;

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
  target record;
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
    -- The table's check allows every kind E05 adds; a correction and a withdrawal are authored from S05.02, a final from S05.03 (which widens this list).
    if new.kind not in ('ack', 'update', 'correction', 'withdrawal') then
      raise exception 'alert_entry: only an ack, an update, a correction or a withdrawal is created yet, not %', new.kind using errcode = 'check_violation';
    end if;
    if new.kind in ('correction', 'withdrawal') then
      -- It names the one entry it replaces, of this same alert, and that entry is a valid target now (approved, or pending approval and web-published,
      -- and not a withdrawal notice). Approval judges it again, under the lock.
      if new.supersedes_id is null then
        raise exception 'alert_entry: a correction or a withdrawal names the entry it replaces' using errcode = 'check_violation';
      end if;
      select t.alert_id, t.kind, t.status, t.web_published_at into target from public.alert_entry t where t.id = new.supersedes_id;
      if not found or target.alert_id <> new.alert_id then
        raise exception 'TARGET_NOT_VALID: the entry a correction or a withdrawal replaces is an entry of the same alert' using errcode = 'check_violation';
      end if;
      if target.kind = 'withdrawal' or not (target.status = 'approved' or (target.status = 'pending_approval' and target.web_published_at is not null)) then
        raise exception 'TARGET_NOT_VALID: only an approved entry, or a pending one that is web-published, is corrected or withdrawn' using errcode = 'check_violation';
      end if;
      if new.kind = 'withdrawal' and new.withdrawal_reason is null then
        raise exception 'alert_entry: a withdrawal gives its reason' using errcode = 'check_violation';
      end if;
      if new.kind = 'correction' and new.withdrawal_reason is not null then
        raise exception 'alert_entry: only a withdrawal has a withdrawal reason' using errcode = 'check_violation';
      end if;
    elsif new.supersedes_id is not null or new.withdrawal_reason is not null then
      raise exception 'alert_entry: only a correction or a withdrawal replaces an entry' using errcode = 'check_violation';
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
     or new.supersedes_id is distinct from old.supersedes_id
     or new.withdrawal_reason is distinct from old.withdrawal_reason
     or new.created_at is distinct from old.created_at then
    raise exception 'alert_entry: id, alert_id, kind, author_id, the entry it replaces, the withdrawal reason and created_at never change' using errcode = 'check_violation';
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

  -- A transition. Only these exist (lifecycle.ts mirrors them). S05.02 adds `superseded`, from an approved entry and from a web-published pending one.
  if not ((old.status = 'draft' and new.status in ('pending_approval', 'discarded'))
          or (old.status = 'pending_approval' and new.status in ('draft', 'discarded', 'approved', 'superseded'))
          or (old.status = 'approved' and new.status = 'superseded')) then
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
  elsif new.status = 'superseded' then
    -- Only an approved correction or withdrawal naming the entry replaces it, and it was approved in this very transaction (the approval's `approved_at` is
    -- now(), the transaction's own time): a direct change of the status cannot supersede an entry quietly.
    if old.status = 'pending_approval' and old.web_published_at is null then
      raise exception 'alert_entry: only a web-published pending entry is superseded' using errcode = 'check_violation';
    end if;
    if new.version is distinct from old.version
       or new.content_hash is distinct from old.content_hash
       or new.sms_bodies is distinct from old.sms_bodies
       or new.submitted_at is distinct from old.submitted_at
       or new.returned_for is distinct from old.returned_for
       or new.returned_note is distinct from old.returned_note
       or new.possible_duplicate_of is distinct from old.possible_duplicate_of
       or new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at
       or new.approved_version is distinct from old.approved_version
       or new.approved_hash is distinct from old.approved_hash
       or new.web_published_at is distinct from old.web_published_at then
      raise exception 'alert_entry: superseding changes nothing else' using errcode = 'check_violation';
    end if;
    if not exists (
      select 1 from public.alert_entry c
      where c.supersedes_id = new.id
        and c.alert_id = new.alert_id
        and c.kind in ('correction', 'withdrawal')
        and c.status = 'approved'
        and c.approved_at = now()
    ) then
      raise exception 'alert_entry: an entry is superseded only by an approved correction or withdrawal that names it' using errcode = 'check_violation';
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
    -- A correction or a withdrawal is approved only while the entry it replaces is still a valid target (approved, or pending and web-published): two
    -- corrections of the same entry cannot both be approved, whatever the use case did.
    if new.kind in ('correction', 'withdrawal') then
      select t.alert_id, t.kind, t.status, t.web_published_at into target from public.alert_entry t where t.id = new.supersedes_id;
      if not found or target.alert_id <> new.alert_id
         or target.kind = 'withdrawal'
         or not (target.status = 'approved' or (target.status = 'pending_approval' and target.web_published_at is not null)) then
        raise exception 'TARGET_NOT_VALID: the entry this replaces is not a valid target any more' using errcode = 'check_violation';
      end if;
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
-- The resident view: the entry a correction or a withdrawal replaces (an appended column)
-- ---------------------------------------------------------------------------------------------
create or replace view nondrill_alert_entry with (security_invoker = true) as
  select
    e.id,
    e.alert_id,
    a.slug,
    e.kind,
    e.phase,
    e.types,
    e.audience,
    e.valid_until,
    e.original_text,
    e.web_published_at,
    (e.approved_by is not null) as verified,
    (e.status = 'superseded') as superseded,
    e.supersedes_id
  from alert_entry e
  join nondrill_alert t on t.id = e.alert_id
  join alert a on a.id = t.id
  where e.web_published_at is not null
    and e.status in ('pending_approval', 'approved', 'superseded', 'published_system');
