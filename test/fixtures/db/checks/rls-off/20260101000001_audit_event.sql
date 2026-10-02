-- Fails the RLS check: row level security is never enabled.
create table audit_event (
  id bigint generated always as identity primary key,
  action text not null
);
