-- S07.10: a Cohere call made for an alert says which alert entry it was for and whether that entry is a drill's, so the Hub can give each alert's share of the
-- vendor's usage with drills apart (FR-M5). Until now `entry_id` and `is_drill` were for text messages only (`spend_event_sms_shape`); the rule is relaxed for the
-- other kinds: an entry and its drill flag come together, and only for the `alert` purpose. Every other column of a non-text row stays null, as before.
--
-- Expand only: the constraint is replaced by one with the same name, NOT VALID, so rows written by the release still serving (no entry, no flag) are not
-- scanned and need not change. Both columns exist since 20261003440000_sms_spend.sql; no column is added, so no table or grant changes.

alter table spend_event drop constraint spend_event_sms_shape;
alter table spend_event add constraint spend_event_sms_shape check (
  (kind = 'sms'
    and delivery_id is not null and lang is not null and is_drill is not null
    and segments is not null and segments between 1 and 24
    and cost_estimate_cents is not null and cost_estimate_cents >= 0
    and purpose in ('alert', 'transactional', 'campaign')
    and (entry_id is not null) = (purpose = 'alert'))
  or (kind <> 'sms'
    and delivery_id is null and lang is null
    and segments is null and cost_estimate_cents is null
    and (entry_id is null) = (is_drill is null)
    and (entry_id is null or purpose = 'alert'))
) not valid;
