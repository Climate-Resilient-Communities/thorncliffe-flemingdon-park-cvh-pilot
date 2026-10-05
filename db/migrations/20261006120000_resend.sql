-- S09.02: an Admin resends texts that failed (AR-21 resend, AR-12, FR-G6), owned by the messaging module (AD-2).
--
-- A resend is a deliberate Admin action that creates a NEW `delivery` row copying an earlier one in the same chain; no row of the chain ever changes
-- (a terminal state never does, and an `unknown` row is only ever resolved by a late callback). The new row keeps the original's kind, entry, recipient,
-- language, body, segments and cost, and records
--   `resend_of`  the chain's first delivery, the root (always the root, whichever row of the chain is resent), and
--   `resend_n`   1 or 2: which resend of the chain it is, with the idempotency key `resend:{root id}:{n}` (S09.04's weekly review reads that key).
-- A chain has at most 2 resends in total (`resend_n in (1, 2)` and the unique `(resend_of, resend_n)`).
--
-- What the database refuses, whoever asks (the app's code, a script, the owner), in `delivery_insert_guard()` (S06.01, S06.02, S06.05, with the resend rule):
--  - a resend that is not an `alert` text, whose `resend_of` is not a chain's root, whose key is not `resend:{root}:{n}`, or whose `resend_n` is not the
--    chain's next number. The guard locks the root `FOR UPDATE` first (AD-18: the delivery row), so two resends of one chain are judged one after the other;
--  - a resend of a chain whose latest text is not `failed`, `undelivered` or `unknown` (a text that arrived, that was cancelled or skipped, or that is still
--    on its way is never resent), or whose recipient is gone (the root's `recipient_id` is null once the subscriber was deleted or opted out);
--  - a resend that differs from the root in anything frozen (kind, recipient, entry, language, body, segments, cost);
--  - a resend of an entry that is not approved, and the drill rule of S06.05 (a drill only to a member of the drill roster, a real alert never to one).
--  A resend is not made inside the approval transaction, so it needs neither the `cvh.approval_entry_id` marker nor an entry approved by this transaction;
--  whether the entry is still sendable (not superseded, thread open, valid-until) is judged where every text is, at the hand-off point, and the use case
--  tells the Admin earlier.
-- `delivery_guard()` gains the two columns among those that never change.
--
-- Expand-only on an existing table: two nullable columns and constraints on those columns only (NOT VALID where they are checks or foreign keys, which every
-- existing row satisfies anyway). The app's insert and select grants already cover the new columns; it still has no update on them.

alter table delivery
  add column resend_of uuid,
  add column resend_n smallint;

alter table delivery add constraint delivery_resend_shape check (
  (resend_of is null and resend_n is null) or (resend_of is not null and resend_n in (1, 2))
) not valid;
alter table delivery add constraint delivery_resend_of_fkey foreign key (resend_of) references delivery (id) not valid;
-- A unique index, not a unique constraint: Postgres cannot add a unique constraint NOT VALID, and the index on columns the migration just added binds nothing of the old rows.
create unique index delivery_resend_unique on delivery (resend_of, resend_n) where resend_of is not null;

-- ---------------------------------------------------------------------------------------------
-- The insert guard of S06.05, with the resend rule (see the header).
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
    end if;
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- The update guard of S06.01, with the two columns among those that never change.
-- ---------------------------------------------------------------------------------------------
create or replace function delivery_guard() returns trigger
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
     or new.resend_of is distinct from old.resend_of
     or new.resend_n is distinct from old.resend_n
     or new.created_at is distinct from old.created_at then
    raise exception 'delivery: what was frozen at creation (recipient, body, segments, cost, language, key, callback reference, send_by, resend) never changes'
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
