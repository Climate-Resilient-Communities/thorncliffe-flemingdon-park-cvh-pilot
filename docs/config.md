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
| `TWILIO_MESSAGING_SERVICE_SID` | yes | production only; the Messaging Service (`MG…`) on the verified toll-free number that every sender request goes through (S06.02). With `SMS_MODE=live` and no Messaging Service the dispatcher refuses to run and claims nothing (`/api/jobs/dispatch` answers 503) | not yet |
| `JOB_SECRET` | yes | production only; 32+ random bytes (`openssl rand -hex 32`). The bearer secret of the job routes pg_cron calls (`/api/jobs/dispatch`, `/api/jobs/messaging-config`); the same value is in the project's Vault (see "Messaging sender"). Until it is set the job routes answer 503 and run nothing | not yet |
| `JOB_SECRET_PREVIOUS` | yes | only during a rotation: the old secret, accepted next to `JOB_SECRET` until the Vault holds the new one (AD-15); remove it afterwards | no |
| `SMS_SEGMENTS_PER_SECOND` | no | the shared send pace, a whole number from 1 to 100; default `3` (Twilio's default toll-free rate). Leave it at the default until Twilio confirms a higher rate for the number | default |
| `SMS_TEST_ALLOWLIST` | no, but never in the repository | comma-separated E.164 numbers for the S01.15 test text | in progress |
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

## Messaging outbox (S06.01)

The outbox (`delivery`) adds no environment variable, and nothing in it reads Twilio's credentials or calls a provider: sending is the dispatcher's (next section).
What it fixes in code and in the migration, so changing one is a change to both (`src/modules/messaging/domain/deliveryRules.ts`,
`delivery_purpose_rule()` in `db/migrations/20261003100000_delivery_outbox.sql`, compared by `test/db/delivery.db.test.ts`):

| Module | Purpose of a `transactional` text | Goes to | `send_by` at most |
|---|---|---|---|
| `alerting` | `approver_notice` | `staff` | 30 minutes (proposed) |
| `subscriptions` | `confirmation` | `pending_signup` | 48 hours |
| `subscriptions` | `welcome` | `subscriber` | 24 hours (proposed) |
| `subscriptions` | `menu_reply` | `subscriber` | 30 minutes |
| `subscriptions` | `prompt_reply` | `subscriber` | 30 minutes (proposed) |
| `subscriptions` | `edit_link` | `subscriber` | 30 minutes (proposed) |
| `subscriptions` | `signup_info` | `inbound_reply` | the `inbound_reply` row's `expires_at` (30 minutes) |
| `checkins` | `escalation` | `oncall` | 60 minutes (proposed) |
| `ops` | `oncall_alert` | `oncall` | 30 minutes (proposed) |

The windows marked "proposed" are engineering proposals for the owner to confirm; the others are in the E06 definitions. A text still
queued after its `send_by` is skipped at the hand-off point, not sent late. Logs show a phone number only as its last two digits
(`+*********23`), whichever field it reaches. The sources that give the dispatcher a recipient's number are wired in
`src/app/messaging.ts`; none exists until the stories that create the recipients' tables (S06.05, S06.07, S07.02, S07.04).

## Messaging sender (S06.02)

One dispatcher sends every text, and nothing else calls the SMS provider. It runs two ways: `POST /api/jobs/dispatch`, which pg_cron calls
every minute, and `kickDispatcher()` (`src/app/dispatch.ts`), which the approval calls right after its transaction commits. Both take the
sender lease (one row, 60 seconds, renewed every 20) or exit without claiming, so they can overlap safely. A run sends for 50 seconds at most
(its limit is 60 and it keeps a 10-second margin, which covers the 8 seconds the adapter waits for Twilio's answer and the write of the
outcome), at the shared pace of `SMS_SEGMENTS_PER_SECOND` (default 3), and the next run continues from where it stopped. The run an approval
starts is shorter (20 seconds, so about 10 seconds of sending): it lives inside the approving request's function, after the response, so
that route must export `maxDuration = 60`; pg_cron's next run sends whatever the kick did not. Where the settings are: `SMS_MODE=log` (every environment except production) sends nothing, reads no Twilio
credential and makes each sendable row `skipped_env`; `live` needs `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_MESSAGING_SERVICE_SID`
(all production only). Every request goes through the Messaging Service with `SmartEncoded=false` and the status callback
`PUBLIC_BASE_URL/api/twilio/status?ref={callback_ref}`.

**Scheduling (the owner runs this, once, in production's Supabase SQL editor as `postgres`; nothing in the repository or CI runs it, and it is
never run in a preview).** pg_cron runs in UTC. The job secret is kept in the project's Vault and read when each job runs, so rotating it
does not need the schedule changed:

```sql
-- 1. The production base URL and the job secret, in the Vault (the secret is the same value as Vercel's JOB_SECRET).
select vault.create_secret('https://project-6qcs4.vercel.app', 'cvh_job_base_url');
select vault.create_secret('<the JOB_SECRET value>', 'cvh_job_secret');

-- 2. The dispatcher, every minute.
select cron.schedule('cvh-dispatch', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'cvh_job_base_url') || '/api/jobs/dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cvh_job_secret')),
    timeout_milliseconds := 60000
  );
$$);

-- 3. The Messaging Service check, daily at 11:00 UTC (7:00 in Toronto while daylight time lasts).
select cron.schedule('cvh-messaging-config', '0 11 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'cvh_job_base_url') || '/api/jobs/messaging-config',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cvh_job_secret')),
    timeout_milliseconds := 30000
  );
$$);
```

The routes refuse a request without `Authorization: Bearer <secret>` (401), and answer 503 while no `JOB_SECRET` is set, so a missing secret never leaves a
job open. If Vercel's deployment protection covers the production URL, `net.http_post` needs the protection bypass header too
(`x-vercel-protection-bypass` with the bypass secret kept in the Vault). To rotate: set `JOB_SECRET_PREVIOUS` to the old value and `JOB_SECRET` to a new one in
Vercel and deploy; `select vault.update_secret((select id from vault.secrets where name = 'cvh_job_secret'), '<new value>')`; then remove
`JOB_SECRET_PREVIOUS`. To stop sending without a deploy, pause the texts (Hub, Administration, "Pause texts"; see "Pausing texts" below); to stop the schedule, `select cron.unschedule('cvh-dispatch')`.
The health job (S06.07, `/api/jobs/health`) is scheduled the same way when it exists; it reads `ops_event` and the sender lease's `renewed_at`.

**Messaging Service: Smart Encoding off, and who may change the service.** Smart Encoding replaces characters it thinks are the same (a typographic
quote, an accented letter), which would break the rule that the frozen body goes out byte for byte (AD-21). So it must be off, and every request sets
`SmartEncoded=false` besides. `/api/jobs/messaging-config` reads the service's setting daily and after every recorded change to the service, and
records `messaging.smart_encoding_on` in `ops_event` (severity error) when it is on, which the health job turns into the on-call alert (S06.07); a setting it
cannot read is recorded as `messaging.service_check_failed` (warning), never taken for off. The configuration-control assumption the procedures
(S09.03) repeat: only named Admins change the Messaging Service, texts are paused while they do, and the check is run again before texts resume
(`curl -X POST -H "Authorization: Bearer <JOB_SECRET>" <production URL>/api/jobs/messaging-config`).

**Pausing texts (S06.06).** No variable, secret or schedule is involved: an Admin signed in with the authenticator (`aal2`) opens Hub, Administration,
"Pause texts" (`/staff/texts`), gives the reason and presses "Pause all texts". From that moment the dispatcher claims nothing except texts to on-call
numbers (so a problem with sending is still reported), a text it had already claimed goes back to the queue before it is handed to Twilio, and every Hub
screen shows "Texts are paused" with who, when and why. Texts approved or created while paused wait in the queue. A text that was already handed to Twilio
cannot be recalled: the page says how many had been handed over when the pause was made. "Resume texts" ends the pause; the dispatcher then continues in
the usual order and checks each text again just before it is handed over, so a text of an alert that was corrected, withdrawn or closed meanwhile, or whose
valid-until time has passed, is cancelled or skipped instead of sent (a final alert, and the withdrawal that closed an alert, are still sent). Pausing and
resuming are audited (`sending.paused`, `sending.resumed`); the reason is kept on the switch only while the pause lasts. It is the first thing to do for a
wrong alert, a provider problem, and before anyone changes the Messaging Service.

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

## Supabase (Auth settings)

- JWT expiry: `43200` seconds (12 hours).
- Password policy and TOTP MFA turned on.

## Twilio

- Toll-free verification and its compliance profile are required before texts from the toll-free
  number are delivered; until then sends fail with error 30032.
- The sender (S06.02) sends through one Messaging Service whose sender pool is the verified toll-free number
  (`TWILIO_MESSAGING_SERVICE_SID`). Its Smart Encoding setting must be off (checked daily; see "Messaging sender").
