-- S09.01: the health job watches every condition of AD-23, records its heartbeat, and can see failed scheduled jobs (owned by ops, AD-2).
--
--  - `health_condition` gains a row for each condition E09 adds to S06.07's five: `job_failed` (a failed pg_cron run, or a job's call that did
--    not answer 2xx), `translation_fallback` (a whole language fell back to English in an alert), `publish_failed` (a directory publish failed
--    and none has succeeded since), `transactional_ceiling` (the daily ceiling on non-alert texts crossed) and `cap_overrun` (a spending cap
--    overrun this month). The check of known codes is widened (expand-only: the previous release still writes only its five rows); the new
--    one is added NOT VALID, and every existing row satisfies it.
--  - `health_heartbeat`: one row, the time of the health job's last run that judged every condition. `GET /api/health/heartbeat` answers 200
--    only while it is less than 3 minutes old, and an uptime monitor outside Vercel, Supabase and Twilio calls it every minute (E09 "Outside
--    check"). No personal data. The app reads it and sets the time; it cannot insert or delete the row.
--  - `health_job_failures(ms)`: how many pg_cron runs failed (`cron.job_run_details`) and how many of the jobs' HTTP calls did not answer 2xx
--    (`net._http_response`, pg_net's record of the answers, kept by pg_net for a few hours) in the last `ms` milliseconds, at most 24 hours. The
--    app's role cannot read the `cron` schema (its jobs' commands name the Vault secrets), so this function, owned by the migration's role,
--    gives it a count and nothing else. A source the database does not have counts 0.
--
-- Supabase's default privileges grant every new table to anon, authenticated and service_role, so each is taken back.

alter table health_condition drop constraint health_condition_known;
alter table health_condition add constraint health_condition_known check (condition in (
  'queue_stuck', 'delivery_unknown', 'sender_stalled', 'smart_encoding_on', 'signature_failures',
  'job_failed', 'translation_fallback', 'publish_failed', 'transactional_ceiling', 'cap_overrun'
)) not valid;
insert into health_condition (condition) values ('job_failed'), ('translation_fallback'), ('publish_failed'), ('transactional_ceiling'), ('cap_overrun');

create table health_heartbeat (
  id smallint primary key default 1,
  completed_at timestamptz,
  constraint health_heartbeat_one_row check (id = 1)
);
insert into health_heartbeat (id) values (1);
alter table health_heartbeat enable row level security;
revoke all on table health_heartbeat from public, anon, authenticated, service_role;
grant select on table health_heartbeat to cvh_app;
grant update (completed_at) on table health_heartbeat to cvh_app;
create policy health_heartbeat_app_select on health_heartbeat for select to cvh_app using (true);
create policy health_heartbeat_app_update on health_heartbeat for update to cvh_app using (true) with check (true);

create function health_job_failures(p_within_ms bigint) returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_since timestamptz := now() - least(greatest(coalesce(p_within_ms, 0), 0), 86400000)::double precision * interval '1 millisecond';
  v_total integer := 0;
  v_count integer;
begin
  if to_regclass('cron.job_run_details') is not null then
    execute 'select count(*)::int from cron.job_run_details where status = ''failed'' and coalesce(end_time, start_time) > $1'
      into v_count using v_since;
    v_total := v_total + coalesce(v_count, 0);
  end if;
  if to_regclass('net._http_response') is not null then
    execute 'select count(*)::int from net._http_response where created > $1
               and (timed_out is true or error_msg is not null or status_code is null or status_code not between 200 and 299)'
      into v_count using v_since;
    v_total := v_total + coalesce(v_count, 0);
  end if;
  return v_total;
end
$$;
revoke all on function health_job_failures(bigint) from public, anon, authenticated, service_role;
grant execute on function health_job_failures(bigint) to cvh_app;
