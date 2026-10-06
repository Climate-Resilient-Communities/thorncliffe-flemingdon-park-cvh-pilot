-- S09.07: the end-of-pilot re-consent campaign (FR-D-7, AR-13 retention states, AR-12 `campaign`; E09 definitions "Campaign", "Re-consent prompt",
-- "Receiving subscriber"; spine AD-9 D-7), owned by the subscriptions module (AD-2).
--
--  - `campaign`: one row per campaign: the real one (at most one, `rehearsal = false`) and its rehearsals on the drill roster (S06.05, as many as the
--    Hub runs). A row freezes what the texts say (`texts`: the catalog's campaign text in each of the 15 languages with the deadline filled in, and
--    its segments), the terms version the subscribers who stay accept (`terms_version`), the deadline (`deadline_date`, the Toronto day the text
--    names, 30 days after the start; `deadline`, the end of that day in Toronto, the instant a YES stops counting), who started it, from which
--    session, at which assurance level, and the Admin's idempotency key (a retried request finds its row). States `started -> ended` (the end job,
--    once the deadline has passed by the database's clock); `cancelled` exists so that the sender can be told to stop a campaign's texts, and only the
--    owner sets it (the guard refuses it from the app's logins; nothing in the app cancels). Sign-ups stay closed from the real campaign's start until an
--    Admin reopens them for the MVP, after it ended (`signups_reopened_at`, `signups_reopened_by`).
--
-- What the database refuses, whoever asks (the app's code, a script, the owner), in `campaign_guard()`:
--  - a campaign not started by an active Admin from that Admin's own unrevoked session that reached aal2 (S01.10's `staff_session.aal2_at`): the
--    database reads the session itself and records `started_aal` from it, so nothing the caller states about an account or a level is believed;
--  - a deadline that is not 30 days after the start, in Toronto, by the database's clock; a frozen text missing for one of the 15 languages;
--  - a real campaign with no rehearsal before it, and a second real campaign (the unique index);
--  - a change to anything frozen at the start; a state change other than `started -> ended` after the deadline or `started -> cancelled` by the table's
--    owner; sign-ups reopened before the real campaign ended, by anyone but an active Admin, or twice.
--
-- The outbox (messaging, S06.01) reads campaigns from here:
--  - `delivery_campaign_started_by_admin(uuid)` now reads the row: started at aal2 by an Admin who is still active, and not cancelled (it answered
--    false for every campaign until this story);
--  - `delivery.campaign_id` gets its foreign key, NOT VALID (no campaign row existed, so no delivery row could name one);
--  - `delivery_kind_shape` lets a campaign text go to a `roster` recipient, and `delivery_insert_guard()` says when: only a rehearsal's, only to a
--    member of the drill roster; a real campaign's text goes only to a subscriber being asked (`reconsent_pending`). Either way the text is the
--    campaign's frozen text for its language, byte for byte, its purpose is `reconsent`, its key `campaign:{campaign}:reconsent:{recipient}` (one per
--    campaign and recipient), and it is made only while its campaign runs (started, before the deadline).
--
-- The re-consent prompt: `sms_prompt` holds one prompt per subscriber, and a `reconsent` prompt is open until the deadline (up to 31 days), so its
-- expiry check is widened for that kind only (NOT VALID: every existing row keeps to the one hour).
--
-- A subscriber who says YES is `retained` and accepts the campaign's terms version: the app may now update `subscriber.consent_version` too.
--
-- Expand-only on existing tables: constraints replaced by wider ones added NOT VALID, a foreign key NOT VALID, a function's body and a trigger
-- function's body replaced (same signatures, same security), and a column grant added.

create table campaign (
  id uuid primary key,
  rehearsal boolean not null,
  state text not null default 'started',
  deadline_date date not null,
  deadline timestamptz not null,
  terms_version text not null,
  texts jsonb not null,
  started_by uuid not null references staff_account (id),
  started_session text not null,
  started_aal text not null,
  started_at timestamptz not null default now(),
  idempotency_key text not null,
  ended_at timestamptz,
  signups_reopened_at timestamptz,
  signups_reopened_by uuid references staff_account (id),
  constraint campaign_idempotency_key_unique unique (idempotency_key),
  constraint campaign_idempotency_key_format check (idempotency_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  constraint campaign_state_known check (state in ('started', 'ended', 'cancelled')),
  constraint campaign_terms_version_format check (terms_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[1-9][0-9]*$'),
  constraint campaign_texts_object check (jsonb_typeof(texts) = 'object'),
  constraint campaign_started_session_format check (started_session ~ '^[0-9a-f]{64}$'),
  constraint campaign_started_aal_known check (started_aal in ('aal1', 'aal2')),
  constraint campaign_ended_when_ended check ((state = 'ended') = (ended_at is not null)),
  constraint campaign_reopened_shape check ((signups_reopened_at is null) = (signups_reopened_by is null)),
  constraint campaign_reopened_real_ended check (signups_reopened_at is null or (not rehearsal and state = 'ended'))
);
-- At most one real campaign: starting it again finds this one.
create unique index campaign_one_real_idx on campaign (rehearsal) where not rehearsal;
create index campaign_started_by_idx on campaign (started_by);
create index campaign_signups_reopened_by_idx on campaign (signups_reopened_by);
alter table campaign enable row level security;
revoke all on table campaign from public, anon, authenticated, service_role;
-- The app starts campaigns and rehearsals, ends them (the job) and reopens sign-ups; it never deletes one, cancels one (the guard) or changes what was frozen.
grant select, insert on table campaign to cvh_app;
grant update (state, signups_reopened_by) on table campaign to cvh_app;
create policy campaign_app_select on campaign for select to cvh_app using (true);
create policy campaign_app_insert on campaign for insert to cvh_app with check (true);
create policy campaign_app_update on campaign for update to cvh_app using (true) with check (true);

-- How long a subscriber has to answer: the deadline is the end of the Toronto day 30 days after the start (AD-9 D-7, S09.08).
create function campaign_deadline_of(p_day date) returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select ((p_day + 1)::timestamp at time zone 'America/Toronto')
$$;
revoke all on function campaign_deadline_of(date) from public, anon, authenticated, service_role;
grant execute on function campaign_deadline_of(date) to cvh_app;

create function campaign_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  starter_ok boolean;
  session_row record;
  lang text;
  frozen jsonb;
  langs text[] := array['en', 'ur', 'ps', 'tl', 'prs', 'gu', 'ta', 'el', 'sk', 'bn', 'hi', 'pa', 'zh', 'es', 'fr'];
begin
  if tg_op = 'INSERT' then
    select exists (select 1 from public.staff_account s where s.id = new.started_by and s.role = 'admin' and s.status = 'active') into starter_ok;
    if not starter_ok then
      raise exception 'campaign: a campaign is started by an active Admin' using errcode = 'check_violation';
    end if;
    select st.staff_account_id, st.revoked_at, st.aal2_at into session_row from public.staff_session st where st.id = new.started_session;
    if not found or session_row.staff_account_id is distinct from new.started_by or session_row.revoked_at is not null then
      raise exception 'campaign: a campaign is started from the Admin''s own open session' using errcode = 'check_violation';
    end if;
    -- The level is the database's reading of the session, never the caller's.
    new.started_aal := case when session_row.aal2_at is not null then 'aal2' else 'aal1' end;
    if new.started_aal <> 'aal2' then
      raise exception 'campaign: a campaign is started by an Admin at aal2' using errcode = 'check_violation';
    end if;
    new.state := 'started';
    new.started_at := now();
    new.ended_at := null;
    new.signups_reopened_at := null;
    new.signups_reopened_by := null;
    if new.deadline_date is distinct from (now() at time zone 'America/Toronto')::date + 30 then
      raise exception 'campaign: the deadline is the Toronto day 30 days after the start' using errcode = 'check_violation';
    end if;
    new.deadline := public.campaign_deadline_of(new.deadline_date);
    foreach lang in array langs loop
      frozen := new.texts -> lang;
      if frozen is null or jsonb_typeof(frozen -> 'body') is distinct from 'string' or btrim(frozen ->> 'body') = '' or char_length(frozen ->> 'body') > 1600
         or jsonb_typeof(frozen -> 'segments') is distinct from 'number' or (frozen ->> 'segments') !~ '^([1-9]|1[0-9]|2[0-4])$' then
        raise exception 'campaign: the frozen text of language % is missing or not a text', lang using errcode = 'check_violation';
      end if;
    end loop;
    if (select count(*) from jsonb_object_keys(new.texts)) <> cardinality(langs) then
      raise exception 'campaign: the frozen texts are those of the 15 languages, and no other' using errcode = 'check_violation';
    end if;
    if not new.rehearsal and not exists (select 1 from public.campaign c where c.rehearsal) then
      raise exception 'campaign: the campaign is rehearsed on the drill roster before it starts' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id or new.rehearsal is distinct from old.rehearsal or new.deadline_date is distinct from old.deadline_date
     or new.deadline is distinct from old.deadline or new.terms_version is distinct from old.terms_version or new.texts is distinct from old.texts
     or new.started_by is distinct from old.started_by or new.started_session is distinct from old.started_session
     or new.started_aal is distinct from old.started_aal or new.started_at is distinct from old.started_at
     or new.idempotency_key is distinct from old.idempotency_key then
    raise exception 'campaign: what was frozen at the start never changes' using errcode = 'check_violation';
  end if;
  if new.state is distinct from old.state then
    if old.state <> 'started' or new.state not in ('ended', 'cancelled') then
      raise exception 'campaign: % to % is not an allowed change', old.state, new.state using errcode = 'check_violation';
    end if;
    if new.state = 'ended' and now() < old.deadline then
      raise exception 'campaign: a campaign ends once its deadline has passed' using errcode = 'check_violation';
    end if;
    -- Only the owner cancels (docs/config.md): every login of the app is refused (a jobs worker's, a renamed pooler role's), not one login by name; only
    -- the table's owner (the SQL editor, the migrator's tools, the tests' fixtures) and a superuser are not the app.
    if new.state = 'cancelled'
       and session_user <> (select pg_catalog.pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid = 'public.campaign'::regclass)
       and not exists (select 1 from pg_catalog.pg_roles r where r.rolname = session_user and r.rolsuper) then
      raise exception 'campaign: only the owner cancels a campaign' using errcode = 'check_violation';
    end if;
    new.ended_at := case when new.state = 'ended' then now() else null end;
  elsif new.ended_at is distinct from old.ended_at then
    raise exception 'campaign: the end is recorded with the state' using errcode = 'check_violation';
  end if;
  if new.signups_reopened_by is distinct from old.signups_reopened_by or new.signups_reopened_at is distinct from old.signups_reopened_at then
    if old.signups_reopened_by is not null or new.signups_reopened_by is null then
      raise exception 'campaign: sign-ups are reopened once' using errcode = 'check_violation';
    end if;
    if old.rehearsal or new.state <> 'ended' then
      raise exception 'campaign: sign-ups are reopened after the campaign ended' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.staff_account s where s.id = new.signups_reopened_by and s.role = 'admin' and s.status = 'active') then
      raise exception 'campaign: sign-ups are reopened by an active Admin' using errcode = 'check_violation';
    end if;
    new.signups_reopened_at := now();
  end if;
  return new;
end
$$;
revoke all on function campaign_guard() from public, anon, authenticated, service_role;

create trigger campaign_guard before insert or update on campaign
  for each row execute function campaign_guard();

-- ---------------------------------------------------------------------------------------------
-- The outbox's reading of a campaign (S06.01's seam): started at aal2 by an Admin who is still an active Admin, and not cancelled.
-- ---------------------------------------------------------------------------------------------
create or replace function delivery_campaign_started_by_admin(p_campaign_id uuid) returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select c.state <> 'cancelled' and c.started_aal = 'aal2'
           and exists (select 1 from public.staff_account s where s.id = c.started_by and s.role = 'admin' and s.status = 'active')
    from public.campaign c
    where c.id = p_campaign_id
  ), false)
$$;

alter table delivery add constraint delivery_campaign_id_fkey foreign key (campaign_id) references campaign (id) not valid;

-- A campaign text may go to a drill-roster member (a rehearsal's); the insert guard says when.
alter table delivery drop constraint delivery_kind_shape;
alter table delivery add constraint delivery_kind_shape check (
  (kind = 'alert' and entry_id is not null and campaign_id is null and purpose is null
    and created_by_module = 'alerting' and recipient_kind in ('subscriber', 'roster'))
  or (kind = 'transactional' and entry_id is null and campaign_id is null and purpose is not null and send_by is not null)
  or (kind = 'campaign' and entry_id is null and campaign_id is not null and purpose is not null and created_by_module = 'subscriptions'
    and recipient_kind in ('subscriber', 'roster'))
) not valid;

-- ---------------------------------------------------------------------------------------------
-- The insert guard of S09.02, with the campaign rule (see the header).
-- ---------------------------------------------------------------------------------------------
create or replace function delivery_insert_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  key_parts text[] := string_to_array(new.idempotency_key, ':');
  approving text := nullif(current_setting('cvh.approval_entry_id', true), '');
  entry_status text;
  entry_bodies jsonb;
  entry_approved_at timestamptz;
  entry_types text[];
  entry_scope text;
  entry_is_drill boolean;
  frozen jsonb;
  rule record;
  key_part text;
  root public.delivery%rowtype;
  chain_resends integer;
  latest_state text;
  run record;
begin
  if new.state <> 'queued' or new.attempts <> 0 then
    raise exception 'delivery: a new delivery is queued, with no attempts' using errcode = 'check_violation';
  end if;
  if new.recipient_id is null then
    raise exception 'delivery: a new delivery names its recipient' using errcode = 'check_violation';
  end if;
  if new.submitted_at is not null or new.provider_message_id is not null or new.provider_error_code is not null then
    raise exception 'delivery: a new delivery has no provider answer yet' using errcode = 'check_violation';
  end if;
  -- The database makes the reference the provider calls back with, and the times.
  new.callback_ref := gen_random_uuid();
  new.created_at := now();
  new.updated_at := new.created_at;
  new.completed_at := null;

  if new.resend_of is not null or new.resend_n is not null then
    -- A resend (S09.02): a copy of the chain's root, made when the chain's latest text did not arrive.
    if new.kind <> 'alert' then
      raise exception 'delivery: only an alert text is resent' using errcode = 'check_violation';
    end if;
    if new.resend_of is null or new.resend_n is null then
      raise exception 'delivery: a resend names the chain''s first delivery and its number' using errcode = 'check_violation';
    end if;
    -- The chain's root, locked first: two resends of one chain are judged one after the other.
    select * into root from public.delivery d where d.id = new.resend_of for update;
    if not found or root.resend_of is not null then
      raise exception 'delivery: resend_of is the first delivery of the chain' using errcode = 'check_violation';
    end if;
    if root.recipient_id is null then
      raise exception 'delivery: a text is never resent to a recipient who is gone' using errcode = 'check_violation';
    end if;
    if new.recipient_kind is distinct from root.recipient_kind or new.recipient_id is distinct from root.recipient_id
       or new.entry_id is distinct from root.entry_id or new.campaign_id is distinct from root.campaign_id
       or new.created_by_module is distinct from root.created_by_module or new.purpose is distinct from root.purpose
       or new.channel is distinct from root.channel or new.lang is distinct from root.lang or new.body is distinct from root.body
       or new.segments is distinct from root.segments or new.cost_estimate_cents is distinct from root.cost_estimate_cents or new.send_by is not null then
      raise exception 'delivery: a resend is a copy of the first delivery of its chain' using errcode = 'check_violation';
    end if;
    if new.idempotency_key is distinct from 'resend:' || new.resend_of::text || ':' || new.resend_n::text then
      raise exception 'delivery: a resend''s key is resend:root:n' using errcode = 'check_violation';
    end if;
    select count(*) into chain_resends from public.delivery d where d.resend_of = root.id;
    if new.resend_n is distinct from (chain_resends + 1)::smallint then
      raise exception 'delivery: a resend is the next number of its chain (a chain has at most 2 resends)' using errcode = 'check_violation';
    end if;
    select d.state into latest_state from public.delivery d where d.id = root.id or d.resend_of = root.id order by d.resend_n desc nulls last limit 1;
    if latest_state not in ('failed', 'undelivered', 'unknown') then
      raise exception 'delivery: only a text that failed, was undelivered or is unknown is resent, once the latest of its chain' using errcode = 'check_violation';
    end if;
    select e.status, a.is_drill, e.types, e.audience ->> 'scope' into entry_status, entry_is_drill, entry_types, entry_scope
      from public.alert_entry e join public.alert a on a.id = e.alert_id where e.id = new.entry_id;
    if entry_status is distinct from 'approved' then
      raise exception 'delivery: a resend belongs to an approved entry, not %', coalesce(entry_status, 'missing') using errcode = 'check_violation';
    end if;
    if entry_is_drill then
      if new.recipient_kind <> 'roster' or not exists (select 1 from public.drill_roster r where r.id = new.recipient_id) then
        raise exception 'delivery: a drill is texted only to a member of the drill roster' using errcode = 'check_violation';
      end if;
    elsif new.recipient_kind = 'roster' then
      raise exception 'delivery: an alert that is not a drill is never texted to the drill roster' using errcode = 'check_violation';
    end if;
    new.claim_rank := public.delivery_claim_rank('alert', new.recipient_kind, entry_types, entry_scope);
    return new;
  end if;

  if new.kind = 'alert' then
    -- The key is entry:recipient:channel, so a recipient is texted once per entry and channel.
    if new.idempotency_key is distinct from new.entry_id::text || ':' || new.recipient_id::text || ':' || new.channel then
      raise exception 'delivery: an alert delivery''s key is entry_id:recipient:channel' using errcode = 'check_violation';
    end if;
    if approving is distinct from new.entry_id::text then
      raise exception 'delivery: an alert delivery is created only inside the approval transaction of its entry (cvh.approval_entry_id)'
        using errcode = 'check_violation';
    end if;
    select e.status, e.sms_bodies, e.approved_at, e.types, e.audience ->> 'scope', a.is_drill
      into entry_status, entry_bodies, entry_approved_at, entry_types, entry_scope, entry_is_drill
      from public.alert_entry e join public.alert a on a.id = e.alert_id where e.id = new.entry_id;
    if entry_status is null or entry_status not in ('pending_approval', 'approved') then
      raise exception 'delivery: an alert delivery belongs to an entry that is being approved or is approved, not %', coalesce(entry_status, 'missing')
        using errcode = 'check_violation';
    end if;
    -- Drill isolation (S06.05, AD-6, AR-10): the text of a drill goes only to a member of the drill roster, and the text of a real alert never does.
    -- A roster recipient must be a row of drill_roster now (a deleted member cannot be texted).
    if entry_is_drill then
      if new.recipient_kind <> 'roster' or not exists (select 1 from public.drill_roster r where r.id = new.recipient_id) then
        raise exception 'delivery: a drill is texted only to a member of the drill roster' using errcode = 'check_violation';
      end if;
    elsif new.recipient_kind = 'roster' then
      raise exception 'delivery: an alert that is not a drill is never texted to the drill roster' using errcode = 'check_violation';
    end if;
    -- The approval stamps the entry with now(): only the transaction that approved it may add its deliveries. The marker
    -- alone is not enough for an entry approved long ago, since any transaction can set it.
    if entry_status = 'approved' and entry_approved_at is distinct from now() then
      raise exception 'delivery: an alert delivery of an approved entry is created in the transaction that approved it' using errcode = 'check_violation';
    end if;
    -- What the approver was shown is what goes out: the entry's frozen SMS body in the row's language.
    frozen := entry_bodies -> new.lang;
    if frozen is null or frozen ->> 'body' is distinct from new.body or frozen ->> 'segments' is distinct from new.segments::text then
      raise exception 'delivery: an alert delivery carries the entry''s frozen SMS body and segments for its language' using errcode = 'check_violation';
    end if;
    -- The dispatcher's claim order (E06 "Claim order"), fixed when the text is created: the entry's types and audience are frozen
    -- from submit, so the rank never goes stale.
    new.claim_rank := public.delivery_claim_rank('alert', new.recipient_kind, entry_types, entry_scope);
  else
    new.claim_rank := public.delivery_claim_rank(new.kind, new.recipient_kind, null, null);
    -- kind:subject:purpose:nonce, each part present.
    if cardinality(key_parts) <> 4 or key_parts[1] <> new.kind or key_parts[2] = '' or key_parts[4] = ''
       or key_parts[3] is distinct from new.purpose then
      raise exception 'delivery: the key of a % delivery is kind:subject:purpose:nonce', new.kind using errcode = 'check_violation';
    end if;
    -- The key outlives the text and is logged: neither the subject nor the nonce may be a phone number (messaging's
    -- looksLikePhoneNumber: only digits and phone punctuation, 7 to 15 digits).
    foreach key_part in array array[key_parts[2], key_parts[4]] loop
      if key_part ~ '^\+?[0-9 ().-]+$' and length(regexp_replace(key_part, '[^0-9]', '', 'g')) between 7 and 15 then
        raise exception 'delivery: no part of a key is a phone number' using errcode = 'check_violation';
      end if;
    end loop;
    if new.kind = 'transactional' then
      select r.recipient_kinds, r.max_window into rule from public.delivery_purpose_rule(new.created_by_module, new.purpose) r;
      if not found then
        raise exception 'delivery: purpose % is not on the allow-list of module %', new.purpose, new.created_by_module using errcode = 'check_violation';
      end if;
      if not (new.recipient_kind = any (rule.recipient_kinds)) then
        raise exception 'delivery: purpose % is never texted to a % recipient', new.purpose, new.recipient_kind using errcode = 'check_violation';
      end if;
      if new.send_by is null then
        raise exception 'delivery: a transactional delivery has a send_by' using errcode = 'check_violation';
      end if;
      if new.send_by <= new.created_at or new.send_by > new.created_at + rule.max_window then
        raise exception 'delivery: send_by of a % text is within % of now', new.purpose, rule.max_window using errcode = 'check_violation';
      end if;
    elsif not public.delivery_campaign_started_by_admin(new.campaign_id) then
      raise exception 'delivery: a campaign delivery needs a campaign started by an Admin at aal2' using errcode = 'check_violation';
    else
      -- S09.07: a campaign text, one per campaign and recipient, made while the campaign runs, in the campaign's frozen text for its language.
      select c.rehearsal, c.texts, c.state, c.deadline into run from public.campaign c where c.id = new.campaign_id;
      if not found then
        raise exception 'delivery: a campaign delivery needs a campaign started by an Admin at aal2' using errcode = 'check_violation';
      end if;
      if run.state <> 'started' or now() >= run.deadline then
        raise exception 'delivery: a campaign text is made only while its campaign runs' using errcode = 'check_violation';
      end if;
      if new.purpose <> 'reconsent' then
        raise exception 'delivery: a campaign text''s purpose is reconsent' using errcode = 'check_violation';
      end if;
      if key_parts[2] is distinct from new.campaign_id::text or key_parts[4] is distinct from new.recipient_id::text then
        raise exception 'delivery: a campaign text''s key is campaign:campaign_id:reconsent:recipient_id' using errcode = 'check_violation';
      end if;
      if run.rehearsal then
        -- The rehearsal (S06.05's drill rule): only the staff phones on the drill roster.
        if new.recipient_kind <> 'roster' or not exists (select 1 from public.drill_roster r where r.id = new.recipient_id) then
          raise exception 'delivery: a rehearsal is texted only to a member of the drill roster' using errcode = 'check_violation';
        end if;
      elsif new.recipient_kind <> 'subscriber'
            or not exists (select 1 from public.subscriber s where s.id = new.recipient_id and s.retention_state = 'reconsent_pending') then
        raise exception 'delivery: a campaign is texted only to a subscriber it asks to re-consent' using errcode = 'check_violation';
      end if;
      frozen := run.texts -> new.lang;
      if frozen is null or frozen ->> 'body' is distinct from new.body or frozen ->> 'segments' is distinct from new.segments::text then
        raise exception 'delivery: a campaign text carries the campaign''s frozen text and segments for its language' using errcode = 'check_violation';
      end if;
    end if;
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- The re-consent prompt is open until the deadline (E09 "Re-consent prompt"); every other prompt keeps to one hour.
-- ---------------------------------------------------------------------------------------------
alter table sms_prompt drop constraint sms_prompt_expires_after_sent;
alter table sms_prompt add constraint sms_prompt_expires_after_sent check (
  expires_at > sent_at and (expires_at <= sent_at + interval '1 hour' or (kind = 'reconsent' and expires_at <= sent_at + interval '32 days'))
) not valid;

-- YES to the campaign makes the subscriber `retained` under the campaign's terms version (S07.01: existing subscribers keep theirs until the re-consent).
grant update (consent_version) on table subscriber to cvh_app;
