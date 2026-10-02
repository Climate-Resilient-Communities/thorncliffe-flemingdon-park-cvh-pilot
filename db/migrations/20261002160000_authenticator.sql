-- S01.10: Admins and Coordinators confirm sign-in with an authenticator code, owned by the identity
-- module (AD-2, AD-4). The authenticator itself (a TOTP factor) lives in Supabase Auth; this adds
-- the app's own record of it and of the sessions that reached `aal2` through the app.
--
-- staff_account.factor_enrolled_at: when the person enrolled an authenticator through the app.
-- Set when their first code is accepted; cleared by an authenticator reset (S01.11) and when the
-- account is given the Admin or Coordinator role from a role without one. The app counts an
-- authenticator only when this is set AND Supabase Auth holds a verified factor, so a factor added
-- at Supabase directly (with a password-only session and the public key) never counts.
--
-- staff_session.aal2_at: when this session reached `aal2` through the app's code check. A request
-- is `aal2` only when Supabase Auth's verified token says so AND its staff_session row has this
-- set, so a session upgraded at Supabase directly, outside the app's throttle and audit, stays at
-- `aal1`. A session never goes back down: it ends instead (revocation, limits).
--
-- Both columns are new and nullable: the release that is serving while this runs never writes
-- them, and every existing row reads as "no authenticator" and "not aal2", which no Admin or
-- Coordinator could have had before this release (gate 2 held them).

alter table staff_account add column factor_enrolled_at timestamptz;
alter table staff_session add column aal2_at timestamptz;

-- The two-Admin rule's database guard (S01.06, 20261002120000_two_usable_admins.sql) now sees the
-- authenticator too: a usable Admin is active, has replaced its starting password AND has
-- factor_enrolled_at set, the same facts the app checks (isUsableAdmin) apart from the provider's
-- factor and the failed-sign-in lock, which the database cannot see.
--
-- Only the function's body changes: the trigger keeps its name, timing and columns (after update
-- of role, status, must_change_password), so the release still serving while this runs meets the
-- same trigger, and with no factor_enrolled_at set anywhere yet it can only refuse less than before.
-- A write that clears factor_enrolled_at alone does not fire the trigger: the app clears it only in
-- an authenticator reset (a recovery action, which the rule allows) and when promoting someone who
-- is not an Admin. Adding the column to the trigger's list is a change to a trigger on an existing
-- table, for a later migration with a contract note once this release is in production.
create or replace function staff_account_keep_two_usable_admins() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  usable_left integer;
begin
  -- Only a change that makes a usable Admin unusable can break the rule.
  if not (old.role = 'admin' and old.status = 'active' and not old.must_change_password and old.factor_enrolled_at is not null) then
    return null;
  end if;
  if new.role = 'admin' and new.status = 'active' and not new.must_change_password and new.factor_enrolled_at is not null then
    return null;
  end if;
  if coalesce(current_setting('cvh.admin_recovery', true), '') = 'on' then
    return null;
  end if;

  -- The count below is only right if it sees what other transactions committed, which a snapshot
  -- taken earlier (REPEATABLE READ, SERIALIZABLE) does not: two such transactions could each
  -- demote a different Admin and both pass. The guard refuses to run there at all.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'two-Admin guard requires READ COMMITTED'
      using errcode = 'check_violation', constraint = 'staff_account_two_usable_admins_isolation';
  end if;

  -- Serialises the counts of concurrent changes (key: identity's admin floor).
  perform pg_advisory_xact_lock(7315420053);
  select count(*) into usable_left
    from public.staff_account
   where role = 'admin' and status = 'active' and not must_change_password and factor_enrolled_at is not null;
  if usable_left < 2 then
    raise exception 'There must always be at least two usable Admins'
      using errcode = 'check_violation', constraint = 'staff_account_two_usable_admins';
  end if;
  return null;
end
$$;
revoke all on function staff_account_keep_two_usable_admins() from public, anon, authenticated, service_role;
