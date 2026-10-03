-- S06.06: an Admin can pause all sending at once (AD-8), owned by the messaging module (AD-2). The pause switch itself
-- (`messaging_control`) was made by S06.02, which only reads it; this migration lets the app set and clear it, and adds the one
-- number the pause screen needs.
--
--  - `handed_off_at_pause`: how many texts had already been handed to the provider when the pause committed, among the texts of the
--    alerts and campaigns the pause is holding (an entry or campaign that still has a text waiting that the pause applies to). The
--    pause screen says "{n} texts were already handed to the provider and cannot be recalled" from it, and the sending progress view
--    (S06.09) uses the same wording. It is counted once, in the pause's own transaction, because it is a statement about the moment the
--    pause committed: later the same texts become delivered, and the number must not change with them. Null while texts are not paused,
--    and null on a pause set before this column existed. The check is NOT VALID (db:check-destructive: a new constraint on an existing
--    table), which is enough: only the pause use case writes the column, and it writes a count.
--  - The app's grant: `update (paused, paused_by, paused_at, reason, handed_off_at_pause, updated_at)`, and an update policy for `cvh_app`.
--    Nothing else: the app still cannot insert or delete the row (`id` is fixed at 1 and the row is made here, once), and cannot change its
--    id. Who may pause is the staff guard's rule (Admins at aal2, `sending.pause`) and the use case's audit record is written in the
--    pause's own transaction; the database holds the shape of a pause (who, when and why, `messaging_control_pause_stated`).
--
-- No trigger is added: a trigger on an existing table needs a contract note (db:check-destructive), and the pause's rules are all in
-- one conditional update under a row lock (messaging/application/messagingPause.ts), tested with the app's own credentials.

alter table messaging_control add column handed_off_at_pause integer;
alter table messaging_control add constraint messaging_control_handed_off_valid check (handed_off_at_pause is null or handed_off_at_pause >= 0) not valid;

grant update (paused, paused_by, paused_at, reason, handed_off_at_pause, updated_at) on table messaging_control to cvh_app;
create policy messaging_control_app_update on messaging_control for update to cvh_app using (true) with check (true);
