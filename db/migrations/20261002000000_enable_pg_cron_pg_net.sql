-- S01.03: the scheduler (pg_cron) and HTTP calls from the database (pg_net)
-- that later stories use for jobs. AD-15: the cron target URL and job secret
-- live in Vault and point at production only. Creates no application tables.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
