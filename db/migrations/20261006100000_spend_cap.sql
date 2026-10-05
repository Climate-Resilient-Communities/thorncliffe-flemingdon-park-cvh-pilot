-- S07.08: the monthly cap on text message spending (AR-12, FR-G6, NFR-N9), owned by the spend module (AD-2).
--
-- `spend_cap` is one row (`id` is fixed at 1; the migration makes it and the app can neither insert nor delete it). `monthly_cents` is the cap in
-- whole cents CAD, null while no Admin has set one. An Admin at aal2 sets or changes it (the policy action `spend.cap`); who set it and when are
-- stored with it, and the change is audited in the same transaction (spend/application/spendCap.ts). The cap WARNS and never blocks: an approval
-- whose estimate takes the month's spending past the cap is approved, audited as `spend.cap_overrun` and recorded as the ops event of the same
-- name (S09.01's health job texts the on-call Admins). The approval reads the row `FOR UPDATE`, last in the lock order of AD-18 (alert, alert_entry,
-- feed_version, delivery, recipient row, checkin, checkin_tally, spend_cap), so two approvals that overlap are judged one after the other.
--
-- The app's grant is select and update of the three columns, with policies "to cvh_app". A new table, so nothing here is destructive.
-- Supabase's default privileges grant every new table to anon, authenticated and service_role, so each is taken back.

create table spend_cap (
  id smallint primary key,
  monthly_cents integer,
  set_by uuid references staff_account (id),
  set_at timestamptz,
  constraint spend_cap_single_row check (id = 1),
  constraint spend_cap_amount_valid check (monthly_cents is null or (monthly_cents >= 1 and monthly_cents <= 10000000)),
  constraint spend_cap_stated check ((monthly_cents is null) = (set_by is null) and (monthly_cents is null) = (set_at is null))
);
create index spend_cap_set_by_idx on spend_cap (set_by);

alter table spend_cap enable row level security;
revoke all on table spend_cap from public, anon, authenticated, service_role;
grant select on table spend_cap to cvh_app;
grant update (monthly_cents, set_by, set_at) on table spend_cap to cvh_app;
create policy spend_cap_app_select on spend_cap for select to cvh_app using (true);
create policy spend_cap_app_update on spend_cap for update to cvh_app using (true) with check (true);

insert into spend_cap (id) values (1);
