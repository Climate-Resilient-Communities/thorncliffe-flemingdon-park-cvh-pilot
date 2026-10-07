-- Privacy follow-up of S08.08 and S09.08 (AD-13, AD-8): an escalation's text keeps the building and floor only as long as the check-in data does.
--
-- S08.08's text to the on-call Admins (`transactional`, module `checkins`, purpose `escalation`, recipient kind `oncall`) says "CVH: Needs help:
-- {building}, floor {floor}. Open: {link}" (or "Not reached"), and the row keeps when it was made. It is addressed to an on-call number, not to the
-- resident, so 20261007040000's deletion of a resident never reaches it: it would keep the place and the time of a resident's call for help for good.
-- The check-in rows themselves hold the resident only until the `checkins-purge-stubs` job turns them into stubs, 23 hours 45 minutes after the close
-- (S08.08's rule, so within 24 hours, as the terms say).
--
-- The rule: the same job, in the same run (one transaction), first replaces with the placeholder '[deleted]' the body of every escalation text made 23
-- hours 45 minutes ago or more that is no longer waiting to be sent (not `queued` or `claimed`), whether or not the resident was deleted since. A text
-- is made in the mark's transaction, before or after the thread's close, so it never keeps the place longer than the row's own stub cutoff (23 hours 45
-- minutes after the close) would; a late mark's text, made after the close, keeps it 23 hours 45 minutes too. With a run every 15 minutes, no
-- escalation text keeps its building and floor past 24 hours. It is the job's first statement, so its delivery rows are taken before any `checkin` row
-- (AD-18's order), and SKIP LOCKED: a row a status callback holds is cleared by the next run.
--
-- What stays, as for a deleted resident's text (20261007040000's header): the provider's id (the table's check requires it on every text Twilio
-- accepted; S06.08's reconciliation retires each estimate by it), the segments, the cost estimate, the language, the purpose, the state and the times,
-- so spend and the measures, which never read a body, are unchanged. The on-call roster entry's link and the key stay too (the roster is staff, not
-- residents). The `checkin_escalation` row (building, floor, status, the Admin's note) is the Hub's record and is not changed here.
--
-- The health job's on-call texts (purpose `oncall_alert`) name a condition and a count, never a resident: they are left as they are.
--
-- `delivery_guard()` allows exactly that: the body of an escalation text, sent and 23 hours 45 minutes old or more, becomes the placeholder, once,
-- with nothing else changed, and only for the table's owner (the job runs as the owner; the app has no grant on the body anyway). Any other body
-- change is refused as before. The backfill below clears the texts already past the cutoff.
--
-- Expand-only: a replaced function with the same signature, owner and grants, the job rescheduled by name with one more statement, and an update of
-- rows that the release in production never reads back (the dispatcher reads a body only while a text is queued or claimed).

-- ---------------------------------------------------------------------------------------------
-- The update guard of 20261007040000, with an escalation text's body cleared by the purge job (see the header).
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
  -- A resident's text forgotten before its body was (before 20261007040000): its body is replaced by the placeholder, and nothing else changes.
  if old.recipient_id is null and old.idempotency_key = 'detached:' || old.id::text and personal and new.body = '[deleted]' and old.body <> '[deleted]' then
    if (to_jsonb(new) - 'updated_at' - 'body') is distinct from (to_jsonb(old) - 'updated_at' - 'body') then
      raise exception 'delivery: forgetting a recipient changes nothing else' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
    return new;
  end if;
  -- An escalation's text to the on-call Admins (S08.08: status, building, floor, staff link), sent 23 hours 45 minutes ago or more: the check-in purge
  -- job, as the table's owner, replaces its body by the placeholder, once, and nothing else changes (see the header). Never a text still waiting to be
  -- sent or being sent.
  if new.body is distinct from old.body and new.body = '[deleted]' and old.body <> '[deleted]'
     and old.kind = 'transactional' and old.created_by_module = 'checkins' and old.purpose = 'escalation' and old.recipient_kind = 'oncall' then
    if (to_jsonb(new) - 'updated_at' - 'body') is distinct from (to_jsonb(old) - 'updated_at' - 'body') then
      raise exception 'delivery: clearing an escalation text changes nothing else' using errcode = 'check_violation';
    end if;
    if old.state in ('queued', 'claimed') or old.created_at > now() - interval '23 hours 45 minutes' then
      raise exception 'delivery: an escalation text is cleared only once sent and 23 hours 45 minutes old' using errcode = 'check_violation';
    end if;
    if session_user <> (select pg_catalog.pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid = 'public.delivery'::regclass)
       and not exists (select 1 from pg_catalog.pg_roles r where r.rolname = session_user and r.rolsuper) then
      raise exception 'delivery: only the check-in purge job clears an escalation text' using errcode = 'check_violation';
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

-- ---------------------------------------------------------------- the purge: escalation texts, rows left live in closed threads, kept rows, stubs
-- Scheduling by name replaces S08.08's job (20261006210000_escalations.sql). Its statements run in one transaction, in this order:
--  0. An escalation text made 23 hours 45 minutes ago or more, no longer queued or claimed, loses its body to the placeholder (this migration). A row
--     someone holds is left for the next run.
--  1. to 3. As S08.08 wrote them: rows still live in closed threads are tallied; a kept row becomes a stub 23 hours 45 minutes after the close; every
--     stub is deleted 2 hours after it was made.
select cron.schedule(
  'checkins-purge-stubs',
  '*/15 * * * *',
  $job$
    update public.delivery set body = '[deleted]'
     where id in (
       select id from public.delivery
        where kind = 'transactional' and created_by_module = 'checkins' and purpose = 'escalation' and recipient_kind = 'oncall'
          and state not in ('queued', 'claimed') and body <> '[deleted]' and created_at <= now() - interval '23 hours 45 minutes'
        order by id
          for update skip locked
     );
    with ended as (
      select c.id, coalesce(a.closed_at, now()) as closed_at,
             c.status in ('not_reached', 'needs_help')
               and exists (select 1 from public.checkin_escalation e where e.round_ref = c.round_ref and e.handled_at is null) as kept
        from public.checkin c join public.alert a on a.id = c.alert_id
       where a.status = 'closed' and c.closed_at is null and c.tallied_at is null
       order by c.id
         for update of c skip locked
    )
    update public.checkin c
       set outcome = case when c.status = 'pending' then 'unmarked' else c.status end,
           tallied_at = ended.closed_at,
           subscriber_id = case when ended.kept then c.subscriber_id end,
           method = case when ended.kept then c.method end,
           closed_at = case when ended.kept then null else now() end
      from ended
     where c.id = ended.id;
    update public.checkin set subscriber_id = null, method = null, closed_at = now()
     where id in (
       select id from public.checkin where closed_at is null and tallied_at <= now() - interval '23 hours 45 minutes' order by id for update skip locked
     );
    delete from public.checkin where closed_at <= now() - interval '2 hours';
  $job$
);

-- The escalation texts already past the cutoff when this applies (as the table's owner, so the guard lets it through).
update delivery
   set body = '[deleted]'
 where kind = 'transactional'
   and created_by_module = 'checkins'
   and purpose = 'escalation'
   and recipient_kind = 'oncall'
   and state not in ('queued', 'claimed')
   and body <> '[deleted]'
   and created_at <= now() - interval '23 hours 45 minutes';
