-- S04.05: Hub staff log a disruption and write an acknowledgement or alert (AD-5, AD-10, AD-21), owned by the
-- alerting module.
--
-- What this adds to the tables S04.03 created:
--  1. `alert.slug`: the thread's short public slug (spine: Consistency Conventions, IDs), made when the thread is
--     logged and never changed, because every text message links to `/a/{slug}` and the link is frozen into the body
--     at submit (S04.06's renderer). S04.08's landing page reads it.
--  2. `alert_entry.possible_duplicate_of`: the open, non-drill thread this entry may duplicate, worked out at submit and
--     frozen with it, so the approver is shown a "possible duplicate" link (AD-5, S04.07). Advisory: not hashed.
--  3. `alert_entry_translation.conversion` and two checks: the zh-Hant conversion record (the zh text's hash, OpenCC's
--     version and configuration) is kept beside its text, and a translation's status, machine flag and model agree.
--  4. `alert_submit_attempt`: one row per Submit press (or "Try translation again"), keyed by the browser's idempotency
--     key. It is what makes a submit whose outcome the browser did not see recoverable (`running`, `committed`,
--     `failed`): the same key returns the first attempt's result, a new key is allowed only after a confirmed failure,
--     and a partial unique index lets only one attempt run per entry. It also holds each language's progress while
--     the translation runs outside any lock.
--  5. `alert_entry.valid_until_mode`: whether the author chose "until resolved" or a date and time for the valid-until,
--     so the composer opens on the choice that was made.
--
-- New constraints on tables that already exist are NOT VALID (expand-only; see 20261002290000_alert_audience_shape.sql
-- for why none is validated here): alert and alert_entry hold no row in any environment that has not been through
-- the app's own use cases, which respect them, and a NOT VALID check still binds every insert and update.
--
-- Supabase's default privileges grant every new table in public to anon, authenticated and service_role, so the new
-- table takes those back; only cvh_app (S01.04) reaches it.

-- ---------------------------------------------------------------------------------------------
-- 1. alert.slug
-- ---------------------------------------------------------------------------------------------
alter table alert add column slug text;
-- Threads made before this migration (none outside development databases) get a slug of their own, from their id. S04.03's guard
-- refuses every update of a closed thread (ALERT_CLOSED), so it is off for this one statement: closed threads need a slug too, and the
-- guard it replaces below is back on, in this same transaction, before anything else can write.
alter table alert disable trigger alert_guard;
update alert set slug = substr(md5(id::text), 1, 8) where slug is null;
alter table alert enable trigger alert_guard;
create unique index alert_slug_key on alert (slug);
alter table alert add constraint alert_slug_valid check (slug is not null and slug ~ '^[a-z0-9]{6,16}$') not valid;

-- A thread's slug never changes either (a text message already carries the link). The rest of the guard is S04.03's.
create or replace function alert_guard() returns trigger
language plpgsql
set search_path = ''
as $$
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
  return new;
end
$$;
revoke all on function alert_guard() from public, anon, authenticated, service_role;

-- The nondrill_alert view (S04.03) selects named columns, so it does not show the slug; S04.08 widens it with its own
-- migration when the landing page needs it.

-- ---------------------------------------------------------------------------------------------
-- 2. alert_entry.possible_duplicate_of
-- ---------------------------------------------------------------------------------------------
alter table alert_entry add column possible_duplicate_of uuid references alert (id);
create index alert_entry_possible_duplicate_of_idx on alert_entry (possible_duplicate_of);
alter table alert_entry add constraint alert_entry_duplicate_not_self check (possible_duplicate_of is null or possible_duplicate_of <> alert_id) not valid;
-- A draft holds nothing frozen, and the duplicate link is frozen with the entry at submit.
alter table alert_entry add constraint alert_entry_draft_no_duplicate check (status <> 'draft' or possible_duplicate_of is null) not valid;
grant update (possible_duplicate_of) on table alert_entry to cvh_app;
-- How the author chose the valid-until: `resolved` ("until resolved": 24 elapsed hours from the press, renewed by each save and submit) or `at`
-- (a date and time). The composer opens on the choice that was made, so a later Save or Submit keeps meaning what the author chose, and the
-- next stories' composers default to the previous entry's choice (epic E04, Valid until). It is part of the draft's content, not of what is
-- hashed: the valid-until instant is.
alter table alert_entry add column valid_until_mode text not null default 'at';
alter table alert_entry add constraint alert_entry_valid_until_mode_valid check (valid_until_mode in ('at', 'resolved')) not valid;
grant update (valid_until_mode) on table alert_entry to cvh_app;

-- The link is set by the submit that freezes the entry (draft to pending_approval) and cleared by the return to draft; it never
-- changes in any other update (a pending entry cannot be changed at all, and an approval keeps what it approves). That is S04.03's
-- entry guard with the new column added to the fields it already holds still (a replaced function, not a second trigger: the
-- guard of an existing table is one place, and a new trigger on a table the previous release writes is a destructive change).
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
       or new.possible_duplicate_of is not null or new.version <> old.version then
      raise exception 'alert_entry: returning to draft clears the hash, the SMS bodies, the time and the possible-duplicate link, and keeps the version' using errcode = 'check_violation';
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
-- 3. alert_entry_translation.conversion and its checks
-- ---------------------------------------------------------------------------------------------
alter table alert_entry_translation add column conversion jsonb;
-- Only zh-Hant is converted, and its conversion record is kept: the zh text's hash, OpenCC's version and configuration.
alter table alert_entry_translation add constraint alert_entry_translation_conversion_shape check (
  (
    (status = 'script_converted') = (conversion is not null)
    and (
      conversion is null
      or (
        jsonb_typeof(conversion) = 'object'
        and conversion ->> 'from' = 'zh'
        and conversion ->> 'from_text_hash' ~ '^[0-9a-f]{64}$'
        and btrim(coalesce(conversion ->> 'opencc_version', '')) <> ''
        and btrim(coalesce(conversion ->> 'config', '')) <> ''
      )
    )
  ) is true
) not valid;
-- A model's translation and a conversion are machine text from a named model (OpenCC for zh-Hant); the English fallback is
-- neither machine text nor from a model (the contract of src/contracts/translated.ts, kept by alerting's mapper).
alter table alert_entry_translation add constraint alert_entry_translation_status_consistent check (
  (status = 'fallback_en' and not machine and model is null)
  or (status in ('translated', 'script_converted') and machine and model is not null)
) not valid;

-- ---------------------------------------------------------------------------------------------
-- 4. alert_submit_attempt
-- ---------------------------------------------------------------------------------------------
create table alert_submit_attempt (
  entry_id uuid not null references alert_entry (id),
  -- The browser's key for one press of Submit (or of "Try translation again"): unguessable, never reused for another press.
  key text not null,
  kind text not null default 'submit',
  state text not null default 'running',
  actor_id uuid not null references staff_account (id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  -- The budget this attempt works to, in milliseconds: the longest route deadline plus 5 seconds (epic E04, Submit budget).
  budget_ms integer,
  -- Each language's result as it settles: { "ur": "translated", "ps": "fallback_en", "zh-Hant": "script_converted", ... }.
  progress jsonb not null default '{}'::jsonb,
  -- Why a failed attempt failed: a refusal code (DRAFT_CHANGED, ROUTES_UNAVAILABLE, ...). Never text.
  outcome text,
  -- What a committed attempt froze.
  result_version integer,
  result_hash text,
  primary key (entry_id, key),
  constraint alert_submit_attempt_key_format check (key ~ '^[A-Za-z0-9_-]{16,64}$'),
  constraint alert_submit_attempt_kind_valid check (kind in ('submit', 'retranslate')),
  constraint alert_submit_attempt_state_valid check (state in ('running', 'committed', 'failed')),
  constraint alert_submit_attempt_finished_consistent check ((state = 'running') = (finished_at is null)),
  constraint alert_submit_attempt_outcome_consistent check ((state = 'failed') = (outcome is not null)),
  constraint alert_submit_attempt_outcome_format check (outcome is null or outcome ~ '^[A-Z][A-Z0-9_]{2,40}$'),
  constraint alert_submit_attempt_result_consistent check (
    (state = 'committed') = (result_version is not null)
    and (result_version is null) = (result_hash is null)
  ),
  constraint alert_submit_attempt_hash_format check (result_hash is null or result_hash ~ '^[0-9a-f]{64}$'),
  constraint alert_submit_attempt_version_positive check (result_version is null or result_version > 0),
  constraint alert_submit_attempt_budget_positive check (budget_ms is null or budget_ms > 0),
  constraint alert_submit_attempt_progress_object check (jsonb_typeof(progress) = 'object')
);
-- Only one attempt runs per entry: a second press while one is running is refused until it finishes or is abandoned.
create unique index alert_submit_attempt_one_running on alert_submit_attempt (entry_id) where state = 'running';
create index alert_submit_attempt_actor_id_idx on alert_submit_attempt (actor_id);
alter table alert_submit_attempt enable row level security;
revoke all on table alert_submit_attempt from public, anon, authenticated, service_role;
grant select, insert on table alert_submit_attempt to cvh_app;
grant update (state, finished_at, budget_ms, progress, outcome, result_version, result_hash) on table alert_submit_attempt to cvh_app;
create policy alert_submit_attempt_app_select on alert_submit_attempt for select to cvh_app using (true);
create policy alert_submit_attempt_app_insert on alert_submit_attempt for insert to cvh_app with check (true);
create policy alert_submit_attempt_app_update on alert_submit_attempt for update to cvh_app using (true) with check (true);

-- An attempt starts running, for the acting account (`cvh.actor_id`, set by the use case), at the database's clock; it
-- ends once, as committed or failed, at the database's clock; its progress changes only while it runs; and what
-- identifies it never changes. A finished attempt is a record: nothing changes it.
create function alert_submit_attempt_guard() returns trigger
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
  if tg_op = 'INSERT' then
    if new.state <> 'running' or new.finished_at is not null or new.outcome is not null or new.result_version is not null then
      raise exception 'alert_submit_attempt: an attempt starts running' using errcode = 'check_violation';
    end if;
    if actor is null or new.actor_id <> actor then
      raise exception 'alert_submit_attempt: the attempt is the acting account''s (cvh.actor_id)' using errcode = 'check_violation';
    end if;
    new.started_at := now();
    return new;
  end if;
  if new.entry_id is distinct from old.entry_id or new.key is distinct from old.key or new.kind is distinct from old.kind
     or new.actor_id is distinct from old.actor_id or new.started_at is distinct from old.started_at then
    raise exception 'alert_submit_attempt: what identifies an attempt never changes' using errcode = 'check_violation';
  end if;
  if old.state <> 'running' then
    raise exception 'alert_submit_attempt: a % attempt is a record and never changes', old.state using errcode = 'check_violation';
  end if;
  if new.state <> 'running' then
    new.finished_at := now();
  end if;
  return new;
end
$$;
revoke all on function alert_submit_attempt_guard() from public, anon, authenticated, service_role;
create trigger alert_submit_attempt_guard before insert or update on alert_submit_attempt for each row execute function alert_submit_attempt_guard();
