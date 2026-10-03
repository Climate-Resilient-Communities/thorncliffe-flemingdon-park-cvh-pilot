-- S06.02 (review fix): the first rank of the claim order is the `fire` entry type alone.
--
-- `delivery_claim_rank()` (20261003410000_dispatcher.sql) put an alert whose types include `fire` or `evacuation` first. There is no
-- `evacuation` disruption type: the catalogue's `fire` is "Fire alarm or evacuation", and `alert_entry_guard` refuses a type that is not
-- in the catalogue, so the second name never matched anything. The list is now `fire`, the same as `SAFETY_OVERRIDE_TYPES`
-- (src/contracts/audience.ts), which messaging/domain/dispatchRules.ts#FIRST_ALERT_TYPES takes from there; a test compares the function
-- with `claimRank` for every case.
--
-- Only the function's body is replaced (the signature, its grants and the rows' stored `claim_rank` are untouched: the rank is fixed
-- when a row is created, and no alert row exists whose types held anything else).

create or replace function delivery_claim_rank(p_kind text, p_recipient_kind text, p_types text[], p_scope text) returns smallint
language sql
immutable
set search_path = ''
as $$
  select (case
    when p_kind = 'alert' and coalesce(p_types && array['fire'], false) then 0
    when p_kind = 'transactional' and p_recipient_kind = 'oncall' then 1
    when p_kind = 'transactional' then 2
    when p_kind = 'alert' and p_scope = 'buildings' then 3
    when p_kind = 'alert' then 4
    else 5
  end)::smallint
$$;
