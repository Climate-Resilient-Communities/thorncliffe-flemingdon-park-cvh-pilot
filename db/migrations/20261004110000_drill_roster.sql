-- S06.05: drills reach only the drill roster (AD-6, AR-10, FR-A17), and the drill view's counts.
--
--  - `drill_roster`: the staff phones a drill is texted on (owned by subscriptions, AD-2). A row is a label (what the Hub calls the phone:
--    a first name or a role, at most 40 characters), a Canadian +1 number in E.164 and the language the drill text is read in. The number is
--    personal data (AD-13), protected as the on-call roster's is (S06.07): it is read only by the sender's ContactResolver (at the hand-off
--    point) and by the roster screen, which shows it masked to its last four digits; it is never written to a log, an audit record or a
--    `delivery` row (AR-12, AR-17: a delivery names this row's id, never the number), and it is never in the repository or CI (it is entered
--    by an Admin at aal2 in the running system). The database is encrypted at rest by the platform, the app's role is the only one that can
--    read the table (RLS, grants to cvh_app only). The app may add, change (label, number, language) and delete a row.
--    `delivery_forget_recipient` (S06.01) is this table's `ON DELETE SET NULL`: the trigger belongs here, in the migration that creates the table.
--  - `delivery_insert_guard()` (S06.01, S06.02) gains the drill rule, for whoever asks (the app's code, a script, the owner): an `alert` delivery
--    of a drill entry is created only for a `roster` recipient that is a row of `drill_roster`, and an `alert` delivery of an entry that is not a
--    drill is never created for a `roster` recipient. Only the function's body is replaced; the trigger and its grants are untouched.
--  - `drill_delivery_result`: for each drill thread, entry, roster member and language, how many texts are waiting, were handed to the provider,
--    were delivered, undelivered, failed, `unknown` or never sent. It reads drill threads only (`alert.is_drill`), so a drill's counts are kept
--    apart from every count of a real alert (FR-M4): nothing that counts real alerts reads this view and this view holds no real alert.
--
-- Supabase's default privileges grant every new table and view to anon, authenticated and service_role, so each is taken back.

create table drill_roster (
  id uuid primary key,
  label text not null,
  phone text not null,
  lang text not null,
  added_by uuid not null references staff_account (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint drill_roster_label_format check (btrim(label) <> '' and char_length(label) <= 40 and label !~ '[[:cntrl:]]'),
  constraint drill_roster_phone_format check (phone ~ '^\+1[2-9][0-9]{9}$'),
  constraint drill_roster_lang_valid check (lang in ('en', 'ur', 'ps', 'tl', 'prs', 'gu', 'ta', 'el', 'sk', 'bn', 'hi', 'pa', 'zh', 'es', 'fr', 'zh-Hant'))
);
create unique index drill_roster_phone_idx on drill_roster (phone);
create index drill_roster_added_by_idx on drill_roster (added_by);
alter table drill_roster enable row level security;
revoke all on table drill_roster from public, anon, authenticated, service_role;
grant select, insert, delete on table drill_roster to cvh_app;
-- A change names only what an Admin edits; the roster's `FOR SHARE` lock at an approval (captureRecipients) needs the update privilege and policy too.
grant update (label, phone, lang, updated_at) on table drill_roster to cvh_app;
create policy drill_roster_app_select on drill_roster for select to cvh_app using (true);
create policy drill_roster_app_insert on drill_roster for insert to cvh_app with check (true);
create policy drill_roster_app_update on drill_roster for update to cvh_app using (true) with check (true);
create policy drill_roster_app_delete on drill_roster for delete to cvh_app using (true);

create trigger drill_roster_forget_deliveries after delete on drill_roster
  for each row execute function delivery_forget_recipient('roster');

-- ---------------------------------------------------------------------------------------------
-- S06.01's and S06.02's insert guard, with the drill rule (see the header).
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

create view drill_delivery_result with (security_invoker = true) as
  select
    e.alert_id,
    d.entry_id,
    d.recipient_id,
    d.lang,
    (count(*) filter (where d.state in ('queued', 'claimed') and d.handed_off_at is null))::int as waiting,
    (count(*) filter (where d.handed_off_at is not null and d.state not in ('cancelled', 'skipped', 'skipped_env')))::int as handed_off,
    (count(*) filter (where d.state = 'delivered'))::int as delivered,
    (count(*) filter (where d.state = 'undelivered'))::int as undelivered,
    (count(*) filter (where d.state = 'failed'))::int as failed,
    (count(*) filter (where d.state = 'unknown'))::int as unknown,
    (count(*) filter (where d.state in ('cancelled', 'skipped', 'skipped_env')))::int as not_sent
  from delivery d
  join alert_entry e on e.id = d.entry_id
  join alert a on a.id = e.alert_id
  where a.is_drill and d.kind = 'alert'
  group by e.alert_id, d.entry_id, d.recipient_id, d.lang;
revoke all on table drill_delivery_result from public, anon, authenticated, service_role;
grant select on table drill_delivery_result to cvh_app;
