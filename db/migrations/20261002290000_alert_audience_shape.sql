-- S04.04: the shape of an alert entry's audience (AD-7, AR-11).
--
-- `alert_entry.audience` is the one Audience value of src/contracts/audience.ts: the scope, the places it names
-- (neighbourhood ids, or buildings each with their floor ids or null for the whole building), the groups and the
-- disruption types. The app builds it in one stored form (lists sorted and without repeats) and the use cases
-- refuse any other; this check repeats the shape the data itself must keep, so that SQL written around the app
-- cannot store an audience the matcher would read differently (a missing list, an empty selection). The first
-- check of S04.03 (alert_entry_audience_valid: an object with a known scope) stays.
--
-- A missing key makes a comparison null, and a check passes on null, so the whole condition is `is true`.
--
-- Whether the places exist (a floor belongs to its building, a neighbourhood is the pilot's) is the use case's rule,
-- read in its transaction: a reference inside a jsonb value cannot be a foreign key.
--
-- Expand-only: a constraint is added NOT VALID (it checks every new or changed row; rows written before it are not scanned), nothing is removed or rewritten.
-- alert_entry holds no row in any environment yet (nothing creates an alert before E04's composer); a later migration may validate it.

alter table alert_entry
  add constraint alert_entry_audience_shape check (
    (
      jsonb_typeof(audience -> 'groups') = 'array'
      and jsonb_typeof(audience -> 'types') = 'array'
      and jsonb_array_length(audience -> 'types') >= 1
      and (
        (
          audience ->> 'scope' = 'neighbourhood'
          and jsonb_typeof(audience -> 'neighbourhood_ids') = 'array'
          and jsonb_array_length(audience -> 'neighbourhood_ids') >= 1
        )
        or (
          audience ->> 'scope' = 'buildings'
          and jsonb_typeof(audience -> 'buildings') = 'array'
          and jsonb_array_length(audience -> 'buildings') >= 1
        )
      )
    ) is true
  ) not valid;
