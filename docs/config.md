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

| `MAP_TILE_URL` | no (the CARTO key in it is a public browser key, but it is not stored in the repository) | `https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}.png?key=…` (CARTO Positron, confirmed by IT); production and preview. The code's keyless default is a fallback whose legacy access ends 2026-11-30 | 2026-10-02 |
| `MAP_TILE_SUBDOMAINS` | no | empty (the keyed URL has no `{s}`); the default `abcd` applies only to the keyless fallback | 2026-10-02 |
| `MAP_TILE_ATTRIBUTION`, `MAP_TILE_ATTRIBUTION_URL` | no | `© OpenStreetMap contributors © CARTO`, `https://carto.com/attributions`; required whenever `MAP_TILE_URL` is set | 2026-10-02 |
| `MAP_TILE_MAX_ZOOM` | no | default `19` | default |
| `MAP_TILE_CACHEABLE`, `MAP_TILE_CACHE_DAYS`, `MAP_TILE_CACHE_LIMIT` | no | `true` and `30` set in production and preview (`MAP_TILE_CACHEABLE=true` is needed with a custom `MAP_TILE_URL`: a set URL is treated as a new provider and is not cacheable unless said; 30 days is CARTO's limit, 7 for Stadia); the limit stays the default `200` (the phone never keeps more than 200) | 2026-10-02 |

The `MAP_TILE_*` variables choose the resident map's tile provider (S02.07; the comparison and IT's confirmation of CARTO
Positron are in the spine's "Map Tile Provider (S02.07)" record). They are read when the map pages are built, so a change
takes effect with the next deploy, and the same values may be set in Preview. A set value that is not valid fails the
build, naming the variable (`src/platform/config/mapTiles.ts`). The two `EMBED_PUBLISH_ALLOWANCE_*` variables and the `SEARCH_*` variables take effect once S03.02
(release search data) is deployed; `SEARCH_QUESTION_ROUTE` once S03.05 is, and only where `COHERE_API_KEY` is set. Twilio, `SMS_TEST_ALLOWLIST` and `COHERE_API_KEY` must not be set
in Preview or Development: start-up fails there.

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
translation and nothing older is reused.

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
