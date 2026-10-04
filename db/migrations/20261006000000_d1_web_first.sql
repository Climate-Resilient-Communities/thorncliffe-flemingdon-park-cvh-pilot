-- S08.03: lower-risk posts appear on the web at once as "Not yet verified" (AD-5 "Web publication", "D-1 eligibility" and "System entries", owned by the alerting module).
--
-- What this changes in the rules the data keeps (the entry guard and the thread guard are replaced, not duplicated; nothing is dropped, no column is added):
--  1. A D-1 post is web-published when it is submitted. `alerting/domain/d1.ts#isD1Eligible` decides it (the use case asks it and sets `web_published_at` in the
--     same update that moves the entry from `draft` to `pending_approval`); the guard repeats the facts the database holds and refuses a publication at submit that does
--     not meet them: the author is an Ambassador and the one who submits, the thread is not a drill, the kind is `ack`, `update` or `correction`, and every type has
--     `disruption_type.direct = true` (null and unknown count as false). The time is the database's `now()`.
--  2. An approval keeps the publication time of an entry that was published at submit (`coalesce(old.web_published_at, approved_at)`), so approving a post never moves
--     it in the order residents read a thread in. Approval still publishes every other entry, at its own time.
--  3. Discarding a web-published pending entry is a system withdrawal: a `published_system` withdrawal (web-only, never approved, so no text is queued or captured for
--     it) may be INSERTED only while the session variable `cvh.system_actor` is `discard` (transaction-local, set by the discard use case) and an account is acting,
--     only in an open thread, naming one pending, web-published entry of the same thread, with the reason `other` and the replaced entry's author; and that entry
--     becomes `superseded` by it in the same transaction (the transition asks for exactly that withdrawal, made at `now()`). The discard of a web-published entry
--     itself, and its return to draft, are still refused: it never returns to draft and is never `discarded`.
--  4. A thread may close `withdrawn` beside such a system withdrawal, made in the same transaction, as it may beside an approved withdrawal (a discard that leaves no
--     published, non-superseded substantive entry).
--  5. A draft is never web-published (NOT VALID check: the guard already refuses it, so no row breaks it, and it binds every later write).

alter table alert_entry add constraint alert_entry_draft_unpublished check (status <> 'draft' or web_published_at is null) not valid;

create or replace function alert_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  closing record;
begin
  if new.id is distinct from old.id
     or new.is_drill is distinct from old.is_drill
     or new.reported_at is distinct from old.reported_at
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.slug is distinct from old.slug then
    raise exception 'alert: id, is_drill, reported_at, created_by, created_at and slug never change (is_drill is set at creation)'
      using errcode = 'check_violation';
  end if;
  if old.status = 'closed' then
    raise exception 'ALERT_CLOSED: a closed thread never changes'
      using errcode = 'check_violation';
  end if;
  if new.status = 'closed' then
    -- The database's clock times the close, as it times an approval: the two are the same instant for a close that comes with an approval. `now()` is the
    -- start of the transaction, which can be earlier than an approval another transaction committed first while this one waited for the thread's lock, so a close
    -- is never timed before the latest approval of its thread.
    -- (Only a close that names its entry is raised to the latest approval: for a close without one, which only the owner's own tools and fixtures make, `closed_at`
    -- stays the transaction's time, so an earlier approval of another transaction is never mistaken for the closing entry by the legacy `approved_at = closed_at` rule.)
    if new.closing_entry_id is not null then
      new.closed_at := greatest(now(), coalesce((select max(e.approved_at) from public.alert_entry e where e.alert_id = new.id), now()));
    else
      new.closed_at := now();
    end if;
    -- The app closes a thread only beside the entry that closes it, made in this transaction. Every login is held to it (a jobs worker's, a renamed pooler role's),
    -- not one login by name; only the table's owner (the migrator's own tools and the tests' fixtures) and a superuser are not the app.
    if session_user <> (select pg_catalog.pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid = 'public.alert'::regclass)
       and not exists (select 1 from pg_catalog.pg_roles r where r.rolname = session_user and r.rolsuper) then
      if new.closing_entry_id is null then
        raise exception 'alert: a thread is closed beside the entry that closes it (closing_entry_id)' using errcode = 'check_violation';
      end if;
      select e.kind, e.status, e.approved_at, e.web_published_at into closing from public.alert_entry e where e.id = new.closing_entry_id and e.alert_id = new.id;
      if not found
         or not (
           (new.closed_reason = 'resolved' and closing.kind = 'final' and closing.status = 'approved' and closing.approved_at = now())
           or (new.closed_reason = 'withdrawn' and closing.kind = 'withdrawal' and closing.status = 'approved' and closing.approved_at = now())
           or (new.closed_reason = 'withdrawn' and closing.kind = 'withdrawal' and closing.status = 'published_system' and closing.web_published_at = now())
           or (new.closed_reason = 'expired' and closing.kind = 'final' and closing.status = 'published_system' and closing.web_published_at = now())
         ) then
        raise exception 'alert: a thread closes only beside an approved final (resolved), an approved or system withdrawal (withdrawn) or a system final (expired) made in the same transaction'
          using errcode = 'check_violation';
      end if;
    end if;
  elsif new.closing_entry_id is not null then
    raise exception 'alert: only a closed thread has a closing entry' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke all on function alert_guard() from public, anon, authenticated, service_role;

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
  system_actor text := nullif(current_setting('cvh.system_actor', true), '');
  covering record;
  author_role public.staff_role;
  thread_is_drill boolean;
begin
  if actor_text is not null and actor_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    actor := actor_text::uuid;
  end if;

  select a.status, a.is_drill into thread_status, thread_is_drill from public.alert a where a.id = new.alert_id;

  if tg_op = 'INSERT' then
    if new.status = 'published_system' and system_actor is not distinct from 'discard' then
      -- The other entry the system makes (S08.03, AD-5 "System entries"): the withdrawal that takes the place of a web-published entry its author or an approver
      -- discarded. It needs the session variable `cvh.system_actor = 'discard'` the discard use case sets (transaction-local) and the account that discards (`cvh.actor_id`),
      -- is web-only (never approved, so no delivery is queued or captured for it) and names the one entry it replaces: pending approval, web-published, of this
      -- same open thread, and not a withdrawal notice. The entry is superseded by it in the same transaction (the transition below asks for exactly this entry).
      if new.kind <> 'withdrawal' then
        raise exception 'alert_entry: the discard of a web-published entry makes a withdrawal, not %', new.kind using errcode = 'check_violation';
      end if;
      if thread_status is distinct from 'open' then
        raise exception 'ALERT_CLOSED: an entry cannot be added to a closed thread' using errcode = 'check_violation';
      end if;
      if actor is null then
        raise exception 'alert_entry: the acting account (cvh.actor_id) is required' using errcode = 'check_violation';
      end if;
      if new.supersedes_id is null or new.withdrawal_reason is distinct from 'other' then
        raise exception 'alert_entry: a system withdrawal names the entry it replaces, with the reason other' using errcode = 'check_violation';
      end if;
      select t.alert_id, t.kind, t.status, t.web_published_at, t.author_id into target from public.alert_entry t where t.id = new.supersedes_id;
      if not found or target.alert_id <> new.alert_id then
        raise exception 'TARGET_NOT_VALID: the entry a withdrawal replaces is an entry of the same alert' using errcode = 'check_violation';
      end if;
      if target.kind = 'withdrawal' or target.status is distinct from 'pending_approval' or target.web_published_at is null then
        raise exception 'TARGET_NOT_VALID: a system withdrawal replaces only a pending entry that is web-published' using errcode = 'check_violation';
      end if;
      if new.version <> 0 or new.returned_note is not null or new.content_hash is not null or new.sms_bodies is not null or new.submitted_at is not null
         or new.returned_for is not null or new.approved_by is not null or new.approved_at is not null or new.approved_version is not null
         or new.approved_hash is not null or new.possible_duplicate_of is not null then
        raise exception 'alert_entry: a system withdrawal has no version, return, frozen content or approval' using errcode = 'check_violation';
      end if;
      -- Attribution: the replaced entry's author stands in (the column is required and names an account); nobody acts as them.
      if new.author_id is distinct from target.author_id then
        raise exception 'alert_entry: a system withdrawal is attributed to the author of the entry it replaces' using errcode = 'check_violation';
      end if;
      new.web_published_at := now();
      new.editor_ids := array[new.author_id];
      select t into bad_type from unnest(new.types) t where not exists (select 1 from public.disruption_type d where d.id = t) limit 1;
      if bad_type is not null then
        raise exception 'alert_entry: unknown type of disruption' using errcode = 'check_violation';
      end if;
      return new;
    end if;
    if new.status = 'published_system' and system_actor is not distinct from 'expire' then
      -- The one entry the system makes (AD-5 "System entries", S05.04): the expire job's `final`, web-only, made in the same transaction that closes the thread as
      -- expired. It needs the session variable `cvh.system_actor` the expire job sets (without it the status falls to the rule below: a new entry starts as a draft), so no human's request and no direct statement can make one; the thread
      -- must be open, and the entry that covers it (the latest published, non-superseded substantive entry) must be past its valid-until by the database's
      -- clock. It is published by the database's clock and starts with nothing frozen, approved or replaced. (The discard use case, which makes a system
      -- withdrawal, is later work: it widens this.)
      if new.kind <> 'final' then
        raise exception 'alert_entry: the expire job makes a final, not %', new.kind using errcode = 'check_violation';
      end if;
      if thread_status is distinct from 'open' then
        raise exception 'ALERT_CLOSED: an entry cannot be added to a closed thread' using errcode = 'check_violation';
      end if;
      select e.valid_until into covering
        from public.alert_entry e
        where e.alert_id = new.alert_id
          and e.web_published_at is not null
          and e.status not in ('draft', 'discarded', 'superseded')
          and e.kind in ('ack', 'update', 'correction', 'final')
        order by e.web_published_at desc, e.id desc
        limit 1;
      if not found or covering.valid_until > now() then
        raise exception 'alert_entry: a thread expires only when the entry that covers it is past its valid-until' using errcode = 'check_violation';
      end if;
      if new.version <> 0 or new.returned_note is not null or new.supersedes_id is not null or new.withdrawal_reason is not null
         or new.content_hash is not null or new.sms_bodies is not null or new.submitted_at is not null or new.returned_for is not null
         or new.approved_by is not null or new.approved_at is not null or new.approved_version is not null or new.approved_hash is not null
         or new.possible_duplicate_of is not null then
        raise exception 'alert_entry: a system final has no version, return, replacement, frozen content or approval' using errcode = 'check_violation';
      end if;
      -- Attribution: the thread's own author stands in (the column is required and names an account); no other account can be named as the author of a system final.
      if new.author_id is distinct from (select a.created_by from public.alert a where a.id = new.alert_id) then
        raise exception 'alert_entry: a system final is attributed to the thread''s own author' using errcode = 'check_violation';
      end if;
      new.web_published_at := now();
      new.editor_ids := array[new.author_id];
      select t into bad_type from unnest(new.types) t where not exists (select 1 from public.disruption_type d where d.id = t) limit 1;
      if bad_type is not null then
        raise exception 'alert_entry: unknown type of disruption' using errcode = 'check_violation';
      end if;
      return new;
    end if;
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
    -- The table's check allows every kind E05 adds; a correction and a withdrawal are authored from S05.02, a final from S05.03. The system final of the
    -- expire job (S05.04) is not authored here: it is a `published_system` entry that job makes, and widens this when it is built.
    if new.kind not in ('ack', 'update', 'correction', 'withdrawal', 'final') then
      raise exception 'alert_entry: only an ack, an update, a correction, a withdrawal or a final is created, not %', new.kind using errcode = 'check_violation';
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
  -- The expire job has no account: the only change it makes besides its own final is the discard of what residents have not read, when it closes the thread.
  -- It is allowed only with proof that the thread is being closed by the job: the system final made in this transaction (the same proof the thread's close
  -- trigger asks for), which the job makes before it discards. A bare session variable discards nothing.
  if actor is null and not (
       system_actor is not distinct from 'expire' and new.status = 'discarded'
       and exists (select 1 from public.alert_entry f
                   where f.alert_id = new.alert_id and f.kind = 'final' and f.status = 'published_system' and f.web_published_at = now())
     ) then
    raise exception 'alert_entry: the acting account (cvh.actor_id) is required' using errcode = 'check_violation';
  end if;
  if content_changed then
    raise exception 'alert_entry: a transition does not change the content' using errcode = 'check_violation';
  end if;
  -- Only an approval publishes an entry, except that an entry that is D-1 (S08.03, `alerting/domain/d1.ts#isD1Eligible`) is published when it is submitted.
  -- Once published, the time never changes: an approval keeps the time residents first read it.
  if new.web_published_at is distinct from old.web_published_at
     and not (new.status = 'approved' and old.web_published_at is null)
     and not (old.status = 'draft' and new.status = 'pending_approval' and old.web_published_at is null) then
    raise exception 'alert_entry: only approval publishes an entry, or the submit of a D-1 entry' using errcode = 'check_violation';
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
    -- D-1 (S08.03): the submit may publish the entry on the web, as "Not yet verified", and only when the facts the database holds say the post is D-1: the author is an
    -- Ambassador who submits it, the thread is not a drill, the kind is an acknowledgement, an update or a correction, and every type is `direct`. The use case decides it
    -- with `isD1Eligible`; this refuses a publication it should not have made. The time is the database's.
    if new.web_published_at is not null then
      select s.role into author_role from public.staff_account s where s.id = new.author_id;
      if author_role is distinct from 'ambassador'
         or actor <> new.author_id
         or thread_is_drill is distinct from false
         or new.kind not in ('ack', 'update', 'correction')
         or cardinality(new.types) < 1
         or exists (select 1 from unnest(new.types) t where not exists (select 1 from public.disruption_type d where d.id = t and d.direct is true)) then
        raise exception 'alert_entry: only an Ambassador''s post of direct types, in a thread that is not a drill, is published when it is submitted' using errcode = 'check_violation';
      end if;
      new.web_published_at := now();
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
      raise exception 'alert_entry: pending_approval to superseded is not an allowed transition unless the entry is web-published' using errcode = 'check_violation';
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
    ) and not (
      -- ... or, for a pending web-published entry that was discarded (S08.03), by the system withdrawal the discard made in this very transaction.
      old.status = 'pending_approval'
      and system_actor is not distinct from 'discard'
      and exists (
        select 1 from public.alert_entry c
        where c.supersedes_id = new.id
          and c.alert_id = new.alert_id
          and c.kind = 'withdrawal'
          and c.status = 'published_system'
          and c.web_published_at = now()
      )
    ) then
      raise exception 'alert_entry: an entry is superseded only by an approved correction or withdrawal that names it, or by the system withdrawal of its discard' using errcode = 'check_violation';
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
    -- corrections of the same entry cannot both be approved, provided the use case supersedes the target in the same transaction.
    if new.kind in ('correction', 'withdrawal') then
      select t.alert_id, t.kind, t.status, t.web_published_at into target from public.alert_entry t where t.id = new.supersedes_id;
      if not found or target.alert_id <> new.alert_id
         or target.kind = 'withdrawal'
         or not (target.status = 'approved' or (target.status = 'pending_approval' and target.web_published_at is not null)) then
        raise exception 'TARGET_NOT_VALID: the entry this replaces is not a valid target any more' using errcode = 'check_violation';
      end if;
    end if;
    -- The database's clock times the approval, whatever the app sent, and the publication unless the entry was published when it was submitted (D-1, S08.03): the
    -- two are then the same instant, and neither can be backdated or set in the future. A D-1 entry keeps the time residents first read it.
    new.approved_at := now();
    new.web_published_at := coalesce(old.web_published_at, new.approved_at);
  end if;
  return new;
end
$$;
revoke all on function alert_entry_guard() from public, anon, authenticated, service_role;

-- A pending web-published entry has at most one system withdrawal, and the withdrawal never stands without the entry it replaces being superseded by the end of the
-- transaction: a caller that only inserts the notice would leave the post pending and visible beside a "Withdrawn" note.
create unique index alert_entry_one_system_withdrawal on alert_entry (supersedes_id) where kind = 'withdrawal' and status = 'published_system';

-- The release in production when this applies cannot insert a `published_system` withdrawal (its entry guard, 20261004070000, lets the
-- system insert only a `final`), so this check never raises on its writes.
-- contract: a4fb407432e0a077be629d0e8284225fcbc80aff
create or replace function alert_system_withdrawal_check() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.alert_entry t where t.id = new.supersedes_id and t.status = 'superseded') then
    raise exception 'TARGET_NOT_VALID: a system withdrawal supersedes the entry it replaces in the same transaction' using errcode = 'check_violation';
  end if;
  return null;
end
$$;
revoke all on function alert_system_withdrawal_check() from public, anon, authenticated, service_role;

create constraint trigger alert_entry_system_withdrawal_check after insert on alert_entry
  deferrable initially deferred
  for each row when (new.kind = 'withdrawal' and new.status = 'published_system')
  execute function alert_system_withdrawal_check();
