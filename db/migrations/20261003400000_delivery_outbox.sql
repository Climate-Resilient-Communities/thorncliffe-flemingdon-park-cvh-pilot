-- S06.01: the outbound queue's table (AD-8, AD-13, AD-6), owned by the messaging module (AD-2).
-- Every text the app sends is one `delivery` row, written before anything is sent. A row never holds a
-- phone number: the dispatcher resolves the number at the hand-off point through the ContactResolver
-- port (E06, S06.02) and keeps it in memory only.
--
-- What the database refuses, whoever asks (the app's code, a script, the owner):
--  - a state change that is not in the transition table (E06 "State transitions"; messaging's
--    domain/deliveryState.ts is the same table, and test/db/delivery.db.test.ts checks every pair of
--    states against both), and any change at all to a row in a terminal state;
--  - a change to what was frozen at creation (the body, the segments, the cost estimate, the language,
--    the recipient's kind, the key and the callback reference);
--  - a cancellation or skip of a row that was already handed to the provider (`handed_off_at` is set);
--  - a second automatic submission: a row handed to the provider goes back to `queued` only when the provider did
--    not accept it, and that counts an attempt (at most 3, then the row can only fail or become unknown); a row
--    never handed off has no outcome (submitted, unknown, delivered or undelivered); a queued row holds no
--    provider id (a text the provider gave an id to is never sent again);
--  - an `alert` row that is not created inside its entry's approval transaction: the approval use case
--    sets the transaction-local setting `cvh.approval_entry_id` to the entry's id (messaging's
--    markApprovalTransaction); the entry must be `pending_approval`, or `approved` by this very transaction
--    (`approved_at = now()`), and the row's body and segments must be the entry's frozen SMS body for the
--    row's language (byte for byte, AD-21);
--  - a `transactional` row whose purpose is not on the allow-list of the module that creates it, whose
--    recipient is of a kind that purpose never texts, or that has no `send_by` (or one further ahead than
--    the purpose's window); delivery_purpose_rule() is the allow-list and messaging's
--    domain/deliveryRules.ts is the same list;
--  - a `campaign` row unless its campaign was started by an Admin at aal2 (delivery_campaign_started_by_admin).
--    No campaign exists until S09.07 creates the `campaign` table, so until then the function answers false and
--    every campaign row is refused; S09.07 replaces the function's body with a read of the campaign row. A
--    campaign text goes to a subscriber and to no other kind of recipient (the table's check).
--
-- `idempotency_key` is unique: `entry_id:recipient:channel` for an alert, `kind:subject:purpose:nonce`
-- for anything else (the trigger checks the shape, and that no part of it is a phone number).
-- `callback_ref` is an opaque random UUID the database makes; the app cannot choose it. Times are the
-- database's: created_at, claimed_at, submitted_at, completed_at and updated_at are set by the trigger, and
-- handed_off_at is the instant the app writes it.
--
-- `recipient_id` belongs to the table `recipient_kind` names (subscriptions, identity, ops), so it is not
-- a foreign key. It becomes null when the recipient is deleted: each recipient table carries the trigger
--   create trigger <table>_forget_deliveries after delete on <table>
--     for each row execute function delivery_forget_recipient('<recipient_kind>');
-- (added by the story that creates the table; its primary key must be `id`). The trigger also replaces the
-- row's key with 'detached:<id>', since a key can hold the recipient's id, so a past delivery keeps no
-- reference to the person. That one change is the only one a terminal row allows. (A trigger on a table that
-- already exists would be refused by db:check-destructive, so it belongs in the migration that creates the
-- recipient's table; `staff_account` is never deleted, only marked removed, so it needs none.)
--
-- Who writes what: the app (cvh_app) reads, adds rows, and changes only the columns the dispatcher and the
-- callbacks change. It never deletes a row. Supabase's default privileges grant every new table to anon,
-- authenticated and service_role, so each is taken back.

create table delivery (
  id uuid primary key,
  kind text not null,
  recipient_kind text not null,
  recipient_id uuid,
  entry_id uuid references alert_entry (id),
  campaign_id uuid,
  created_by_module text not null,
  purpose text,
  channel text not null default 'sms',
  lang text not null,
  body text not null,
  segments integer not null,
  cost_estimate_cents integer not null,
  idempotency_key text not null,
  callback_ref uuid not null default gen_random_uuid(),
  state text not null default 'queued',
  attempts integer not null default 0,
  due_at timestamptz not null default now(),
  send_by timestamptz,
  claimed_at timestamptz,
  claimed_by text,
  claim_token uuid,
  handed_off_at timestamptz,
  submitted_at timestamptz,
  provider_message_id text,
  provider_error_code integer,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_idempotency_key_unique unique (idempotency_key),
  constraint delivery_callback_ref_unique unique (callback_ref),
  constraint delivery_kind_valid check (kind in ('alert', 'transactional', 'campaign')),
  constraint delivery_recipient_kind_valid check (recipient_kind in ('subscriber', 'pending_signup', 'roster', 'staff', 'oncall', 'inbound_reply')),
  constraint delivery_module_valid check (created_by_module in ('alerting', 'subscriptions', 'checkins', 'ops')),
  constraint delivery_channel_valid check (channel = 'sms'),
  constraint delivery_lang_valid check (lang in ('en', 'ur', 'ps', 'tl', 'prs', 'gu', 'ta', 'el', 'sk', 'bn', 'hi', 'pa', 'zh', 'es', 'fr', 'zh-Hant')),
  constraint delivery_body_valid check (btrim(body) <> '' and char_length(body) <= 1600),
  constraint delivery_segments_valid check (segments between 1 and 24),
  constraint delivery_cost_valid check (cost_estimate_cents >= 0),
  constraint delivery_key_format check (idempotency_key ~ '^[A-Za-z0-9._:-]{1,200}$'),
  constraint delivery_purpose_format check (purpose is null or purpose ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint delivery_state_valid check (state in ('queued', 'claimed', 'submitted', 'unknown', 'delivered', 'undelivered', 'failed', 'cancelled', 'skipped', 'skipped_env')),
  constraint delivery_attempts_valid check (attempts between 0 and 3),
  constraint delivery_claimed_by_format check (claimed_by is null or claimed_by ~ '^[A-Za-z0-9._:-]{1,64}$'),
  constraint delivery_provider_message_id_format check (provider_message_id is null or provider_message_id ~ '^(SM|MM)[0-9a-f]{32}$'),
  constraint delivery_provider_error_code_valid check (provider_error_code is null or provider_error_code between 1 and 99999),
  -- The shape of each kind. An alert is for one entry and goes to a subscriber, or to a drill-roster member (S06.05
  -- adds the drill rule). Transactional and campaign texts name no entry, so no cancellation of an entry reaches them.
  constraint delivery_kind_shape check (
    (kind = 'alert' and entry_id is not null and campaign_id is null and purpose is null
      and created_by_module = 'alerting' and recipient_kind in ('subscriber', 'roster'))
    or (kind = 'transactional' and entry_id is null and campaign_id is null and purpose is not null and send_by is not null)
    or (kind = 'campaign' and entry_id is null and campaign_id is not null and purpose is not null and created_by_module = 'subscriptions'
      and recipient_kind = 'subscriber')
  ),
  constraint delivery_send_by_after_creation check (send_by is null or send_by > created_at),
  -- A claimed row says who claimed it, when and under which lease; a queued row holds no claim, no hand-off and no
  -- provider id.
  constraint delivery_claim_coherent check (
    (state = 'claimed' and claimed_at is not null and claimed_by is not null and claim_token is not null)
    or (state = 'queued' and claimed_at is null and claimed_by is null and claim_token is null and handed_off_at is null and provider_message_id is null)
    or state not in ('claimed', 'queued')
  ),
  constraint delivery_handed_off_was_claimed check (handed_off_at is null or claimed_at is not null),
  -- The provider's id is known once a text is submitted (from its answer or from a callback).
  constraint delivery_in_flight_has_provider_id check (state not in ('submitted', 'delivered', 'undelivered') or provider_message_id is not null),
  constraint delivery_completed_when_terminal check (
    (state in ('delivered', 'undelivered', 'failed', 'cancelled', 'skipped', 'skipped_env')) = (completed_at is not null)
  )
);
-- The cancellation of an entry's rows, and the recipient's rows (a deletion's skip and the nulling of its link).
create index delivery_entry_id_idx on delivery (entry_id) where entry_id is not null;
create index delivery_recipient_idx on delivery (recipient_kind, recipient_id) where recipient_id is not null;
-- The dispatcher's and the sweep's view of what is not finished.
create index delivery_unresolved_idx on delivery (state, due_at) where state in ('queued', 'claimed', 'submitted', 'unknown');
alter table delivery enable row level security;

revoke all on table delivery from public, anon, authenticated, service_role;
grant select, insert on table delivery to cvh_app;
-- Only what the dispatcher and the callbacks change (S06.02, S06.04). Not the recipient or the key (only the
-- recipient-deletion trigger changes those), not the frozen content, and not the times the trigger sets.
grant update (state, due_at, claimed_by, claim_token, handed_off_at, attempts, provider_message_id, provider_error_code) on table delivery to cvh_app;
create policy delivery_app_select on delivery for select to cvh_app using (true);
create policy delivery_app_insert on delivery for insert to cvh_app with check (true);
create policy delivery_app_update on delivery for update to cvh_app using (true) with check (true);

-- ---------------------------------------------------------------------------------------------
-- The allow-list of transactional purposes: for each module that may create one, the purpose, the
-- kinds of recipient it may text and how far ahead its `send_by` may be (E06 definitions, "Sendable
-- (transactional)"). A later story adds a purpose by replacing this function and domain/deliveryRules.ts.
-- ---------------------------------------------------------------------------------------------
create function delivery_purpose_rule(p_module text, p_purpose text)
returns table (recipient_kinds text[], max_window interval)
language sql
immutable
set search_path = ''
as $$
  select r.recipient_kinds, r.max_window
  from (values
    ('alerting',      'approver_notice', array['staff'],         interval '30 minutes'),
    ('subscriptions', 'confirmation',    array['pending_signup'], interval '48 hours'),
    ('subscriptions', 'welcome',         array['subscriber'],    interval '24 hours'),
    ('subscriptions', 'menu_reply',      array['subscriber'],    interval '30 minutes'),
    ('subscriptions', 'prompt_reply',    array['subscriber'],    interval '30 minutes'),
    ('subscriptions', 'edit_link',       array['subscriber'],    interval '30 minutes'),
    ('subscriptions', 'signup_info',     array['inbound_reply'], interval '30 minutes'),
    ('checkins',      'escalation',      array['oncall'],        interval '60 minutes'),
    ('ops',           'oncall_alert',    array['oncall'],        interval '30 minutes')
  ) as r (module, purpose, recipient_kinds, max_window)
  where r.module = p_module and r.purpose = p_purpose
$$;
revoke all on function delivery_purpose_rule(text, text) from public, anon, authenticated, service_role;
grant execute on function delivery_purpose_rule(text, text) to cvh_app;

-- ---------------------------------------------------------------------------------------------
-- Whether a campaign was started by an Admin at aal2. No campaign exists until S09.07 creates the
-- `campaign` table, so nothing can have been started and the answer is false: every campaign row is
-- refused, and nothing the caller says (a setting, an id, an account) changes that. S09.07 replaces this
-- body with a read of the campaign row (started by an active Admin at aal2, not cancelled) and adds
-- delivery.campaign_id's foreign key NOT VALID; the trigger below keeps calling the function.
-- ---------------------------------------------------------------------------------------------
create function delivery_campaign_started_by_admin(p_campaign_id uuid) returns boolean
language sql
stable
set search_path = ''
as $$
  select false
$$;
revoke all on function delivery_campaign_started_by_admin(uuid) from public, anon, authenticated, service_role;
grant execute on function delivery_campaign_started_by_admin(uuid) to cvh_app;

-- ---------------------------------------------------------------------------------------------
-- A new row: one of the three kinds, created the way its kind allows (see the header).
-- ---------------------------------------------------------------------------------------------
create function delivery_insert_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  key_parts text[] := string_to_array(new.idempotency_key, ':');
  approving text := nullif(current_setting('cvh.approval_entry_id', true), '');
  entry_status text;
  entry_bodies jsonb;
  entry_approved_at timestamptz;
  frozen jsonb;
  rule record;
  key_part text;
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

  if new.kind = 'alert' then
    -- The key is entry:recipient:channel, so a recipient is texted once per entry and channel.
    if new.idempotency_key is distinct from new.entry_id::text || ':' || new.recipient_id::text || ':' || new.channel then
      raise exception 'delivery: an alert delivery''s key is entry_id:recipient:channel' using errcode = 'check_violation';
    end if;
    if approving is distinct from new.entry_id::text then
      raise exception 'delivery: an alert delivery is created only inside the approval transaction of its entry (cvh.approval_entry_id)'
        using errcode = 'check_violation';
    end if;
    select e.status, e.sms_bodies, e.approved_at into entry_status, entry_bodies, entry_approved_at from public.alert_entry e where e.id = new.entry_id;
    if entry_status is null or entry_status not in ('pending_approval', 'approved') then
      raise exception 'delivery: an alert delivery belongs to an entry that is being approved or is approved, not %', coalesce(entry_status, 'missing')
        using errcode = 'check_violation';
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
  else
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
    end if;
  end if;
  return new;
end
$$;
revoke all on function delivery_insert_guard() from public, anon, authenticated, service_role;
create trigger delivery_insert_guard before insert on delivery for each row execute function delivery_insert_guard();

-- ---------------------------------------------------------------------------------------------
-- A change to a row: only what the transition table and the story allow (see the header).
-- ---------------------------------------------------------------------------------------------
create function delivery_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  terminal text[] := array['delivered', 'undelivered', 'failed', 'cancelled', 'skipped', 'skipped_env'];
  allowed boolean;
begin
  -- The recipient was deleted: its link and the key lose the recipient, on a row in any state, and nothing else changes.
  if new.recipient_id is null and old.recipient_id is not null and new.idempotency_key = 'detached:' || old.id::text then
    if (to_jsonb(new) - 'recipient_id' - 'idempotency_key' - 'updated_at') is distinct from (to_jsonb(old) - 'recipient_id' - 'idempotency_key' - 'updated_at') then
      raise exception 'delivery: forgetting a recipient changes nothing else' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
    return new;
  end if;

  if new.id is distinct from old.id
     or new.kind is distinct from old.kind
     or new.recipient_kind is distinct from old.recipient_kind
     or new.recipient_id is distinct from old.recipient_id
     or new.entry_id is distinct from old.entry_id
     or new.campaign_id is distinct from old.campaign_id
     or new.created_by_module is distinct from old.created_by_module
     or new.purpose is distinct from old.purpose
     or new.channel is distinct from old.channel
     or new.lang is distinct from old.lang
     or new.body is distinct from old.body
     or new.segments is distinct from old.segments
     or new.cost_estimate_cents is distinct from old.cost_estimate_cents
     or new.idempotency_key is distinct from old.idempotency_key
     or new.callback_ref is distinct from old.callback_ref
     or new.send_by is distinct from old.send_by
     or new.created_at is distinct from old.created_at then
    raise exception 'delivery: what was frozen at creation (recipient, body, segments, cost, language, key, callback reference, send_by) never changes'
      using errcode = 'check_violation';
  end if;
  if old.state = any (terminal) then
    raise exception 'delivery: a % delivery never changes', old.state using errcode = 'check_violation';
  end if;
  if new.provider_message_id is distinct from old.provider_message_id and old.provider_message_id is not null then
    raise exception 'delivery: the provider id, once known, never changes' using errcode = 'check_violation';
  end if;
  if new.attempts < old.attempts then
    raise exception 'delivery: attempts only go up' using errcode = 'check_violation';
  end if;
  new.updated_at := now();

  if new.state is distinct from old.state then
    allowed := case old.state
      when 'queued' then new.state in ('claimed', 'cancelled', 'skipped')
      when 'claimed' then new.state in ('queued', 'cancelled', 'skipped', 'skipped_env', 'submitted', 'failed', 'unknown', 'delivered', 'undelivered')
      when 'submitted' then new.state in ('delivered', 'undelivered', 'failed', 'unknown')
      when 'unknown' then new.state in ('delivered', 'undelivered', 'failed', 'submitted')
      else false
    end;
    if not allowed then
      raise exception 'delivery: % to % is not an allowed transition', old.state, new.state using errcode = 'check_violation';
    end if;
    -- A text already handed to the provider cannot be cancelled or skipped: it is in flight.
    if new.state in ('cancelled', 'skipped') and old.handed_off_at is not null then
      raise exception 'delivery: a text already handed to the provider is not % (it is in flight)', new.state using errcode = 'check_violation';
    end if;
    -- No automatic second submission: a handed-off row goes back to the queue only when the provider did not accept
    -- the text (HTTP 429, or a connection that failed before it was sent), and that counts an attempt; at 3 attempts
    -- it can only fail. Any other outcome of a hand-off is `unknown`, and the lease expiry of a handed-off row is
    -- never a return to the queue.
    if new.state = 'queued' and old.state = 'claimed' and old.handed_off_at is not null and new.attempts <= old.attempts then
      raise exception 'delivery: a text already handed to the provider goes back to the queue only if it was not accepted, and that counts an attempt'
        using errcode = 'check_violation';
    end if;
    -- The provider answers, or calls back, only about a text it was handed.
    if old.state = 'claimed' and old.handed_off_at is null and new.state in ('submitted', 'unknown', 'delivered', 'undelivered') then
      raise exception 'delivery: a text not handed to the provider has no outcome (the hand-off is recorded first)' using errcode = 'check_violation';
    end if;
    if new.state = 'claimed' then
      -- The claim names its worker and lease (the table's check requires both); the claim time is the database's.
      new.claimed_at := now();
    elsif new.state = 'queued' then
      -- Back in the queue: no claim, no lease, no hand-off.
      new.claimed_at := null;
      new.claimed_by := null;
      new.claim_token := null;
      new.handed_off_at := null;
    elsif new.claimed_at is distinct from old.claimed_at or new.claimed_by is distinct from old.claimed_by or new.claim_token is distinct from old.claim_token then
      raise exception 'delivery: only a claim or a return to the queue changes the claim' using errcode = 'check_violation';
    end if;
    -- The hand-off is recorded on its own, while the row is claimed (below); a state change never makes it.
    if new.state <> 'queued' and new.handed_off_at is distinct from old.handed_off_at then
      raise exception 'delivery: the hand-off is recorded on its own, while the row is claimed' using errcode = 'check_violation';
    end if;
    if new.state = 'submitted' then
      new.submitted_at := coalesce(old.submitted_at, now());
    end if;
    if new.state = any (terminal) then
      new.completed_at := now();
    end if;
  else
    -- No transition: the claim and the times stay; the hand-off is recorded once, while claimed.
    if new.claimed_at is distinct from old.claimed_at or new.claimed_by is distinct from old.claimed_by or new.claim_token is distinct from old.claim_token then
      raise exception 'delivery: the claim changes only with the state' using errcode = 'check_violation';
    end if;
    if new.handed_off_at is distinct from old.handed_off_at then
      if old.state <> 'claimed' or old.handed_off_at is not null or new.handed_off_at is null then
        raise exception 'delivery: the hand-off is recorded once, while the row is claimed' using errcode = 'check_violation';
      end if;
      new.handed_off_at := now();
    end if;
    if new.due_at is distinct from old.due_at and old.state <> 'queued' then
      raise exception 'delivery: only a queued row is rescheduled' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end
$$;
revoke all on function delivery_guard() from public, anon, authenticated, service_role;
create trigger delivery_guard before update on delivery for each row execute function delivery_guard();

-- ---------------------------------------------------------------------------------------------
-- The recipient was deleted: each row that names it forgets it (see the header). Runs as the table's
-- owner, since the app may not change the recipient or the key of a row, and the trigger is on tables of
-- other modules; it changes nothing but those two columns. The argument is the recipient_kind.
-- ---------------------------------------------------------------------------------------------
create function delivery_forget_recipient() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_nargs <> 1 or tg_argv[0] not in ('subscriber', 'pending_signup', 'roster', 'staff', 'oncall', 'inbound_reply') then
    raise exception 'delivery_forget_recipient takes the recipient_kind as its one argument' using errcode = 'invalid_parameter_value';
  end if;
  update public.delivery
     set recipient_id = null, idempotency_key = 'detached:' || id::text
   where recipient_kind = tg_argv[0] and recipient_id = old.id;
  return old;
end
$$;
revoke all on function delivery_forget_recipient() from public, anon, authenticated, service_role;
