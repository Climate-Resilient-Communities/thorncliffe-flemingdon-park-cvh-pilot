-- Fails the RLS check: RLS is on, but a policy lets anon read the table.
create table audit_event (
  id bigint generated always as identity primary key,
  action text not null
);
alter table audit_event enable row level security;
create policy audit_event_read on audit_event for select to anon using (true);
