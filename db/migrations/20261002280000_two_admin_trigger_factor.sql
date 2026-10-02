-- Follow-up to S01.10 (20261002160000_authenticator.sql): the two-Admin trigger now also fires
-- when factor_enrolled_at changes. The function already counts an enrolled authenticator as part
-- of a usable Admin (same facts as isUsableAdmin in src/modules/identity/domain/usableAdmin.ts),
-- but the trigger's column list did not include factor_enrolled_at, so an UPDATE that only cleared
-- an Admin's enrolment skipped the check. The recovery flag (cvh.admin_recovery) still lets an
-- authenticator reset through; the function is unchanged.
--
-- The trigger is replaced, a change to a trigger on an existing table, so this names the S01.10
-- release that is already in production and no longer relies on the old column list.
-- contract: cdb5a328d0d1098744bd799f4177666fcf5ea62e
drop trigger staff_account_keep_two_usable_admins on staff_account;

create trigger staff_account_keep_two_usable_admins
  after update of role, status, must_change_password, factor_enrolled_at on staff_account
  for each row execute function staff_account_keep_two_usable_admins();
