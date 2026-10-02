-- S04.04: the shape of an alert entry's audience (AD-7, AR-11).
--
-- `alert_entry.audience` is the one Audience value of src/contracts/audience.ts: the scope, the places it names
-- (neighbourhood ids, or buildings each with their floor ids or null for the whole building), the groups and the
-- disruption types. The app builds it in one stored form (lists sorted and without repeats) and the use cases
-- refuse any other; this check repeats the shape the data itself must keep, so that SQL written around the app
-- cannot store an audience the matcher would read differently (a missing list, an empty selection, a number where an
-- id belongs, a floor list that is empty). The first check of S04.03 (alert_entry_audience_valid: an object with a
-- known scope) stays.
--
-- A missing key makes a comparison null, and a check passes on null, so the whole condition is `is true`.
--
-- Whether the places exist (a floor belongs to its building, a neighbourhood is the pilot's) is the use case's rule,
-- read in its transaction: a reference inside a jsonb value cannot be a foreign key.
--
-- The list members are checked with jsonpath, because a CHECK cannot hold a subquery. `jsonb_path_exists` is
-- immutable. The path is in lax mode, so a missing list is an empty sequence (the array checks above catch it).

alter table alert_entry
  add constraint alert_entry_audience_shape check (
    (
      jsonb_typeof(audience -> 'groups') = 'array'
      and jsonb_typeof(audience -> 'types') = 'array'
      and jsonb_array_length(audience -> 'types') >= 1
      -- The audience carries the entry's own types, the topics a resident may have muted: the same set, each way
      -- (containment ignores order and repeats; the app stores both sorted).
      and (audience -> 'types') @> to_jsonb(types)
      and to_jsonb(types) @> (audience -> 'types')
      -- Every group, topic and neighbourhood id is a string.
      and not jsonb_path_exists(audience, '$.groups[*] ? (@.type() != "string")')
      and not jsonb_path_exists(audience, '$.types[*] ? (@.type() != "string")')
      and not jsonb_path_exists(audience, '$.neighbourhood_ids[*] ? (@.type() != "string")')
      -- Each building says its floors: null for the whole building, else a non-empty array of strings (floor ids).
      and not jsonb_path_exists(
        audience,
        '$.buildings[*] ? (!exists(@.floors) || (@.floors.type() != "null" && (@.floors.type() != "array" || @.floors.size() == 0 || exists(@.floors[*] ? (@.type() != "string")))))'
      )
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

-- Why NOT VALID, and no `validate constraint` here: alert_entry holds no row in any environment yet (nothing creates an
-- alert before E04's composer), so validating would scan nothing. But scripts/db/check-destructive.mjs compares the
-- constraint as the database reports it after the run, and a validated check on a table that already exists is reported
-- as "adds constraint ... add it NOT VALID and validate later" (the previous release may write rows that violate it).
-- A NOT VALID check still binds every insert and update, which is all this table has. A later migration may validate it.
