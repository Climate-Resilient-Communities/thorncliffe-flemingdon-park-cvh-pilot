-- S01.08: staff sessions end on time and when access changes, owned by the identity module
-- (AD-2, AD-4). The sessions themselves are staff_session (S01.07); this adds what revocation
-- needs on the account.
--
-- staff_account.session_generation counts the revocations of the account's sessions (suspension,
-- removal, role change, password reset, authenticator reset). Sign-in reads it before checking the
-- password and again, with the account's row locked, before it keeps the session: a revocation in
-- between refuses that sign-in, so a password checked before a reset never opens a session after it.

alter table staff_account add column session_generation integer not null default 0;
-- NOT VALID: the column is new, so every existing row has 0 and already passes; the check applies
-- to every row written from now on, without a validation scan of the existing ones.
alter table staff_account
  add constraint staff_account_session_generation_non_negative check (session_generation >= 0) not valid;
