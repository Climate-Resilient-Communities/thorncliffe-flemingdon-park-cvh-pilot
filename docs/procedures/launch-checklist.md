# Launch checklist

**Owner:** IT lead (production settings and jobs) with the Hub Admin lead (rehearsals and sign-off)
**Last reviewed:** 2026-10-08 (after the production SIT of that day: lines it confirmed are ticked "Claude (SIT)")

Everything that must be true in production before residents rely on the CVH for alerts. Tick each line with the date and who did it. Secret values are never written here: only that they are set and where (`docs/config.md` holds the names and rules). Launch is the day `RESIDENT_ALERTS_ENABLED` is turned on and `cvh-dispatch` is scheduled; the items above that line can be done earlier.

## 1. Vercel production settings ([config](../config.md#vercel-production-environment-variables))

| Item | Done | By |
| --- | --- | --- |
| `JOB_SECRET` set (32+ random bytes, a Vercel Secret) | 2026-10-06 | Claude for the product owner |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `TWILIO_MESSAGING_SERVICE_SID` set | 2026-10-08 (set by 2026-10-06, Production only; untested until toll-free verification passes) | Claude (SIT) |
| `SMS_MODE=live` (SIT 2026-10-08: the variable is set, Production only; its value was not read, so confirm it is `live` and tick) | | |
| `COHERE_API_KEY` set (Production only; live searches answer) | 2026-10-08 (set by 2026-10-02) | Claude (SIT) |
| `COHERE_API_KEY` is the launch key, with a spend limit set on the key in Cohere (not visible from the app: check in Cohere's dashboard) | | |
| Cohere asked whether its ~1,000 calls a month per model also applies to `embed-v4.0` on the key, and the answer recorded here. The search embedding has **no app-side monthly stop**: `SEARCH_EMBED_MONTHLY_CALLS` (default 1000) only warns ops at 80% (`search.leg_failed` `embed_quota_near`), and past a vendor cap every search answers "unavailable" ([config](../config.md#the-search-embeddings-monthly-budget)). Until Cohere answers, check the dashboard's usage per model (`embed-v4.0`, `rerank-v3.5`, both translate models) **once a month**, and in the first week after launch | | Product owner |
| `RESIDENT_ALERTS_ENABLED=true` (the launch switch, S04.08): last, on launch day | | |

## 2. Supabase scheduled jobs (SQL editor, as `postgres`; [config](../config.md))

| Item | Done | By |
| --- | --- | --- |
| Vault secrets `cvh_job_base_url` and `cvh_job_secret` (the same value as Vercel's `JOB_SECRET`) | 2026-10-06 | product owner |
| `cvh-health` (every minute); the heartbeat answers 200 | 2026-10-06 | product owner |
| `cvh-expire` (every minute) | 2026-10-06 | product owner |
| `cvh-subscriber-measures` (05:05 UTC daily) | 2026-10-06 | product owner |
| `cron.log_run` is on, checked as `postgres` (the app's login cannot read the `cron` schema): `show cron.log_run;` and `select count(*) from cron.job_run_details where start_time > now() - interval '1 hour';` returns more than 0. If it is off, `health_job_failures` sees only the HTTP jobs' failures, not a failed SQL-only job (the purges) (SIT 2026-10-08, O3: the run history looked empty) | | |
| **The app's database password rotated before any phone number is stored** (SIT 2026-10-08, F1: it is short and guessable, and the pooler is public): as `postgres`, `alter role cvh_app_login password '…'` with 32 random bytes (`openssl rand -hex 32`); then `DATABASE_URL` in Vercel (Production **and** Preview), `SEARCH_TEST_DATABASE_URL` in GitHub `production`, a redeploy, the heartbeat answers 200, and a line in the [rotation record](rotate-secrets.md#rotation-record) | | IT lead |
| `cvh-messaging-config` (daily; needs the Twilio settings above) | | |
| `cvh-reconcile-spend` (daily; needs the Twilio settings above) | | |
| `cvh-dispatch` (every minute): on launch day, after Twilio is set and tested | | |
| Not at launch: `cvh-campaign-end` and `cvh-end-of-pilot-purge` belong to [the end of the pilot](end-of-pilot.md) | n/a | |

Check with `select jobname, schedule, active from cron.job order by jobname;`.

## 3. Twilio Messaging Service ([changing Messaging Service settings](messaging-service-change.md))

| Item | Done | By |
| --- | --- | --- |
| Advanced Opt-Out on | | |
| Inbound webhook `PUBLIC_BASE_URL/api/twilio/inbound` (POST) | | |
| **YES is not an opt-in (START) keyword**, tested on the verified number (a YES must reach the CVH and confirm a sign-up) | | |
| Smart Encoding off | | |
| Toll-free verification approved (until then every text fails with 30032) | | |
| **No status callback URL** on the Messaging Service itself (the app sets the callback on each message) | | |
| Geo permissions: **Canada only** | | |
| SMS pumping protection **on** | | |
| Sender pool: the verified toll-free number (`TWILIO_FROM_NUMBER`) only | | |
| After the two lines above, `/api/jobs/messaging-config` run once (or `cvh-messaging-config` scheduled) and it reads both settings as set: the field names it reads are an unverified assumption ([config](../config.md)) | | |

## 4. The outside uptime monitor ([config: "The outside check"](../config.md))

The only alarm that still works when Vercel, Supabase or Twilio is down: the Hub's banner and the on-call texts both run inside the CVH.

| Item | Done | By |
| --- | --- | --- |
| Monitor account created by IT, owned by a shared IT or Hub address, not a person | | |
| HTTP(S) monitor on `https://project-6qcs4.vercel.app/api/health/heartbeat`: GET, 10 s timeout, anything but 200 is down, alert after **2 failures in a row**, emails every on-call Admin, and again on recovery | | |
| Interval **1 minute** (the spec's 5-minute promise; a 3- or 5-minute free plan does not meet it, so either pay for 1 minute or record the product owner's decision to accept the slower one here) | | |
| The alert email includes the response body (`health_job_stale`, `provider_auth`, `database_unreachable`) if the plan allows; otherwise one keyword monitor per code | | |
| The service's name recorded in the spine (AD-23, "As built (S09.01)") | | |
| Rehearsed: `cvh-health` stopped, the heartbeat answers 503, every on-call Admin gets the email within 5 minutes; then restarted, 200 again and the recovery email arrives ([config](../config.md)). A failed rehearsal blocks launch | | |

## 5. Content and people

| Item | Done | By |
| --- | --- | --- |
| Directory published (the current release on the Directory page) | 2026-10-08 (release 9, published 2026-10-07, complete and current, 99 providers, files served) | Claude (SIT); published by the product owner |
| Terms published (until then production's sign-up page is a 404 and the endpoint answers 503) | 2026-10-08 (`2026-10-07.1`; `/en/terms` and `/en/text-alerts` answer 200). Sign-up is therefore open: keep the page unadvertised until section 3 is done | Claude (SIT) |
| Staff accounts made, Admins with an authenticator | | |
| At least one number on the On-call numbers page (once texting is live, no alert but a drill can be approved without one) | | |
| Drill roster set ([running a drill](run-a-drill.md)) | | |
| Search launch readiness met (S03.08): `npm run search-test-set -- coverage --launch` and `npm run search-test-set -- readiness` both exit 0, i.e. the full test set has no coverage gap, the Hub has approved `data/search-test-set/bar.json`, and the latest evaluation report meets every minimum ([the search test set](../../data/search-test-set/README.md)). Each language whose first measurement is below what the Hub would accept is listed under this line with its action and owner | | Hub Director with the IT lead |
| The search guard can measure (S03.09), set up once the Hub approves `bar.json`: in GitHub, **Settings → Environments → `search-guard`**, with the product owner as required reviewer (each measuring run waits for approval before it spends Cohere calls), deployment branches: all, the secrets `SEARCH_TEST_DATABASE_URL`, `COHERE_API_KEY` and `SUPABASE_SECRET_KEY` (production's values) and the variable `NEXT_PUBLIC_SUPABASE_URL` | | Product owner with the IT lead |
| Native readers have checked the search's crisis-phrase lists (`src/modules/directory/domain/crisisPhrases.ts`, safety-relevant: a question that describes an emergency puts the 911 block first). Every list but English is machine-assisted: for each of es, fr, sk, hi (with romanized Hindi, Urdu, Punjabi and Gujarati), ur, prs, ps, bn, ta, pa, gu, el, zh and tl, a reader of the language adds what residents would type for a clear emergency, removes what an ordinary question would say, adds examples of both to `crisisPhrases.test.ts`, and records the date and their name here (or in the PR that changes the list) | | Hub, with an ambassador or reviewer for each language |

## 6. Launch rehearsals ([rehearsal log](rehearsals.md))

| Item | Done | By |
| --- | --- | --- |
| The four launch rehearsals each have a row marked "worked" in the rehearsal log | | |
| The outside monitor's rehearsal (section 4) worked | | |

## 7. GitHub repository

| Item | Done | By |
| --- | --- | --- |
| `main` protected (a branch protection rule or a ruleset): the `Checks` status required, pull requests required, no force pushes or deletions (SIT 2026-10-08, F2; `Checks` is the one job to require, [config](../config.md#github-environments)) | | Product owner |
| Secret scanning and push protection on (free for a public repository), and optionally Dependabot security updates | | Product owner |

## 8. After the pilot (MVP): not launch blockers

The product owner decided on 2026-10-09 that residents see every translation, unlabelled, for the pilot
(`CATALOGUE_PILOT_MACHINE_TRANSLATIONS`, default on; [config](../config.md#translations-residents-see-catalogue_pilot_machine_translations)).
These items are what that decision deferred. They are not ticked for launch.

| Item | Done | By |
| --- | --- | --- |
| **Native-reader review of the translations, safety-critical first.** A reader of each launch language reviews, in this order: (1) the 911 texts (`number.911.*`, every guide's `when911`; `npm run seed:guides -- --launch-check` lists those without a reviewed translation), the emergency roles ("How they can help") and the descriptions of the safety-critical providers (an emergency role, "Support & Emergency Services", or a crisis or emergency line: the provider seed's report counts them); (2) the guides and the essential numbers, and the tailored alert advice lines (`tailored.*` in `design/prototype/cvh/strings.<lang>.screens.js`: the per-group advice under an alert, machine-assisted by Claude on 2026-10-09, safety-adjacent); (3) the terms; (4) the other provider descriptions, category and subcategory names. Each review is recorded in the translation files (`scripts/review_translations.py`: reviewer and date) and loads as `reviewed` | | Hub, with a reader for each language |
| Decide, with the reviews done, whether to set `CATALOGUE_PILOT_MACHINE_TRANSLATIONS=off` (reviewed-only again, with the "Not yet available in this language" note for the rest) or to keep unreviewed machine text and bring back a visible label, and record the decision in the spine (AD-11) | | Product owner |
| The translations the facts check keeps out (the provider seed's "Not loaded ... facts" line, by language) fixed in the translation files, so the seed reports none | | Translation owner |

## Sign-off

| | Date | Name (role) |
| --- | --- | --- |
| Every line above is done or marked n/a | | IT lead |
| Launch approved | | Hub Admin lead |
