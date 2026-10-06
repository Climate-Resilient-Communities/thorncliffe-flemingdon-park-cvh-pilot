-- S07.05: the numbered text menus (E07 definitions "Menu", "Building change by text", AD-9) change a subscriber's language (menu 2) and, with
-- menu 1, replace all of its saved buildings with the one building (and floor) chosen, setting its neighbourhood to that building's.
--
--  - `subscriber`: the app may now update `lang` and `neighbourhood_id`, besides `retention_state` (S07.04, the deletion's row lock; E09). The
--    number, the groups, `consent_version` and `started_by` stay unchangeable by the app. A menu locks the row FOR NO KEY UPDATE, an edit's
--    lock, before it changes anything (S07.07: an edit of a subscriber waits for an approval that is capturing recipients FOR SHARE, and the
--    next capture sees it whole; a resend's FOR KEY SHARE, which only a deletion's FOR UPDATE stops, does not wait for it).
--  - `subscriber_place`: unchanged; the app already selects, inserts and deletes its rows, which is how menu 1 replaces them.
--  - `sms_prompt`: unchanged. Its `kind` is a code, not a fixed list (S07.04), so the menus' kinds (`menu_building`, `menu_language`) and the
--    edit link's offer (`edit_link_offer`, used once S07.06 sends the link) need no change here; the menu's page is the row's `step`. A menu
--    row is kept for an hour (`expires_at`, within the table's one-hour check) while the menu itself is open for 10 minutes after its last
--    message (`sent_at`): a reply in between is told the menu has reset. The purge job deletes the rows after their hour, as before.
--  - The daily menu limit (5 a day per number) is kept as keyed hashes in `rate_limit` (scope `sms_menu`), deleted after 24 hours by
--    S07.09's purge, like the inbound limit's.
--
-- Expand only: a grant, no table or column changes.

grant update (lang, neighbourhood_id) on table subscriber to cvh_app;
