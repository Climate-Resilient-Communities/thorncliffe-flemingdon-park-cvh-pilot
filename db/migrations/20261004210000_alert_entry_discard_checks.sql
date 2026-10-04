-- S08.02, the second step: the checks that tie `alert_entry.discard_reason` and `alert_entry.attributed_rsn` to the entry's status (AD-5).
--
-- 20261004200000_ambassador_post.sql added both columns and checked only the reason's value set, because the release before it discards without a reason
-- and keeps running while that migration is applied. This migration is applied only once that release (S08.02) is live in production, when every discard
-- the app makes says why (`discardEntry`: by_author or declined; `closeAlert`, the expire job included: by_close) and a return to draft clears the building:
--  1. `alert_entry_discard_reason_status`: an entry is discarded exactly when it has a reason.
--  2. `alert_entry_attributed_rsn_frozen`: a draft holds no building (it is frozen at submit, with the texts that name it).
-- Both are NOT VALID: entries discarded before S08.02 carry no reason, and a discarded entry never changes again (the entry guard), so they stay as they are;
-- every new or changed row must satisfy them. Nothing else is added or replaced.

alter table alert_entry add constraint alert_entry_discard_reason_status
  check ((status = 'discarded') = (discard_reason is not null)) not valid;
alter table alert_entry add constraint alert_entry_attributed_rsn_frozen
  check (attributed_rsn is null or status <> 'draft') not valid;
