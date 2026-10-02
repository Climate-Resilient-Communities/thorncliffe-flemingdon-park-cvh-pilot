# Change Proposal: one free Supabase project for the pilot

- **Date:** 2026-10-02
- **Status:** Approved by the product owner on 2026-10-02 and applied. Texts are quoted from `origin/main` (f5b1073).
- **Decision (owner, verbatim):** "Previews and production share the same single free Supabase project (ca-central-1). The architecture doc's AD-15 staging/production split, with a separate staging project and Supabase Pro, is deferred to MVP." Follow-up: "this is a pilot, that's fine — all this work and backups can be done for MVP; this is just to prove it can work."
- **Current setup (owner's note):**
  - Vercel project `thorncliffe-flemingdon-park-cvh-pilot` on the **Hobby** plan, with no Git connection; GitHub Actions deploys.
  - Standard Deployment Protection is on.
  - GitHub secrets: `VERCEL_TOKEN`, `VERCEL_AUTOMATION_BYPASS_SECRET`. GitHub variables: `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `PRODUCTION_URL`.
  - Vercel env vars set in **both Production and Preview**: `DATABASE_URL` (transaction pooler), `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The names are provisional until an env schema exists.
  - `db/migrations` is empty, and CI has no Supabase steps.
  - Twilio credentials exist only in production, and test allowlist numbers are never in the repository.
- **Scope:** no new stories, no new safeguards, no added hours. Anything that needs staging, backups or a restore moves to "Deferred to MVP". `docs/planning/mvp/reference/*` is unchanged.

## Summary

- **Deferred to the MVP:**
  - the staging project and Supabase Pro;
  - backups and the restore procedure, including `scripts/restore-reconcile`, the restore and STOP-evidence rehearsals and the restore spend reconciliation;
  - the deletion ledger and its two Storage launch-readiness rows;
  - the Twilio-log retention check that only served restores.
- **Estimates:**

  | Story | Old | New |
  | --- | --- | --- |
  | S01.02 | 4 h | 3.5 h |
  | S06.08 | 3 h | 2.5 h |
  | S09.03 | M 5 h | S 2 h |

  - E01 89 → 88.5 h; E06 45 → 44.5 h; E09 33 → 30 h.
  - **Build 495.5 h / 91 stories → 491.5 h / 91 stories.**
  - Manual operations 18 → 15 h.
- **Cost:** two-month estimate about CAD 700 → **about CAD 545**. The Supabase Pro line (CAD 100) and the Vercel Pro line (CAD 55) both go to 0.

## Accepted risks for the pilot

- Previews run unmerged code with the production `DATABASE_URL` and `SUPABASE_SECRET_KEY`, so they can read and write live resident data and trigger jobs.
- There are no backups and no restore. The Supabase Free plan includes neither ([pricing](https://supabase.com/pricing), [backups](https://supabase.com/docs/guides/platform/backups)), so losing data is final.
- The Free project is paused after a week of low database activity, then restored by hand ([project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)). It also turns read-only above 500 MB ([database size](https://supabase.com/docs/guides/platform/database-size)).
- Vercel Hobby is limited to non-commercial personal use ([fair use](https://vercel.com/docs/limits/fair-use-guidelines)). Once a Hobby usage limit is exceeded, that feature stays unavailable until 30 days have passed ([Hobby](https://vercel.com/docs/plans/hobby)).

## 1. `docs/architecture/ARCHITECTURE-SPINE.md`

### Frontmatter

`updated: '2026-10-01'` → `updated: '2026-10-02'`

### AD-8 (Spend)

1. `(`month:{YYYY-MM}` for a Toronto calendar month; `restore:{backup timestamp}:{re-enable timestamp}` for the gap a restore covers)` → `(`month:{YYYY-MM}` for a Toronto calendar month)`
2. Delete the sentence ` Texts a restore marks `unknown` keep their estimates on that basis.`

### AD-13

1. Delete this passage (from "Before a deletion commits" to "(AD-8)."):
   > Before a deletion commits, a write-ahead intent holding a salted hash of the number is written to a Storage bucket outside the database and confirmed; without that confirmation the deletion does not commit. Only STOP (already enforced by Twilio) is then held for retry; other deletions fail visibly and are retried by the person or the purge. Ledger objects are kept for the backup window plus one day. Twilio's opt-out list cannot be read, so STOP evidence outside the database is Twilio's inbound message log (body redaction off, retention covering the backup window). A restore stays in maintenance, contacting nobody, until `scripts/restore-reconcile` reports complete: paginated listings of the ledger and the Twilio log read in full; the ledger bucket's retention policy (backup window plus one day) and its no-early-delete, no-overwrite controls verified from Storage's configuration; no redacted bodies; log retention covering the range; the opt-out keyword list current; and every record created within 2 minutes of a matching intent or STOP resolved by an Admin from evidence of the order of deletion and re-subscription (otherwise recovery stays blocked). It then applies every kept intent, and every STOP in the log since the backup, to records created at or before them (never to a later re-subscription), and re-runs the purge and, in an audited recovery mode while sending is disabled, marks every `queued` or `claimed` delivery `unknown` (the only path for that change); spend for the gap comes from a restore reconciliation (AD-8).
2. `Daily backups keep deleted data for the backup window; the terms say so.` → `The pilot's Supabase Free project has no backups, so a deletion is final (backups, restore and the deletion ledger are deferred to the MVP).`

### AD-15

1. Prevents: `a preview or staging build sending real SMS, acting on production data, or running production jobs.` → `a preview build sending real SMS or running production jobs.`
2. Regions: `- **Regions:** production is Vercel `yul1` with Supabase `ca-central-1`; staging is a separate Supabase project.` → `- **Regions:** production is Vercel `yul1` with Supabase `ca-central-1`. The pilot has one Supabase project (Free plan), shared by production and previews; a separate staging project is deferred to the MVP.`
3. Separate accounts: `- **Separate accounts:** only production has a Twilio subaccount and a (verified) toll-free number; staging and previews have none. Each environment has its own Cohere key with a spend limit and its own pg_cron target URL and job secret in that database's Vault.` → `- **Separate accounts:** only production has a Twilio subaccount and a (verified) toll-free number; previews have none. Each environment has its own Cohere key with a spend limit. The pg_cron target URL and job secret in the project's Vault point at production only.`
4. Previews: `- **Previews:** run no cron, apply no migrations, and use staging with synthetic subscribers only; production data is never copied out.` → `- **Previews:** run no cron and apply no migrations; they use the shared Supabase project, including its live data (accepted pilot risk).`
5. The SMS mode, Deploys and Secrets bullets are unchanged.

### AD-25

1. Prevents: `environments with different buildings, providers or routes; real subscriber data in staging.` → `environments with different buildings, providers or routes.`
2. `loaded by idempotent upsert scripts run per environment by an Admin through CI.` → `loaded by idempotent upsert scripts run by an Admin through CI.`
3. Delete ` Staging uses synthetic subscribers only.`

### Stack

- `| Vercel | Pro, region `yul1` |` → `| Vercel | Hobby, region `yul1` |`
- `| Supabase | Pro, region `ca-central-1` |` → `| Supabase | Free (one project, shared by production and previews), region `ca-central-1` |`

### System diagram

- `subgraph Vercel["Vercel Pro, yul1 Montreal"]` → `subgraph Vercel["Vercel Hobby, yul1 Montreal"]`
- `subgraph Supabase["Supabase Pro, ca-central-1"]` → `subgraph Supabase["Supabase Free, ca-central-1"]`

### Deferred

1. `| Point-in-time recovery, multi-region, SLOs | Pilot sets no reliability targets (N4); Supabase Pro daily backups with one restore rehearsal before launch. |` → `| Point-in-time recovery, multi-region, SLOs | Pilot sets no reliability targets (N4). |`
2. Add a row: `| Single Supabase project (2026-10-02) | Deferred to the MVP: a separate staging project, Supabase Pro and Vercel Pro, backups and restore (including the restore rehearsal, `scripts/restore-reconcile` and restore spend reconciliation), and the deletion ledger. The pilot runs one Supabase Free project shared by production and previews. |`

### Open Questions

Delete the row that begins `| Does Supabase Storage expose and enforce a retention policy of at least the backup window plus one day …`.

## 2. `docs/architecture/solution-design.md`

### §1 Cost

`**Cost.** About CAD 560 for two months (estimate)` → `**Cost.** About CAD 545 for two months (estimate)`

### §2 Providers and diagram

- `| Vercel Pro | Runs the web app and its server functions |` → `| Vercel Hobby | Runs the web app and its server functions |`
- `| Supabase Pro | Postgres database, staff sign-in with TOTP, private file storage, scheduled jobs (pg_cron) |` → `| Supabase Free (one project) | Postgres database, staff sign-in with TOTP, private file storage, scheduled jobs (pg_cron) |`
- `subgraph Vercel["Vercel Pro, Montreal"]` → `subgraph Vercel["Vercel Hobby, Montreal"]`
- `subgraph Supabase["Supabase Pro, Canada"]` → `subgraph Supabase["Supabase Free, Canada"]`

### §4 Drills

`In addition, the staging environment can only text the drill roster, and preview builds cannot send texts at all (AD-15).` → `In addition, preview builds cannot send texts at all (AD-15).`

### §6.1

Delete the row `| Backups | Daily copies of the database | Supabase Pro backup window; deleted data stays in backups until they expire, and the terms say so | Supabase project owners |`.

### §7.1

1. `| Production | Supabase Pro, Canada | Live, to subscribers | Yes |` → `| Production | Supabase Free, Canada (one project) | Live, to subscribers | Yes |`
2. Delete `| Staging | Separate Supabase project, synthetic subscribers only | Never; every send is recorded as skipped | Yes, own secret |`
3. `| Preview (one per code change) | Staging data | Logged only, never sent | No |` → `| Preview (one per code change) | The production project, live data | Logged only, never sent | No |`
4. `Each environment has its own Cohere key with a spend limit and its own job secret. The application refuses to start if the text mode and environment do not match. Production data is never copied out.` → `Each environment has its own Cohere key with a spend limit; the job secret is production's. The application refuses to start if the text mode and environment do not match. Previews share production's database (accepted pilot risk; a staging project is MVP work).`

### §7.5

Delete `- **Restore.** Supabase Pro takes daily backups. One restore is rehearsed before launch.`

### §8 Cost

1. `| Vercel Pro | 1 seat, 2 months | 55 |` → `| Vercel Hobby | 1 seat, 2 months | 0 |`
2. `| Supabase Pro | Production, plus staging compute in the same organisation | 100 |` → `| Supabase Free | One project | 0 |`
3. `| **Total** | | **about 700** |` → `| **Total** | | **about 545** |`
4. `| Headroom within CAD 1,000 | | about 300 |` → `| Headroom within CAD 1,000 | | about 455 |`

### §9

1. §9.1: `| A drill reaches residents | Database refuses non-roster recipients; staging and previews cannot text. |` → `| A drill reaches residents | Database refuses non-roster recipients; previews cannot text. |`
2. §9.2: delete `| Rehearse a database restore from backup | IT | Before launch |`.

### §10

`- **Point-in-time recovery, multiple regions, reliability targets.**` → `- **Point-in-time recovery, multiple regions, reliability targets; backups and restore; a staging project; Supabase Pro and Vercel Pro.**`

## 3. `docs/planning/pilot/epics.md`

### Overview

`**Totals.** Build 495.5 h across 91 stories (E01–E09). Manual operations during the pilot: 18 h (see "Manual operations").` → `**Totals.** Build 491.5 h across 91 stories (E01–E09). Manual operations during the pilot: 15 h (see "Manual operations").`

Append to the same paragraph: ` With the single-Supabase change (2026-10-02) it became 491.5 h: backups, restore and the deletion ledger moved to the MVP.`

### Requirements Inventory

1. NFR-N9: `(current estimate about CAD 700)` → `(current estimate about CAD 545)`
2. AR-4: `- AR-4: environments: Vercel Pro yul1 + Supabase Pro ca-central-1 production; separate staging Supabase; previews use staging, no cron, no migrations;` → `- AR-4: environments: Vercel Hobby yul1 + one Supabase Free project in ca-central-1, shared by production and previews (staging deferred to the MVP); previews run no cron and apply no migrations;` (the rest of the line is unchanged)

### Launch Readiness

1. Delete `| Production STOP-evidence rehearsal: a real STOP to the production number is read back through the paginated Messages API (body, sender, timestamp) and replayed to delete a test subscription (S09.03) | IT + Hub | Before launch |`
2. `| Rehearse a full drill in production; rehearse one database restore with `scripts/restore-reconcile` (S09.03) | Hub + IT | Before launch |` → `| Rehearse a full drill in production (S09.03) | Hub + IT | Before launch |`
3. Delete `| Storage decision for the deletion ledger: … (S09.03) | IT | **Before S09.03 implementation starts** |`
4. Delete `| Verified ledger enforcement in production: … (S09.03) | IT + Hub | **Before launch (launch gate)** |`

### Epic List

1. Launch gate: `S09.03 (procedures, deletion ledger, restore reconciliation and rehearsals, including the production STOP-evidence rehearsal)` → `S09.03 (procedures and rehearsals)`
2. E09 description: `written procedures with restore reconciliation,` → `written procedures,`

### E01

1. Header: `**Epic estimate:** 89 h across 16 stories (4 S, 12 M)` → `**Epic estimate:** 88.5 h across 16 stories (4 S, 12 M)`
2. **S01.02** (estimate 4 → 3.5 h; the separation criterion is removed):
   - `- **Size:** S · **Estimate:** 4 h` → `- **Size:** S · **Estimate:** 3.5 h`
   - `I want production, staging and previews kept apart with settings checked at start-up,` / `So that no environment can text residents or touch production data by mistake.` → `I want production and previews checked at start-up,` / `So that no environment other than production can text residents.`
   - Delete this criterion:
     ```
     **Given** two Supabase Pro projects, production in `ca-central-1` and staging
     **When** the app runs in production, staging and a preview
     **Then** production connects only to the production project, and staging and previews connect only to staging (each environment's credentials exist only in that environment's Vercel variables)
     ```
   - The `SMS_MODE`, `PUBLIC_BASE_URL` and Twilio criteria are unchanged.
3. **S01.15:** `**Given** staging or a preview` → `**Given** a preview`

### E03

The estimates are unchanged. These are wording edits only.

1. **S03.07:** `**When** the runner is run on staging with the translated-question leg on and off` → `**When** the runner is run against a preview deployment (the shared Supabase project) with the translated-question leg on and off`
2. **S03.09:**
   - `**Then** the runner runs the evaluation subset against staging,` → `**Then** the runner runs the evaluation subset against the change's preview deployment,`
   - `**And** each run's usage is recorded in `spend_event` against staging` → `**And** each run's usage is recorded in `spend_event` in the shared project, labelled as a test-set run`

### E04

The estimates are unchanged.

1. Intro: `Staging and previews run with it on.` → `Previews run with it on.`
2. **S04.01:** `**When** `scripts/translation-latency` runs on staging within the usage allowance` → `**When** `scripts/translation-latency` runs against the shared Supabase project within the usage allowance`

### E06

1. Header: `**Epic estimate:** 45 h across 9 stories (4 S, 5 M)` → `**Epic estimate:** 44.5 h across 9 stories (4 S, 5 M)`
2. Definitions, state table: delete the row `| `queued`, `claimed` | `unknown` | only the restore recovery operation (E09 S09.03), while recovery mode is on |`
3. **S06.08** (estimate 3 → 2.5 h; the restore interval and its overlap test are removed):
   - `- **Size:** S · **Estimate:** 3 h` → `- **Size:** S · **Estimate:** 2.5 h`
   - Delete `; for a restore, `[backup's timestamp, moment sending was re-enabled)`, with id `restore:{backup timestamp}:{re-enable timestamp}` (S09.03)`
   - `(messages with no delivery carrying that `MessageSid`, for example texts sent after a backup whose rows were lost)` → `(messages with no delivery carrying that `MessageSid`)`
   - Delete `; and a message inside both a month and a restore interval, with the month imported first and with the restore imported first, counted once and retiring its estimate once in both orders`
4. **S06.09:** `the Twilio adapter is imported only by the dispatcher and the reconciliation and restore scripts (dependency rule)` → `the Twilio adapter is imported only by the dispatcher and the reconciliation script (dependency rule)`

### E07

The estimates are unchanged.

1. **S07.01:** delete ` that backups keep deleted data for the backup window;`
2. **S07.09:** `message body redaction is off and message log retention covers the database backup window (STOP evidence, E09), and raises` → `and raises`
   - This removes only the restore-evidence check; the other checks in the sentence are kept.

### E09

1. Header: `**Epic estimate:** 33 h across 7 stories (3 S, 4 M)` → `**Epic estimate:** 30 h across 7 stories (4 S, 3 M)`
2. Launch gate: `and S09.03 (procedures, deletion ledger, restore reconciliation, the access-request process and the rehearsals, including the production STOP-evidence rehearsal).` → `and S09.03 (procedures, the access-request process and the rehearsals).`
3. Definitions: delete the rows **Deletion ledger**, **Unconfirmed deletion**, **STOP evidence**, **Restore complete** and **Replay rule**.
4. **S09.01:** `the launch rehearsal includes stopping the health job on staging and confirming the email arrives` → `the launch rehearsal includes stopping the production health job before launch and confirming the email arrives`
5. **S09.03:** replace the whole story with:
```
### Story S09.03 — Procedures are written and rehearsed

- **Size:** S · **Estimate:** 2 h · **Actual:** —
- **Traces:** NFR-N6, NFR-N5, AR-21, AR-17, Launch readiness · **Depends on:** S09.01, S09.02 · **Branch:** `e09-s03-procedures`
- **Note:** the deletion ledger, restore procedure, `scripts/restore-reconcile`, restore spend reconciliation and the restore and STOP-evidence rehearsals are deferred to the MVP (single Supabase project, 2026-10-02).

As a Hub Coordinator,
I want short procedures I can follow under pressure,
So that sending, correcting and recovering are done the same way every time.

**Acceptance Criteria:**

**Given** `docs/procedures/`
**When** this story is done
**Then** it holds one page each, in plain steps with screen names, for: writing and approving an alert; correcting and withdrawing; closing; running a drill; pausing and resuming texts; resending failed texts; a cap overrun; a health alert and who owns the incident; changing Messaging Service settings (texts paused first); rotating secrets (at pilot start, on departures, at pilot end); and a resident access request
**And** each names its owner and last-reviewed date, and each Hub screen that starts one of these tasks links to it

**Given** the access-request process (the pilot has no access-request screen)
**When** a resident asks what is held
**Then** an Admin establishes verified control by calling the number back, then IT runs `scripts/access-request` (service key, read-only, output shown on screen and not saved); a deletion on the resident's behalf is done the same way only after verified control; the request is recorded in the audit trail without the number, with requests open longer than 25 days flagged in the weekly review (30-day limit)

**Given** someone who cannot show verified control of the number (it can no longer receive texts or calls)
**When** they ask for access or deletion
**Then** the request is recorded (without the number), nothing is revealed and nothing is deleted; the Hub offers the alternative of sending a given one-time phrase by text from that number, explains that texting STOP from it deletes the subscription, and that subscribers who do not re-consent at the end of the pilot are deleted after the stated deadline (S09.08)

**Given** launch readiness
**When** the procedures are rehearsed
**Then** a production drill (S06.05), a pause and resume, a resend in production to the drill roster and the access-request process are performed following the written steps, and any step that did not work is fixed in the procedure before launch
```
   Compared with the current story, every criterion about the ledger, restore, `scripts/restore-reconcile`, the completeness checks, recovery mode, the sequence and fake tests, spend after a restore, the staging restore rehearsal and the STOP-evidence rehearsal is removed. "restoring the database" is removed from the procedures list. The kept access-request criterion loses ", with backups covered by the retention notice in the terms". In the rehearsal criterion, "a resend on staging, the restore rehearsal with `scripts/restore-reconcile`" becomes "a resend in production to the drill roster". Estimate 5 → 2 h, M → S.
6. **S09.08:** `runs the full E07 deletion with a ledger entry;` → `runs the full E07 deletion;`
   - It still depends on S09.03, which is kept, so the dependency stays valid.

### Deferred to MVP (add rows to the table)

```
| S09.03 (part) Deletion ledger and restore | Write-ahead deletion ledger in Storage and its launch gates, restore procedure, `scripts/restore-reconcile` with completeness checks, recovery mode, restore spend reconciliation, restore and STOP-evidence rehearsals | None: the pilot's Supabase Free project has no backups, so a deletion is final |
| S06.08 (part) Restore reconciliation | Reconciliation interval for a restore gap | Monthly reconciliation only |
| S01.02 (part) Staging project | Separate staging Supabase project; previews on synthetic data | Previews share the production project (accepted pilot risk) |
| S07.09 (part) STOP-evidence retention check | Daily check that Twilio log retention covers the backup window | None |
```
After the table, add: `These parts were deferred by the single-Supabase change (2026-10-02).`

### Manual operations

1. Delete `| Running the staging restore rehearsal and the production STOP-evidence rehearsal (launch gates) | Before launch | 3 h |`
2. `| **Total** | | **18 h** |` → `| **Total** | | **15 h** |`
3. Delete `| Restore reconciliation, only if a restore is ever needed | Contingency | about 4 h (not in the total) |`

### Totals check

| Epic | Old | New |
| --- | --- | --- |
| E01 | 89 | 88.5 |
| E02 | 83.5 | 83.5 |
| E03 | 44 | 44 |
| E04 | 59 | 59 |
| E05 | 43 | 43 |
| E06 | 45 | 44.5 |
| E07 | 52 | 52 |
| E08 | 47 | 47 |
| E09 | 33 | 30 |
| **Build** | **495.5 h / 91** | **491.5 h / 91** |

Dependencies: no story depends on a deferred part. S09.08's only ledger reference is removed. S06.08 keeps the monthly reconciliation that S07.08 and S09 views use. The E06 state-table row that cited S09.03 recovery is removed.
