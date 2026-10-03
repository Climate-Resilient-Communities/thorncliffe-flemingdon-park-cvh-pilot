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
| `EMBED_PUBLISH_ALLOWANCE_CALLS_PER_MONTH` | no | `500` | 2026-10-02 |
| `EMBED_PUBLISH_ALLOWANCE_TOKENS_PER_MONTH` | no | `1000000` | 2026-10-02 |
| `COHERE_API_KEY` | yes | production only, with a spend limit set on the key in Cohere | not yet |
| `SEARCH_THRESHOLD` | no | default `0.3` (provisional until S03.07) | default |
| `SEARCH_EMBED_MODEL` | no | default `embed-v4.0` | default |
| `SEARCH_EMERGENCY_CATEGORIES` | no | default `Support & Emergency Services` | default |

The two `EMBED_PUBLISH_ALLOWANCE_*` variables and the `SEARCH_*` variables take effect once S03.02
(release search data) is deployed. Twilio, `SMS_TEST_ALLOWLIST` and `COHERE_API_KEY` must not be set
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

## Supabase (Auth settings)

- JWT expiry: `43200` seconds (12 hours).
- Password policy and TOTP MFA turned on.

## Twilio

- Toll-free verification and its compliance profile are required before texts from the toll-free
  number are delivered; until then sends fail with error 30032.
