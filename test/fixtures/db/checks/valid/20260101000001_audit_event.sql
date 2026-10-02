-- Passes: owned by audit (spine ownership table), RLS on, only a service_role policy.
create table audit_event (
  id bigint generated always as identity primary key,
  action text not null
);
alter table audit_event enable row level security;
create policy audit_event_service on audit_event for all to service_role using (true);
