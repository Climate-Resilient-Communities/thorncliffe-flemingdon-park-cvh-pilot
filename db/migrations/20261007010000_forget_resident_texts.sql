-- Review fixes (S09.08, AD-13, AD-8): a deleted resident's texts keep no words written to them alone, and a campaign YES's reply has its own purpose.
--
-- 1. What a deleted resident leaves in the outbox. Until now `delivery_forget_recipient()` cleared only the row's link (`recipient_id`) and its key,
--    so a deleted subscriber's past texts kept their bodies: "Saved. Your building is now {building}, floor {floor}.", the menu pages of the streets,
--    buildings and floors they chose, their edit link with its token, the language they picked. Now, when a resident is deleted (a `subscriber` or a
--    `pending_signup`), the same update also replaces the body of every `transactional` text of theirs with the fixed placeholder '[deleted]'. The rule
--    is by kind, the outbox's own split by purpose:
--      - `transactional` (confirmation, welcome, menu_reply, prompt_reply, edit_link, and any purpose a later story adds for a resident): written to
--        that one resident, so it is theirs and goes with them. A new purpose is covered without touching this function;
--      - `alert`: the entry's frozen SMS body for the language, byte for byte the same for every recipient (delivery_insert_guard() refuses anything
--        else) and published on the public feed: public alert text, kept, so the alert's accounting and history stay whole;
--      - `campaign`: the campaign's frozen text for the language, the same for every subscriber asked (the insert guard again): kept.
--    `inbound_reply` rows are not touched: their texts (`signup_info`: the sign-up link, "sign-ups are paused", "the pilot has ended") are the same
--    for everyone in a language, and the row is deleted at the hand-off, before the text is sent. The drill roster, the on-call roster and staff are
--    not residents.
--    The segments, the cost estimate, the language, the purpose, the state and the times stay: spend (S07.08, the estimate per delivery in
--    `spend_event`, which never held a body) and the measures (S07.10, S06.08's delivery measures, `correction_reach`, which count rows by kind,
--    purpose, entry and state) read nothing else. The body column is NOT NULL with `delivery_body_valid` (not blank, at most 1,600 characters); the
--    placeholder satisfies both.
--
--    `provider_message_id` is kept, on purpose:
--      - the table's `delivery_in_flight_has_provider_id` requires it on every submitted, delivered or undelivered row (every text Twilio accepted),
--        and the status callback matches a late callback with it;
--      - S06.08's price reconciliation retires each text's estimate with the actual Twilio prices by this id (`retireSmsEstimates`); without it the
--        month would show the text twice, as an unmatched actual and an unresolved estimate. Once retired, spend keeps the same pair by design
--        (`sms_estimate_retirement.message_sid` with the estimate's `delivery_id`), so nulling it here would remove nothing.
--    The id says nothing of the person by itself: it leads to them only through Twilio's own message log, which keeps the number and the body until
--    it is deleted there. That is a step of docs/procedures/end-of-pilot.md (IT deletes the pilot's messages from Twilio, outbound and inbound,
--    after the purge has completed and the last month is reconciled), and the terms page says what Twilio keeps until then.
--
--    `delivery_guard()` allows exactly that: forgetting a recipient changes the link, the key and, for a resident's transactional text, the body to
--    the placeholder; nothing else. A text forgotten before this migration (link and key already gone) may have its body replaced the same way, once;
--    the backfill below does it for every one.
--
-- 2. `reconsent_kept` (S09.07): the reply to a campaign YES, until now a `prompt_reply`. A busy reply day after the campaign is expected, not abuse,
--    so the health job's `transactional_ceiling` count (S09.01) leaves this purpose out; giving it its own purpose is what lets it. The allow-list
--    gains it (subscriptions, to a subscriber, 30 minutes), as messaging's domain/deliveryRules.ts does.
--
-- Expand-only: three replaced functions with the same signatures, owners and grants, and an update of rows that only the new code reads. The release
-- in production when this applies never writes a body after creation and never queues `reconsent_kept`; its deletions now also scrub the bodies,
-- which it never reads back.

-- ---------------------------------------------------------------------------------------------
-- The allow-list of transactional purposes, with `reconsent_kept`.
-- ---------------------------------------------------------------------------------------------
create or replace function delivery_purpose_rule(p_module text, p_purpose text)
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
    ('subscriptions', 'reconsent_kept',  array['subscriber'],    interval '30 minutes'),
    ('checkins',      'escalation',      array['oncall'],        interval '60 minutes'),
    ('ops',           'oncall_alert',    array['oncall'],        interval '30 minutes')
  ) as r (module, purpose, recipient_kinds, max_window)
  where r.module = p_module and r.purpose = p_purpose
$$;
revoke all on function delivery_purpose_rule(text, text) from public, anon, authenticated, service_role;
grant execute on function delivery_purpose_rule(text, text) to cvh_app;

-- ---------------------------------------------------------------------------------------------
-- The update guard of S09.02, with the resident's body forgotten too (see the header).
-- ---------------------------------------------------------------------------------------------
create or replace function delivery_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  terminal text[] := array['delivered', 'undelivered', 'failed', 'cancelled', 'skipped', 'skipped_env'];
  allowed boolean;
  -- A resident's own text: what forgetting them may replace with the placeholder.
  personal boolean := old.kind = 'transactional' and old.recipient_kind in ('subscriber', 'pending_signup');
begin
  -- The recipient was deleted: its link and the key lose the recipient, on a row in any state, a resident's own text loses its body, and nothing else
  -- changes.
  if new.recipient_id is null and old.recipient_id is not null and new.idempotency_key = 'detached:' || old.id::text then
    if (to_jsonb(new) - 'recipient_id' - 'idempotency_key' - 'updated_at' - 'body') is distinct from (to_jsonb(old) - 'recipient_id' - 'idempotency_key' - 'updated_at' - 'body')
       or (new.body is distinct from old.body and not (personal and new.body = '[deleted]')) then
      raise exception 'delivery: forgetting a recipient changes nothing else' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
    return new;
  end if;
  -- A resident's text forgotten before its body was (before 20261007010000): its body is replaced by the placeholder, and nothing else changes.
  if old.recipient_id is null and old.idempotency_key = 'detached:' || old.id::text and personal and new.body = '[deleted]' and old.body <> '[deleted]' then
    if (to_jsonb(new) - 'updated_at' - 'body') is distinct from (to_jsonb(old) - 'updated_at' - 'body') then
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
revoke all on function delivery_guard() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- The recipient was deleted: each row that names it forgets it, and a resident's own text forgets what it said (see the header). Runs as the
-- table's owner, since the app may not change the recipient, the key or the body of a row, and the trigger is on tables of other modules. The
-- argument is the recipient_kind.
-- ---------------------------------------------------------------------------------------------
create or replace function delivery_forget_recipient() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_nargs <> 1 or tg_argv[0] not in ('subscriber', 'pending_signup', 'roster', 'staff', 'oncall', 'inbound_reply') then
    raise exception 'delivery_forget_recipient takes the recipient_kind as its one argument' using errcode = 'invalid_parameter_value';
  end if;
  update public.delivery
     set recipient_id = null,
         idempotency_key = 'detached:' || id::text,
         body = case when kind = 'transactional' and recipient_kind in ('subscriber', 'pending_signup') then '[deleted]' else body end
   where recipient_kind = tg_argv[0] and recipient_id = old.id;
  return old;
end
$$;
revoke all on function delivery_forget_recipient() from public, anon, authenticated, service_role;

-- The residents deleted before this migration: their own texts forget what they said too.
update delivery
   set body = '[deleted]'
 where kind = 'transactional'
   and recipient_kind in ('subscriber', 'pending_signup')
   and recipient_id is null
   and idempotency_key = 'detached:' || id::text
   and body <> '[deleted]';
