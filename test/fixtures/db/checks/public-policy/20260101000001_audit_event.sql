-- Fails the RLS check: a policy without TO applies to PUBLIC, so to anon and authenticated.
create table audit_event (
  id bigint generated always as identity primary key,
  action text not null
);
alter table audit_event enable row level security;
create policy audit_event_all on audit_event using (true);
