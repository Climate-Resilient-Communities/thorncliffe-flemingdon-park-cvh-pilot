-- Supabase's default privileges grant every new function, table and sequence in
-- public to anon and authenticated (and PostgreSQL grants every new function to
-- PUBLIC), so each migration had to remember to take them back. This takes the
-- grants away by default for what the migrating role (postgres) creates in
-- public from now on. Objects that already exist keep the privileges they have
-- (the earlier migrations revoked them one by one). A migration that wants a
-- client role to reach something must grant it explicitly; `npm run db:check`
-- still fails on any function, view, table or sequence that anon or
-- authenticated can reach, however it got there.
--
-- Revoking from PUBLIC in a schema removes only a grant to PUBLIC that was made
-- in that schema; PostgreSQL's built-in EXECUTE for PUBLIC on every new function
-- is a global default that only a database-wide ALTER DEFAULT PRIVILEGES (with no
-- IN SCHEMA) can remove, which would also change functions that extensions
-- create. So a function still needs its own "revoke all on function ... from
-- public" (db:check requires it).
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
