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
-- Threads made before this migration (none outside development databases) get a slug of their own, from their id.
update alert set slug = substr(md5(id::text), 1, 8) where slug is null;
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

-- The link is set by the submit that freezes the entry (draft to pending_approval) and cleared by the return to draft;
-- it never changes in any other update (a pending entry cannot be changed at all, and an approval keeps what it approves).
create function alert_entry_duplicate_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.possible_duplicate_of is distinct from old.possible_duplicate_of
     and not (old.status = 'draft' and new.status = 'pending_approval')
     and not (old.status = 'pending_approval' and new.status = 'draft' and new.possible_duplicate_of is null) then
    raise exception 'alert_entry: the possible-duplicate link changes only when the entry is submitted or returned to draft'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke all on function alert_entry_duplicate_guard() from public, anon, authenticated, service_role;
create trigger alert_entry_duplicate_guard before update on alert_entry for each row execute function alert_entry_duplicate_guard();

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
