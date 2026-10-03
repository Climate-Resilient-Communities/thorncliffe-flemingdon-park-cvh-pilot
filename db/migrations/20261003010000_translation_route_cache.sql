-- S04.02: alerts are translated by route, checked and never sent in the wrong language (AD-10, AR-14, D-4, D-5).
-- Two tables owned by the translation module: `translation_route` (what to translate with, and how to check it) and
-- `translation_cache` (the passing results).
--
-- translation_route is config, not code: one row per route position, that is per (language, model), seeded here from
-- the addendum's routing table (docs/planning/pilot/addendum.md, "Translation routing") in the order the offline catalogue
-- script uses (scripts/translate_catalogue.py ROUTES). A language's `position` 1 is its first choice. Each row has:
--  - the model, as the Cohere API names it;
--  - that position's own attempt timeout in milliseconds. A language's route deadline is the sum of its attempt
--    timeouts and is not stored; a deferred trigger refuses a language whose sum is over 30 s. An attempt timeout is a
--    whole number of seconds, at most 20 s (the definitions: measured p99 x 1.25 rounded up to the next second);
--  - the check the language's output must pass (the same on every row of a language, which the trigger also enforces):
--    `eld_code` (null for a language `eld` does not know: Pashto), the expected `script`, `marker_letters` (at least one
--    must be in the output) and `excluded_letters` (none may be). Pashto must contain a Pashto marker letter, and
--    neither Pashto nor Dari may contain a letter only Urdu uses; Dari also may not contain a Pashto marker letter,
--    because a model asked for Dari with the wrong words answers in Pashto, which `eld` reads as Persian;
--  - `source`: `provisional` for every value seeded here. THE ATTEMPT TIMEOUTS BELOW ARE PROVISIONAL: they were chosen
--    before any latency was measured. S04.01 measures every model per language and replaces them by a later migration,
--    setting `source = 'measured'`, and they are re-measured from `spend_event` call times after the pilot's first two
--    weeks and whenever a model or route changes. English is the source and zh-Hant is converted from zh by OpenCC, so
--    neither has a route.
-- The app reads this table and cannot change it: a route changes by migration.
--
-- translation_cache keeps a passing result under every part of AD-10's key: `(source_hash, lang, model_id,
-- prompt_version, check_version)` plus, for zh-Hant only, the OpenCC version and configuration (`''` for every other
-- language, so they can be part of the primary key). Only passing results are stored: the status can be only `ok`
-- (a model's text that passed the checks) or `script_converted` (zh-Hant), so a failure or the English fallback cannot be
-- cached, whatever the code does. A zh-Hant row also names the sha256 of the zh text it was converted from, and the app
-- reuses it only for that zh text. The app inserts rows and can replace only a zh-Hant conversion's body and source hash
-- (a column grant, and an update policy that sees only `script_converted` rows of zh-Hant, before and after the change).
-- A model's text (`ok`) is written once: the app has no way to change or delete it, so a text that passed the checks stays
-- as it passed, and what a cache read returns for it is what was checked.
--
-- Supabase's default privileges grant every new table in public to anon, authenticated and service_role, so each
-- table takes those back; only cvh_app (S01.04) reaches them.

create table translation_route (
  lang text not null,
  position smallint not null,
  model text not null,
  attempt_timeout_ms integer not null,
  eld_code text,
  script text not null,
  marker_letters text not null default '',
  excluded_letters text not null default '',
  source text not null default 'provisional',
  primary key (lang, position),
  constraint translation_route_lang_model_key unique (lang, model),
  constraint translation_route_lang_valid check (lang in ('ur', 'ps', 'tl', 'prs', 'gu', 'ta', 'el', 'sk', 'bn', 'hi', 'pa', 'zh', 'es', 'fr')),
  constraint translation_route_position_range check (position between 1 and 9),
  constraint translation_route_model_format check (model ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  constraint translation_route_attempt_timeout_valid check (attempt_timeout_ms between 1000 and 20000 and attempt_timeout_ms % 1000 = 0),
  constraint translation_route_eld_code_format check (eld_code is null or eld_code ~ '^[a-z]{2,3}$'),
  constraint translation_route_script_valid check (script in ('arabic', 'devanagari', 'bengali', 'gurmukhi', 'gujarati', 'tamil', 'greek', 'han', 'latin')),
  constraint translation_route_source_valid check (source in ('provisional', 'measured'))
);
alter table translation_route enable row level security;
revoke all on table translation_route from public, anon, authenticated, service_role;
grant select on table translation_route to cvh_app;
create policy translation_route_app_select on translation_route for select to cvh_app using (true);

-- A language's route deadline (the sum of its attempt timeouts) is at most 30 s, and its rows agree about its check.
-- Checked when the transaction ends, so a migration may change several positions of a language together.
create function translation_route_shape() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  total bigint;
  checks bigint;
begin
  select coalesce(sum(attempt_timeout_ms), 0),
         count(distinct (coalesce(eld_code, '') || '|' || script || '|' || marker_letters || '|' || excluded_letters))
    into total, checks
    from public.translation_route
    where lang = new.lang;
  if total > 30000 then
    raise exception 'translation_route: the route deadline of % is % ms, over 30000 ms (the sum of its attempt timeouts)', new.lang, total
      using errcode = 'check_violation', constraint = 'translation_route_shape';
  end if;
  if checks > 1 then
    raise exception 'translation_route: the rows of % disagree about the check its output must pass', new.lang
      using errcode = 'check_violation', constraint = 'translation_route_shape';
  end if;
  return null;
end
$$;
revoke all on function translation_route_shape() from public, anon, authenticated, service_role;

create constraint trigger translation_route_shape
  after insert or update on translation_route
  deferrable initially deferred
  for each row execute function translation_route_shape();

-- The routing table of the addendum. Models: north-small-translate-09-2026 (North Small Translate),
-- command-a-translate-08-2025 (Command A Translate), tiny-aya-fire and tiny-aya-water (Tiny Aya, through the Cohere API).
-- Pashto has one model: Command A Translate returned Dari for Pashto. Every language gets a provisional 20 s route
-- deadline: a single model 20 s, two models 10 s each.
insert into translation_route (lang, position, model, attempt_timeout_ms, eld_code, script, marker_letters, excluded_letters, source) values
  -- Pashto and Dari: North Small Translate first. eld has no Pashto (it reads it as Persian): script and letters alone.
  ('ps', 1, 'north-small-translate-09-2026', 20000, null, 'arabic', 'ټډړږښګڼېۍ', 'ٹڈڑںےھہ', 'provisional'),
  ('prs', 1, 'north-small-translate-09-2026', 10000, 'fa', 'arabic', '', 'ٹڈڑںےھہټډړږښګڼېۍ', 'provisional'),
  ('prs', 2, 'command-a-translate-08-2025', 10000, 'fa', 'arabic', '', 'ٹڈڑںےھہټډړږښګڼېۍ', 'provisional'),
  -- French, Spanish, Chinese, Greek, Hindi: Command A Translate officially supports them; North Small Translate second.
  ('fr', 1, 'command-a-translate-08-2025', 10000, 'fr', 'latin', '', '', 'provisional'),
  ('fr', 2, 'north-small-translate-09-2026', 10000, 'fr', 'latin', '', '', 'provisional'),
  ('es', 1, 'command-a-translate-08-2025', 10000, 'es', 'latin', '', '', 'provisional'),
  ('es', 2, 'north-small-translate-09-2026', 10000, 'es', 'latin', '', '', 'provisional'),
  ('zh', 1, 'command-a-translate-08-2025', 10000, 'zh', 'han', '', '', 'provisional'),
  ('zh', 2, 'north-small-translate-09-2026', 10000, 'zh', 'han', '', '', 'provisional'),
  ('el', 1, 'command-a-translate-08-2025', 10000, 'el', 'greek', '', '', 'provisional'),
  ('el', 2, 'north-small-translate-09-2026', 10000, 'el', 'greek', '', '', 'provisional'),
  ('hi', 1, 'command-a-translate-08-2025', 10000, 'hi', 'devanagari', '', '', 'provisional'),
  ('hi', 2, 'north-small-translate-09-2026', 10000, 'hi', 'devanagari', '', '', 'provisional'),
  -- Urdu, Bengali, Tamil, Punjabi: North Small Translate (on its official list), then Tiny Aya Fire.
  ('ur', 1, 'north-small-translate-09-2026', 10000, 'ur', 'arabic', '', '', 'provisional'),
  ('ur', 2, 'tiny-aya-fire', 10000, 'ur', 'arabic', '', '', 'provisional'),
  ('bn', 1, 'north-small-translate-09-2026', 10000, 'bn', 'bengali', '', '', 'provisional'),
  ('bn', 2, 'tiny-aya-fire', 10000, 'bn', 'bengali', '', '', 'provisional'),
  ('ta', 1, 'north-small-translate-09-2026', 10000, 'ta', 'tamil', '', '', 'provisional'),
  ('ta', 2, 'tiny-aya-fire', 10000, 'ta', 'tamil', '', '', 'provisional'),
  ('pa', 1, 'north-small-translate-09-2026', 10000, 'pa', 'gurmukhi', '', '', 'provisional'),
  ('pa', 2, 'tiny-aya-fire', 10000, 'pa', 'gurmukhi', '', '', 'provisional'),
  -- Tagalog and Slovak: North Small Translate, then Tiny Aya Water.
  ('tl', 1, 'north-small-translate-09-2026', 10000, 'tl', 'latin', '', '', 'provisional'),
  ('tl', 2, 'tiny-aya-water', 10000, 'tl', 'latin', '', '', 'provisional'),
  ('sk', 1, 'north-small-translate-09-2026', 10000, 'sk', 'latin', '', '', 'provisional'),
  ('sk', 2, 'tiny-aya-water', 10000, 'sk', 'latin', '', '', 'provisional'),
  -- Gujarati: Tiny Aya Fire first; it is on neither North Small Translate's nor Command A Translate's official list.
  ('gu', 1, 'tiny-aya-fire', 10000, 'gu', 'gujarati', '', '', 'provisional'),
  ('gu', 2, 'north-small-translate-09-2026', 10000, 'gu', 'gujarati', '', '', 'provisional');

create table translation_cache (
  source_hash text not null,
  lang text not null,
  model_id text not null,
  prompt_version text not null,
  check_version text not null,
  opencc_version text not null default '',
  opencc_config text not null default '',
  body text not null,
  status text not null,
  from_text_hash text,
  created_at timestamptz not null default now(),
  primary key (source_hash, lang, model_id, prompt_version, check_version, opencc_version, opencc_config),
  constraint translation_cache_source_hash_format check (source_hash ~ '^[0-9a-f]{64}$'),
  constraint translation_cache_lang_valid check (lang in ('ur', 'ps', 'tl', 'prs', 'gu', 'ta', 'el', 'sk', 'bn', 'hi', 'pa', 'zh', 'es', 'fr', 'zh-Hant')),
  constraint translation_cache_model_id_format check (model_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  constraint translation_cache_versions_present check (prompt_version <> '' and check_version <> ''),
  constraint translation_cache_body_present check (btrim(body) <> ''),
  constraint translation_cache_status_passing check (status in ('ok', 'script_converted')),
  constraint translation_cache_converted_shape check (
    (lang = 'zh-Hant' and status = 'script_converted' and opencc_version <> '' and opencc_config <> ''
      and from_text_hash is not null and from_text_hash ~ '^[0-9a-f]{64}$')
    or (lang <> 'zh-Hant' and status = 'ok' and opencc_version = '' and opencc_config = '' and from_text_hash is null)
  )
);
alter table translation_cache enable row level security;
revoke all on table translation_cache from public, anon, authenticated, service_role;
grant select, insert on table translation_cache to cvh_app;
grant update (body, from_text_hash) on table translation_cache to cvh_app;
create policy translation_cache_app_select on translation_cache for select to cvh_app using (true);
create policy translation_cache_app_insert on translation_cache for insert to cvh_app with check (true);
create policy translation_cache_app_update on translation_cache for update to cvh_app
  using (lang = 'zh-Hant' and status = 'script_converted')
  with check (lang = 'zh-Hant' and status = 'script_converted');
