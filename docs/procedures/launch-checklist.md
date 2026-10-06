# Launch checklist

**Owner:** IT lead (production settings and jobs) with the Hub Admin lead (rehearsals and sign-off)
**Last reviewed:** 2026-10-06

Everything that must be true in production before residents rely on the CVH for alerts. Tick each line with the date and who did it. Secret values are never written here: only that they are set and where (`docs/config.md` holds the names and rules). Launch is the day `RESIDENT_ALERTS_ENABLED` is turned on and `cvh-dispatch` is scheduled; the items above that line can be done earlier.

## 1. Vercel production settings ([config](../config.md#vercel-production-environment-variables))

| Item | Done | By |
| --- | --- | --- |
| `JOB_SECRET` set (32+ random bytes, a Vercel Secret) | 2026-10-06 | Claude for the product owner |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `TWILIO_MESSAGING_SERVICE_SID` set | | |
| `SMS_MODE=live` | | |
| `COHERE_API_KEY` is the launch key, with a spend limit set on the key in Cohere | | |
| `RESIDENT_ALERTS_ENABLED=true` (the launch switch, S04.08): last, on launch day | | |

## 2. Supabase scheduled jobs (SQL editor, as `postgres`; [config](../config.md))

| Item | Done | By |
| --- | --- | --- |
| Vault secrets `cvh_job_base_url` and `cvh_job_secret` (the same value as Vercel's `JOB_SECRET`) | 2026-10-06 | product owner |
| `cvh-health` (every minute); the heartbeat answers 200 | 2026-10-06 | product owner |
| `cvh-expire` (every minute) | 2026-10-06 | product owner |
| `cvh-subscriber-measures` (05:05 UTC daily) | 2026-10-06 | product owner |
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
| Directory published (the current release on the Directory page) | 2026-10-04 (release 8) | product owner |
| Terms published (until then production's sign-up page is a 404 and the endpoint answers 503) | | |
| Staff accounts made, Admins with an authenticator | | |
| At least one number on the On-call numbers page (once texting is live, no alert but a drill can be approved without one) | | |
| Drill roster set ([running a drill](run-a-drill.md)) | | |

## 6. Launch rehearsals ([rehearsal log](rehearsals.md))

| Item | Done | By |
| --- | --- | --- |
| The four launch rehearsals each have a row marked "worked" in the rehearsal log | | |
| The outside monitor's rehearsal (section 4) worked | | |

## Sign-off

| | Date | Name (role) |
| --- | --- | --- |
| Every line above is done or marked n/a | | IT lead |
| Launch approved | | Hub Admin lead |
