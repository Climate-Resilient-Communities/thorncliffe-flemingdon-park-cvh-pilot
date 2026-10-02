-- Fails the ownership check (AD-2): audit_event belongs to audit, not ops.
create schema ops;
create table ops.audit_event (
  id bigint generated always as identity primary key
);
alter table ops.audit_event enable row level security;
