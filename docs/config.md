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
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | yes | production only; the from-number is the toll-free number in E.164 that residents are told to text START to (R-06, S07.02). The auth token (the account's primary one) also checks the signature of Twilio's status callbacks (`/api/twilio/status`, S06.04): without it that route answers 503 and does nothing | in progress |
| `TWILIO_MESSAGING_SERVICE_SID` | yes | production only; the Messaging Service (`MG…`) on the verified toll-free number that every sender request goes through (S06.02). With `SMS_MODE=live` and no Messaging Service the dispatcher refuses to run and claims nothing (`/api/jobs/dispatch` answers 503) | not yet |
| `JOB_SECRET` | yes | production only; 32+ random bytes (`openssl rand -hex 32`). The bearer secret of the job routes pg_cron calls (`/api/jobs/dispatch`, `/api/jobs/messaging-config`, `/api/jobs/health`, `/api/jobs/reconcile-spend`, `/api/jobs/expire`, `/api/jobs/subscriber-measures`, `/api/jobs/campaign-end`, `/api/jobs/end-of-pilot-purge`); the same value is in the project's Vault (see "Messaging sender"). Until it is set the job routes answer 503 and run nothing | 2026-10-06 |
| `JOB_SECRET_PREVIOUS` | yes | only during a rotation: the old secret, accepted next to `JOB_SECRET` until the Vault holds the new one (AD-15); remove it afterwards | no |
| `SMS_SEGMENTS_PER_SECOND` | no | the shared send pace, a whole number from 1 to 100; default `3` (Twilio's default toll-free rate). Leave it at the default until Twilio confirms a higher rate for the number | default |
| `RESIDENT_ALERTS_ENABLED` | no | `false` (also when unset): the launch gate of E04 (S04.08). While it is off the feed (`/api/feed`) returns no threads and no alert page opens, whatever has been approved. The code lock is released as of E05 (`RESIDENT_ALERTS_RELEASED` in `src/platform/config/env.ts` is true), so `true` now starts in production and turns the gate on. The switch is only this Vercel variable: an Admin sets it with a production redeploy and records it in the launch-readiness checklist. Previews and local development run with it on unless it is `false` | default (off) |
| `SMS_PRICE_PER_SEGMENT_CENTS` | no | the price of one text message segment, in cents CAD: a positive number with at most three decimals, no more than 100. The estimated cost of an alert (S04.06) is segments × recipients × this price, rounded up to whole cents, and is always shown as an estimate. PROVISIONAL default `1.5` (about CAD 0.015 a segment): IT confirms it from Twilio's price for Canadian toll-free numbers and sets it here. Any environment may set it. Each text's own estimate in `spend_event` (S06.08) is its segments × this price, rounded up to whole cents | default |
| `SMS_USD_TO_CAD_RATE` | no | the exchange rate, Canadian dollars per US dollar, that a reconciliation (S06.08) converts the prices Twilio reports (billed in US dollars) at: a positive number with at most four decimals, between 0.5 and 5. PROVISIONAL default `1.4`: the owner confirms it and sets it here. Each actual price keeps the rate it was converted at and is shown labelled with it. Any environment may set it (not a `TWILIO_` variable: it is no credential) | default |
| `SMS_TRANSACTIONAL_DAILY_CEILING` | no | the daily ceiling on non-alert (`transactional`) texts, menus and prompts included and the texts to on-call numbers not counted (AD-22, S09.01): more than this many created since midnight in Toronto raises the health job's "daily limit" condition, which texts the on-call Admins once that day and shows on the Hub until midnight; texts keep sending. A whole number of at least 1. PROVISIONAL default `300`: the owner confirms it against the sign-ups expected on the busiest day (a launch event). Any environment may set it | default |
| `EMBED_PUBLISH_ALLOWANCE_CALLS_PER_MONTH` | no | `500` | 2026-10-02 |
| `EMBED_PUBLISH_ALLOWANCE_TOKENS_PER_MONTH` | no | `1000000` | 2026-10-02 |
| `SPEND_PILOT_BUDGET_CENTS` | no | the pilot's budget in whole cents CAD that the Spend page (S07.08) shows spending against: a whole number of at least 1; default `100000` (CAD 1,000). It is a figure to show, not a limit: the monthly cap an Admin sets on the Hub is stored in the database (`spend_cap`). Any environment may set it | default |
| `SPEND_TOKEN_ESTIMATE_CAD_PER_MILLION` | no | an estimate rate, in dollars (CAD) per million tokens, for Cohere usage whose price is unknown (S07.08): a positive number with at most four decimals, at most 10000. Unset, such usage is shown on the Spend page as "price unknown" with its calls and tokens and is left out of the totals (which then say so); set, it is shown as a labelled estimate and counted. Not a `COHERE_` variable (it is no credential), so any environment may set it | not set |
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
(release search data) is deployed; `SEARCH_QUESTION_ROUTE`, `SEARCH_QUESTION_FALLBACK`, `SEARCH_FALLBACK_MIN_BUDGET_MS` and `SEARCH_TRANSLATE_MONTHLY_CALLS` once S03.05 is, and only where `COHERE_API_KEY` is set. Twilio and `COHERE_API_KEY` must not be set
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
the direct leg answers alone; a fallback that is cut at the 2.2 s deadline gives `timed_out`. The production test-set run
(S03.07, below) builds the leg as the app does, so it falls back too; its report lists the model of each translation call and
counts the questions a fallback model translated, and `SEARCH_QUESTION_FALLBACK=off` for the run measures the routed models alone.

With `SEARCH_TRANSLATE_MONTHLY_CALLS` set, ops is warned before a limit is reached. Each time a translation `spend_event` row is
written for a model that has a limit, the model's translate rows in the current calendar month (America/Toronto, whoever made
them: questions and test-set runs alike) are counted, after the response and in one query, so that no search waits for it. When
the count reaches 80% of the limit, one `ops_event` `search.leg_failed` with reason `translate_quota_near` and the model is
written (its `ms` is 0: no search is behind it): once per model per month per instance, so an instance that restarts may warn
again. It is a warning only: nothing is refused at the limit, and a failed count changes nothing. The count is of calls as this
app made them; the vendor's own count is the one that decides, so set the limit a little under it.

## Messaging outbox (S06.01)

The outbox (`delivery`) adds no environment variable, and nothing in it reads Twilio's credentials or calls a provider: sending is the dispatcher's (next section).
What it fixes in code and in the migration, so changing one is a change to both (`src/modules/messaging/domain/deliveryRules.ts`,
`delivery_purpose_rule()` in `db/migrations/20261003400000_delivery_outbox.sql`, compared by `test/db/delivery.db.test.ts`):

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
`src/app/messaging.ts`; the drill roster's (S06.05) and the on-call roster's (S06.07) exist, and the others come with the stories that create the
recipients' tables (S07.02, S07.04). The drill roster's numbers are entered by an Admin on `/staff/drills/roster` in the running system and are never in
the repository or CI.

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
`PUBLIC_BASE_URL/api/twilio/status?ref={callback_ref}` (and Twilio's retry fragment, see "Delivery status callbacks").

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

**The health job (S06.07, S09.01, `/api/jobs/health`).** Every minute it judges every condition of AD-23: texts queued and due for more than 5 minutes
outside a pause; a delivery that became `unknown`, or a text handed off with no outcome for 10 minutes; no renewal of the sender lease for 3 minutes while
texts are due; Smart Encoding found on; more than 5 webhook signature failures in 10 minutes (S06.07); and (S09.01) a scheduled job that failed in the last
10 minutes (a failed run in `cron.job_run_details`, or a job's call in `net._http_response` that did not answer 2xx, timed out or could not connect; pg_net
records no URL, so every failed pg_net call counts, and pg_net must be used for nothing but the jobs' calls to `/api/jobs/`); an alert
submitted with a whole language in English in the last 24 hours; a directory publish that failed with none succeeding since; more non-alert texts today
than `SMS_TRANSACTIONAL_DAILY_CEILING`; a spending cap overrun this month (`spend.cap_overrun`, which S07.08 records); and (S09.01 follow-up)
Twilio refusing the CVH's sign-in (`dispatch.provider_auth_failed`: the sender stops at a 401, or the third 403 in a row) with nothing accepted
since, neither a text nor the daily Messaging Service check (`provider_auth`; its on-call text is itself the next try of the credentials, so a
refusal that passes clears within a few minutes; with no on-call number and no other text, nothing tries again and it holds). It records an `ops_event` (no
personal data) when it texts the on-call Admins and when a condition clears, and queues one text per number on the on-call roster, at most once per
condition per 30 minutes (the daily limit once a day). Every Admin and Coordinator screen names each open condition in plain words until it clears;
everyone else at the Hub sees only "Sending is failing". Each run that judged every condition records the time in `health_heartbeat`, which the heartbeat
below reads. It needs the same `JOB_SECRET` as the other job routes and `SMS_TRANSACTIONAL_DAILY_CEILING` (optional); it works in every environment
(outside production its texts become `skipped_env` like all others). **The owner schedules it, once, in production's Supabase SQL editor as `postgres`, after the Vault secrets of step 1 above exist; this
repository does not apply it, and it is never run in a preview:**

```sql
-- 4. The health job, every minute. The first run before any on-call number exists records its findings and texts nobody.
select cron.schedule('cvh-health', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'cvh_job_base_url') || '/api/jobs/health',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cvh_job_secret')),
    timeout_milliseconds := 60000
  );
$$);
```

To stop it, `select cron.unschedule('cvh-health')`; the heartbeat then answers 503 within 3 minutes and the outside check emails the on-call Admins.

**The heartbeat and the outside check (S09.01).** `GET /api/health/heartbeat` (or `HEAD`) answers 200 with an empty body only if the health job judged
every condition less than 3 minutes ago and Twilio sign-in is not failing; else 503, whose plain-text body (`GET` only; `HEAD` has no body) is one
short code naming what is failing. Always `Cache-Control: no-store` and no cookie; it is public and needs no secret, and says nothing else (no number,
no time, no error text, no id). The codes:

| Body of the 503 | What it means | What IT does first |
| --- | --- | --- |
| `health_job_stale` | The health job has not completed a run for 3 minutes, or never has: pg_cron stopped, the job secret wrong, Vercel down, or the job keeps failing to judge a condition. | Check `cvh-health` in pg_cron and the job's logs (`health.condition_failed`). |
| `provider_auth` | Twilio has refused the CVH's sign-in (HTTP 401, or 403 three times in a row) and accepted nothing since, for at least 10 minutes: no text is being sent, the on-call texts included. | Check the Twilio account (suspended? auth token rotated?) and `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` in Vercel. It clears at the next text Twilio accepts. |
| `database_unreachable` | The database failed, or did not answer in 5 seconds. | Check Supabase's status and the project. |

An app that is down gives no answer at all. A Twilio refusal is debounced: it turns the heartbeat red only after the health job has found it holding
for 10 minutes, and the health job's on-call text, queued as soon as the refusal is found and claimed before every text but a fire alert, is the
next try of the credentials, so one refusal that passes clears within a few minutes and never reaches the monitor. Nothing in the CVH can text
anyone about these, so an uptime monitor outside Vercel, Supabase and Twilio watches it. **IT chooses the monitor and sets it up before launch (nothing in this repository does), and
records its name in the spine (AD-23, "As built (S09.01)"):**

- a free-tier HTTP(S) uptime monitor that is not hosted on Vercel, Supabase or Twilio and does not send through the CVH;
- it requests `https://<production host>/api/health/heartbeat` every minute (a 1-minute interval: one that only offers 3 or 5 minutes does not meet the
  5-minute promise below), with a timeout of 10 seconds, and counts any answer other than 200 (and no answer) as down;
- if the service supports it, its alert email includes the response body, so the email names the cause above (UptimeRobot and Better Stack
  both have keyword or response-body options; IT checks what its plan offers). A monitor that cannot include it still works: any status other
  than 200 is down, and the Hub's banner names the cause;
- it alerts only after **2 failed checks in a row**, and then emails every on-call Admin (the same people as the On-call numbers page; their email
  addresses are kept in the monitor, never in this repository), and emails again when the heartbeat recovers;
- if Vercel's deployment protection covers the production URL, the monitor needs the protection bypass header (as pg_cron does), or the path is
  excluded from protection.

With a 1-minute interval and 2 failures in a row, the email leaves within about 2 minutes of the heartbeat turning 503 (which itself happens within
3 minutes of the job's last complete run), so the on-call Admins hear within 5 minutes of the heartbeat failing.

**The launch rehearsal (before launch, once, with IT and an on-call Admin; recorded in the [launch checklist](procedures/launch-checklist.md)):** in production's SQL editor,
`select cron.unschedule('cvh-health')`; confirm `GET /api/health/heartbeat` answers 503 within 3 minutes and the monitor's email reaches every on-call
Admin within 5 minutes after that; then schedule the job again with statement 4 above, confirm the heartbeat answers 200 within 2 minutes and the
monitor's recovery email arrives. A failed rehearsal blocks launch.

**The expire job (S05.04, `/api/jobs/expire`).** Every minute it closes each open alert thread whose latest published, non-superseded entry is past its
valid-until (compared as UTC instants, so the clock changes cannot move it): in one transaction per thread, under the thread's lock, it adds a web-only system
final ("This alert has expired without a further update. The problem may continue. Contact the Hub for current information.", from the string catalog
`staff.expire.finalText`, in English until it is translated) and closes the thread as `expired`, which residents read as "Expired", never "Resolved". It needs the
same `JOB_SECRET` as the other job routes and no other variable, sends no text and reads no Twilio credential, so it works in every environment. A run closes at most
100 threads; a thread whose transaction fails is rolled back and recorded as an `ops_event` (`alert.expire_failed`, a failure class only), and the next run closes it.
A thread closed more than 5 minutes after its valid-until is recorded too (`alert.expire_late`): it means earlier runs were missed (pg_cron stopped, the app was
down or the route answered an error), which is how a failed pg_cron run shows up in `ops_event` for E09's health job, together with `cron.job_run_details` and
`net._http_response` (pg_net's record of the HTTP answers, which the route's 500 for a run that closed nothing and failed everything it tried also reaches).
A run that fails as a whole (the overdue listing cannot be read) records an `alert.expire_failed` with no thread. A pg_cron run that never reaches the route records
nothing in `ops_event`: finding it from `cron.job_run_details` and `net._http_response` is E09's health job's, and `alert.expire_late` is the later trace.
**The owner schedules it, once, in production's Supabase SQL editor as `postgres`, after the Vault secrets of step 1 above exist; this repository does not apply it,
and it is never run in a preview:**

```sql
-- 5. The expire job, every minute.
select cron.schedule('cvh-expire', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'cvh_job_base_url') || '/api/jobs/expire',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cvh_job_secret')),
    timeout_milliseconds := 60000
  );
$$);
```

To stop it, `select cron.unschedule('cvh-expire')`; threads then stay open past their valid-until until it runs again (residents still read the valid-until).

**On-call numbers (S06.07).** No variable is involved. An Admin signed in with the authenticator opens Hub, Administration, "On-call numbers" (`/staff/oncall`) and
adds each Admin's Canadian mobile number with a name or role (at most 10); only the last four digits are shown afterwards, and no audit record, event or log
holds a number. **Once texts are live** (`SMS_MODE=live`, which is production only, and `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and
`TWILIO_MESSAGING_SERVICE_SID` all set), no alert except a drill can be approved while the list is empty: the approver is told to ask an Admin to add a number.
Until Twilio is set up that rule is off, so the Hub's first Admin can approve alerts with an empty list; **add a number before setting the Twilio variables.**

**Messaging Service: Smart Encoding off, and who may change the service.** Smart Encoding replaces characters it thinks are the same (a typographic
quote, an accented letter), which would break the rule that the frozen body goes out byte for byte (AD-21). So it must be off, and every request sets
`SmartEncoded=false` besides. `/api/jobs/messaging-config` reads the service's setting daily and after every recorded change to the service, and
records `messaging.smart_encoding_on` in `ops_event` (severity error) when it is on, which the health job turns into the on-call alert (S06.07); a setting it
cannot read is recorded as `messaging.service_check_failed` (warning), never taken for off. The configuration-control assumption the procedures
(S09.03) repeat: only named Admins change the Messaging Service, texts are paused while they do, and the check is run again before texts resume
(`curl -X POST -H "Authorization: Bearer <JOB_SECRET>" <production URL>/api/jobs/messaging-config`).

**Messaging Service: Canada-only geo permissions and SMS pumping protection (S07.09, AD-22).** The same daily check reads two more settings: the countries
the service may text must be Canada and nothing else, and SMS pumping protection must be on. When either is not, it records
`messaging.service_settings_wrong` (severity error; the detail says which, as two flags) and the health job's `messaging_settings` condition texts the on-call
Admins once and shows on the Hub until a later check finds both right (`messaging.service_settings_ok`). A setting it cannot read is never taken for right and
never quieter than wrong: it records a `messaging.service_check_failed` warning (the code, and `check: abuse_settings`) and also
`messaging.service_settings_wrong` with `unreadable: true`, so the on-call Admins are texted and the Hub shows it until a check reads both settings as right.
**Launch gate (IT, at the launch rehearsal):** confirm against the production Twilio account where these two settings really live. The adapter
(`readAbuseSettings` in `src/modules/messaging/adapters/twilioMessagingService.ts`) reads the Messaging Service resource's `sms_pumping_protection`
(boolean) and `geo_permissions` (the countries' ISO codes); those field names are an assumption, written without a Twilio account to try them against, and
Twilio may keep geo permissions and pumping protection as account-level settings instead. If the real API names them otherwise or keeps them elsewhere, the
check alerts on-call every day (`pumping_setting_missing` or `geo_setting_missing`) until the one function is corrected; it never passes silently. Do not
launch until a check has read both settings as right.

**Pausing texts (S06.06).** No variable, secret or schedule is involved: an Admin signed in with the authenticator (`aal2`) opens Hub, Administration,
"Pause texts" (`/staff/texts`), gives the reason and presses "Pause all texts". From that moment the dispatcher claims nothing except texts to on-call
numbers (so a problem with sending is still reported), a text it had already claimed goes back to the queue before it is handed to Twilio, and every Hub
screen shows "Texts are paused" with who, when and why. Texts approved or created while paused wait in the queue. A text that was already handed to Twilio
cannot be recalled: the page says how many had been handed over when the pause was made. "Resume texts" ends the pause; the dispatcher then continues in
the usual order and checks each text again just before it is handed over, so a text of an alert that was corrected, withdrawn or closed meanwhile, or whose
valid-until time has passed, is cancelled or skipped instead of sent (a final alert, and the withdrawal that closed an alert, are still sent). Pausing and
resuming are audited (`sending.paused`, `sending.resumed`); the reason is kept on the switch only while the pause lasts. It is the first thing to do for a
wrong alert, a provider problem, and before anyone changes the Messaging Service. The pause stops only texts that have not yet been handed to Twilio, so it says how many had gone, but only for an
alert that still had texts waiting: an alert that had finished sending when the pause was made is not reported (an owner decision is open on that). If the
`messaging_control` row were ever missing, the sender would hold every text and every Hub screen would say "Texts are not going out ... Tell IT."; the
migration makes the row and the app cannot delete it, so that means the database was changed by hand.

## Delivery status callbacks (S06.04)

A text's delivery status (`delivered`, `undelivered`, a late `failed`) comes only from Twilio's status callbacks, `POST /api/twilio/status?ref={callback_ref}`.
Nothing needs to be set in Twilio's console for them: the dispatcher gives every request its own `StatusCallback` URL
(`PUBLIC_BASE_URL/api/twilio/status?ref={callback_ref}`, followed by a `#rc=3&rp=ct,5xx` fragment that asks Twilio to retry a 5xx, see "Retries" below), and Twilio calls that URL
without the fragment. **Do not set a status callback URL on the Messaging Service
itself** that points at this route: its calls carry no `ref`, so each is counted in `ops_event` as `delivery.callback_ignored` (`no_ref`) and none
changes a delivery.

- **What validates a callback.** `X-Twilio-Signature` is checked before anything else, with the account's `TWILIO_AUTH_TOKEN`, against `PUBLIC_BASE_URL` (an
  https origin with no port or path, `https://project-6qcs4.vercel.app` in production) plus the path and query string of the request and the form
  body. The request's own host header is never used. So **changing `PUBLIC_BASE_URL` (a custom domain, for example) changes the URL the app expects Twilio to have signed**:
  a text handed to Twilio before the change calls back to the old URL, whose signature then no longer matches and is refused. Set it once, before the first live send.
  A missing or wrong signature answers 403 and does nothing, and each is recorded as `webhook.signature_invalid` in `ops_event` (at most 50 in any 10 minutes
  are kept, since anyone can send the request; the health job alerts the on-call Admin above 5 in 10 minutes, S06.07). Where no Twilio account is configured
  (every environment but production) the route answers 503 and does nothing.
- **Vercel deployment protection must not cover this route.** Twilio cannot send Vercel's protection-bypass header, so a protected URL answers Twilio with a
  Vercel sign-in page and no callback ever reaches the app: every text would stay `submitted` and become `unknown` after 24 hours. Before the first live send, check from outside:
  `curl -i -X POST https://<production URL>/api/twilio/status` must answer `403` with `{"error":{"code":"invalid_signature"}}` (the app's own answer), not a `401`, a redirect or an HTML page.
- **Rotating the Twilio Auth Token** (at pilot start, on a departure, at pilot end). Twilio signs with the account's primary Auth Token. Promote the secondary
  token and set `TWILIO_AUTH_TOKEN` in Vercel to the same value in the same minute, with texts paused (S06.06): a callback signed with the old token that arrives after the
  deploy is refused (403, counted) and Twilio does not resend it, so its text stays `submitted` and becomes `unknown` after 24 hours (visible, never lost, never resent).
  The app accepts one token only; accepting the previous one for a short window, as the job secrets do, is an owner decision (not built).
- **Retries.** Twilio retries a webhook once, and only on a connection failure, unless the URL says otherwise. So the `StatusCallback` the dispatcher gives every request
  ends in Twilio's connection overrides, `#rc=3&rp=ct,5xx` (nothing to set in the console): up to three retries on a connection failure or any 5xx, never on a 4xx. The route
  answers 500 when its database fails (nothing was changed), so Twilio sends the same callback again; the fragment is not sent and not signed, so nothing else changes, and a
  repeat is harmless. The retries share Twilio's 15 seconds in total: a database that stays down longer loses the callback, and the sweep makes that text `unknown` (after 5 minutes
  if it was never answered, after 24 hours if `submitted`), which the Hub follows up. A 4xx (a refused signature, a body over 64 KiB) is never retried. A 503 (no
  `TWILIO_AUTH_TOKEN` set) is retried too and still does nothing, so a production deployment without the token is a fault to fix, not a state to leave.
- **What the statuses do.** `queued`, `sending`, `sent`, `accepted` and `scheduled` mean `submitted`; `delivered`, `undelivered` and `failed` are final (with Twilio's
  error code kept for the last two). A final status never changes, a repeat or a late non-terminal status changes nothing and is not counted, and a text that was `unknown`
  moves to the callback's status and is marked resolved (`delivery.unknown_resolved`). One exception: a text that was `submitted` and became `unknown` after 24 hours with no
  final status moves only on a final one (a late `sent` changes nothing and is not counted, since the next sweep would only make it `unknown` again). Anything else the route is sent (a status it does not know, no `MessageSid`) is
  counted as `delivery.callback_ignored` and changes nothing.
- **What it never keeps or logs.** The route sets no cookie and is never cached. Nothing from the request is stored or logged: not the number, the message text, the
  signature, the reference or Twilio's message id (a log line holds the delivery's own id and the states). `ops_event` holds codes only.

## What each text costs, and the reconciliation (S06.08)

Each text is counted once, when the provider accepts it or its outcome becomes `unknown` (it may have been charged): its estimate, segments × `SMS_PRICE_PER_SEGMENT_CENTS`
rounded up to whole cents CAD, is written to `spend_event` (kind `sms`, with the language, the alert entry and `is_drill`) in the same transaction as the outcome. A text that
goes back to the queue (HTTP 429, a connection that failed before sending) writes nothing, so a retried text is counted when it is finally accepted.

**The reconciliation** sets what Twilio actually billed against those estimates, month by month. `POST /api/jobs/reconcile-spend` (the job secret, like the dispatcher's) lists the Twilio
Messages API for a Toronto calendar month, `[first instant of the month, first instant of the next)` converted to UTC, with the stable id `month:{YYYY-MM}`, and records each message's
price once, by its `MessageSid`. With no body it reconciles the month before this one, every month still pending and every ended month that has text message estimates but no complete reconciliation (a month the job never reached);
`{"month":"2026-10"}` reconciles that month. Every run first re-runs the matching of estimates to actuals, even when every month is complete, so a late provider id whose own matching failed is recovered by the next daily run. It only reconciles a month
that has ended, and it is idempotent: a complete month is not listed again, and nothing is recorded from a listing that failed, was cut short (200 pages a month, or 45 seconds for the whole run, shared by its months: a month whose turn comes after
the time is spent waits for the next run) or has a message with no price yet: that month shows as "pending reconciliation", with its estimates still counted, and the next run tries again. A pending month is visible in `sms_reconciliation` (`state`, `pending_reason`, `attempts`,
`last_attempt_at`) and in the log (`reconcile.pending`, with the reason). Outside production there is no Twilio account (no credentials exist elsewhere), so the route answers `{"status":"not_live"}`
and reads nothing; the real Twilio adapter is built only for production and every test uses a fake.

**Scheduling (the owner runs this once, in production's Supabase SQL editor as `postgres`; nothing in the repository or CI runs it).** Daily is enough (a complete month costs one query), and the
manual operation "Twilio usage reconciliation, monthly, twice" is the same call by hand a few days after the month ends and again once Twilio has priced the last messages:

```sql
select cron.schedule('cvh-reconcile-spend', '30 11 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'cvh_job_base_url') || '/api/jobs/reconcile-spend',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cvh_job_secret')),
    timeout_milliseconds := 60000
  );
$$);
```

By hand: `curl -X POST -H "Authorization: Bearer <JOB_SECRET>" -d '{"month":"2026-10"}' <production URL>/api/jobs/reconcile-spend` answers each month's result (counts and codes, no message and no number).

**The daily subscriber measures (S07.10, `/api/jobs/subscriber-measures`).** Once a day it stores, for the Toronto day that has just ended, receiving subscribers by state, pending sign-ups,
confirmations and deletions by language and neighbourhood, as counts only (`subscriber_measure`; the Hub's Measures page shows them, a count of 1 to 4 as "Fewer than 5"). It reads no Twilio credential and works in every environment.
The state figures (receiving subscribers, pending sign-ups) are taken at the run and filed under the day that has just ended, and the day's confirmations and deletions are counted up to midnight, so the job runs just after Toronto midnight: 05:05 UTC is 00:05 in winter and 01:05 in summer (pg_cron has no time zone, so one schedule cannot be exact in both; an hour is the most a state figure can be ahead of its day's events). A run that is late or retried is filed under the same day but is taken later, so the gap widens by that delay; a second run on the same day replaces that day's figures. A day on which the job did not run has no subscriber figures. The owner runs this once in production's Supabase SQL editor as `postgres`; nothing in the repository or CI runs it:

```sql
select cron.schedule('cvh-subscriber-measures', '5 5 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'cvh_job_base_url') || '/api/jobs/subscriber-measures',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cvh_job_secret')),
    timeout_milliseconds := 60000
  );
$$);
```

**Owner decisions recorded here (S06.08).**

- *The exchange rate.* `SMS_USD_TO_CAD_RATE`, default `1.4` (provisional). Twilio bills in US dollars; the CAD amount is the price × this rate, to the thousandth of a cent, and each actual keeps the rate it used.
- *Where the reconciliation is triggered.* A job endpoint, not a script: the Twilio credentials exist only in production's environment, so a script run anywhere else would have none, and copying them out is what the secrets rules forbid.
- *Only a month that has ended is reconciled.* A complete reconciliation never changes, so one run while the month still ran would be missing every message sent after it.
- *Rounding.* An estimate is rounded up to whole cents per text, so a one-segment text at 1.5 cents is estimated at 2: an estimate may overstate by less than a cent a text and never understates, until its actual replaces it.
- *A message Twilio never prices.* A month with an outbound message that has no price keeps the whole month pending (its estimates stay counted). If Twilio leaves a failed or cancelled message unpriced for good, the owner decides whether that counts as zero.
- *Before the first real run.* The Twilio adapter follows Twilio's documentation (the date filters `DateSent>` and `DateSent<` as GMT dates `YYYY-MM-DD`, widened by a day on each side because a date cannot say where in its day an instant is, with the exact interval applied afterwards; `next_page_uri`, `price` and `price_unit`) and has been tested only against a fake. IT checks the first real month's count and total against Twilio's usage page.

## Spend against the budget, and the monthly cap (S07.08)

`/staff/spend` ("Spend", Admins and Directors; a Director read-only) shows text message and Cohere spend for this month (Toronto calendar month) and for the pilot to date against
`SPEND_PILOT_BUDGET_CENTS`. Text messages are shown the way S06.08 counts them: the actual where a month's reconciliation is complete, with the unmatched actuals and the unresolved
estimates labelled and shown apart (they may overlap, and the page says so), and a month with no complete reconciliation labelled "pending reconciliation" with its estimates counted. Cohere
usage with a price is shown at it; usage without one is shown as "price unknown" with its calls and tokens, or as a labelled estimate when `SPEND_TOKEN_ESTIMATE_CAD_PER_MILLION` is set,
and a total that leaves such usage out says so. None of it is ever shown as zero.

**The monthly cap** is one row, `spend_cap`. An Admin at `aal2` types it in dollars on the Spend page (the policy action `spend.cap`); it is saved with who set it and when, and audited
(`spend.cap_set`, with the cap afterwards and the one it replaced) in the same transaction. It **warns and never blocks**:

- Before approving, the approval view says when the month's text spending plus the texts still waiting to be sent plus this entry's estimate (each text's own estimate rounded up to a cent, as the
  outbox stores it) would pass the cap, and by how much. Reaching the cap exactly is within it.
- The approval's own transaction judges it again, under the `spend_cap` row's lock (last in AD-18's order, so two approvals that overlap are judged one after the other). If the cap is passed the
  approval still commits and the same transaction records the audit record `spend.cap_overrun` (subject: the entry; `over_cents`, `cap_cents`, `entry_cents`) and the `spend.cap_overrun` ops event,
  which the health job (S09.01) turns into one `transactional` text to the on-call Admins, once for each new overrun, and a banner on the Hub until the month ends.
- Nothing else is held back by the cap: not a text to the on-call Admins, not a reply to STOP, not an alert.

**Owner decisions recorded here (S07.08).** (1) The pilot budget is CAD 1,000, set by `SPEND_PILOT_BUDGET_CENTS`, and is a figure to show; the cap is the Admin's to set and starts unset. (2) "Admins are
notified by a `transactional` text" is met by the on-call roster the health job already texts (`oncall_roster` holds the Admins' numbers); there is no second list. (3) The cap is on text messages only; Cohere
has its own limit on its key, and its usage is shown beside it. (4) A text counts towards the month when the provider accepts it (S06.08), so the cap also adds the estimate of texts still waiting to be sent
(queued, or claimed and not settled), which would otherwise let several approvals each look free while the sender is paused or behind.

## The end-of-pilot re-consent campaign (S09.07)

An Admin runs it from the Hub's End of the pilot page (`/staff/campaign`, the policy action `campaign.run`: Admins at aal2). It adds no environment variable;
what it needs and fixes:

| What | Where | Value |
|---|---|---|
| The campaign text | catalog `smsTexts.reconsent`, all 15 languages (`{date}` is the deadline) | Frozen in the campaign row when it starts (`campaign.texts`), so a later catalog change does not touch a running campaign. AI-generated, not yet checked by native readers: **reviewed by native readers before launch (Launch Readiness)**, as the acceptance criteria ask. Each language fits one text with the longest date of every month (`campaignTexts.test.ts`). |
| The date in the text | catalog `smsDate` (`months`, `dayMonth`, `digits`), all 15 languages | How the text writes the deadline: the month names, the order of day and month, and the numerals (Pashto and Dari write Extended Arabic-Indic digits, Bengali its own). Fixed in the catalog from CLDR 47, never asked of the runtime's `Intl`, whose data differ between Node versions (one wrote the Tamil date day first, another month first), so the frozen text is the one reviewed and measured on every runtime. Gujarati, Tamil, Greek and Bengali abbreviate the month to fit one text, and French writes August "aout". Reviewed by native readers with the texts. |
| The replies | catalog `smsTexts.reconsentKept`, `smsTexts.pilotEnded`, `smsTexts.signupsPaused`, `signup.error.signups_paused`, all 15 languages | `reconsentKept` after YES before the deadline (purpose `prompt_reply`); `pilotEnded` after a YES after the deadline, and `signupsPaused` to a number the CVH does not know while sign-ups are paused (purpose `signup_info`, through a 30-minute `inbound_reply` row, at most once a day per number, as the sign-up link); `signup.error.signups_paused` on the web form (HTTP 409) and the staff sign-up. |
| The deadline | `RECONSENT_DAYS` (30) in `src/modules/subscriptions/domain/campaign.ts`, and `campaign_guard()` | The end of the Toronto day 30 days after the start, by the database's clock. The real campaign is refused unless a rehearsal on the drill roster exists. |
| The end | pg_cron job below, `/api/jobs/campaign-end` | Every 15 minutes: every campaign and rehearsal past its deadline becomes `ended`; the real one is audited `campaign.ended` with how many stayed and how many did not reply. Sign-ups stay closed until an Admin presses "Reopen sign-ups for the MVP". Who receives texts does not wait for the job: a `reconsent_pending` subscriber stops receiving at the deadline itself. |
| Twilio's START and HELP replies | Twilio Console, the Messaging Service's Opt-Out Management | Twilio answers START and HELP itself (AD-9), and its replies carry the sign-up link (see "Advanced Opt-Out" below), which the form refuses while sign-ups are paused. **When the campaign starts**, the owner sets both replies to the paused wording ("CVH text sign-ups are paused while the pilot ends. Reply STOP to stop.") and **when an Admin reopens sign-ups** puts the link back; S09.03's end-of-pilot procedure carries both steps. Twilio's replies are one text for every language, as they are now. |
| Cancelling | the owner, in the SQL editor | `update campaign set state = 'cancelled' where not rehearsal;` (the database refuses it from the app's logins) stops the campaign's texts not yet handed to the provider (the sender skips them) and reopens sign-ups; nothing in the Hub does it. The subscribers already asked stay `reconsent_pending` until the owner decides what to do with them, and the campaign no longer counts for them: they keep receiving texts after its deadline, are never lapsed (S09.08's purge does not name them), and their YES is answered as any subscriber's. |

The end job, which the owner runs once in production's Supabase SQL editor as `postgres` (nothing in the repository or CI runs it):

```sql
select cron.schedule('cvh-campaign-end', '*/15 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'cvh_job_base_url') || '/api/jobs/campaign-end',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cvh_job_secret')),
    timeout_milliseconds := 60000
  );
$$);
```

## The end-of-pilot purge (S09.08)

`/api/jobs/end-of-pilot-purge` deletes, after the campaign's deadline, every subscriber who did not reply YES. It adds no environment variable besides the
job secret, sends no text and reads no Twilio credential. What it does and fixes:

| What | Where | Value |
|---|---|---|
| When | pg_cron job below, every 15 minutes, 5 minutes after the end job (`5,20,35,50 * * * *`) | Nothing until the real campaign's deadline (`campaign.deadline`: the end of the Toronto day its text names, the 30th day after the start) has passed by the database's clock and the end job has ended the campaign (its `campaign.ended` audit counts who stayed and who did not reply before anyone is deleted; the database refuses the purge's record earlier), and nothing for a cancelled campaign. The first run after the end begins the purge, about 5 minutes after the deadline. |
| Who | `purgeableSql` in `src/modules/subscriptions/adapters/purgeStore.ts` | Subscribers still `reconsent_pending`. `retained` (said YES) and `active` (joined after the start) subscribers are never selected. |
| How | `src/modules/subscriptions/application/purge.ts` | One short transaction per subscriber, 100 ids read at a time: the number's lock, the waiting texts skipped, the row locked and the state and deadline checked again under the lock by the database's clock (a YES that won keeps them), then the full deletion STOP runs (the row, a pending sign-up, the number's `inbound_reply` rows; texts already sent forget the subscriber). A run starts new deletions for 40 seconds (`PURGE_BUDGET_MS`), and the next run goes on. |
| Record | `campaign_purge` | `deleted` (raised with each deletion), and once none is left `completed_at` and `retained`, with the one ops event `campaign.purge_completed` (`deleted`, `retained`: counts only). A run with a subscriber whose deletion failed answers 500, so the health job's `job_failed` texts the on-call Admins; that subscriber is tried again at the next run, and the purge completes only once none is left. |
| The terms page | `/{lang}/terms`, `src/app/pilotEnd.ts` | Once the purge has completed, the page states "Resident data deleted" with the Toronto day it completed, in every language (AI-generated translations, not yet checked by native readers). The page now renders on request; the day is read from `campaign_purge` through Next's data cache (an hour, expired by the run that completes the purge). `CVH_FAKE_RESIDENT_DATA_DELETED_ON=YYYY-MM-DD` stands in for it in local development only (the resident page tests); start-up refuses it on Vercel. |
| Kept | `correction_reach_kept` | The staff audit trail, `subscriber_measure`, `subscriber_event_count` (the deletions are counted there), `usage_count`, the weekly review, the spend views and the delivery rows of texts already sent (no longer naming anyone). The correction reach (S07.10's `correction_reach`) counts from the recipient ids the deletions clear, so the purge keeps it as it stood when it began: the database copies the view's rows into `correction_reach_kept` in the transaction that begins the purge, and the Hub's Measures page reads a kept entry from there (an entry measured later is read live). |

The purge job, which the owner runs once in production's Supabase SQL editor as `postgres` (nothing in the repository or CI runs it), before the campaign starts:

```sql
select cron.schedule('cvh-end-of-pilot-purge', '5,20,35,50 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'cvh_job_base_url') || '/api/jobs/end-of-pilot-purge',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cvh_job_secret')),
    timeout_milliseconds := 60000
  );
$$);
```

Once `campaign.purge_completed` is in `ops_event` (`select at, detail from ops_event where kind = 'campaign.purge_completed'`), the job has nothing left to
do: `select cron.unschedule('cvh-end-of-pilot-purge')` and `select cron.unschedule('cvh-campaign-end')` are part of the end-of-pilot procedure
(docs/procedures/end-of-pilot.md).

## Web sign-up for text alerts (S07.02)

`/{lang}/text-alerts` (R-05, then R-06 once sent) posts to `POST /api/signup`. It adds no environment variable; what it reads and fixes:

| What | Where | Value |
|---|---|---|
| Canadian area codes | `src/contracts/canadianAreaCodes.ts` | The Canadian geographic area codes of the numbering plan, by province (non-geographic and toll-free codes left out). A number is accepted only as `+1` and ten digits whose area code is on the list. Add a new overlay there, with its province, before it is in service; the form and the server read the same list. |
| Sign-ups per client | `SIGNUP_RATE_LIMIT` in `src/modules/subscriptions/application/webSignup.ts` | 5 in an hour from one client (a keyed hash of its address in `rate_limit`, scope `signup`, deleted after 24 hours); the sixth is answered 429 and nothing is stored. |
| Terms version recorded | `signupConsentVersion` in `src/modules/subscriptions/application/termsService.ts` | The published `consent_version`. Outside production, while the terms are a draft, the draft's version (the form says the terms are a draft, as the terms page does); in production the page is a 404 and the endpoint answers 503 until the terms are published. |
| The number residents text START to | `TWILIO_FROM_NUMBER` (production) | Shown on R-06: "No text within 5 minutes? Text START to {number}, then sign up again". Where it is not set the line names no number. |
| The confirmation text | catalog `smsTexts.confirmation`, all 15 languages | "Reply YES to get CVH alerts. Reply STOP to stop." `transactional`, purpose `confirmation`, `send_by` 48 hours (the pending sign-up's `expires_at`). |
| Expired pending sign-ups | pg_cron job `subscriptions-purge-pending-signup` (migration `20261004220000_pending_signup.sql`) | Every 15 minutes, as the table's owner, deletes pending sign-ups whose 48 hours have passed. |

A confirmation the provider refuses because the number texted STOP (Twilio error 21610), at once or in a later status callback, deletes
the pending sign-up (`forgetOptedOutSignup`, the sender's and callbacks' `afterFailure` seam): R-06 tells the resident to text START and
sign up again. Every accepted sign-up, new number or not, answers HTTP 202 `{"v":1,"status":"accepted"}` after the same statements.

## Inbound texts: YES, the welcome and STOP (S07.04)

Twilio forwards every text residents send to the Messaging Service to `POST /api/twilio/inbound`. It adds no environment variable; what it
needs and fixes:

| What | Where | Value |
|---|---|---|
| The inbound webhook | Twilio Console, the Messaging Service's Integration, "Send a webhook" | `PUBLIC_BASE_URL/api/twilio/inbound`, HTTP POST, exactly as written (the signature is checked against that URL, built from `PUBLIC_BASE_URL`). Signed with `TWILIO_AUTH_TOKEN`: without it the route answers 503 and does nothing; a wrong signature is 403 and counts toward the same on-call alert as the status callbacks'. |
| Advanced Opt-Out | Twilio Console, the Messaging Service's Opt-Out Management | On. STOP, START and HELP are Twilio's to answer (its START and HELP replies carry the sign-up link, launch readiness). **YES must not be an opt-in (START) keyword**: a YES Twilio marks `OptOutType=START` is left to Twilio, and the sign-up is never confirmed. |
| Replies | catalog `smsTexts.welcome`, `smsTexts.alreadySignedUp`, `smsTexts.deletePrompt`, `smsTexts.signupInfo`, all 15 languages | `welcome` (after YES; purpose `welcome`; replies 1, 2 and 3 (S07.05's menus), 0, STOP and the overnight notice), `alreadySignedUp` and `deletePrompt` (purpose `prompt_reply`, one text in every language), `signupInfo` (the sign-up link `/{lang}/text-alerts`, purpose `signup_info`, through a 30-minute `inbound_reply` row). |
| The words for yes | catalog `smsKeywords.yes`, comma-separated | Accepted besides YES and Y, in the number's language (for example `oui`, `sí, si`, `ہاں, جی`). Read, never sent. |
| The sign-up link to an unknown number | `SIGNUP_INFO_SCOPE` in `src/modules/subscriptions/application/inbound.ts` | At most once in 24 hours per number (a keyed hash in `rate_limit`, scope `signup_info`). |
| The inbound limit (S07.09) | `INBOUND_LIMIT` in `src/modules/subscriptions/domain/inbound.ts` | More than 20 messages in an hour from one number: the 21st and every later one that day (Toronto) get no reply and change nothing; only the day's count is kept (`inbound_limited_count`: messages, and numbers that reached it). Kept as keyed hashes in `rate_limit` (scopes `inbound`, `inbound_mute`). STOP, the second 0, and Twilio's STOP, START and HELP are decided before this limit and are never limited or counted. |
| The rate-limit hashes | pg_cron job `subscriptions-purge-rate-limit` (migration `20261006060000_abuse_limits.sql`) | Every hour at :07: every `rate_limit` row older than 24 hours is deleted, whether or not any request comes in. |
| Old message ids, reply rows and prompts | pg_cron job `subscriptions-purge-inbound` (migration `20261006010000_subscriber_inbound.sql`) | Every 15 minutes: `inbound_seen` hashes after 48 hours, `inbound_reply` rows past their 30 minutes, run-out `sms_prompt` rows. |

STOP (and a second reply 0 within 10 minutes) deletes the subscriber, its places, muted topics and prompt, any pending sign-up and any
`inbound_reply` row of the number, at once and for good; no record of the number is kept. Only the day's count of each keyword is kept of
any inbound text.

### The numbered menus (S07.05)

Replies 1 (building or floor) and 2 (language) start a menu; reply 3 withdraws a check-in request. They add no environment variable:

| What | Where | Value |
|---|---|---|
| Menu texts | catalog `smsTexts.menu*`, `buildingSaved`, `buildingSavedWhole`, `languageSaved`, `noCheckinRequest`, `checkinWithdrawn`, all 15 languages (AI-generated, not yet checked by native readers) | Every one fits one segment in its language; `src/modules/subscriptions/application/menuTexts.test.ts` fails CI naming the text and the language otherwise, and renders every page of the 43 register buildings. A page holds as many options as fit, at most 7, so a translation that grows means more pages, never a second segment. |
| Idle reset | `MENU_IDLE_MS` (10 minutes) and `MENU_KEPT_MS` (1 hour) in `src/modules/subscriptions/domain/menus.ts` | A menu is open for 10 minutes after its last message; a reply after that, until an hour after the last message, is told the menu reset and is read as a new keyword; the purge job deletes the row after the hour, and a later reply is read as a new keyword with no notice (as built, for the product owner to confirm: S07.05's story). |
| Daily menu limit | `MENUS_PER_DAY` (5) in the same file | Menus started per number per day in Toronto, kept as keyed hashes in `rate_limit` (scope `sms_menu`, deleted after 24 hours by `subscriptions-purge-rate-limit`). The 6th reply 1 or 2 gets the Hub's number and the edit link's offer (S07.06). Known edge, as with the inbound limit's mute: the day the clocks go back is 25 hours long, so the menus started in its first hour are deleted in its last hour, and a number that used its 5 in that first hour can start a 6th in the last. |
| The Hub's number | `data/catalogue/numbers.json` (id `hub`), generated into `src/contracts/hubNumber.generated.ts` | What reply 9 and the limit reply give, as `(416) 421-8997`. |
| Check-in requests | `checkins`' ports (`src/app/checkins.ts`), wired in `src/app/inbound.ts` | Reply 3 withdraws the request ("Your check-in request is withdrawn", or "You have no check-in request" when there is none); a move by menu 1 off the "where I live" floor withdraws it and offers the edit link to ask again (S08.05, below). |

### The one-time web link (S07.06)

A subscriber asks for the link by text (reply 1 to the offer at the daily menu limit, or after closing a menu with nothing changed) and
gets `PUBLIC_BASE_URL/{lang}/subscription/{token}`. It adds no environment variable:

| What | Where | Value |
|---|---|---|
| The link's life | `EDIT_LINK_TTL_MS` in `src/contracts/subscriptionEdit.ts`; migration `20261006150000_subscription_edit_token.sql` | 30 minutes, used once (a change or the deletion); a new link replaces the subscriber's earlier one. Only the token's sha256 is stored. |
| Texts | catalog `smsTexts.menuClosedLink`, `smsTexts.editLink`, `smsTexts.editSaved`, all 15 languages (AI-generated, not yet checked by native readers) | `menuClosedLink` fits one segment (the menus' fixture); `editLink` carries the link (purpose `edit_link`, `send_by` the link's expiry); `editSaved` confirms a change in the new language. A deletion sends nothing. |
| The page and its API | `/{lang}/subscription/{token}`, `POST /api/subscription/view`, `/change`, `/delete` | `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, no cookie, never kept by the service worker, no usage event. The page's HTML is the same for every link; the choices come only from `view`. |
| Expired links | pg_cron job `subscriptions-purge-edit-tokens` (the same migration) | Every 15 minutes: links past their 30 minutes, used or not. |
| Logs | `stdoutSubscriptionsLog` in `src/modules/subscriptions/adapters/subscriptionsLog.ts` | One JSON line per request with its outcome; any token and any phone number is taken out of every field. |

### Check-in requests (S08.05)

A subscribed resident asks to be checked on during a heat or power disruption: on the web sign-up form, the staff-assisted sign-up and the
edit page, after reading `/{lang}/ready/check-in` (R-33). It adds no environment variable; what it reads and fixes:

| What | Where | Value |
|---|---|---|
| The consent wording's version | `CHECKIN_CONSENT_VERSION` in `src/contracts/checkin.ts`, with the catalog's `checkin.consent*` | Recorded on the request (`checkin_consent_version`); a request is saved only with the version the server shows now. Change the version with the wording. |
| Round types | `disruption_type.checkin` (migration `20261006170000_checkin_request.sql`; the app may update that one column, `20261006180000_round_types.sql`) | `heat` and `power` in the pilot: an approved acknowledgement, update or correction of one of these types starts its thread's round (S08.06). An Admin at aal2 changes them on the coverage page (`/staff/coverage`, "Save round types"; policy action `checkins.round_types`), audited as `round_types.changed` with the types before and after. A change applies from the next approval: the rows of a round already started stay until its thread closes. None is allowed (no alert then starts a round). |
| Coverage | identity's `coversFloor` (an active Ambassador assigned to that floor or the whole building) | A request for a floor nobody covers is not saved ("No ambassador covers your floor yet. Call the Hub at {number}"); the rest of the form saves. At YES the floor is checked again. The Admin coverage screen counts the requests on uncovered floors per building, with no one named. |
| Texts | catalog `smsTexts.checkinWithdrawn`, `smsTexts.checkinMoved`, `smsTexts.checkinUncoveredNow`, all 15 languages (AI-generated, not yet checked by native readers) | `checkinWithdrawn` after a withdrawal (reply 3, the edit page, a move off the floor without the edit link); `checkinMoved` after menu 1's move withdrew the request, with the edit link's offer ("Reply 1"); `checkinUncoveredNow` after the welcome when the floor of a request made at sign-up is no longer covered at YES. Each fits one segment (`menuTexts.test.ts`). |
| Personalised answers | `POST /api/signup`, the staff sign-up's action, `POST /api/subscription/view` and `/change` | The only place a request's outcome is said: POST only, `Cache-Control: no-store`, never kept by the service worker, no usage event. R-33 itself is public and cacheable. |
| Closed stubs | pg_cron job `checkins-purge-stubs` (the same migration; S08.08 reschedules it by name in `20261006210000_escalations.sql`) | Every 15 minutes, as the table's owner: a row still live in a closed thread (left by a close of the previous release) is tallied as a close tallies it, as of the thread's close, skipping rows someone holds; a row kept for the Hub's follow-up (tallied at the close, not closed) becomes a stub 23 hours 45 minutes after it was tallied, so within 24 hours of the close, without being counted again; then `checkin` rows closed into stubs more than 2 hours ago are deleted. Live rows of open threads stay; the tally changes only for the rows it tallies. |

#### Changing which types start a round (runbook)

The residents' texts about check-ins name heat warnings and power outages, in all 15 languages: `R33.what` (the check-in page), `groups.checkin.line`
(the sign-up choice), `R24.checkin` (the Get ready page) and `A04.noRound` (the round page). They do not follow the round types. So unticking Heat or Power on the coverage
page makes them inaccurate: residents keep being promised a check-in that no alert of that type now starts. The control says so beside the boxes, and
"Save round types" refuses ("Nothing changed. Heat or Power is unticked, ...") unless the Admin also ticks "I understand: the residents' texts still name
heat warnings and power outages until they are changed". Ticking another type (Water, say) needs no confirmation, but those texts will not mention it.

1. Before unticking Heat or Power (or adding a type residents should be told about), agree the new wording with the product owner.
2. Change the English source of those four keys (`design/prototype/cvh/strings.en.screens.js` or `strings.en.js`) and have each language translated
   the way the catalog's other resident texts are (machine translation labelled as such is accepted for the pilot; these are not safety-critical),
   then `node scripts/gen-strings.cjs` and a pull request. Until it is deployed the texts are inaccurate.
3. On `/staff/coverage`, change the boxes, tick the confirmation and press "Save round types". The change applies from the next approval; rounds
   already running keep their rows until their alerts close.
4. Put the change, and when the texts were (or will be) corrected, in this week's notes (`docs/procedures/weekly-notes/`).

An assignment saved on the coverage page adds that building's requesters on floors it now covers to the building's open rounds at once (never a
drill's, a closed thread's or one whose types are no longer round types), so assigning an Ambassador during a heat round needs no new approval.

## GitHub: environments

| Environment | Secrets and variables | Rules |
|---|---|---|
| `production` | `VERCEL_TOKEN` (replaced 2026-10-02), `PRODUCTION_DATABASE_URL` (as `postgres`, session pooler, port 5432), `VERCEL_AUTOMATION_BYPASS_SECRET`, `SEARCH_TEST_DATABASE_URL`, `COHERE_API_KEY` and `SUPABASE_SECRET_KEY` (the three for the "Search test set" workflow, S03.07: not set yet); variables `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `PRODUCTION_URL`, `NEXT_PUBLIC_SUPABASE_URL` (for the same workflow: not set yet) | deploys from `main` only |
| `preview` | `VERCEL_TOKEN` (replaced 2026-10-02), `VERCEL_AUTOMATION_BYPASS_SECRET` | previews only for open pull requests of this repository that carry the label `preview` |

`VERCEL_TOKEN` must be a personal token of a member of the Vercel team that owns the project,
scoped to that team: `vercel promote` and `vercel rollback` look up the token's user and fail with
"User not found (404)" otherwise.

### CI (`.github/workflows`)

- **Checks.** Every push runs `ci.yml`. Its job named exactly `Checks` (the one to require in branch protection) needs three jobs that run at
  once (`checks.yml`): `Static` (lint, types, CSS and string checks, unit tests, dependency rules), `Database` (the disposable Supabase
  Postgres: migrations, RLS, `test:db`, the destructive-change check) and `Browser` (one build; the layout, staff, resident and Hub suites in
  the pinned Playwright image, so the runner installs no browser; then the smoke check of the build). `npm run ci:local` runs the same steps one after the other.
- **Skip on main.** On a push to `main`, `scripts/ci/tested-tree.sh` skips the three jobs, and `Checks` passes as "tested at `<sha>`", only
  when the pushed commit is a merge commit whose tree equals the tree of the merged pull request's head, and that head has a successful
  `Checks` of `ci.yml`. The decision is in the job summary. Anything else (a squash, main moved, no passing run, an API error) runs everything.
  Production still deploys after `Checks`, with every guard unchanged.
- **Previews are on demand.** Apply the label `preview` to a pull request of this repository (one preview a batch, on the last pull request);
  `preview.yml` waits for the head's `Checks` to succeed, then deploys, and deploys again on each push while the label stays. A fork's
  pull request never gets one. Create the label once (Issues > Labels).
- **Nightly and latency.** `nightly.yml` runs the same checks on `main` every night (no deploy). `search-latency.yml` sends one English search
  to `PRODUCTION_URL` every day and fails, with an annotation, when the answer is not `ok` with a result, or when its response time or `Server-Timing`
  total passes the budget. Both only alert (a failed run); neither touches production. `codeql.yml` scans the code, apart from `Checks`;
  Dependabot opens weekly grouped pull requests for npm and the actions (`@playwright/test` is bumped by hand with the image tag and baselines).
- **Repository variables** (Settings > Secrets and variables > Actions > Variables; `PRODUCTION_URL` must be a repository variable too, for the latency probe):
  `SMOKE_SEARCH` (default on; `off` skips the one real search of the production smoke check and the daily probe, which each spend one Cohere
  call), `SMOKE_SEARCH_PREVIEW` (`on` also runs that search against a preview, which needs a Cohere key; default off) and `SEARCH_LATENCY_BUDGET_MS`
  (default `3000`). The production smoke check records the search's response time and `Server-Timing` total in the job summary; a failed search
  fails the smoke check and so rolls production back like any other failed smoke check.
- **Actions are pinned** to full commit SHAs with the version in a comment; Dependabot proposes the updates.

The "Seed production" workflow (Actions tab) runs `seed:providers`, `seed:buildings` or
`seed:guides` with `PRODUCTION_DATABASE_URL`, in `dry-run` by default.

The "Search test set" workflow (Actions tab, S03.07) asks the tuning questions of `data/search-test-set/questions.jsonl` to
production's real search use case (the current release, Cohere's `embed-v4.0`, the private bucket, and with the leg on the
translated-question leg) and reports the hit rate per language, no-match and emergency accuracy, p50 and p95 per question, the
vendor usage and a suggested no-match threshold; the suggestion sets nothing. It runs from `main` only, in the `production`
environment, and the evaluation subset is refused (S03.08's).
Importing the ambassadors' questions, the coverage check, the evaluation split (`subsets.json`), the launch bar (`bar.json`) and
`readiness` are described in `data/search-test-set/README.md` (S03.08).

Add to the GitHub `production` environment (repository settings > Environments > production), once:

- secrets `COHERE_API_KEY` (production's key), `SUPABASE_SECRET_KEY` (reads the private release bucket) and `SEARCH_TEST_DATABASE_URL`, set to production's app `DATABASE_URL` (the app's own login, `cvh_app`, which can do all this run does: read the release and the spend, write spend rows). The run does not take `PRODUCTION_DATABASE_URL`, the superuser's, and the workflow stops if `SEARCH_TEST_DATABASE_URL` is not set;
- variable `NEXT_PUBLIC_SUPABASE_URL`;
- only if production sets them in Vercel, variables of the same names and values: `SEARCH_QUESTION_ROUTE`, `SEARCH_QUESTION_FALLBACK`, `SEARCH_FALLBACK_MIN_BUDGET_MS`, `SEARCH_EMERGENCY_THRESHOLD`, and `SEARCH_THRESHOLD` (checked only: the run measures the threshold the current release recorded). Unset means the defaults, as in production;
- optional variables `SEARCH_TEST_MONTHLY_CALLS` (the calls a month the Cohere key allows in all: 1000, the free trial key's) and `SEARCH_TEST_RESERVE_CALLS` (the calls of them kept for live search, which no run uses: 200). Set the first if the key is upgraded.

The workflow names any missing secret or variable and stops before it calls anything. The key stays out of Vercel's Preview and Development and out of
the repository; the run does not use the app's environment check, which is unchanged.

Before a run, look at the month. The trial key is shared with live search, and a key that runs out gives every resident's question a
429 until the month turns (search then answers "unavailable"). A run of both legs plans about 440 calls, 44% of the month. The run
checks it too: once it is told to go, and before its first call, it reads this month's Cohere calls (embedding and translation, every
purpose, the calendar month in America/Toronto) from `spend_event`, prints them with the allowance and what is left, and refuses to
start when those calls and its own worst case (its plan with every retry, never more than `max_calls`) would pass the allowance less
the reserve: with the defaults, 1000 - 200 = 800 calls. To see the count yourself, in the production database (the SQL editor, read only):

```sql
select kind, purpose, sum(calls) as calls
from spend_event
where kind in ('embed', 'translate')
  and at >= (date_trunc('month', now() at time zone 'America/Toronto') at time zone 'America/Toronto')
group by kind, purpose
order by kind, purpose;
```

`spend_event` is the app's own record, so it can miss a call that never reached it (a process that died): the vendor's own count, in
Cohere's dashboard, is the one that decides. Check that too before the first run of a month.

To run it: Actions > Search test set > Run workflow, on `main`: `split` tuning, `leg` `both` (off, then on), `max_calls` empty (500).
`confirm` is unticked by default: the run then only prints the plan (the calls per leg and the allowance) and succeeds, and calls
nothing. Run it that way first, read the plan, then run it again with `confirm` ticked. Calls are paced, never pass `max_calls`, and
a run stops, reports partial results and fails when the cap, a vendor's monthly quota, repeated vendor failures or repeated search
failures say so (the leg after a leg that stopped is not run). A 429 or another vendor failure is its own outcome in the report,
never a miss. The use case records each call as `test_set` spend and no `search_log` row is written. The job summary holds
aggregates only; the per-question report (ids, scores and counts, never a question's text) is in the run's artifact, and the
report and the chosen threshold are committed afterwards (provisional until S03.08). The printed output stays in the job log, where GitHub
masks the secrets; it is not uploaded, because an artifact of this public repository can be downloaded by anyone signed in to GitHub.
A run that ends badly (an error, or the step's 25-minute limit) leaves a progress file of the questions asked so far in the artifact,
with the same kind of content. From a shell, with the same values exported (the database as `SEARCH_TEST_DATABASE_URL`):
`npm run search-test-set -- run --engine production --model embed-v4.0 --translated-leg both --yes`; `--plan-only` prints the plan
and stops, and without either flag it prints the plan and exits 2.

### Rolling out a change to what the directory listing shows (for example the AD-11 pilot change, PR #60)

A change to which translations a release carries reaches residents only through a new release. Do it in this order:

1. **Deploy** the change (merge to `main`; production deploys from it). Check that `GET /api/health` returns the
   merged commit as `version`.
2. **Let phones pick up the new app.** Since S02.12 a service worker is registered (AD-1; how it updates is in "How a
   deploy reaches residents' phones" below). Pages are network first, so a phone with signal runs the new code from its
   next page load; the copies kept on the phone are used only without signal (or when the network takes more than 6
   seconds), and without signal a phone cannot fetch a newer release, so old kept code rarely meets the new release. A
   phone that is not opened keeps the old version until it next opens the CVH with signal. Wait at least 24 hours after
   the deploy before step 3. An old app version still reads the new release (`DirectoryListingV1` did not change), but it
   shows an unreviewed machine translation with the older "Translated by machine" label instead of "Machine-translated;
   not reviewed by a person", which is why the publish waits.
3. **Seed, then publish.** Run "Seed production" with `seed:providers` as a dry run, compare its report with the one
   in the pull request, then run it to apply. Then an Admin presses **Publish directory**. Nothing changes for
   residents until that publish: they keep the current release, built from the earlier seed.

### Compact vectors for search (cold start)

The publish job writes `releases/{n}/vectors.bin` beside `vectors.json`: little-endian Float32 behind a small JSON header
(release, catalogue version, model, dimensions, provider order, sha256 of the numbers). The release record names it
(`search.binary`, an optional field, with its own sha256). The search reads it first, checks its hash, and uses
`vectors.json` when the binary is missing (a release published before this change, or a store that refused it), with the
same errors (`vectors_missing`, `vectors_hash`, `vectors_release`). A binary that is there but does not match its
recorded hash fails the search as `vectors_hash`, like the JSON file would.

**Owner action: press Publish directory once after this is deployed.** Until then the current release has no binary, and a
cold instance still downloads and parses the JSON file. The release is built from the same texts, so the publish copies
the vectors from the current release and calls the embedding model for none of them. The first publish also lets the
`directory-releases` bucket accept `application/octet-stream` (an existing bucket only allowed JSON); if that update is
refused, the publish still succeeds with JSON vectors only (the server then logs `directory_bucket_update_failed`).

Rollback: a build from before this change rejects the record's `search.binary` field, which turns search off. After the
re-publish, rolling the app back to such a build needs a publish from that build (or search stays unavailable).

The expected cold snapshot is download-dominated: about 0.2 to 0.5 s instead of 0.5 to 0.9 s (about 0.7 MB over Storage
instead of 2 to 3 MB; sha256, parse and validation fall from roughly 50 ms to a few ms, more on a slow cold vCPU). Confirm it
with the `Server-Timing` snapshot phase after the re-publish.

## How a deploy reaches residents' phones (S02.12)

The resident service worker is `src/app/sw.ts` (Serwist, `@serwist/turbopack`), built with the app and served at
`/serwist/sw.js` with scope `/`. Its rules are in `src/app/offline/rules.ts`; nothing here is an environment variable.

- **Which worker is current.** Each build's worker carries the list of that build's scripts and styles (content-hashed),
  so any code change is a new worker, and its caches are named after a hash of that list (`cvh-pages-{build}`,
  `cvh-static-{build}`).
- **When a phone looks for it.** The browser checks `/serwist/sw.js` when a CVH page loads with signal, bypassing its own
  cache.
- **Install.** A new worker downloads the new build's scripts and styles (files that did not change are kept), and
  stores home, the numbers page and the offline page in every language the phone uses, then fetches again up to 20
  pages the previous version kept. If signal drops before the scripts, styles and those critical pages are stored,
  the install fails and the previous version stays in use; the browser tries again on a later page load.
- **Take over.** Once installed it takes over at once (`skipWaiting`, `clientsClaim`): open pages use it from their
  next request, and it deletes the previous build's page and static caches. Serwist removes the old precached files.
  The directory files (`cvh-data-v1`) are not tied to a build and stay; the map's tile cache (`cvh-map-tiles-v1`) is
  never touched.
- **How long it takes.** A phone with signal runs the new code from its first page load after the deploy (pages are
  network first) and has the new worker within seconds of it. A phone that does not open the CVH keeps the previous
  version, offline copies included, until it next opens it with signal. There is no forced refresh.
- **Order for a change residents must see together with a release:** deploy, wait (24 hours, as above), seed, publish.

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
- The sender (S06.02) sends through one Messaging Service whose sender pool is the verified toll-free number
  (`TWILIO_MESSAGING_SERVICE_SID`). Smart Encoding must be **off** on it: the approver sees the frozen body and the
  provider must send exactly those bytes; Smart Encoding would rewrite characters after approval and change the segment
  count the estimate was made from (AD-21). It is checked daily (see "Messaging sender"), and every request also sets
  `SmartEncoded=false`.
- Pre-launch checklist (S07.04, product owner 2026-10-04): on the Messaging Service, Advanced Opt-Out is on, its inbound webhook is
  `PUBLIC_BASE_URL/api/twilio/inbound` (POST), and **YES is not an opt-in (START) keyword**: Twilio would mark a YES `OptOutType=START`
  and answer it itself, and the resident's sign-up would never be confirmed. Test it on the verified number before launch.
