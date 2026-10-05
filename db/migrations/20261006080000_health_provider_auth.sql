-- S09.01 follow-up: the health job watches Twilio sign-in, and the heartbeat turns red when it keeps failing (owned by ops, AD-2).
--
--  - `health_condition` gains a row for `provider_auth`: Twilio refused the CVH's credentials (`dispatch.provider_auth_failed`, S06.02) and has
--    accepted nothing since (no text accepted, no daily Messaging Service check that read its setting). The health job texts the on-call Admins
--    about it like any level condition, and `GET /api/health/heartbeat` answers 503 `provider_auth` once it has held for 10 minutes, so the
--    outside check emails them through a channel that does not depend on Twilio.
--  - The check of known codes is widened (expand-only: every code S09.01 and S07.09's `messaging_settings` allowed is kept; the previous release
--    judges only its eleven conditions and leaves this row inactive); the new one is added NOT VALID, like S09.01's, and every existing row
--    satisfies it.
--
-- No new table, no new grant: the app's role already reads and updates `health_condition` and cannot insert into it.

alter table health_condition drop constraint health_condition_known;
alter table health_condition add constraint health_condition_known check (condition in (
  'queue_stuck', 'delivery_unknown', 'sender_stalled', 'smart_encoding_on', 'signature_failures',
  'job_failed', 'translation_fallback', 'publish_failed', 'transactional_ceiling', 'cap_overrun', 'messaging_settings',
  'provider_auth'
)) not valid;
insert into health_condition (condition) values ('provider_auth');
