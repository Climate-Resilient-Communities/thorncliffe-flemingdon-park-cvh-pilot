-- S08.06: heat and power alerts start a check-in round (E08 definitions "Round types", "Round", AD-12, AD-18). The rows, their guards and the
-- tally are S08.05's (20261006170000_checkin_request.sql: a drill or closed thread gets no `checkin` row, whoever inserts it); the approval's
-- call to `checkins.ensureRound` is the app's. What this adds is the Admin's edit of the round types:
--
--  - `disruption_type.checkin` (places' table): which types' approved alerts start a round. An Admin at aal2 changes it from the coverage page
--    (the policy action `checkins.round_types`), audited as `round_types.changed` with the types before and after, in the change's own
--    transaction (places/application/roundTypes.ts). The app may change that one column and nothing else of the table: the ids, and whether a
--    type may appear on the web at once (`direct`, D-1), stay the migrations'. A change starts or ends no round by itself: the next approval
--    reads the types in its own transaction, and the rows of a round already started stay until its thread closes.
--
-- A column grant and an update policy: nothing here is destructive.

grant update (checkin) on table disruption_type to cvh_app;
create policy disruption_type_app_update on disruption_type for update to cvh_app using (true) with check (true);
