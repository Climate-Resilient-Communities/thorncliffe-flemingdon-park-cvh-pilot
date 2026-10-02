-- S02.08: the building contact an Admin enters on the building's staff screen, owned by the places
-- module with the rest of `building` (spine table ownership).
--
-- A contact is a role (what residents call the person: "Superintendent") and a phone number, with
-- its owner and the day it was last entered. The owner is always the Hub in the pilot (the Hub
-- provides the contact, the building does not): it is stored so the resident page can say "Provided
-- by the Hub", and so a later owner is a new value, not a new column. The four columns are all
-- set or all empty: a building with no contact has none of them, and residents see "Not known".
-- No personal name is stored; the role is enough to find the person in the building.
--
-- Grants. The app (cvh_app) already reads `building` and updates the two confirmation columns;
-- it now also updates these four, and no others (the register's facts stay the seed's). Residents
-- do not read the table: the app reads it for them through the places module, which returns only
-- the facts the story lists (never `floors_confirmed_by`). The table keeps its RLS and its
-- revoke from anon, authenticated and service_role (S01.13); adding columns adds no privilege.

alter table building
  add column contact_role text,
  add column contact_phone text,
  add column contact_owner text,
  add column contact_updated_at timestamptz;
-- NOT VALID: the columns are new, so every existing row has them null and already passes; the checks
-- apply to every row written from now on, without a validation scan of the existing ones.
alter table building
  add constraint building_contact_role_valid check (contact_role is null or (contact_role = btrim(contact_role) and char_length(contact_role) between 1 and 40 and contact_role !~ '  ')) not valid,
  add constraint building_contact_phone_valid check (contact_phone is null or contact_phone ~ '^[2-9][0-9]{2}-[2-9][0-9]{2}-[0-9]{4}$') not valid,
  add constraint building_contact_owner_valid check (contact_owner is null or contact_owner = 'hub') not valid,
  add constraint building_contact_complete check (
    (contact_role is null and contact_phone is null and contact_owner is null and contact_updated_at is null)
    or (contact_role is not null and contact_phone is not null and contact_owner is not null and contact_updated_at is not null)
  ) not valid;

grant update (contact_role, contact_phone, contact_owner, contact_updated_at) on table building to cvh_app;
