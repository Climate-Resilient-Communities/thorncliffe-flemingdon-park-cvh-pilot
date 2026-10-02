-- Fails the RLS check: a policy for authenticated (among other roles).
create table audit_event (
  id bigint generated always as identity primary key,
  action text not null
);
alter table audit_event enable row level security;
create policy audit_event_write on audit_event for insert to service_role, authenticated with check (true);
