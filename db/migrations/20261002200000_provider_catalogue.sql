-- S02.04: the reviewed provider catalogue, loaded from data/catalogue/ (providers.json and
-- translations/{lang}.json) by the idempotent seed (scripts/seed/providers.mjs), and each
-- provider's publication state and last-confirmed date, which the Hub's Admins set on
-- /staff/providers. Owned by the directory module (spine table ownership).
--
-- Who writes what:
--  - the seed runs as the migration role and writes the listing (name, texts, contact,
--    location, categories). It never touches `published`, `published_at` or `last_confirmed`,
--    except to unpublish a provider that left the catalogue (`in_catalogue = false`), whose
--    last-confirmed date it keeps. Nothing is ever deleted from `provider`.
--  - the app (cvh_app, through cvh_app_login) reads everything and may change only
--    `published`, `published_at`, `last_confirmed` and `updated_at` of a provider: there is no
--    way for the app to edit listing text, in SQL as on the screen (AD-11). It cannot insert or
--    delete any of these rows.
--  - residents do not read these tables: S02.05 writes the directory release files from them
--    (published providers with a last-confirmed date).
--
-- `texts` holds, per text key (`services`, `emergency_role`), the English and the translations
-- the seed accepted (reviewed and current): {"services": {"en": "...", "ur": "..."}}. A language
-- missing from a text means English with translation.unavailable. `translations` records where
-- each loaded translation came from (model, reviewer, review date). Supabase's default
-- privileges grant every new table in public to anon, authenticated and service_role, so each
-- table takes those back; there are no sequences (every key is text).

create table provider (
  id text primary key,
  name text not null,
  -- [{"name": "Police Station", "labels": {"en": "Police Station", "ur": "..."}}]
  subcategories jsonb not null default '[]'::jsonb,
  -- {"phone": [...], "email": [...], "social": [...], "web": [...]}
  contact jsonb not null default '{}'::jsonb,
  texts jsonb not null,
  translations jsonb not null default '{}'::jsonb,
  -- Research notes for Hub staff only; never shown to residents.
  source_notes jsonb not null default '[]'::jsonb,
  -- False once the provider is no longer in providers.json: flagged "not in catalogue", unpublished.
  in_catalogue boolean not null default true,
  published boolean not null default false,
  published_at timestamptz,
  last_confirmed date,
  updated_at timestamptz not null default now(),
  constraint provider_id_format check (id ~ '^[A-Z][0-9]{3,6}$'),
  constraint provider_published_after_confirmation check (not published or last_confirmed is not null),
  constraint provider_published_in_catalogue check (not published or in_catalogue),
  constraint provider_published_at_when_published check (published = (published_at is not null))
);

create table provider_location (
  provider_id text not null references provider (id),
  seq smallint not null default 0,
  street text not null,
  city text not null,
  postal text,
  lat double precision not null,
  lng double precision not null,
  primary key (provider_id, seq),
  -- The Toronto bounding box (src/contracts/torontoBounds.ts).
  constraint provider_location_in_toronto check (lat between 43.58 and 43.86 and lng between -79.64 and -79.11)
);

create table category (
  -- The id the catalogue gives the category label (labels.categories.<name>.id).
  id text primary key,
  name text not null unique,
  sort_order smallint not null,
  -- The English name and the reviewed translations of it: {"en": "...", "ur": "..."}.
  labels jsonb not null,
  translations jsonb not null default '{}'::jsonb,
  in_catalogue boolean not null default true
);

create table provider_category (
  provider_id text not null references provider (id),
  category_id text not null references category (id),
  primary key (provider_id, category_id)
);
create index provider_category_category_idx on provider_category (category_id);

alter table provider enable row level security;
alter table provider_location enable row level security;
alter table category enable row level security;
alter table provider_category enable row level security;

revoke all on table provider, provider_location, category, provider_category from public, anon, authenticated, service_role;

grant select on table provider, provider_location, category, provider_category to cvh_app;
grant update (published, published_at, last_confirmed, updated_at) on table provider to cvh_app;

create policy provider_app_select on provider for select to cvh_app using (true);
create policy provider_app_update on provider for update to cvh_app using (true) with check (true);
create policy provider_location_app_select on provider_location for select to cvh_app using (true);
create policy category_app_select on category for select to cvh_app using (true);
create policy provider_category_app_select on provider_category for select to cvh_app using (true);

-- A last-confirmed date is never in the future (Toronto's calendar day, the Hub's own). A CHECK
-- cannot hold this because now() is not immutable, so a trigger does: the Admin's screen refuses a
-- future date first, and this is the guard under it (a script, a query run by hand).
create function provider_last_confirmed_not_future() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.last_confirmed > (now() at time zone 'America/Toronto')::date then
    raise exception 'provider.last_confirmed cannot be in the future'
      using errcode = 'check_violation', constraint = 'provider_last_confirmed_not_future';
  end if;
  return new;
end
$$;
revoke all on function provider_last_confirmed_not_future() from public, anon, authenticated, service_role;

create trigger provider_last_confirmed_not_future
  before insert or update on provider
  for each row execute function provider_last_confirmed_not_future();
