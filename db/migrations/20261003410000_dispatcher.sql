-- S06.02: the sender (AD-8, AD-18), owned by the messaging module (AD-2). This migration adds what the dispatcher needs and
-- nothing that sends: the sender lease, the pause switch it reads, and the claim order of the outbox.
--
--  - `dispatcher_lease`: the one row that decides which dispatcher sends. A run takes it with a conditional update that
--    succeeds only when the previous lease has expired (`expires_at <= now()`), which writes a new random ownership token and
--    an expiry 60 seconds ahead; every renewal and every claim and hand-off compares `token = mine and expires_at > now()`.
--    `paced_until` carries the shared send pace from one holder to the next (the instant before which the next holder may
--    not submit, so two consecutive runs never exceed the pace between them). The row exists from the start and is never
--    inserted or deleted by the app; the dispatcher only updates the five columns it owns.
--  - `messaging_control`: the one row that holds the pause (S06.06 sets it, audited, and adds its own grants). The
--    dispatcher only reads it, before each claim and at the hand-off. A missing row would read as paused (fail closed).
--  - `delivery.claim_rank` (0 to 5) and `delivery_claim_rank()`: the claim order of the E06 definitions as one number, fixed
--    when the row is created from what the entry's own frozen content says: 0 fire and evacuation alert entries, 1 on-call
--    texts, 2 other transactional texts, 3 building-level alerts, 4 neighbourhood-level alerts, 5 campaign texts; then
--    oldest first. The dispatcher claims `order by claim_rank, created_at, id`, so it never reads alerting's tables, and
--    messaging/domain/dispatchRules.ts#claimRank is the same function (a test compares them for every case).
--    The insert trigger below is S06.01's, replaced whole: the only change is that it sets `claim_rank`. A trigger cannot be
--    added to an existing table without a release note (db:check-destructive), so the function's body is replaced instead.
--
-- Who writes what: the app (cvh_app) reads both tables and changes only the lease row's five columns. Supabase's default
-- privileges grant every new table to anon, authenticated and service_role, so each is taken back.

create table dispatcher_lease (
  id smallint primary key default 1,
  token uuid not null,
  holder text not null,
  expires_at timestamptz not null,
  renewed_at timestamptz not null,
  paced_until timestamptz not null,
  constraint dispatcher_lease_single_row check (id = 1),
  constraint dispatcher_lease_holder_format check (holder ~ '^[A-Za-z0-9._:-]{1,64}$')
);
-- Expired from the start, so the first run takes it.
insert into dispatcher_lease (id, token, holder, expires_at, renewed_at, paced_until)
values (1, gen_random_uuid(), 'none', to_timestamp(0), to_timestamp(0), to_timestamp(0));
alter table dispatcher_lease enable row level security;

revoke all on table dispatcher_lease from public, anon, authenticated, service_role;
grant select on table dispatcher_lease to cvh_app;
grant update (token, holder, expires_at, renewed_at, paced_until) on table dispatcher_lease to cvh_app;
create policy dispatcher_lease_app_select on dispatcher_lease for select to cvh_app using (true);
create policy dispatcher_lease_app_update on dispatcher_lease for update to cvh_app using (true) with check (true);

create table messaging_control (
  id smallint primary key default 1,
  paused boolean not null default false,
  paused_by uuid references staff_account (id),
  paused_at timestamptz,
  reason text,
  updated_at timestamptz not null default now(),
  constraint messaging_control_single_row check (id = 1),
  constraint messaging_control_reason_length check (reason is null or (btrim(reason) <> '' and char_length(reason) <= 500)),
  -- A pause says who paused, when and why (every Hub screen shows it, S06.06).
  constraint messaging_control_pause_stated check (not paused or (paused_by is not null and paused_at is not null and reason is not null))
);
insert into messaging_control (id) values (1);
create index messaging_control_paused_by_idx on messaging_control (paused_by);
alter table messaging_control enable row level security;

revoke all on table messaging_control from public, anon, authenticated, service_role;
-- Read only here: S06.06 adds the update grant with the audited pause and resume use cases.
grant select on table messaging_control to cvh_app;
create policy messaging_control_app_select on messaging_control for select to cvh_app using (true);

-- ---------------------------------------------------------------------------------------------
-- The claim order (E06 "Claim order"): fire and evacuation alert entries first, then on-call and other transactional
-- texts, then building-level before neighbourhood-level alerts, then oldest first (the dispatcher adds created_at, id).
-- A campaign text, which the definitions do not rank, goes last.
-- ---------------------------------------------------------------------------------------------
create function delivery_claim_rank(p_kind text, p_recipient_kind text, p_types text[], p_scope text) returns smallint
language sql
immutable
set search_path = ''
as $$
  select (case
    when p_kind = 'alert' and coalesce(p_types && array['fire', 'evacuation'], false) then 0
    when p_kind = 'transactional' and p_recipient_kind = 'oncall' then 1
    when p_kind = 'transactional' then 2
    when p_kind = 'alert' and p_scope = 'buildings' then 3
    when p_kind = 'alert' then 4
    else 5
  end)::smallint
$$;
revoke all on function delivery_claim_rank(text, text, text[], text) from public, anon, authenticated, service_role;
grant execute on function delivery_claim_rank(text, text, text[], text) to cvh_app;

alter table delivery add column claim_rank smallint not null default 5;
alter table delivery add constraint delivery_claim_rank_valid check (claim_rank between 0 and 5) not valid;
-- The dispatcher's claim: the queued rows in claim order.
create index delivery_claim_idx on delivery (claim_rank, created_at, id) where state = 'queued';

-- ---------------------------------------------------------------------------------------------
-- S06.01's insert guard, with one addition: the row's claim_rank (see the header).
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
    select e.status, e.sms_bodies, e.approved_at, e.types, e.audience ->> 'scope'
      into entry_status, entry_bodies, entry_approved_at, entry_types, entry_scope
      from public.alert_entry e where e.id = new.entry_id;
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
