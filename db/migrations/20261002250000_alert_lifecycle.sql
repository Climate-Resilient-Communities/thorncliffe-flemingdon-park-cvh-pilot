-- S04.03: alert threads and entries follow one lifecycle (AD-5, AD-18, AD-6), owned by the
-- alerting module; `disruption_type` is places' (AD-2, AD-25).
--
-- A thread (`alert`) is one disruption: `open` until closed, with `reported_at` (when the first
-- report reached the Hub) and `is_drill`, which is set at creation and never changes. An entry
-- (`alert_entry`) is anything published in a thread. This story implements `ack` and `update`
-- from `draft` to `approved`, plus return and discard; the kinds and statuses E05 adds are
-- already allowed by the checks, but no transition reaches them yet.
--
-- The state machine lives in src/modules/alerting/domain/lifecycle.ts and is mirrored here by a
-- trigger (alert_entry_guard) that rejects any other transition, whoever asks. The trigger also
-- carries the rules the spine puts on the data itself:
--  - the acting account is the session variable `cvh.actor_id`, set (transaction-local) by every
--    use case; an entry change without one is refused;
--  - a draft's content can change only by an actor, who becomes an editor (`editor_ids` holds the
--    author and every account that edited the entry; the app cannot write the column); only an
--    editor submits, and only an editor adds a translation, so a returner who is not an editor
--    cannot re-freeze the content and then approve it;
--  - a `pending_approval` entry is frozen: no change at all while it stays pending. Content can
--    change only after it returns to `draft`, and that return clears the approval binding
--    (`content_hash`, `sms_bodies`, `submitted_at`) and deletes its translations. `version` only
--    ever goes up, by one at each submit;
--  - an approval names the version and hash it was shown (`approved_version`, `approved_hash`);
--    they must equal the entry's, and the approver can be neither the author nor any editor;
--  - a web-published entry never returns to `draft` and is never discarded here (E05 corrects it);
--  - nothing in a closed thread changes except an entry being discarded while the thread is
--    closing (the session variable `cvh.closing` is 'on', set transaction-local by the close path,
--    which E05 adds; the domain's `closing` flag in lifecycle.ts is the same rule);
--  - an approval is timed by the database: `approved_at` and `web_published_at` are set to now()
--    whatever the app sends (no clock skew can refuse it, none can backdate it);
--  - a thread is created by its acting account, at the database's clock.
--
-- Reads that lock follow AD-18: the use cases lock `alert`, then `alert_entry`, then
-- `feed_version`. The app's role needs UPDATE on the locked tables for SELECT ... FOR UPDATE,
-- so it has column-level UPDATE on the columns the lifecycle changes, and no more.
--
-- Supabase's default privileges grant every new table in public to anon, authenticated and
-- service_role, so each table takes those back; only cvh_app (S01.04) reaches them.

-- ---------------------------------------------------------------------------------------------
-- disruption_type (places): the types of disruption. `direct` is whether an Ambassador's post of
-- that type may appear on the web at once (D-1, AD-5): true for the lower-risk types, false for
-- fire and "Other", null (not decided, counts as false) for the neighbourhood-wide ones.
-- ---------------------------------------------------------------------------------------------
create table disruption_type (
  id text primary key,
  direct boolean,
  constraint disruption_type_id_format check (id ~ '^[a-z][a-z_]{1,19}$')
);
alter table disruption_type enable row level security;
revoke all on table disruption_type from public, anon, authenticated, service_role;
grant select on table disruption_type to cvh_app;
create policy disruption_type_app_select on disruption_type for select to cvh_app using (true);

insert into disruption_type (id, direct) values
  ('power', true),
  ('water', true),
  ('elevator', true),
  ('flood', true),
  ('fire', false),
  ('other', false),
  ('heat', null),
  ('smoke', null),
  ('winter', null);

-- ---------------------------------------------------------------------------------------------
-- alert: the thread.
-- ---------------------------------------------------------------------------------------------
create table alert (
  id uuid primary key,
  status text not null default 'open',
  closed_reason text,
  closed_at timestamptz,
  is_drill boolean not null,
  reported_at timestamptz not null,
  created_by uuid not null references staff_account (id),
  created_at timestamptz not null default now(),
  constraint alert_status_valid check (status in ('open', 'closed')),
  constraint alert_closed_reason_valid check (closed_reason is null or closed_reason in ('resolved', 'expired', 'withdrawn')),
  constraint alert_closed_consistent check (
    (status = 'open' and closed_reason is null and closed_at is null)
    or (status = 'closed' and closed_reason is not null and closed_at is not null)
  ),
  constraint alert_reported_not_after_created check (reported_at <= created_at)
);
create index alert_created_by_idx on alert (created_by);
alter table alert enable row level security;
revoke all on table alert from public, anon, authenticated, service_role;
grant select, insert on table alert to cvh_app;
grant update (status, closed_reason, closed_at) on table alert to cvh_app;
create policy alert_app_select on alert for select to cvh_app using (true);
create policy alert_app_insert on alert for insert to cvh_app with check (true);
create policy alert_app_update on alert for update to cvh_app using (true) with check (true);

-- A new thread is created by the acting account (`cvh.actor_id`, set by the use case) and takes the
-- database's clock as its creation time, so neither can be claimed by the caller.
create function alert_insert_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor_text text := nullif(current_setting('cvh.actor_id', true), '');
  actor uuid;
begin
  if actor_text is not null and actor_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    actor := actor_text::uuid;
  end if;
  if actor is null then
    raise exception 'alert: the acting account (cvh.actor_id) is required to create a thread' using errcode = 'check_violation';
  end if;
  if new.created_by is distinct from actor then
    raise exception 'alert: the creator must be the acting account' using errcode = 'check_violation';
  end if;
  new.created_at := now();
  return new;
end
$$;
revoke all on function alert_insert_guard() from public, anon, authenticated, service_role;
create trigger alert_insert_guard before insert on alert for each row execute function alert_insert_guard();

-- A thread only goes from open to closed, with a reason, and never reopens. `is_drill` and the
-- facts of its creation never change (AD-6), whoever asks: the owner included.
create function alert_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.is_drill is distinct from old.is_drill
     or new.reported_at is distinct from old.reported_at
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'alert: id, is_drill, reported_at, created_by and created_at never change (is_drill is set at creation)'
      using errcode = 'check_violation';
  end if;
  if old.status = 'closed' then
    raise exception 'ALERT_CLOSED: a closed thread never changes'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke all on function alert_guard() from public, anon, authenticated, service_role;
create trigger alert_guard before update on alert for each row execute function alert_guard();

-- What residents may ever read: every resident-facing query selects from this view, never from
-- `alert` (AD-6). It runs with the caller's rights, and only cvh_app reaches it.
create view nondrill_alert with (security_invoker = true) as
  select id, status, closed_reason, reported_at, closed_at, created_at
  from alert
  where not is_drill;
revoke all on table nondrill_alert from public, anon, authenticated, service_role;
grant select on table nondrill_alert to cvh_app;

-- ---------------------------------------------------------------------------------------------
-- alert_entry: anything published in a thread.
-- ---------------------------------------------------------------------------------------------
create table alert_entry (
  id uuid primary key,
  alert_id uuid not null references alert (id),
  kind text not null,
  status text not null default 'draft',
  author_id uuid not null references staff_account (id),
  editor_ids uuid[] not null,
  original_text text not null,
  types text[] not null,
  audience jsonb not null,
  phase text not null,
  valid_until timestamptz not null,
  version integer not null default 0,
  content_hash text,
  sms_bodies jsonb,
  submitted_at timestamptz,
  returned_for text,
  approved_by uuid references staff_account (id),
  approved_at timestamptz,
  approved_version integer,
  approved_hash text,
  web_published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint alert_entry_kind_valid check (kind in ('ack', 'update', 'correction', 'withdrawal', 'final')),
  constraint alert_entry_status_valid check (status in ('draft', 'pending_approval', 'approved', 'discarded', 'superseded', 'published_system')),
  constraint alert_entry_phase_valid check (phase in ('problem', 'in_progress')),
  constraint alert_entry_text_valid check (btrim(original_text) <> '' and char_length(original_text) <= 600),
  constraint alert_entry_types_present check (cardinality(types) >= 1),
  constraint alert_entry_audience_valid check (jsonb_typeof(audience) = 'object' and audience ->> 'scope' in ('neighbourhood', 'buildings')),
  constraint alert_entry_author_is_editor check (author_id = any (editor_ids)),
  constraint alert_entry_version_non_negative check (version >= 0),
  constraint alert_entry_hash_format check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  constraint alert_entry_approved_hash_format check (approved_hash is null or approved_hash ~ '^[0-9a-f]{64}$'),
  constraint alert_entry_sms_bodies_valid check (sms_bodies is null or jsonb_typeof(sms_bodies) = 'object'),
  constraint alert_entry_returned_for_valid check (returned_for is null or returned_for in ('edit', 'return', 'retranslate')),
  -- A draft holds nothing frozen; a pending, approved or superseded entry holds all of it.
  constraint alert_entry_draft_unfrozen check (status <> 'draft' or (content_hash is null and sms_bodies is null and submitted_at is null)),
  constraint alert_entry_frozen_complete check (
    status not in ('pending_approval', 'approved', 'superseded')
    or (content_hash is not null and sms_bodies is not null and submitted_at is not null and version > 0)
  ),
  constraint alert_entry_approval_complete check (
    (approved_by is null) = (approved_at is null)
    and (approved_by is null) = (approved_version is null)
    and (approved_by is null) = (approved_hash is null)
  ),
  constraint alert_entry_approved_has_approval check (status <> 'approved' or (approved_by is not null and web_published_at is not null)),
  constraint alert_entry_unapproved_has_none check (status not in ('draft', 'pending_approval', 'discarded') or approved_by is null),
  constraint alert_entry_returned_only_in_draft check (status not in ('pending_approval', 'approved') or returned_for is null)
);
create index alert_entry_alert_id_idx on alert_entry (alert_id);
create index alert_entry_author_id_idx on alert_entry (author_id);
create index alert_entry_approved_by_idx on alert_entry (approved_by);
alter table alert_entry enable row level security;
revoke all on table alert_entry from public, anon, authenticated, service_role;
grant select, insert on table alert_entry to cvh_app;
-- Not editor_ids: only the trigger writes it. Not id, alert_id, kind, author_id, created_at.
grant update (
  status, original_text, types, audience, phase, valid_until, version, content_hash, sms_bodies,
  submitted_at, returned_for, approved_by, approved_at, approved_version, approved_hash, web_published_at
) on table alert_entry to cvh_app;
create policy alert_entry_app_select on alert_entry for select to cvh_app using (true);
create policy alert_entry_app_insert on alert_entry for insert to cvh_app with check (true);
create policy alert_entry_app_update on alert_entry for update to cvh_app using (true) with check (true);

-- alert_entry_translation: the web text of each translated language (every launch language
-- except English), frozen with the entry at submit.
create table alert_entry_translation (
  entry_id uuid not null references alert_entry (id),
  lang text not null,
  body text not null,
  machine boolean not null default true,
  model text,
  status text not null,
  source_hash text not null,
  created_at timestamptz not null default now(),
  primary key (entry_id, lang),
  constraint alert_entry_translation_lang_valid check (lang in ('ur', 'ps', 'tl', 'prs', 'gu', 'ta', 'el', 'sk', 'bn', 'hi', 'pa', 'zh', 'es', 'fr', 'zh-Hant')),
  constraint alert_entry_translation_body_present check (btrim(body) <> ''),
  constraint alert_entry_translation_status_valid check (status in ('translated', 'fallback_en', 'script_converted')),
  constraint alert_entry_translation_source_hash_format check (source_hash ~ '^[0-9a-f]{64}$')
);
alter table alert_entry_translation enable row level security;
revoke all on table alert_entry_translation from public, anon, authenticated, service_role;
grant select, insert, delete on table alert_entry_translation to cvh_app;
create policy alert_entry_translation_app_select on alert_entry_translation for select to cvh_app using (true);
create policy alert_entry_translation_app_insert on alert_entry_translation for insert to cvh_app with check (true);
create policy alert_entry_translation_app_delete on alert_entry_translation for delete to cvh_app using (true);

-- feed_version: one row, incremented by every transaction that changes what the web shows
-- (AD-12); the feed's cache and the clients compare it. It only goes up, by one.
create table feed_version (
  id smallint primary key default 1,
  version bigint not null default 0,
  constraint feed_version_single_row check (id = 1),
  constraint feed_version_non_negative check (version >= 0)
);
insert into feed_version (id, version) values (1, 0);
alter table feed_version enable row level security;
revoke all on table feed_version from public, anon, authenticated, service_role;
grant select on table feed_version to cvh_app;
grant update (version) on table feed_version to cvh_app;
create policy feed_version_app_select on feed_version for select to cvh_app using (true);
create policy feed_version_app_update on feed_version for update to cvh_app using (true) with check (true);

create function feed_version_forward_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.version <> old.version + 1 then
    raise exception 'feed_version only goes up, by one'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke all on function feed_version_forward_only() from public, anon, authenticated, service_role;
create trigger feed_version_forward_only before update on feed_version for each row execute function feed_version_forward_only();

-- ---------------------------------------------------------------------------------------------
-- The entry's state machine and rules (see the header).
-- ---------------------------------------------------------------------------------------------
create function alert_entry_guard() returns trigger
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
    or new.valid_until is distinct from old.valid_until;

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
       or new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at
       or new.approved_version is distinct from old.approved_version
       or new.approved_hash is distinct from old.approved_hash
       or new.web_published_at is distinct from old.web_published_at then
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
    if new.returned_for is not null or new.approved_by is not null then
      raise exception 'alert_entry: submit clears the return and holds no approval' using errcode = 'check_violation';
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
       or new.version <> old.version then
      raise exception 'alert_entry: returning to draft clears the hash, the SMS bodies and the time, and keeps the version' using errcode = 'check_violation';
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
       or new.submitted_at is distinct from old.submitted_at then
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
create trigger alert_entry_guard before insert or update on alert_entry for each row execute function alert_entry_guard();

-- Returning an entry to draft deletes its frozen translations (it runs after the row is a draft,
-- when alert_entry_translation_guard lets them go).
create function alert_entry_clear_translations() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'pending_approval' and new.status = 'draft' then
    delete from public.alert_entry_translation where entry_id = new.id;
  end if;
  return null;
end
$$;
revoke all on function alert_entry_clear_translations() from public, anon, authenticated, service_role;
create trigger alert_entry_clear_translations after update on alert_entry for each row execute function alert_entry_clear_translations();

-- Translations change only while their entry is a draft. The parent row is locked FOR SHARE, so
-- a submit that is freezing the entry at the same moment either finishes first (and this refuses)
-- or waits for this.
create function alert_entry_translation_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_status text;
  parent_editors uuid[];
  actor_text text := nullif(current_setting('cvh.actor_id', true), '');
  actor uuid;
begin
  select e.status, e.editor_ids into parent_status, parent_editors from public.alert_entry e where e.id = coalesce(new.entry_id, old.entry_id) for share;
  if parent_status is distinct from 'draft' then
    raise exception 'alert_entry_translation: the translations of a % entry are frozen', parent_status using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then
    -- Not checked: the delete that a return to draft cascades must work for any returner.
    return old;
  end if;
  -- Only an editor of the entry adds a translation (so a returner who is not an editor cannot
  -- supply the translations a submit needs).
  if actor_text is not null and actor_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    actor := actor_text::uuid;
  end if;
  if actor is null or not (actor = any (parent_editors)) then
    raise exception 'alert_entry_translation: only an editor of the entry adds a translation' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke all on function alert_entry_translation_guard() from public, anon, authenticated, service_role;
create trigger alert_entry_translation_guard before insert or delete on alert_entry_translation for each row execute function alert_entry_translation_guard();
