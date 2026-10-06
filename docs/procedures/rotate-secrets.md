# Rotating secrets

**Owner:** IT lead (a Hub Admin does the Hub steps)
**Last reviewed:** 2026-10-06

Secrets live in Vercel's production environment, the Supabase project's Vault and GitHub's environments, never in the repository, a chat or an email (AD-15). They are rotated **at pilot start**, **when anyone who held one leaves**, and **at pilot end**. Write each rotation in the rotation record at the end of this page: the date, which secret, who, never the value.

## The secrets

| Secret | Where it is kept | How to rotate it |
| --- | --- | --- |
| `JOB_SECRET` | Vercel production; the Vault as `cvh_job_secret` (pg_cron reads it) | Set `JOB_SECRET_PREVIOUS` to the old value and `JOB_SECRET` to a new one (`openssl rand -hex 32`) in Vercel and redeploy; in the Supabase SQL editor run `select vault.update_secret((select id from vault.secrets where name = 'cvh_job_secret'), '<new value>')`; check the heartbeat answers 200 two minutes later; remove `JOB_SECRET_PREVIOUS` and redeploy. |
| `TWILIO_AUTH_TOKEN` | Vercel production | As `docs/config.md` says ("Rotating the Twilio Auth Token"). Twilio signs its status callbacks and inbound texts with the primary token and the app accepts one token only, so: (1) the Hub Admin on call pauses texts with the reason "Twilio token rotation" ([pausing and resuming](pause-and-resume-texts.md)); (2) in the Twilio Console create the secondary auth token; (3) in the same minute, promote the secondary to primary in Twilio and set it as `TWILIO_AUTH_TOKEN` in Vercel, and redeploy; (4) once the deploy is live, check the health banner shows no "Twilio refused the CVH sign-in" or "signature check" line and the heartbeat answers 200; (5) the Admin resumes texts. Until the deploy is live, a status callback or an inbound text signed with the new token is refused and never resent: the text it was about becomes `unknown` after 24 hours (check before resending, it may have arrived), and an inbound STOP, YES or menu reply in that window is lost, so IT reads that window's inbound messages in Twilio's logs (Monitor, Logs, Messaging) and the Hub follows each one up. |
| `SUPABASE_SECRET_KEY` | Vercel production; GitHub `production` environment | In Supabase, Project Settings, API Keys, create a new secret key; set it in Vercel (redeploy) and in GitHub; then delete the old key. Current sign-in failure counts and rate-limit counts are forgotten (they are keyed with it), which is harmless. |
| `DATABASE_URL` (the app's login `cvh_app_login`) | Vercel production; GitHub `production` as `SEARCH_TEST_DATABASE_URL` | At a quiet time (texts are held while the app cannot connect), in the SQL editor `alter role cvh_app_login password '<new>'`; update both secrets; redeploy; check the heartbeat answers 200. |
| `PRODUCTION_DATABASE_URL` (the `postgres` login, migrations) | GitHub `production` | Supabase, Project Settings, Database, reset the database password; update the GitHub secret. pg_cron is not affected. |
| `COHERE_API_KEY` | Vercel production; GitHub `production` | In Cohere's dashboard create a new production key with the spend limit; set it in Vercel (redeploy) and GitHub; delete the old key. |
| `VERCEL_TOKEN` | GitHub `production` and `preview` | Create a new personal token of a Vercel team member, scoped to the team; replace both secrets; delete the old token. |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | GitHub `production` and `preview` (and the Vault and the uptime monitor, if deployment protection covers production) | Regenerate it in Vercel's deployment protection settings; replace it everywhere it is kept. |
| `STAFF_PASSWORD_PEPPER` | Vercel production | **Not rotated while staff accounts exist** (`docs/config.md`): a new pepper makes every staff password stop working until each is re-issued, and once setup is finished no tool re-issues an Admin's password without an Admin who can sign in. Set it once before the first Admin is created. If it may have leaked, treat it as an incident with the owner. |

Kept as secrets but not rotated: `TWILIO_ACCOUNT_SID`, `TWILIO_MESSAGING_SERVICE_SID` and `TWILIO_FROM_NUMBER` (`docs/config.md` marks them secret, and they stay in Vercel's production environment only). They are identifiers, not credentials: nothing can be done with them without the auth token, and they cannot be changed without a new account, service or number, so rotating the auth token is what protects them. Not secrets at all: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `PUBLIC_BASE_URL` and the CARTO browser key in `MAP_TILE_URL`. Local copies of the production environment (`.env.production.local`, pulled for a script) are deleted after use.

After any rotation: check `GET /api/health/heartbeat` answers 200, the Hub shows no health banner, and a test text (a drill on the roster, or the service check) works.

## At pilot start (IT lead)

1. Give every secret in the table a new value made for production, so nothing used while building the pilot still works (the pepper is set once, here, before the first Admin is created).
2. Check who holds each account: the Vercel team, the Supabase organisation, the Twilio account and subaccount users, the Cohere account, the GitHub repository's admins and environment reviewers, and the uptime monitor. Remove anyone who does not need it.
3. Record the rotation below.

## When someone leaves

1. **Same day, a Hub Admin, on People** (`/staff/people`): **Reset a password** for the person (they are signed out on every device; the new starting password is never given to anyone and expires in 24 hours), and for an Admin or Coordinator also **Reset an authenticator**. The pilot has no Remove button on People: note the person in the rotation record so the account is removed once the screen exists.
2. A Hub Admin removes their phone from **On-call numbers** and from the **Drill roster**, and from the uptime monitor's email list (IT).
3. IT removes them from Vercel, Supabase, Twilio, Cohere, GitHub and the uptime monitor.
4. IT rotates every secret in the table they could have seen (anyone who pulled the production environment, or had Vercel, Supabase, Twilio, Cohere or GitHub admin access, could see all of them).
5. Record it below.

## At pilot end (IT lead, after the purge, S09.08)

1. Rotate or revoke every secret in the table. If the CVH continues to the MVP, new values; if it stops, revoke the keys and tokens (Twilio, Cohere, Supabase, Vercel) and stop the pg_cron jobs.
2. Reset the password and authenticator of every staff account that does not continue.
3. Review the account holders as at pilot start.
4. Record it below, and in the final report (S09.08).

## Rotation record

| Date | Which secrets | Why (start, departure, end, suspected leak) | Who | Checked |
| --- | --- | --- | --- | --- |
| | | | | |
