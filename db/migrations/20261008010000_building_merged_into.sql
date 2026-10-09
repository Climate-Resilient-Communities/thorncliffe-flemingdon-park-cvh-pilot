-- UAT F-5: a registration the buildings seed folds into another (data/seed/building-merge.csv) leaves every building list (AD-25, S01.13, owned by the places module).
--
-- The City register lists 85-95 Thorncliffe Park Dr twice (rsn 4154159 and 4237447). The first seed loaded both, so every building picker showed the address twice.
-- The merge file now maps 4237447 to 4154159. A building already loaded is never deleted (its floors' ids are what assignments, sign-ups and check-ins name), so the
-- seed marks the folded one instead:
--   building.merged_into   the rsn of the building it was folded into; null for every other building. Set and cleared only by the buildings seed (the owner role):
--                          a building whose line leaves the merge file is listed again on the next run. The places module leaves a merged building out of every
--                          list (the Hub's pickers and pages, the resident's picker, the SMS building menu); read by its rsn it is still there, so nothing that
--                          names it breaks.
-- Expand-only: a nullable column the previous release never reads. The app role is not granted to write it.

alter table building add column merged_into text references building (rsn);
alter table building add constraint building_merged_into_other check (merged_into is null or merged_into <> rsn) not valid;
create index building_merged_into_idx on building (merged_into);
