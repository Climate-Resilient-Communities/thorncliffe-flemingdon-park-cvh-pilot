# Configuration

Where each setting of the pilot lives, who sets it, and the non-secret values chosen. Secret values
are never written here: only their names and where they are kept. The full rules for each variable
are in `src/platform/config/env.ts`.

## Vercel: Production environment variables

| Variable | Secret | Value or rule | Set |
|---|---|---|---|
| `DATABASE_URL` | yes | the app's connection as `cvh_app_login`, transaction pooler (port 6543) | yes |
| `SUPABASE_SECRET_KEY` | yes | Supabase Auth Admin API and the private directory Storage bucket | yes |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | no | the Supabase project | yes |
| `PUBLIC_BASE_URL` | no | `https://project-6qcs4.vercel.app` | yes |
| `STAFF_PASSWORD_PEPPER` | yes | 32+ random bytes (`openssl rand -hex 32`); never change it once staff exist | 2026-10-02 |
| `SMS_MODE` | no | `live` (production only) | in progress |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | yes | production only; the from-number is the toll-free number in E.164 | in progress |
| `SMS_TEST_ALLOWLIST` | no, but never in the repository | comma-separated E.164 numbers for the S01.15 test text | in progress |
| `SMS_PRICE_PER_SEGMENT_CENTS` | no | the price of one text message segment, in cents CAD: a positive number with at most three decimals, no more than 100. The estimated cost of an alert (S04.06) is segments × recipients × this price, rounded up to whole cents, and is always shown as an estimate. PROVISIONAL default `1.5` (about CAD 0.015 a segment): IT confirms it from Twilio's price for Canadian toll-free numbers and sets it here. Any environment may set it | default |
| `EMBED_PUBLISH_ALLOWANCE_CALLS_PER_MONTH` | no | `500` | 2026-10-02 |
| `EMBED_PUBLISH_ALLOWANCE_TOKENS_PER_MONTH` | no | `1000000` | 2026-10-02 |
| `COHERE_API_KEY` | yes | production only, with a spend limit set on the key in Cohere | not yet |
| `SEARCH_THRESHOLD` | no | default `0.3` (provisional until S03.07) | default |
| `SEARCH_EMBED_MODEL` | no | default `embed-v4.0` | default |
| `SEARCH_EMERGENCY_CATEGORIES` | no | default `Support & Emergency Services` | default |
| `SEARCH_EMERGENCY_THRESHOLD` | no | the similarity (0 to 1, no greater than `SEARCH_THRESHOLD`) at which an emergency-category provider among the top 3 of either leg sets `emergency_first` even with no clear match (owner decision 41). Default `0.25`. Read at search time, not recorded on a release | default |
| `SEARCH_QUESTION_ROUTE` | no | `search_question_route` (S03.05): `kind=model` pairs for `ps`, `prs`, `ur`, `romanized_or_mixed`, `ambiguous_arabic` (`kind=off`, or `off` alone, switches the translated-question leg off). Default (provisional): `north-small-translate-09-2026` for `ps`, `prs` and `ur` (native-script Urdu, owner decision 40), `command-a-translate-08-2025` for the other two | default |
| `SEARCH_QUESTION_FALLBACK` | no | The Cohere model the translated-question leg retries with, once, when the routed model answers HTTP 429 (past the vendor's per-month request limit, or a transient rate limit), per kind of question, in the shape of `SEARCH_QUESTION_ROUTE`: `kind=model` pairs for `ps`, `prs`, `ur`, `romanized_or_mixed`, `ambiguous_arabic` (`kind=off` means no retry for that kind, `off` alone for all; a bad value fails start-up). Default (provisional, owner decision 45, 2026-10-03; the addendum's routing table lists Command A Translate as Dari's second choice): `command-a-translate-08-2025` for `prs` and for `ur` (the addendum says Command A Translate does not support writing Urdu, but a question is only read into English, and the owner tested that it does that: "کھانا کہاں ملے گا" gives "Where can I get food?"), and `off` for `ps` (Command A Translate returned Dari for Pashto: turn it on by config only if S03.07's test set shows it reads Pashto well). `romanized_or_mixed` and `ambiguous_arabic` default to `command-a-translate-08-2025` too, which is skipped while their routed model already is that model, so by default they do not retry; they would if `SEARCH_QUESTION_ROUTE` changed. A kind never retries with its routed model. See "When a translation model is past its limit" below | default |
| `SEARCH_FALLBACK_MIN_BUDGET_MS` | no | The least time, in milliseconds (a whole number from 0 to 2200), that must remain of the leg's 2.2 s for the fallback to be tried: a call that cannot finish would only be billed. Default `800` (a translation takes about 0.5 s) | default |
| `SEARCH_TRANSLATE_MONTHLY_CALLS` | no | `model=limit` pairs, for example `north-small-translate-09-2026=1000`: the translation calls the vendor allows that model in a calendar month, so that ops hears before the 429s begin. No default: unset means no warning. A bad value fails start-up. See "When a translation model is past its limit" below | not set |

| `MAP_TILE_URL` | no (the CARTO key in it is a public browser key, but it is not stored in the repository) | `https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}.png?key=…` (CARTO Positron, confirmed by IT); production and preview. The code's keyless default is a fallback whose legacy access ends 2026-11-30 | 2026-10-02 |
| `MAP_TILE_SUBDOMAINS` | no | empty (the keyed URL has no `{s}`); the default `abcd` applies only to the keyless fallback | 2026-10-02 |
| `MAP_TILE_ATTRIBUTION`, `MAP_TILE_ATTRIBUTION_URL` | no | `© OpenStreetMap contributors © CARTO`, `https://carto.com/attributions`; required whenever `MAP_TILE_URL` is set | 2026-10-02 |
| `MAP_TILE_MAX_ZOOM` | no | default `19` | default |
| `MAP_TILE_CACHEABLE`, `MAP_TILE_CACHE_DAYS`, `MAP_TILE_CACHE_LIMIT` | no | `true` and `30` set in production and preview (`MAP_TILE_CACHEABLE=true` is needed with a custom `MAP_TILE_URL`: a set URL is treated as a new provider and is not cacheable unless said; 30 days is CARTO's limit, 7 for Stadia); the limit stays the default `200` (the phone never keeps more than 200) | 2026-10-02 |

The `MAP_TILE_*` variables choose the resident map's tile provider (S02.07; the comparison and IT's confirmation of CARTO
Positron are in the spine's "Map Tile Provider (S02.07)" record). They are read when the map pages are built, so a change
takes effect with the next deploy, and the same values may be set in Preview. A set value that is not valid fails the
build, naming the variable (`src/platform/config/mapTiles.ts`). The two `EMBED_PUBLISH_ALLOWANCE_*` variables and the `SEARCH_*` variables take effect once S03.02
(release search data) is deployed; `SEARCH_QUESTION_ROUTE`, `SEARCH_QUESTION_FALLBACK`, `SEARCH_FALLBACK_MIN_BUDGET_MS` and `SEARCH_TRANSLATE_MONTHLY_CALLS` once S03.05 is, and only where `COHERE_API_KEY` is set. Twilio, `SMS_TEST_ALLOWLIST` and `COHERE_API_KEY` must not be set
in Preview or Development: start-up fails there.

**When a translation model is past its limit.** Cohere answers HTTP 429 ("You are past the per-month request limit for this
model") when a key has used up a model's monthly requests; a transient rate limit is also a 429. The adapter turns the vendor's
error into a class (`quota`, `rate_limited`, `unavailable`, `other`) and nothing of its text: it reads only the `message` of the
response body, never the rest of the body or the error's own text, which may echo the question. On `quota` or `rate_limited`
the leg retries once with the model `SEARCH_QUESTION_FALLBACK` names for that kind of question (same abort signal and 2.2 s
deadline), when at least `SEARCH_FALLBACK_MIN_BUDGET_MS` of the 2.2 s remain, so a resident's Dari or Urdu question still
searches through English; `search_log.translated_leg` is `used` and `spend_event` records the model that answered (a 429 is
not billed and writes no row). Ops sees it as `ops_event` `search.leg_failed` (at most once a minute per reason and model, with
the model id): `translate_quota` means a routed model is past its limit (change the key, the plan or `SEARCH_QUESTION_ROUTE`;
this needs a person, and it is told before the retry, so it is told even when the retry is cut at the deadline),
`translate_fallback_used` means the fallback rescued a question (told once its translation was embedded), and
`translate_failed` is any other vendor failure, including the fallback's and a failure of our own (an adapter that says it was
cancelled when nothing cancelled it, an unexpected exception); a translation refused by a check is not a vendor failure and
writes none. If the fallback fails too, or there is no time or no fallback for that kind of question, the leg is `failed` and
the direct leg answers alone; a fallback that is cut at the 2.2 s deadline gives `timed_out`. The search test-set runner never
falls back, so S03.07 measures the routed models and not whichever answered.

With `SEARCH_TRANSLATE_MONTHLY_CALLS` set, ops is warned before a limit is reached. Each time a translation `spend_event` row is
written for a model that has a limit, the model's translate rows in the current calendar month (America/Toronto, whoever made
them: questions and test-set runs alike) are counted, after the response and in one query, so that no search waits for it. When
the count reaches 80% of the limit, one `ops_event` `search.leg_failed` with reason `translate_quota_near` and the model is
written (its `ms` is 0: no search is behind it): once per model per month per instance, so an instance that restarts may warn
again. It is a warning only: nothing is refused at the limit, and a failed count changes nothing. The count is of calls as this
app made them; the vendor's own count is the one that decides, so set the limit a little under it.

## GitHub: environments

| Environment | Secrets and variables | Rules |
|---|---|---|
| `production` | `VERCEL_TOKEN` (replaced 2026-10-02), `PRODUCTION_DATABASE_URL` (as `postgres`, session pooler, port 5432), `VERCEL_AUTOMATION_BYPASS_SECRET`; variables `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `PRODUCTION_URL` | deploys from `main` only |
| `preview` | `VERCEL_TOKEN` (replaced 2026-10-02), `VERCEL_AUTOMATION_BYPASS_SECRET` | previews only for branches with an open pull request |

`VERCEL_TOKEN` must be a personal token of a member of the Vercel team that owns the project,
scoped to that team: `vercel promote` and `vercel rollback` look up the token's user and fail with
"User not found (404)" otherwise.

The "Seed production" workflow (Actions tab) runs `seed:providers`, `seed:buildings` or
`seed:guides` with `PRODUCTION_DATABASE_URL`, in `dry-run` by default.

### Rolling out a change to what the directory listing shows (for example the AD-11 pilot change, PR #60)

A change to which translations a release carries reaches residents only through a new release. Do it in this order:

1. **Deploy** the change (merge to `main`; production deploys from it). Check that `GET /api/health` returns the
   merged commit as `version`.
2. **Let phones pick up the new app.** No service worker is registered yet, and the app's scripts are content-hashed
   files, so a phone runs the new code from its next page load; only a tab left open keeps the old code until it is
   reloaded. Wait at least 24 hours after the deploy before step 3. An old app version still reads the new release
   (`DirectoryListingV1` did not change), but it shows an unreviewed machine translation with the older "Translated by
   machine" label instead of "Machine-translated; not reviewed by a person", which is why the publish waits. Once a
   service worker is shipped (AD-1), wait until its new version has taken over phones instead (how soon depends on its
   update settings: check them then).
3. **Seed, then publish.** Run "Seed production" with `seed:providers` as a dry run, compare its report with the one
   in the pull request, then run it to apply. Then an Admin presses **Publish directory**. Nothing changes for
   residents until that publish: they keep the current release, built from the earlier seed.
## Translation of alerts (S04.02)

Alerts are translated at submit by the routes in the `translation_route` table (spine AD-10). The routes are not an environment
variable: they are rows, seeded by the migration `20261003010000_translation_route_cache.sql` from the addendum's routing table, and
a change is a later migration. The only secret translation needs is `COHERE_API_KEY` (above), production only: previews and local
runs have no key, and the tests use a fake model.

| Setting | Where it lives | Value | Who changes it |
|---|---|---|---|
| The ordered models of each language | `translation_route.model` by `position` (1 is the first choice) | the addendum's table: Pashto `north-small-translate-09-2026` only; Dari North then `command-a-translate-08-2025`; French, Spanish, Chinese, Greek, Hindi Command A Translate then North; Urdu, Bengali, Tamil, Punjabi North then `tiny-aya-fire`; Tagalog, Slovak North then `tiny-aya-water`; Gujarati `tiny-aya-fire` then North | a migration |
| Each model's attempt timeout | `translation_route.attempt_timeout_ms` | **provisional**: 10 s for each of two models, 20 s for Pashto's one (`source = 'provisional'`) | S04.01's migration, from measured latency (`source = 'measured'`) |
| A language's route deadline | not stored: the sum of its attempt timeouts, at most 30 s | **provisional**: 20 s for every language | follows from the attempt timeouts |
| The check each language's output must pass | `translation_route.eld_code`, `script`, `marker_letters`, `excluded_letters` | spine AD-10 | a migration |
| The prompt's version | `PROMPT_VERSION` in `src/modules/translation/adapters/cohereTranslator.ts` | `1` | the developer who changes the prompt or a language name in it (a test fails until the version and its pinned fingerprint are changed together) |
| The checks' version | `CHECK_LOGIC_VERSION` and `ELD_VERSION` in `src/modules/translation/domain/alertChecks.ts` | `2`, `2.1.0` | the developer who changes how checks are applied, how a model's output is normalised before them (version 2: digits of any script written 0-9, design note D-13) or the `eld` package |
| How long a store is waited for | `STORE_GRACE_MS` in `src/modules/translation/application/alertTranslator.ts` (and `storeGraceMs` in the translator's dependencies, for tests) | 1 s: a cache read that does not answer is a miss, a cache or spend write that does not finish is given up, the routes read that does not answer rejects the translation | the developer, with the submit budget (the longest route deadline plus 5 s) in view: at most four graces follow one another (the routes read; then zh-Hant's converter, its cache read and the final flush of writes) |

The attempt timeouts and deadlines are provisional until S04.01 has measured latency and replaced them by a later migration; they
are re-measured from the per-call times recorded in `spend_event` (kind `translate`, purpose `alert`, no text) after the pilot's
first two weeks and whenever a model or route changes. The translation cache (`translation_cache`) needs no setting: its key holds the
prompt version, the check version and, for zh-Hant, OpenCC's version and configuration, so a change to any of them makes a fresh
translation and nothing older is reused. `CVH_FAKE_TRANSLATOR=sample` (local development and the end-to-end tests only; the
environment check refuses it on Vercel) answers every language with a fixed sample sentence that is not a translation of the alert:
it is cached under a prompt version of its own (`PROMPT_VERSION` followed by `+sample`) and records no spend, so nothing it makes is
ever served under the key of a real model.

## Supabase (Auth settings)

- JWT expiry: `43200` seconds (12 hours).
- Password policy and TOTP MFA turned on.

## Twilio

- Toll-free verification and its compliance profile are required before texts from the toll-free
  number are delivered; until then sends fail with error 30032.
- Smart Encoding must be **off** on the Messaging Service. The approver sees the frozen body and the
  provider must send exactly those bytes; Smart Encoding would rewrite characters after approval and
  change the segment count the estimate was made from (AD-21). E06 reads the setting before sending
  and raises an on-call alert if it is on, and every request also sets `SmartEncoded=false` (the S01.15
  Twilio adapter does; E06's sender keeps it).
