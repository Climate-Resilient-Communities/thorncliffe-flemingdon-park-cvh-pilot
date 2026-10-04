-- S08.02: an ambassador posts an update or incident for their floors (AD-5, owned by the alerting module).
--
-- What this adds to the tables the earlier stories created (expand-only; no trigger is added or replaced):
--  1. `alert_entry.discard_reason`: why an entry was discarded, set by the use case that discards it, in the same UPDATE that sets `discarded`:
--       `by_author`  the author took back their own draft or submitted entry (alerting.discardEntry, the actor is the author);
--       `declined`   the Hub did not send it: an approver, or anyone but the author, discarded it (alerting.discardEntry);
--       `by_close`   the thread closed with it unread (alerting.closeAlert: a final's or a withdrawal's approval, or the expire job).
--     So an ambassador's post reads "Not sent by the Hub" (A-01, A-03) only when the Hub really declined it (the decision S08.01 handed over). Only the value
--     set is checked here (`alert_entry_discard_reason_valid`; null passes). That a discarded entry has a reason and no other entry has one is a check of its
--     own, added by a later migration once this release is live: the release before this one discards without a reason, and it keeps running while this
--     migration is applied (the deploy window). Entries discarded before this migration carry none and keep none (a discarded entry never changes again).
--  2. `alert_entry.attributed_rsn`: the building a post is attributed to, frozen at submit with the texts that say "Building ambassador, {building}" (AD-5,
--     "Seam for E08"); null for the Hub's own entries. A draft holds none: a return to draft clears it with the other frozen fields (the use case does; the
--     check that makes it so comes with the later migration above). The approval view (O-07) and residents read it, never the author's role at the time they read.
--  3. A new resident view `nondrill_alert_entry_v3` carries `attributed_rsn` beside the columns of `nondrill_alert_entry_v2`, which is left exactly as it is
--     (the previous release reads it during the deploy window; a later release drops it).

alter table alert_entry add column discard_reason text;
alter table alert_entry add column attributed_rsn text;
-- The app sets both through its use cases (a discard, a submit, a return); updates are granted by column, as for the other columns the use cases write.
grant update (discard_reason, attributed_rsn) on table alert_entry to cvh_app;
alter table alert_entry add constraint alert_entry_discard_reason_valid
  check (discard_reason is null or discard_reason in ('by_author', 'declined', 'by_close')) not valid;

create view nondrill_alert_entry_v3 with (security_invoker = true) as
  select
    e.id,
    e.alert_id,
    a.slug,
    e.kind,
    e.phase,
    e.types,
    e.audience,
    e.valid_until,
    e.original_text,
    e.web_published_at,
    (e.approved_by is not null) as verified,
    (e.status = 'superseded') as superseded,
    e.supersedes_id,
    e.attributed_rsn
  from alert_entry e
  join nondrill_alert t on t.id = e.alert_id
  join alert a on a.id = t.id
  where e.web_published_at is not null
    and e.status in ('pending_approval', 'approved', 'superseded', 'published_system');
revoke all on table nondrill_alert_entry_v3 from public, anon, authenticated, service_role;
grant select on table nondrill_alert_entry_v3 to cvh_app;
