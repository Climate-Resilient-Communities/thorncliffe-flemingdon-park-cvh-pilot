-- S04.08: what a resident may read of the alerts (AD-6, AD-17), owned by the alerting module.
--
-- Every resident-reachable read of the alerts goes through three views and nothing else (AD-6): a lint rule forbids any
-- other alert relation in the resident query files (src/modules/alerting/adapters/resident/), so a drill can only be read
-- there by a mistake the rule and the integration test catch. They select named columns, so they show a resident nothing
-- that is not meant to be shown: no author, editor, approver, hash, SMS body, version or audience of a draft. Each runs
-- with the caller's rights (security_invoker), so the app's role needs the privileges it already has on the tables, and
-- only the app's role reaches them.
--
--  - nondrill_alert (S04.03) is the thread, and stays exactly as it is: a changed definition of a view the previous release
--    may read is a contract change (db:check-destructive), and nothing here needs the thread's columns to change.
--  - nondrill_alert_entry: the entries of a non-drill thread that are web-published (`web_published_at` is set) and not
--    draft or discarded, so a draft, a returned entry or a drill's entry is never in the view. It carries the thread's
--    `slug` (the address of the alert, "/a/{slug}", S04.05), read from the thread the join to nondrill_alert has just shown
--    is not a drill. `verified` is whether the entry has been approved (`approved_by` is set; every entry the Hub approves in
--    this epic is "Verified by the Hub", and an ambassador's post that the web showed before approval, which E08 adds, is
--    not), and `superseded` is whether a correction or withdrawal replaced it (E05).
--  - nondrill_alert_entry_translation: the frozen web texts of those entries, one row per language (the zh-Hant
--    conversion record is left out: the feed's contract does not carry it).

create view nondrill_alert_entry with (security_invoker = true) as
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
    (e.status = 'superseded') as superseded
  from alert_entry e
  join nondrill_alert t on t.id = e.alert_id
  join alert a on a.id = t.id
  where e.web_published_at is not null
    and e.status in ('pending_approval', 'approved', 'superseded', 'published_system');
revoke all on table nondrill_alert_entry from public, anon, authenticated, service_role;
grant select on table nondrill_alert_entry to cvh_app;

create view nondrill_alert_entry_translation with (security_invoker = true) as
  select t.entry_id, t.lang, t.body, t.machine, t.model, t.status, t.source_hash
  from alert_entry_translation t
  join nondrill_alert_entry e on e.id = t.entry_id;
revoke all on table nondrill_alert_entry_translation from public, anon, authenticated, service_role;
grant select on table nondrill_alert_entry_translation to cvh_app;
