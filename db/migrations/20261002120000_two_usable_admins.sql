-- S01.06: there are always at least two usable Admins, owned by the identity
-- module (AD-4).
--
-- The identity module refuses every suspension, removal and demotion that
-- would leave fewer than two usable Admins, under a lock on the Admin rows
-- (src/modules/identity/application/staffChanges.ts). This trigger is the
-- second guard, in the database itself: an UPDATE that turns a usable Admin
-- into one that is not refuses when fewer than two would be left, whoever runs
-- it and whatever the app checked.
--
-- It sees only what the database holds: an Admin that is active and has
-- replaced its starting password. The enrolled authenticator lives in Supabase
-- Auth and the app checks it; the failed-sign-in lock arrives with S01.07,
-- which adds it here if it is stored on staff_account.
--
-- The one exception is recovery (S01.06): an Admin-issued password reset
-- (S01.08), an authenticator reset (S01.11) and the automatic locks (S01.07)
-- go ahead even when they leave fewer than two. Their transaction says so with
-- `set local cvh.admin_recovery = 'on'` (identity's permitAdminShortfall), which
-- ends with the transaction.
--
-- Two concurrent changes cannot both pass on a stale count: the trigger takes
-- a transaction-level advisory lock before counting, and in READ COMMITTED its
-- count then sees whatever the other transaction committed. In REPEATABLE READ and SERIALIZABLE
-- it would not, so a change that could break the rule is refused there outright.

create function staff_account_keep_two_usable_admins() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  usable_left integer;
begin
  -- Only a change that makes a usable Admin unusable can break the rule.
  if not (old.role = 'admin' and old.status = 'active' and not old.must_change_password) then
    return null;
  end if;
  if new.role = 'admin' and new.status = 'active' and not new.must_change_password then
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
   where role = 'admin' and status = 'active' and not must_change_password;
  if usable_left < 2 then
    raise exception 'There must always be at least two usable Admins'
      using errcode = 'check_violation', constraint = 'staff_account_two_usable_admins';
  end if;
  return null;
end
$$;
revoke all on function staff_account_keep_two_usable_admins() from public, anon, authenticated, service_role;

create trigger staff_account_keep_two_usable_admins
  after update of role, status, must_change_password on staff_account
  for each row execute function staff_account_keep_two_usable_admins();
