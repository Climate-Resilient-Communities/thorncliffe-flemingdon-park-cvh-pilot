-- Drift test fixture: the migrations side. schema-matching.ts describes exactly this.
create type audit_outcome as enum ('ok', 'refused');

create table staff_account (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  created_at timestamptz not null default now()
);
alter table staff_account enable row level security;

create table audit_event (
  id bigint generated always as identity primary key,
  actor_id uuid references staff_account (id) on delete set null,
  action text not null,
  outcome audit_outcome not null default 'ok',
  detail jsonb,
  occurred_at timestamptz not null default now()
);
create index audit_event_occurred_at_idx on audit_event (occurred_at);
alter table audit_event enable row level security;
