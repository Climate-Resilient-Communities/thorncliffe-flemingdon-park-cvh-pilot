-- Residents suggest a place that is missing or correct one that looks wrong, and the Hub moderates them (PRD §6.3 "Community contributions and
-- moderation queue", D9/E4: deferred in the signed pilot scope, built by the product owner's decision of 2026-11-07; prototype R-17 to R-23,
-- O-08 to O-10). Owned by the directory module, whose catalogue a suggestion is about.
--
-- place_submission: one row per suggestion sent from the resident app (POST /api/places/submissions).
--   ref               the reference code the resident is given (R-21) and reads the Hub's decision with (R-23); eight characters in two groups.
--                     It is the only way back to a row: residents have no identity (AD-3), so nothing here names, counts or can reach the person.
--   kind              `add` (a place that is missing, R-19) or `correct` (a listed provider, R-22: `provider_id` and the name the resident saw,
--                     `changes` holds only the fields they changed).
--   lang              the page language it was sent from: the Hub reads the words in it, the decline reason is shown in it.
--   type .. languages the answers of R-19 for a new place: an official service or a community offer, the name, the one sentence, where
--                     (`location`: a pin, a building of the register or an address), and the optional kind, phone, website, cost, ID, step-free
--                     and languages. Text is what the resident typed; it is shown to Hub staff and, by the code, to whoever holds the code.
--   status            `pending` until a Coordinator or an Admin accepts or declines it (O-09, O-10), once. A decline names one of O-10's
--                     pre-written reasons (`decline_reason`), which the resident reads in their language; `decline_note` is the Hub member's own
--                     note for the Hub's record and is never shown to the resident nor audited.
--   applied_at/by     an accepted suggestion waits on the Providers page until an Admin has added it to the catalogue (a new provider, or the
--                     correction applied): the listing text changes only through the catalogue scripts (AD-11), so acceptance never writes a
--                     provider row; "Done" there sets these two, once.
--   decided_by, applied_by are staff_account ids; the audit trail (`submission.accepted`, `submission.declined`, `submission.applied`) records
--   the same with the row's id, never its text.
--
-- The client's address is not stored: the route counts a keyed hash of it in `rate_limit` (scope `place_submission`), as search and sign-up do.
--
-- The app (cvh_app) reads and inserts rows and may update only the decision columns; a guard keeps a decision and an application once made.
-- Supabase's default privileges grant every new table to anon, authenticated and service_role, so each is taken back.

create table place_submission (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  kind text not null,
  lang text not null,
  type text,
  name text not null,
  what text,
  location jsonb,
  category text,
  phone text,
  web text,
  cost text,
  id_required text,
  step_free text,
  languages text[],
  provider_id text,
  changes jsonb,
  status text not null default 'pending',
  decline_reason text,
  decline_note text,
  decided_by uuid,
  decided_at timestamptz,
  applied_by uuid,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  constraint place_submission_ref_format check (ref ~ '^[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$'),
  constraint place_submission_kind check (kind in ('add', 'correct')),
  constraint place_submission_lang_format check (lang ~ '^[a-z]{2,3}(-[A-Za-z]{2,8})?$'),
  constraint place_submission_type check (type is null or type in ('official', 'offer')),
  constraint place_submission_name_length check (char_length(name) between 1 and 200),
  constraint place_submission_what_length check (what is null or char_length(what) between 1 and 140),
  constraint place_submission_location_object check (location is null or jsonb_typeof(location) = 'object'),
  constraint place_submission_category_length check (category is null or char_length(category) <= 100),
  constraint place_submission_phone_length check (phone is null or char_length(phone) <= 40),
  constraint place_submission_web_length check (web is null or char_length(web) <= 200),
  constraint place_submission_cost check (cost is null or cost in ('free', 'low', 'fee', 'notSure')),
  constraint place_submission_id_required check (id_required is null or id_required in ('yes', 'no', 'notSure')),
  constraint place_submission_step_free check (step_free is null or step_free in ('yes', 'no', 'notSure')),
  constraint place_submission_provider_id_format check (provider_id is null or provider_id ~ '^[A-Z][0-9]{3,6}$'),
  constraint place_submission_changes_object check (changes is null or jsonb_typeof(changes) = 'object'),
  -- A new place has its type, its sentence and where; a correction names the provider and what changed, and nothing of a new place's form.
  constraint place_submission_add_shape check (kind <> 'add' or (type is not null and what is not null and location is not null and provider_id is null and changes is null)),
  constraint place_submission_correct_shape check (kind <> 'correct' or (provider_id is not null and changes is not null and type is null and location is null)),
  constraint place_submission_status check (status in ('pending', 'accepted', 'declined')),
  constraint place_submission_decided_when_not_pending check ((status = 'pending') = (decided_at is null) and (decided_at is null) = (decided_by is null)),
  constraint place_submission_reason_when_declined check ((status = 'declined') = (decline_reason is not null)),
  constraint place_submission_decline_reason check (decline_reason is null or decline_reason in ('advert', 'noLocation', 'duplicate', 'unclear', 'outOfArea', 'notCommunity')),
  constraint place_submission_note_when_declined check (decline_note is null or (status = 'declined' and char_length(decline_note) between 1 and 300)),
  constraint place_submission_applied_when_accepted check ((applied_at is null) = (applied_by is null) and (applied_at is null or status = 'accepted'))
);
-- The queue (O-08) reads the waiting ones oldest first; the Providers page reads the accepted ones not yet applied.
create index place_submission_pending_idx on place_submission (created_at) where status = 'pending';
create index place_submission_to_apply_idx on place_submission (decided_at) where status = 'accepted' and applied_at is null;
create index place_submission_decided_idx on place_submission (decided_at);
alter table place_submission enable row level security;

revoke all on table place_submission from public, anon, authenticated, service_role;
grant select, insert on table place_submission to cvh_app;
grant update (status, decline_reason, decline_note, decided_by, decided_at, applied_by, applied_at) on table place_submission to cvh_app;
create policy place_submission_app_select on place_submission for select to cvh_app using (true);
create policy place_submission_app_insert on place_submission for insert to cvh_app with check (true);
create policy place_submission_app_update on place_submission for update to cvh_app using (true) with check (true);

-- A suggestion is decided once (pending -> accepted or declined) and an accepted one applied once; nothing else of a row ever changes, whoever
-- writes (the column grants already keep the app to the decision columns).
create function place_submission_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'pending' and (new.status, new.decline_reason, new.decline_note, new.decided_by, new.decided_at)
     is distinct from (old.status, old.decline_reason, old.decline_note, old.decided_by, old.decided_at) then
    raise exception 'place_submission: a decision is made once' using errcode = 'check_violation';
  end if;
  if old.applied_at is not null and (new.applied_at, new.applied_by) is distinct from (old.applied_at, old.applied_by) then
    raise exception 'place_submission: an accepted suggestion is applied once' using errcode = 'check_violation';
  end if;
  if (new.id, new.ref, new.kind, new.lang, new.type, new.name, new.what, new.location, new.category, new.phone, new.web, new.cost,
      new.id_required, new.step_free, new.languages, new.provider_id, new.changes, new.created_at)
     is distinct from (old.id, old.ref, old.kind, old.lang, old.type, old.name, old.what, old.location, old.category, old.phone, old.web, old.cost,
      old.id_required, old.step_free, old.languages, old.provider_id, old.changes, old.created_at) then
    raise exception 'place_submission: what was sent never changes' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke all on function place_submission_guard() from public, anon, authenticated, service_role;
create trigger place_submission_guard before update on place_submission for each row execute function place_submission_guard();
