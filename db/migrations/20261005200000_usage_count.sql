-- S02.15: usage_count (owned by directory), the daily counts of install events and of directory, listing, map, guide and numbers
-- use, by page language and neighbourhood (AR-26, FR-M1, FR-M3).
--
-- It counts and nothing else. A row is a day (a Toronto date, never a time), what happened, the page language, the neighbourhood the
-- page was about (an empty string when it was about neither: part of the key, so the count for "no neighbourhood" is one row), and how
-- many times. There is no identifier of any kind in it: no address, no user agent, no device or session id, no time finer than the
-- day, no building, floor or group. A row cannot be tied to a person, and the table has no column that could carry what would let it.
--
-- The app (cvh_app) reads the counts (the Hub's report), adds a row for a combination's first event of the day and raises `n` after
-- that; it never changes another column and never deletes. Supabase's default privileges grant every new table to anon,
-- authenticated and service_role, so each is taken back.

create table usage_count (
  day date not null,
  evt text not null,
  lang text not null,
  nbhd text not null default '',
  n bigint not null default 1,
  primary key (day, evt, lang, nbhd),
  constraint usage_count_evt check (evt in ('install', 'directory_view', 'listing_view', 'map_view', 'guide_view', 'numbers_view')),
  constraint usage_count_lang_format check (lang ~ '^[A-Za-z]{2,3}(-[A-Za-z]{4})?$'),
  constraint usage_count_nbhd check (nbhd in ('', 'TP', 'FP')),
  constraint usage_count_n_positive check (n > 0)
);
alter table usage_count enable row level security;

revoke all on table usage_count from public, anon, authenticated, service_role;
grant select, insert on table usage_count to cvh_app;
grant update (n) on table usage_count to cvh_app;
create policy usage_count_app_select on usage_count for select to cvh_app using (true);
create policy usage_count_app_insert on usage_count for insert to cvh_app with check (true);
create policy usage_count_app_update on usage_count for update to cvh_app using (true) with check (true);
