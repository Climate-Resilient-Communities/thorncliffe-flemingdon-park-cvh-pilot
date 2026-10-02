-- Fails the ownership check (AD-2): widget is not in the spine's table ownership table.
create table widget (
  id bigint generated always as identity primary key
);
alter table widget enable row level security;
