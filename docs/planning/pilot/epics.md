---
stepsCompleted: [1, 2]
requirementCounts: {functional: 42, nonFunctional: 8, architecture: 27, uxDesign: 19}
inputDocuments:
  - docs/planning/pilot/prd.md
  - docs/planning/pilot/addendum.md
  - docs/architecture/ARCHITECTURE-SPINE.md
  - docs/architecture/solution-design.md
  - docs/research/multilingual-program-search/research.md
  - docs/CVH - UX-UI Design Specification and Clickable Prototype Brief v8.docx
  - design/prototype/ (cvh/inventory.js screens, cvh/strings.*.js, ds/cvrh/tokens.json)
  - data/catalogue/
  - data/seed/
excluded:
  - docs/planning/mvp/ (parked)
  - prototype partner space P-01..P-16, moderation O-08..O-10, resident submissions R-17..R-23, seasonal heads-up R-32, connect-to-service A-05, printed notice X-05, audio X-08, space status X-09, statement chip X-06, code of conduct X-03 (MVP scope)
conventions:
  requirement_ids: 'FR-<PRD id> (e.g. FR-A15), NFR-<PRD id> (e.g. NFR-N5), AR-<n> (architecture), UX-DR<n> (prototype and brief)'
  time_tracking: 'every story carries Estimate (set at planning) and Actual (filled when the story is done)'
---

# CVH Pilot - Epic Breakdown

## Overview

This document breaks the CVH pilot into epics and stories, built from the pilot PRD, the architecture spine (AD-1 to AD-25) and the clickable prototype. The build happens before the two-month pilot and is not counted in it. Every story records an estimate and, when done, the actual time taken.

## Requirements Inventory

### Functional Requirements

FR-A1: Staff, coordinators and ambassadors (for assigned buildings) write alerts for the neighbourhood, buildings, chosen floors and optional groups; heat and smoke are neighbourhood alerts by Hub staff or coordinators only. Web shows every alert in the area, ordered by the device's own choices; SMS goes only to matching subscribers (no building → neighbourhood alerts only; building without floor → every alert for that building).
FR-A2: Alerts go out on the web app and by SMS to matching subscribers (web push deferred to the MVP per AD Deferred). SMS sign-up needs only phone, language and neighbourhood (building, floor, groups, check-in optional); no name, unit, email, password or account; double opt-in by YES even when helped; every message says how to stop; choices changeable and subscription deletable at any time, including by text. The welcome text says, in the resident's language, that messages are checked by Hub staff and may not be sent overnight (accepted pilot risk R-11).
FR-A3: Every alert, guide and interface string is available in the 15 launch languages, machine-translated and labelled, with the English original one tap away; the author sees SMS recipients per language before approval.
FR-A4: Staff and ambassadors post a short acknowledgement before details are known and update it; time to first acknowledgement is measured.
FR-A5: Every alert shows origin and verification in the same words and place on every surface ("Verified by the Hub", "Not yet verified"), never by colour alone; one step explains what "verified" means.
FR-A7: An ongoing disruption is one running thread; every alert has a valid-until; resolved or expired alerts close with a final entry and move to a readable archive.
FR-A9: Residents choose buildings (including a relative's) and alert types, on the device or in their SMS subscription.
FR-A10 (stretch): Hub staff post an official alert's content with source named and a link, labelled "Official alert from [source]"; no automated feeds.
FR-A11: One-step share (including WhatsApp chats and Status) with origin, verification and time readable without opening the link; link opens the live alert with corrections in the opener's language; always the standard version; unverified shared as unverified; sharing not recorded.
FR-A12: First use: language, then optional groups and building/floor (never unit), kept on the device; invitation to SMS sign-up carrying the choices.
FR-A13: Tailoring only orders and highlights and may add one line of advice; never names a group or reason.
FR-A15: Two-person approval for every SMS/push send, correction and withdrawal; one-action approval showing exact text, audience, channels, recipient count. D-1: lower-risk ambassador posts (power, water/plumbing, elevator, flood/leak) appear on the web at once as "Not yet verified"; fire/evacuation and "Other" appear nowhere until approved; approved posts show "Verified by the Hub"; withdrawn posts show the withdrawal in place.
FR-A16: Corrections and withdrawals reach every original recipient on every original channel, marked as corrections; the original shows the correction in place (120 → same 120).
FR-A17: Drills marked as exercises everywhere, sent only to the drill roster, never to residents, never convertible to real alerts, kept apart in every view, count and report.
FR-C1: Check-in requires SMS sign-up; subscription holds only phone, language, neighbourhood, building, floor, groups, check-in request and method.
FR-C3: Check-in requests visible only to ambassadors covering that floor (during an active heat/outage alert) and Admins; others see counts only; building management never.
FR-C4: Residents withdraw a check-in request or unsubscribe (with deletion) at any time, including by text.
FR-C6: Ask for a check-in by call or text; told what it is and is not, not an emergency service, when to call 911, and that an ambassador on her floor sees her number and floor; told at once if no ambassador covers her floor and offered the Hub's number.
FR-C7: During a heat/outage alert, covering ambassadors see their floors' requests (phone, floor, method; no name or reason), mark done / not reached / needs help in one tap, including without signal (held in page memory, sent on reconnect, nothing saved); not reached and needs help pass to the Hub immediately; records deleted at close, counts kept.
FR-D2: Searchable directory of about 100 providers from the reviewed catalogue, filterable by category, neighbourhood and "Helps in an emergency"; listing shows categories, contacts, day-to-day services, emergency role (911 named where not an emergency service), last-confirmed date; one provider in several categories/locations listed once; missing details "not known".
FR-D2-Q: Ask in your own words in any launch language (including romanized): three to five best listings, in the language the question was written in (page language when unclear); meaning-based matching; "no clear match" shows categories and the Hub's number; emergency results show 911 first; time per question measured; test set of about 150 questions with the bar set before launch.
FR-D3: Map of providers and the 43 buildings on a neutral base map with clustered pins; cooling spaces, water fountains and washrooms distinguishable; pins open the same listing.
FR-D4-P: Building page shows register facts (storeys, elevators, emergency power, cooling room, air conditioning, barrier-free entrance) with last-updated date.
FR-D6: Status for each building and neighbourhood (active problem, work in progress, resolved) with text and icon, derived from alerts.
FR-D7: Six preparedness guides (power, flood, elevator, heat, smoke, fire evacuation) with before/during/after, opening at "during" from an alert; one essential-numbers page (911 apart with when to call, 211, 311, building contact).
FR-E1: Ambassador sees alerts for assigned buildings and, during heat/outage alerts, the round for their floors.
FR-E2: Ambassador posts updates or incidents for any floor of assigned buildings (range, list or whole building; one or more types or "Other" with text and 911 first); attribution shown before sending; goes to approval; ambassadors and Hub staff mark incidents resolved.
FR-E3: Rounds reported to the Hub as counts by building and floor.
FR-E5: Hub staff see which buildings and floors have an assigned ambassador.
FR-G1: Roles Admin, Coordinator, Director, Ambassador with the PRD permission table; every account is a named person; residents have no accounts.
FR-G2: Admin-only account lifecycle; usernames, email on record, no email sent; starting password rvh-firstname-lastname valid once with forced change, locked if unused in 24 hours; Admin-only resets (audited); at least two Admins; removal ends access everywhere immediately.
FR-G3: Hub maintains the 43 buildings and floors from the register, with last-updated dates; ambassadors assigned from this list.
FR-G4: Hub maintains providers (from the reviewed catalogue) with last-confirmed dates.
FR-G5: Every send, approval, correction, withdrawal, drill and account change is audited; resident actions are not recorded individually.
FR-G6: Admins see SMS and translation spend against the budget and set a monthly SMS cap; over-cap shows the shortfall (never blocks).
FR-D-6: SMS keywords: STOP/START/HELP in English; numbered replies 1 (building/floor menu), 2 (language menu), 3 (withdraw check-in), 0 (stop and delete); menus per language, one segment per message, 0 back, 9 Hub number, reset after 10 minutes idle.
FR-D-7: End of pilot: re-consent SMS; non-YES deleted after 30 days; staff audit trail and aggregates kept.
FR-M1: Pilot measure: SMS subscribers and web app installs, by language and neighbourhood, reported daily from aggregate counts (no identifiers).
FR-M2: Pilot measure: time from disruption report to first acknowledgement, from writing to approval, and from approval to delivery, per alert, from the audit trail and delivery records.
FR-M3: Pilot measure: directory and map use in an ordinary week (views, searches, no-match rate, time per question by language), aggregate only.
FR-M4: Pilot measure: drills run, and corrections sent with their reach (recipients of the original vs recipients of the correction), drills reported separately.
FR-M5: Pilot measure: cost per alert by language and total spend to date (SMS segments and Cohere usage) against the budget.

### NonFunctional Requirements

NFR-N1: 15 languages including right-to-left layout for Urdu, Dari and Pashto; machine-translated text labelled.
NFR-N2: Screen-reader support, basic mode, status never by colour alone, WCAG 2.1 AA target.
NFR-N3: Ordinary phone browser, installable without an app store, older phones and slow connections; last-loaded alerts, building status and essential numbers readable offline; SMS carries every alert.
NFR-N4: No numeric targets; outages, failed sends and slow deliveries logged and reviewed weekly.
NFR-N5: No resident names; minimum data; personal staff sign-in, second factor for Admin and Coordinator; check-in records deleted at close; plain-language terms naming processors and community ownership; PIPEDA; privacy contact and Hub-handled access/correction; minimum age 16 or younger with a guardian's help; staff sessions 30 minutes idle (ambassadors) and 12 hours (others); phone-first staff screens; staff-assisted sign-up.
NFR-N6: Small codebase; written procedures for sending, approving, correcting, withdrawing and drills; drills rehearsed on the live system against the roster; test system never sends texts.
NFR-N7: Buildings, providers and guides have a named owner and a last-updated or last-confirmed date shown to residents.
NFR-N9: Total build and running cost within about CAD 1,000 for two months (current estimate about CAD 700).

### Additional Requirements

- AR-1 (starter): new Next.js 16.3.8 App Router project (create-next-app, TypeScript per its default) with React 19.3, Tailwind 4.3.3, next-intl 4.14.8, Serwist 9.5.12, Drizzle 0.45.3 + postgres 3.4.9 (`prepare: false`), zod 4.6.5, Vitest 5.0.3, Playwright 1.63.0, dependency-cruiser 18.5.0 — this is Epic 1 Story 1.
- AR-2: modular monolith: `src/app`, `src/contracts`, `src/modules/<11 modules>/{domain,application,adapters,index.ts}`, `src/platform`, `src/ui`, `src/i18n`; dependency graph from the spine enforced by dependency-cruiser; table ownership checked against migrations (AD-2).
- AR-3: one app, two surfaces: `/[lang]` resident (service worker cached) and `/staff` (no-store, network-only except the in-memory round page) (AD-1).
- AR-4: environments: Vercel Pro yul1 + Supabase Pro ca-central-1 production; separate staging Supabase; previews use staging, no cron, no migrations; `SMS_MODE` live only in production, log elsewhere; env schema validated at boot; secrets in Vercel env and Supabase Vault; CI applies SQL migrations before production deploy (AD-15).
- AR-5: database: SQL migrations canonical (Supabase CLI), Drizzle schema with drift check, RLS enabled with no policies, pg_cron and pg_net enabled in the first migration (Conventions, AD-4).
- AR-6: staff auth with Supabase Auth: Admin-created usernames, one-time starting password with forced change and 24-hour lock, TOTP aal2 for Admin and Coordinator, status check every request, global sign-out on suspension, table-driven `policy.ts#can`, session limits (AD-4).
- AR-7: wire contracts as versioned zod schemas in `src/contracts` (LangCode, Audience + matcher, Translated, FeedV1, Thread, Entry, DirectoryManifestV1, SearchV1 with query_lang), contract-tested both sides (AD-20).
- AR-8: alert thread/entry state machine in `lifecycle.ts` mirrored by triggers; editor_ids; content_hash (RFC 8785); D-1 predicate; supersession; single close path; system entries; duplicate hint (AD-5).
- AR-9: lifecycle concurrency: thread lock first, fixed lock order, ALERT_CLOSED, close discards pending and cancels queued (AD-18).
- AR-10: drill isolation by triggers (roster-only deliveries, no drill check-ins), `nondrill_alert` view for every resident read, drill share 404 (AD-6).
- AR-11: one audience matcher in `src/contracts/audience.ts`, SQL equal by property test, recipients + language + body snapshotted at approval, correction recipients rule (AD-7).
- AR-12: Postgres outbox (`delivery` kinds alert/transactional/campaign), claim/submit lease, fixed claim order, ContactResolver port, retries, pause switch, signed status webhooks, spend reservation and cap warning (AD-8).
- AR-13: inbound router decision table, double opt-in, Twilio Advanced Opt-Out, numbered menus, YES resolution, D-7 retention states (AD-9).
- AR-14: translation port with config routes (Cohere only), script/marker and eld checks, p99-derived timeout, fallback_en, OpenCC zh-Hant, cache, spend recording; app never translates directory text (AD-10).
- AR-15: directory publish loads `data/catalogue/`, embeds, writes versioned files to private storage, resumable; search in memory with query-language results, translated-question leg for ps/prs/romanized, RRF, threshold, emergency_first (AD-11).
- AR-16: check-in rounds per thread, consent wording + consent_version, coverage via `identity.coversFloor`, Hub escalation SMS, needs-help retention, tally grain (AD-12).
- AR-17: personal-data confinement, delivery holds no phone, search_log without query text, logger masking, privacy contact and access requests (AD-13).
- AR-18: append-only audit in the same transaction; Section 9 views (AD-14).
- AR-19: one SMS renderer (smsBody.ts) for every outbound text, frozen at submit for alerts, segment counting, one-segment menus with CI fixtures; phone-first approval view (AD-21).
- AR-20: public endpoint throttling, staff-assisted sign-up limited per staff account, transactional ceiling, 5 menus per number per day (AD-22).
- AR-21: health job, ops_event, on-call SMS alerts, weekly N4 view, pause and resend procedures (AD-23).
- AR-22: test strategy: unit, integration against local Supabase for every trigger/constraint/lock, port fakes, e2e on previews, required property/contract/no-cookie tests, search test set and translation checks on change (AD-24).
- AR-23: idempotent seeding: buildings from the register keyed by rsn with merge list, providers and translations from `data/catalogue/`, guides and numbers; roster and on-call numbers entered by Admins; first Admin by audited script (AD-25).
- AR-24: derived building/neighbourhood status in `status.ts` with phase and precedence (AD-19).
- AR-25: versioned public feed with feed_version, edge cache, polling, service-worker highest-version rule, archive endpoint, share URL `?l=` (AD-17).
- AR-26: device-only personalisation, no cookies on resident routes (asserted), aggregate usage beacon (AD-3).
- AR-27: strings and tokens generated from the prototype; RTL logical CSS; Noto subsets; basic mode; one 911 block on alerts, guides, numbers and check-in screens (AD-16).

### UX Design Requirements

UX-DR1: Design tokens from `design/prototype/ds/cvrh/tokens.json` generated into CSS custom properties and a Tailwind v4 theme (light and navy), matching the prototype exactly.
UX-DR2: UI strings generated from `design/prototype/cvh/strings.*.js` (15 languages + `strings.en.screens.js`) into next-intl catalogs, with the visible "[EN]" fallback and a CI missing-key report per language.
UX-DR3: Resident shell from `ResidentApp.dc.html`, `C_ResidentHeader`, `C_ResidentNav` at 320, 390 and 768 widths; language control overlay R-02 reachable from every screen.
UX-DR4: First run R-01 (language), R-26 (groups), R-35 (where I live), R-34 (what I have told the CVH), with choices kept on the device.
UX-DR5: Home R-03 with building status (text + icon + colour) and alerts ordered by device choices; tailored block X-12.
UX-DR6: Alert detail R-07 with origin and verification marker X-02, "what verified means" R-28, machine-translation label X-04 (label and English original only; no report-an-error control in the pilot), exercise marker X-10, disruption type icons X-13, not-911 statement X-01.
UX-DR7: Share R-29 and the shared-message preview R-30.
UX-DR8: Archive R-08.
UX-DR9: SMS sign-up R-05, confirmation R-06 (how to stop, how to change), text message specimen R-04 as the reference for SMS layout.
UX-DR10: Search entry R-09, results R-10, filters R-27 with applied-filter bar X-11 (pilot filters: category, neighbourhood, "Helps in an emergency"), no results R-11 (route to a person).
UX-DR11: Listing R-12, organisation page R-13, "How they can help" box X-14.
UX-DR12: Map R-14, list R-15, preview card R-16 with clustered pins and distinct markers for cooling spaces, fountains and washrooms.
UX-DR13: Be ready index R-24, hazard guide R-25 (before/during/after, opening at "during" from an alert), numbers R-31.
UX-DR14: Ask for a check-in R-33 with the consent wording (ambassador sees number and floor), not-911 statement and no-coverage message.
UX-DR15: Hub shell (`HubApp.dc.html`, `C_HubTop`, `C_HubSide`, 390 width) made phone-first.
UX-DR16: Operator screens O-01 home, O-11 log disruption, O-12 acknowledgement, O-13 promote, O-02 compose, O-03 audience place, O-04 audience group, O-05 pre-send review (phone-first approval view), O-06 published, O-14 update, O-15 correct, O-16 resolve, O-07 ambassador post review, O-17 check-in progress and escalations; O-18 official alert only if A10 is built.
UX-DR17: Ambassador screens A-01 home, A-02 post update, A-03 post confirmation and channel status, A-04 my round (one-handed, works without signal).
UX-DR18: Basic mode X-07 across resident screens.
UX-DR19: Accessibility: screen-reader labels on every control, status never by colour alone, 44 px touch targets, contrast per WCAG 2.1 AA, logical CSS for RTL, Noto font subsets per active language.

### Launch Readiness (non-development, not counted as stories)

| Item | Owner | Needed by |
| --- | --- | --- |
| Submit Twilio toll-free verification (Hub business number, address, website) | Hub | Week 1 of build |
| Get Cohere pricing for the translate models; set an organisation spend limit | Hub / IT | Before launch |
| Confirm Cohere production access and exact model identifiers for Command A Translate and North Small Translate (both require production access); until then all routes are provisional | Hub / IT | Before launch |
| Search meets every Hub-approved minimum (hit rate per language, no-match accuracy, emergency accuracy) on the evaluation subset of the full test set (S03.08) | Hub + IT | Before launch |
| Confirm Tiny Aya's licence covers the Hub's use (if routed) | Hub | Before launch |
| Confirm each building's real floor labels (43 buildings) | Hub | Before seeding production |
| Write the search test set with ambassadors: about 10 real questions per language, 150 in total, each with the expected provider | Hub + ambassadors | Before search tuning |
| Measure Cohere p99 translation latency and set the per-language timeout | IT | Before launch |
| Name the privacy contact; counsel review of consent and terms wording | Hub | Before launch |
| Written procedures (N6): sending, approving, correcting, withdrawing, drills, pause, resend, cap overrun | Hub | Before launch |
| Name the Admin on-call roster and on-duty Hub number; enter drill roster | Hub | Before launch |
| Rehearse a full drill in production; rehearse one database restore | Hub + IT | Before launch |
| Plan launch events with staff-assisted sign-up | Hub | Before launch |

### FR Coverage Map

| Requirement | Epic(s) |
| --- | --- |
| FR-A1 targeting | E04 (web), E07 (SMS) |
| FR-A2 SMS sign-up, channels, welcome text | E07 |
| FR-A3 languages | E02 (interface, guides), E04 (alerts) |
| FR-A4 acknowledgement | E04 |
| FR-A5 verification marker | E04 |
| FR-A7 running threads, valid-until, archive | E05 |
| FR-A9 buildings and topics | E02 (on the phone), E07 (SMS subscription) |
| FR-A10 official alerts (stretch) | E10 |
| FR-A11 share | E05 |
| FR-A12 first-use choices | E02 |
| FR-A13 tailoring | E04 |
| FR-A15 two-person approval, D-1 | E04 (approval, D-1 rule), E08 (ambassador posts) |
| FR-A16 corrections on every channel | E05 (web), E07 (SMS) |
| FR-A17 drills | E06 |
| FR-C1, C3, C4, C6, C7 check-ins | E08 |
| FR-D2 directory | E02 |
| FR-D2-Q ask in your own words | E03 |
| FR-D3 map | E02 |
| FR-D4-P building facts | E02 |
| FR-D6 live status | E05 |
| FR-D7 guides and numbers | E02 |
| FR-E1, E2, E3 ambassador tools | E08 |
| FR-E5 coverage | E01 |
| FR-G1, G2, G3, G5 roles, accounts, buildings, audit | E01 |
| FR-G4 providers | E02 |
| FR-G6 spend and cap | E07 |
| FR-D-6 keywords and menus | E07 |
| FR-D-7 end of pilot | E09 |
| FR-M1 subscribers and installs | E02 (installs), E07 (subscribers), E09 (view) |
| FR-M2 timings | E04, E06 (data), E09 (view) |
| FR-M3 directory and search use | E02, E03 (data), E09 (view) |
| FR-M4 drills and correction reach | E06, E07 (data), E09 (view) |
| FR-M5 cost per alert | E06, E07 (data), E09 (view) |
| NFR-N1, N2, N3, N7 | E02 (carried by every later epic) |
| NFR-N4 weekly review | E09 |
| NFR-N5 privacy and security | E01 (staff), E07 (terms, consent), E08 (check-in consent), E09 (access requests) |
| NFR-N6 procedures and drills | E06, E09 |
| NFR-N9 cost | E06, E07, E09 |

## Epic List

**Conventions.** Epics `E01`–`E10`; stories `S<epic>.<nn>` (e.g. `S04.03`); branches `e04-s03-<short-slug>`. Story size S (up to 4 hours) or M (1 day) by default; L (2 days) only with a written reason in the story. Every story records **Estimate** and **Actual** time.

**Launch gate.** The pilot launches only when E01–E08 are done, plus E09's health alerts and written procedures. E09's Director measures view and end-of-pilot process may land during the pilot (D-7 must be ready by day 60). E10 is optional. Residents never get E04 without E05.

**Optional soft launch.** Once E02 and E03 are done, they may be opened to ambassadors during the build to collect translation and search feedback for the catalogue and the search test set.

### E01 — Hub staff sign in and run the pilot's foundations
Admins create staff accounts; staff sign in safely; the 43 buildings and floors are seeded (floor labels marked unconfirmed until the Hub confirms them) and ambassadors assigned; coverage and the audit trail work; a first text arrives from production (labelled spike, removed in E06).
**Covers:** FR-G1, G2, G3, G5, E5 · NFR-N5 (staff) · AR-1–6, 18, 22, 23 · UX-DR15

### E02 — Residents use the CVH every day in their own language
The installable resident app in 15 languages with first-run choices on the phone, the reviewed directory, map, building facts, guides, numbers, basic mode and offline reading.
**Covers:** FR-A3 (interface, guides), A9 (phone), A12, D2, D3, D4-P, D7, G4, M1 (installs), M3 (browsing) · NFR-N1, N2, N3, N7 · AR-3, 15 (publish), 26, 27 · UX-DR1–5, 10–13, 18, 19

### E03 — Residents ask in their own words and get the right provider
Starts with the search test-set format, runner and a starter set of about 30 questions (the full 150 come from ambassadors before launch). Meaning-based search in any language, romanized included, answered in the question's language, with a no-match route, 911 first on emergency results and the test set in CI.
**Covers:** FR-D2-Q, M3 (search) · AR-15 (search), 24 · UX-DR10

### E04 — Hub staff write, translate and approve alerts residents can trust
Starts by measuring Cohere's p99 translation latency and setting the per-language timeouts. Staff log a disruption, acknowledge it, compose an alert for a place or group, translate it into 15 languages with checks, and a second person approves it; it appears on the web, ordered and tailored on the phone, with the verification marker.
**Covers:** FR-A1 (web), A3 (alerts), A4, A5, A13, A15, M2 (web timings) · AR-7, 8, 9, 11, 14, 19 (rendering, approval view), 24 · UX-DR6, 15, 16

### E05 — Alerts stay current: updates, corrections, closing, status and sharing
Running threads with updates, corrections and withdrawals shown in place, closing and expiry, the archive, derived building and neighbourhood status, and one-step sharing.
**Covers:** FR-A7, A11, A16 (web), D6 · AR-8 (supersession, close), 9, 24, 25 · UX-DR6–8, 16

### E06 — Texts go out safely
The outbound queue for every text, the single SMS renderer, sending with a fixed order, delivery status webhooks, drills isolated to the roster, the pause switch and a stuck-queue alert; the Hub can send a drill alert by text to staff on the roster. Replaces the E01 spike.
**Covers:** FR-A17, M2 (delivery data), M4 (drills), M5 (cost data) · NFR-N6 · AR-10, 12, 19 (SMS), 21 (minimal)

### E07 — Residents sign up and get alerts by text
The terms and privacy page, SMS sign-up (also staff-assisted) with YES confirmation and the welcome text, keywords and numbered menus, alerts and corrections sent to matching subscribers, spend cap warnings and abuse limits, deletion on STOP.
**Covers:** FR-A1 (SMS), A2, A9 (SMS), A16 (SMS), G6, D-6, M1 (subscribers), M4 (correction reach), M5 · NFR-N5 (terms), N9 · AR-11 (SMS fan-out), 13, 20 · UX-DR9

### E08 — Ambassadors post building updates and check on neighbours
Posting stories come first (ambassador home, web-first "Not yet verified" posts) so posting works even if sign-up slips; then check-in requests with consent and coverage checks, the round that works without signal, Hub escalation and counts.
**Covers:** FR-E1, E2, E3, C1, C3, C4, C6, C7, A15 (D-1 path) · NFR-N5 (check-in consent) · AR-16 · UX-DR14, 17

### E09 — The Hub monitors the pilot and closes it cleanly
The full health job and on-call alerts, resend of failed texts, the weekly review, the Director's read-only pilot measures view, privacy access requests, and end-of-pilot re-consent and deletion.
**Covers:** FR-D-7, M1–M5 (view) · NFR-N4, N5 (access requests), N6, N9 · AR-17, 21

### E10 (optional stretch) — Hub staff relay an official alert
An official alert from a named source, with a link, through normal approval.
**Covers:** FR-A10 · UX-DR16 (O-18)

## E01 — Hub staff sign in and run the pilot's foundations

Admins create staff accounts; staff sign in safely; the 43 buildings and floors are seeded and ambassadors assigned; coverage and the audit trail work; a first text arrives from production.

**Epic estimate:** 81 h across 15 stories (5 S, 10 M) · **Epic actual:** —

**Shared foundations reused by later stories and epics:** environment configuration (S01.02), migrations and RLS (S01.03), the audit trail (S01.04), accounts and sessions (S01.05–S01.11), the role policy (S01.12), buildings and floors (S01.13), coverage (S01.14). Each story creates only the tables it needs and names the stories it depends on.

**Definitions used in this epic**

| Term | Meaning |
| --- | --- |
| Starting password | `rvh-<firstname>-<lastname>`, lower case, spaces removed, accents stripped. Valid for one successful sign-in and for 24 hours from issue. |
| Expired starting password | Unused 24 hours after issue. Signing in with it fails with "Your starting password has expired. Ask an Admin to re-issue it." and sets the account to `locked_pending_reissue`. Only an Admin's re-issue (new 24-hour window, audited) unlocks it. |
| Own password | At least 10 characters, not containing the username, not equal to the starting password. |
| Failed-sign-in throttle | 5 failed attempts for one username within 15 minutes lock that username for 15 minutes; 20 failures from one client (salted IP hash) within an hour block that client for an hour. The message is always "Username or password is incorrect" (no hint whether the username exists). |
| Session limits | Ambassadors: signed out after 30 minutes with no authenticated request, and after 12 hours in any case. Coordinators, Directors, Admins: signed out 12 hours after sign-in. |
| Setup sequence | After signing in, a staff member passes these gates in order: (1) replace the starting password, if one is in use; (2) enrol an authenticator, if the role is Admin or Coordinator and none is enrolled; (3) enter the Hub. At each gate only that gate's page and API, `GET /api/staff/me` and `POST /api/staff/sign-out` are reachable; every other `/staff` page redirects to the current gate and every other `/api/staff` call returns 403 with `setup_incomplete`. |
| Authenticator level | Admins and Coordinators enter an authenticator code once at sign-in, which raises the session to `aal2` for its 12-hour life. Privileged actions require an `aal2` session; the pilot does not ask for a new code per action (per-action step-up is an MVP decision). |
| Session revocation | Suspension, removal, password reset, authenticator reset and any role change end every session of that account on every device; the next request returns 401. |
| Usable Admin | An Admin account that is active (not suspended or removed), not locked (no failed-sign-in lock, not `locked_pending_reissue`), has replaced its starting password, and has an enrolled authenticator. Changes that can make an Admin unusable: suspension, removal, demotion, password reset (a new starting password), authenticator reset and any lock. |
| Bootstrap state | Initial setup only: from the creation of the first Admin until two usable Admins exist for the first time. During it, each pending Admin (the first Admin and the one second Admin they create) may only complete their own setup (replace the starting password, enrol an authenticator, sign out); the first Admin may also create the second Admin. It ends permanently when the second Admin becomes usable (`bootstrap.completed` audited). A later shortfall never re-enters bootstrap; it is handled by the recovery rules in S01.06 and S01.11. |
| Covered floor | A floor of a pilot building that has at least one assigned Ambassador (whole building or that floor) who is active, not suspended or removed, and not locked (failed-sign-in lock or `locked_pending_reissue`). |

### Story S01.01 — Developer can run, test and deploy the CVH app skeleton

- **Size:** M · **Estimate:** 6 h · **Actual:** —
- **Traces:** AR-1, AR-2, AR-22 · **Depends on:** none · **Branch:** `e01-s01-app-skeleton`

As a developer,
I want a new CVH app with the agreed stack, module layout and checks,
So that every later story starts from the same structure and rules.

**Acceptance Criteria:**

**Given** the repository with its existing `docs/`, `data/`, `design/` and `scripts/` folders
**When** the project is created with `create-next-app` 16.3.8 (App Router, TypeScript default) and the spine's Stack table is installed
**Then** `package.json` pins exactly the Stack table's versions
**And** `src/app`, `src/contracts`, `src/modules/<11 modules>/{domain,application,adapters}` with an `index.ts` each, `src/platform`, `src/ui`, `src/i18n` and `db/migrations` exist

**Given** the dependency graph in `docs/architecture/ARCHITECTURE-SPINE.md`
**When** `npm run lint:deps` runs
**Then** dependency-cruiser fails on a cycle, an undeclared module-to-module edge, or an import of another module's non-`index.ts` file
**And** a deliberately bad import in a test fixture makes it fail

**Given** a push to any branch
**When** CI runs
**Then** lint, type check, unit tests and the dependency check must pass before a Vercel preview is built

**Given** a merge to `main`
**When** Vercel deploys to production (region `yul1`)
**Then** a post-deploy smoke check requests `/` (200), `/api/health` (200 with app version) and `/staff/sign-in` (200 with `Cache-Control: no-store`)
**And** if any check fails, the previous production deployment is promoted back (instant rollback) and the failure is shown in the CI run

### Story S01.02 — Environments are separated and refuse unsafe settings

- **Size:** S · **Estimate:** 4 h · **Actual:** —
- **Traces:** AR-4, NFR-N6 · **Depends on:** S01.01 · **Branch:** `e01-s02-environment-safeguards`

As a developer,
I want production, staging and previews kept apart with settings checked at start-up,
So that no environment can text residents or touch production data by mistake.

**Acceptance Criteria:**

**Given** two Supabase Pro projects, production in `ca-central-1` and staging
**When** the app runs in production, staging and a preview
**Then** production connects only to the production project, and staging and previews connect only to staging (each environment's credentials exist only in that environment's Vercel variables)

**Given** `src/platform/config/env.ts` validates variables with zod at start-up
**When** `SMS_MODE` is anything but `live` in production or anything but `log` elsewhere
**Then** the app refuses to start and logs which rule failed

**Given** `PUBLIC_BASE_URL` (used in alert links, share links and texts)
**When** it is missing, is not `https` (except `http://localhost` in local development), in production does not equal the production host set in `src/platform/config/hosts.ts`, or outside production equals the production host
**Then** the app refuses to start and logs which rule failed
**And** an automated test covers each rejected combination of environment, `SMS_MODE` and `PUBLIC_BASE_URL`

**Given** Twilio credentials
**When** they are present in any environment other than production
**Then** start-up fails ("Twilio credentials are only allowed in production")

### Story S01.03 — Database changes are migrated, locked down and recoverable

- **Size:** M · **Estimate:** 6 h · **Actual:** —
- **Traces:** AR-5, AR-4 · **Depends on:** S01.02 · **Branch:** `e01-s03-migrations-rls`

As a developer,
I want schema changes applied by CI with checks and a clear recovery path,
So that a bad migration never leaves production half-changed or exposed.

**Acceptance Criteria:**

**Given** the first migration
**When** it is applied
**Then** it enables `pg_cron` and `pg_net` and creates no application tables

**Given** any migration that creates a table
**When** CI runs
**Then** CI fails if the table has RLS disabled or has any anon or authenticated policy

**Given** a merge to `main`
**When** CI applies migrations to production
**Then** each migration runs in its own transaction, production is migrated before the app deploys, and previews never apply migrations or run cron jobs

**Given** a migration that fails
**When** CI applies it
**Then** that migration is rolled back, the pipeline stops, the production app is not redeployed, and the app keeps running on the previous release
**And** because the failed migration was never applied, it may be corrected in place and the pipeline re-run; migrations already recorded as applied in production are immutable, and CI rejects any edit to them (checksum check against production's migration history)
**And** a problem found after a migration has been applied is fixed forward with a new migration

**Given** a production deploy can be rolled back to the previous app release without rolling back the database
**When** a migration is added
**Then** it must keep the schema compatible with the previous release (expand, then contract in a later release)
**And** CI fails a migration that drops or renames a table or column, or narrows a column type, unless it carries a `-- contract:` note naming the release that stopped using it, and that release is already in production

**Given** Drizzle connects through the Supabase transaction pooler with `prepare: false`
**When** the drift test runs in CI
**Then** it fails if the hand-written Drizzle schema differs from a freshly migrated database

### Story S01.04 — Every staff action leaves a permanent, safe audit record

- **Size:** M · **Estimate:** 5 h · **Actual:** —
- **Traces:** FR-G5, AR-18, AR-17 · **Depends on:** S01.03 · **Branch:** `e01-s04-audit-trail`

As a Hub Admin,
I want every staff action and failed attempt recorded with who did it and when,
So that the pilot can show who did what without storing anything sensitive.

**Acceptance Criteria:**

**Given** `audit_event(id, at, actor_staff_id, action, subject_type, subject_id, outcome, is_drill, meta)` owned by the `audit` module
**When** a change succeeds
**Then** `audit.record(...)` writes its `ok` record inside the same transaction, so the change and its record commit or roll back together

**Given** an action is refused or fails (wrong password, lock, permission denied, two-Admin rule, validation)
**When** the business transaction is rolled back or never started
**Then** `audit.recordRefusal(...)` writes the `refused` record in its own separate transaction afterwards, so the record survives the rollback
**And** an integration test shows a refused change leaves business data unchanged and exactly one `refused` record added

**Given** an action listed in this epic (`account.*`, `bootstrap.completed`, `password.*`, `factor.*` (including `factor.enrolled` and `factor.reset`), `auth.signed_in`, `auth.failed`, `auth.locked`, `session.revoked`, `permission.denied`, `building.*`, `assignment.*`, `seed.run`, `sms.test_sent`)
**When** it happens
**Then** exactly one audit record is written with `outcome` `ok` or `refused`

**Given** each action type has an allow-listed `meta` schema
**When** `meta` contains a field outside the schema
**Then** the record is rejected
**And** passwords, tokens, authenticator secrets, phone numbers, email addresses and message bodies can never be stored; the person is identified only by `actor_staff_id` and the subject by id

**Given** writing an `ok` audit record fails
**When** it is part of a change (create, assign, reset and so on)
**Then** the whole change fails and nothing is saved (fail closed)

**Given** writing a `refused` record fails
**When** the action was already refused
**Then** it stays refused (never turned into a success), and the audit failure is logged as an operational error

**Given** the application's own database role
**When** it attempts UPDATE or DELETE on `audit_event`
**Then** the database refuses (integration test using the app's credentials, not the owner role)

### Story S01.05 — Admin can bootstrap the first Admin and create staff accounts

- **Size:** M · **Estimate:** 6 h · **Actual:** —
- **Traces:** FR-G1, FR-G2, AR-6, AR-23 · **Depends on:** S01.04 · **Branch:** `e01-s05-staff-accounts`

As a Hub Admin,
I want a controlled first-Admin setup and a screen to add each staff member,
So that everyone gets a named account without the Hub sending email.

**Acceptance Criteria:**

**Given** no Admin exists
**When** IT runs `scripts/create-first-admin` (service key, production only) with username, first name, last name and email
**Then** one Admin is created with a starting password, `account.created` is audited with actor `system`, and the system is in bootstrap state
**And** running the script while any Admin exists is refused

**Given** an Admin on "Add a person"
**When** they enter username, first name, last name, email and role
**Then** the account is created with a starting password and `must_change_password = true`, and no email is sent
**And** a duplicate username is refused; names that reduce to an empty starting password (e.g. only symbols) are refused with a message

**Given** bootstrap state
**When** the first Admin tries anything except completing their own setup or creating one second Admin, or the second Admin tries anything except completing their own setup
**Then** it is refused with "Finish setting up two Admins first"
**And** the first Admin cannot create a third account, or a second account of any other role, during bootstrap

**Given** both pending Admins
**When** each signs in with their starting password
**Then** each can replace their password and enrol an authenticator following the setup sequence, without needing the other to act first
**And** when the second Admin becomes usable, `bootstrap.completed` is audited and bootstrap never returns, even if usable Admins later drop below two

### Story S01.06 — There are always at least two usable Admins

- **Size:** S · **Estimate:** 4 h · **Actual:** —
- **Traces:** FR-G2, AR-6 · **Depends on:** S01.05 · **Branch:** `e01-s06-two-admin-rule`

As a Hub Admin,
I want the system to refuse any change that leaves fewer than two usable Admins,
So that the Hub can never lock itself out.

**Acceptance Criteria:**

**Given** exactly two usable Admins
**When** someone tries to suspend, remove or demote either of them
**Then** it is refused with "There must always be at least two usable Admins" and audited as `refused`

**Given** a recovery action on an Admin (an Admin-issued password reset or authenticator reset, see S01.08 and S01.11), or an automatic lock (failed-sign-in lock, expired starting password)
**When** it would leave fewer than two usable Admins
**Then** it is allowed, because blocking it would stop the Admin recovering; this is the only exception to the rule
**And** the Hub shows every Admin a "Fewer than two usable Admins" banner until two are usable again, and the audit record carries `admin_shortfall: true`

**Given** three usable Admins
**When** two requests to demote two different Admins run at the same time
**Then** exactly one succeeds and the other is refused (enforced by a lock on Admin rows and a database trigger; integration test fires both requests concurrently)

**Given** bootstrap has ended
**When** usable Admins drop below two through the recovery exception
**Then** the system does not re-enter bootstrap; suspension, removal and demotion of Admins stay refused, and all other actions continue normally

### Story S01.07 — Staff member signs in and replaces their starting password

- **Size:** M · **Estimate:** 7 h · **Actual:** —
- **Traces:** FR-G2, NFR-N5, AR-6 · **Depends on:** S01.05 · **Branch:** `e01-s07-sign-in`

As a staff member,
I want to sign in with my username and set my own password on first use,
So that only I can act under my name.

**Acceptance Criteria:**

**Given** an account with a valid starting password
**When** the person signs in with it
**Then** they are at gate 1 of the setup sequence: only "Choose your password", `POST /api/staff/password`, `GET /api/staff/me` and `POST /api/staff/sign-out` are reachable; every other `/staff` page redirects there and every other `/api/staff` call returns 403 with `setup_incomplete`
**And** after a valid own password is saved, the starting password no longer works, `password.changed` is audited, and the person moves to the next gate (authenticator enrolment for Admins and Coordinators, otherwise the Hub)

**Given** a starting password unused for 24 hours
**When** the person signs in with it
**Then** sign-in fails with the expired message, the account becomes `locked_pending_reissue`, and `auth.locked` is audited
**And** after an Admin re-issues it, a new 24-hour window starts

**Given** 5 wrong passwords for one username within 15 minutes, or 20 failures from one client within an hour
**When** another attempt is made
**Then** it is refused for the lock period with the same generic message, even if the password is right, and each failure is audited as `auth.failed`

**Given** a proposed own password shorter than 10 characters, containing the username, or equal to the starting password
**When** it is submitted
**Then** it is refused with the reason

### Story S01.08 — Sessions expire and are revoked when they should be

- **Size:** M · **Estimate:** 6 h · **Actual:** —
- **Traces:** FR-G2, NFR-N5, AR-6 · **Depends on:** S01.07 · **Branch:** `e01-s08-sessions`

As a Hub Admin,
I want sessions to end on time and immediately when access changes,
So that a lost phone or a departed volunteer cannot keep access.

**Acceptance Criteria:**

**Given** an Ambassador with no authenticated request for 30 minutes, or any Ambassador session older than 12 hours
**When** they make a request
**Then** it returns 401 and they are sent to sign-in

**Given** a Coordinator, Director or Admin session older than 12 hours
**When** they make a request
**Then** it returns 401

**Given** an Admin suspends or removes an account, resets its password or authenticator, or changes its role
**When** that account's open session on any device makes its next request
**Then** it returns 401 (status checked on every request; global sign-out), and `session.revoked` is audited

**Given** a staff member forgets their password
**When** an Admin chooses "Reset password"
**Then** a new starting password is issued with the same 24-hour rule, all sessions are revoked, and `password.reset` is audited; there is no self-service reset in the pilot
**And** resetting an Admin's password is a recovery action: it is allowed even if it leaves fewer than two usable Admins (S01.06 exception)

### Story S01.09 — Staff use a phone-first Hub

- **Size:** S · **Estimate:** 4 h · **Actual:** —
- **Traces:** UX-DR15, NFR-N5, AR-3 · **Depends on:** S01.07 · **Branch:** `e01-s09-hub-shell`

As a Coordinator approving from my phone,
I want the Hub's screens built for a phone first,
So that I can act quickly away from a desk.

**Acceptance Criteria:**

**Given** the Hub shell from `HubApp.dc.html`, `C_HubTop` and `C_HubSide`
**When** opened at 390 px wide
**Then** navigation, the signed-in person and role, and sign-out are reachable without horizontal scrolling, with 44 px touch targets
**And** at 1280 px the same shell shows the side navigation

**Given** any `/staff/**` or `/api/staff/**` response
**When** inspected
**Then** it carries `Cache-Control: no-store`

**Given** a screen reader
**When** it reads the shell
**Then** every control has an accessible name, and the current page is announced

### Story S01.10 — Admins and Coordinators must use an authenticator code

- **Size:** M · **Estimate:** 6 h · **Actual:** —
- **Traces:** FR-G2, NFR-N5, AR-6 · **Depends on:** S01.08 · **Branch:** `e01-s10-totp-enforcement`

As a Hub Admin,
I want Admins and Coordinators to confirm sign-in with an authenticator app, and every privileged action to require that confirmed (`aal2`) session,
So that a stolen password alone can never approve, send or change anything.

**Acceptance Criteria:**

**Given** an Admin or Coordinator without an enrolled authenticator who has replaced their starting password
**When** they reach gate 2 of the setup sequence
**Then** only the enrolment page, `POST /api/staff/factor/enrol`, `POST /api/staff/factor/verify`, `GET /api/staff/me` and `POST /api/staff/sign-out` are reachable; every other `/api/staff` call returns 403 with `setup_incomplete`
**And** after the confirming code is accepted, the session is `aal2`, `factor.enrolled` is audited, and they enter the Hub

**Given** an Admin or Coordinator with an enrolled authenticator
**When** they sign in
**Then** they enter one authenticator code once, the session becomes `aal2` for its 12-hour life, and no further code is asked per action

**Given** any privileged server action (approve, send, correct, withdraw, drill, publish, cap, pause, account changes)
**When** the request's verified token is below `aal2`
**Then** the server refuses it with 403, whatever the screen showed (tested by calling each action directly)

**Given** an Ambassador or Director
**When** they sign in
**Then** no authenticator is required

**Given** an account is given the Admin or Coordinator role
**When** the change is saved
**Then** all its sessions are revoked and it must enrol an authenticator at next sign-in before using the new role

### Story S01.11 — Admin can recover a lost authenticator safely

- **Size:** S · **Estimate:** 4 h · **Actual:** —
- **Traces:** FR-G2, AR-6 · **Depends on:** S01.10, S01.06 · **Branch:** `e01-s11-factor-recovery`

As a Coordinator who lost my phone,
I want an Admin to reset my authenticator,
So that I can get back in without weakening security for everyone.

**Acceptance Criteria:**

**Given** a Coordinator or Admin reports a lost phone
**When** another Admin (never the person themselves) chooses "Reset authenticator"
**Then** the factor is removed, all the person's sessions are revoked, they must enrol a new authenticator at next sign-in, and `factor.reset` is audited

**Given** an Admin's authenticator is reset
**When** this would leave fewer than two usable Admins
**Then** the reset still happens under the recovery exception in S01.06, the shortfall banner shows, and the remaining usable Admin is told to restore a second usable Admin
**And** the system does not re-enter bootstrap

**Given** every usable Admin has lost access
**When** IT runs `scripts/recover-admin` with the service key
**Then** one named Admin's authenticator is reset under the same rules, and the run is audited with actor `system` and a reason

### Story S01.12 — Each role can do exactly what the pilot allows, enforced on the server

- **Size:** M · **Estimate:** 6 h · **Actual:** —
- **Traces:** FR-G1, AR-6 (AD-4 matrix) · **Depends on:** S01.10 · **Branch:** `e01-s12-role-policy`

As a Hub Admin,
I want one rule book deciding who can do what, enforced on every request,
So that no one can do more than their role allows, even by calling the server directly.

**Acceptance Criteria:**

**Given** `identity/domain/policy.ts#can(role, action, context)`
**When** the table-driven unit test runs every row of the AD-4 authority matrix
**Then** allowed combinations return true and all others false

**Given** every staff route handler and server action that exists at the end of this epic
**When** an integration test calls each directly as: no session, each role, and an Ambassador outside their assigned building
**Then** unauthenticated calls return 401, disallowed roles and out-of-scope calls return 403, business data is unchanged, and one `permission.denied` refusal record is added to the audit trail

**Given** a Director
**When** any write endpoint is called directly with a Director session
**Then** it returns 403, business data is unchanged, and one `permission.denied` refusal record is added
**And** later epics extend this test with every new endpoint (a CI check fails if a staff endpoint is missing from the permission test list)

### Story S01.13 — Admin can import and confirm the 43 pilot buildings and their floors

- **Size:** M · **Estimate:** 7 h · **Actual:** —
- **Traces:** FR-G3, FR-D4-P (data), AR-23 · **Depends on:** S01.12 · **Branch:** `e01-s13-buildings-floors`

As a Hub Admin,
I want the pilot buildings and floors loaded from the City register and confirmed by us,
So that alerts, sign-ups and assignments all use one correct list.

**Acceptance Criteria:**

**Given** `data/seed/apartment_building_reg.geojson`
**When** the seed script runs
**Then** exactly the 43 buildings in M4H (32) and M3C (11) are upserted into `building`, keyed by `rsn`, with address, coordinates, neighbourhood and the D4-P facts, and `seed.run` is audited with counts

**Given** the import runs again
**When** register facts have changed
**Then** facts and last-updated are updated, confirmed floor labels are never overwritten, and a building no longer in the register is flagged "not in latest register" for Admin review, never deleted

**Given** any row fails validation (missing `rsn`, coordinates outside Toronto, the same `rsn` twice)
**When** the import runs
**Then** the whole import rolls back, nothing changes, and the report lists every failing row

**Given** two register entries with the same address but different `rsn` (e.g. "85-95 Thorncliffe Park Dr")
**When** the import runs
**Then** they stay two buildings unless `data/seed/building-merge.csv` maps them to one primary `rsn`; without that file entry the import reports the duplicate as a warning and continues

**Given** a building with `CONFIRMED_STOREYS = N`
**When** first imported
**Then** `building_floor` gets floors 1..N marked unconfirmed, each with a stable floor id
**And** an Admin can rename, add or remove floor labels (e.g. no 13, "G", "L") and mark the building confirmed; each change is audited

**Given** an Admin edits floor labels
**When** a label is empty, longer than 8 characters, uses characters other than letters, digits, spaces and hyphens, or duplicates another label in the same building (ignoring case and spaces)
**Then** the change is refused with the reason and nothing is saved

**Given** a floor with one or more ambassador assignments
**When** an Admin tries to remove it
**Then** it is refused with "Reassign or remove the ambassadors on this floor first", listing them; renaming the floor is allowed and keeps its id and assignments

### Story S01.14 — Admin can assign ambassadors and see which floors are covered

- **Size:** M · **Estimate:** 6 h · **Actual:** —
- **Traces:** FR-E5, FR-G3, AR-16 · **Depends on:** S01.13 · **Branch:** `e01-s14-assignments-coverage`

As a Hub Admin,
I want to assign ambassadors to buildings and floors and see the gaps,
So that I know where check-ins can be promised before a disruption.

**Acceptance Criteria:**

**Given** an active Ambassador account
**When** an Admin assigns it to a building with "all floors" or a list of floor ids
**Then** `ambassador_assignment(staff_id, rsn, floor_ids | null)` is saved and audited
**And** a floor id not belonging to that building, or a non-Ambassador account, is refused

**Given** `identity.coversFloor(rsn, floor_id)`
**When** it is called
**Then** it returns true only for a covered floor, with tests for: whole building, listed floors, reassignment to another building, removal, suspended or locked ambassador (not covering), renamed floor label (still covered by id), and an unknown building (false)

**Given** the coverage view
**When** an Admin or Coordinator opens it on a phone
**Then** each of the 43 buildings shows covered and uncovered floors in text as well as colour, and a Director sees it read-only

### Story S01.15 — Admin sees a first text arrive from production (spike)

- **Size:** S · **Estimate:** 4 h · **Actual:** —
- **Traces:** AR-4 (SMS_MODE), Launch readiness (toll-free verification) · **Depends on:** S01.10 · **Branch:** `e01-s15-first-text-spike`
- **Note:** labelled spike; E06 removes it when the outbound queue replaces it.

As a Hub Admin,
I want to send one test text from production to an approved phone,
So that we learn in week one whether the Twilio account and toll-free number work.

**Acceptance Criteria:**

**Given** production only: `SMS_MODE=live`, Twilio credentials and the toll-free number exist only in production's Vercel variables, and `SMS_TEST_ALLOWLIST` (E.164 numbers set in production's variables, never in the repository) is configured
**When** an Admin at `aal2` picks an allowlisted number and presses "Send test text"
**Then** one text "CVH test from production" is sent through the Twilio adapter, and the screen shows Twilio's API response status and message id
**And** `sms.test_sent` is audited with the status, without the phone number

**Given** a number not on the allowlist
**When** the Admin tries to send
**Then** it is refused and no provider call is made

**Given** a second press within 5 minutes for the same number, or a repeated request with the same request id
**When** it arrives
**Then** it is refused as a duplicate and no second text is sent

**Given** Twilio returns an error (for example unverified toll-free number or invalid credentials)
**When** the test runs
**Then** the screen shows the provider's error code and message, nothing is retried automatically, and the outcome is audited as `refused`

**Given** staging or a preview
**When** the page is opened
**Then** the button is replaced by "Texts are only sent from production"; no Twilio credentials exist there (S01.02)
**And** delivery-status callbacks are not part of the spike; they arrive with the outbound queue in E06

## E02 — Residents use the CVH every day in their own language

Residents open the CVH in any phone browser, choose their language and what matters to them on the phone, browse the reviewed directory and map, read building facts, guides and essential numbers, switch to basic mode, install the app and read what they last loaded without signal.

**Epic estimate:** 87 h across 15 stories (4 S, 11 M) · **Epic actual:** —

**Depends on E01:** S01.01 (app and CI), S01.02 (environments), S01.03 (migrations and RLS), S01.04 (audit), S01.12 (role policy and permission test list), S01.13 (buildings and floors). Each story creates only the tables it needs and names the stories it depends on.

**Definitions used in this epic**

| Term | Meaning |
| --- | --- |
| Launch languages | The 15 codes in `design/prototype/cvh/data.js` (`ur ps tl prs gu ta el sk bn hi pa zh es fr en`). `ur`, `ps` and `prs` are right-to-left. Traditional Chinese (`zh-Hant`) is offered as a labelled script conversion of `zh`, never a separate translation. |
| Language URL | Every resident page lives under `/{lang}/…` with `lang` a `LangCode`. An unknown code redirects to `/en/…` with the same path. `/` sends a first-time visitor to the language screen and a returning one to their saved language. |
| Device choices | Language, buildings (any number, by `rsn`, including a relative's), floors (by floor id, never unit), groups, muted topics and basic mode, stored only in `localStorage` under `cvh.choices` as `{v: 1, …}` validated by a zod schema in `src/contracts`. A missing, unreadable or invalid value is treated as "no choices" and the first-run screens are offered again; the app never fails because of it. |
| Published provider | A provider in the current directory release that the Hub has published and given a last-confirmed date. Unconfirmed providers are loaded but never shown to residents. |
| Release | One numbered, immutable set of directory files: one listing file per launch language plus `zh-Hant`, and a manifest. Only one release is current. |
| Machine-translation label | The catalog string shown on any text that was machine-translated, with a one-tap "Show English" that reveals the English original in place. |
| Not known | Shown (translated) wherever a provider or building detail is missing; a field is never hidden silently or shown blank. |
| Offline-readable | After the app has been loaded once with signal, the following open without signal: home with the last feed and building status, essential numbers, guides already opened, and the directory listing file of the current language. Map tiles of areas already viewed are included only if the chosen tile provider permits caching (S02.07). Each shows "Last updated {time}". |
| Personal choices vs usage events | Personal choices (buildings, floors, groups, muted topics, basic mode) never leave the phone, except in the SMS sign-up and edit-link requests in E07. Usage events (S02.15) are a separate, fixed, aggregate-only message: `{evt, lang, nbhd?}`, no identifier of any kind, never a building, floor or group. |
| Proposed engineering budget | A performance limit set by the team to protect older phones and slow connections (NFR-N3). It is not a PRD requirement: the PRD sets no numbers. Budgets live in `perf-budget.json` and may be changed by the team with a written reason in the change. |
| Traceable translation | Every translated text (listings, guides, numbers) keeps its English original, the hash of the English source it was made from, the model or conversion used, and its review status (`machine` or `reviewed`, with review date). `zh-Hant` records the `zh` source hash and the OpenCC version and configuration used. |

**Recorded discrepancy.** `docs/architecture/solution-design.md` ("Caching and cost") says guides are translated when the Hub publishes them. The spine (AD-10) says guides are translated once by the offline scripts and reviewed like the catalogue. This epic follows the spine; the solution design is to be corrected in the next documentation pass.

### Story S02.01 — Developer generates the look and every interface string from the prototype

- **Size:** M · **Estimate:** 6 h · **Actual:** —
- **Traces:** UX-DR1, UX-DR2, AR-27, NFR-N1 · **Depends on:** S01.01 · **Branch:** `e02-s01-tokens-strings`

As a developer,
I want design tokens and strings generated from the approved prototype,
So that the app matches the prototype exactly and no string is re-authored by hand.

**Acceptance Criteria:**

**Given** `design/prototype/ds/cvrh/tokens.json`
**When** `npm run gen:tokens` runs
**Then** it writes CSS custom properties and a Tailwind v4 theme for light and navy, and a snapshot test fails if any generated value differs from `tokens.json`

**Given** `design/prototype/cvh/strings.*.js` (15 languages) and `strings.en.screens.js`
**When** `npm run gen:strings` runs
**Then** it writes one next-intl catalog per launch language into `src/i18n/`, and running it twice produces identical files
**And** a key missing in a language renders the English text with the visible "[EN]" marker, never an empty string or a raw key

**Given** CI
**When** strings are generated
**Then** CI publishes a per-language report of missing keys, and fails if any language is missing a key in the 911 block, the machine-translation label or "Not known"

**Given** a generated catalog file is edited by hand
**When** CI runs
**Then** it fails because the regenerated file differs

### Story S02.02 — Resident sees the CVH in their language, right to left where needed

- **Size:** M · **Estimate:** 7 h · **Actual:** —
- **Traces:** UX-DR3, UX-DR19 (RTL, fonts), AR-3, AR-26, NFR-N1, FR-A3 (interface) · **Depends on:** S02.01 · **Branch:** `e02-s02-resident-shell`

As a resident,
I want every screen in my language and laid out the right way for my script,
So that I can use the CVH without English.

**Acceptance Criteria:**

**Given** the resident shell from `ResidentApp.dc.html`, `C_ResidentHeader` and `C_ResidentNav`
**When** opened at 320, 390 and 768 px in each launch language
**Then** there is no horizontal scrolling, and a Playwright screenshot per width and language is stored as the baseline

**Given** `ur`, `ps` or `prs`
**When** any resident page renders
**Then** `<html dir="rtl" lang="…">` is set and layout uses logical CSS only (a lint rule fails on `left`, `right`, `margin-left` and similar physical properties in `src/`)

**Given** the language control (R-02)
**When** it is opened from any resident screen and a language chosen
**Then** the same page reloads under the new language URL and the choice is saved in device choices

**Given** an unknown language code in the URL
**When** the page is requested
**Then** it redirects to `/en/` with the same path

**Given** a page in one language
**When** it loads
**Then** only that language's Noto font subset is downloaded (checked in the network log)

**Given** the end-to-end test from AD-3
**When** it requests `/{lang}/**`
**Then** no response sets a cookie (next-intl runs with `localeCookie: false`; Supabase middleware matches only `/staff/**` and `/api/staff/**`)

### Story S02.03 — Resident makes first-run choices that stay on the phone

- **Size:** M · **Estimate:** 7 h · **Actual:** —
- **Traces:** FR-A12, FR-A9 (on the phone), UX-DR4, AR-26 · **Depends on:** S02.02, S01.13 · **Branch:** `e02-s03-first-run-choices`

As a resident,
I want to choose my language, groups and where I live once, and change them later,
So that the CVH shows me what matters to me without asking who I am.

**Acceptance Criteria:**

**Given** a first visit
**When** the resident opens the CVH
**Then** they see R-01 (language) first, then R-26 (groups) and R-35 (where I live), each skippable, then home

**Given** R-35
**When** the resident picks one or more buildings from the 43 (their own or a relative's) and optionally floors
**Then** buildings are stored by `rsn` and floors by floor id, with no limit on how many; a unit number is never asked

**Given** R-34 (what I have told the CVH)
**When** opened
**Then** it lists every saved choice in plain words, lets each be changed or cleared, and "Clear everything" removes `cvh.choices` and returns to R-01

**Given** device choices saved for a building whose `rsn` is no longer in the building list, or a floor id that no longer exists
**When** the app loads
**Then** that building or floor is dropped from the choices and R-34 says it was removed; nothing else is lost

**Given** `cvh.choices` is missing, corrupt or fails the schema
**When** the app loads
**Then** it starts as a first visit and never throws

**Given** a resident with saved personal choices uses every screen in this epic
**When** the network log is inspected (end-to-end test)
**Then** the saved selection itself is never sent: no request carries the list of saved buildings or floors, groups, muted topics or basic mode, in the URL, headers or body
**And** requests for public content are allowed even when they name a building, such as opening a building page (`/{lang}/buildings/{rsn}`) or its facts; these are the same requests any visitor makes and carry no marker that the building is saved
**And** home and the numbers page get data for saved buildings from the whole-neighbourhood feed and building list already on the phone, never by sending the saved list to the server
**And** the only other requests derived from the resident are the usage events defined in S02.15, which this test checks against their fixed schema

### Story S02.04 — Hub loads the reviewed catalogue and confirms providers

- **Size:** M · **Estimate:** 6 h · **Actual:** —
- **Traces:** FR-G4, NFR-N7, AR-15, AR-25 · **Depends on:** S01.12, S01.04 · **Branch:** `e02-s04-catalogue-providers`

As a Hub Admin,
I want the reviewed catalogue loaded and each provider confirmed before residents see it,
So that residents only see listings the Hub has checked.

**Acceptance Criteria:**

**Given** `data/catalogue/providers.json` (99 providers, stable `id`) and `data/catalogue/translations/{lang}.json`
**When** the catalogue seed script runs
**Then** `provider`, `provider_location`, `category` and `provider_category` are upserted keyed by provider `id`; running it twice changes nothing; a provider in several categories is stored once; `seed.run` is audited with counts

**Given** the catalogue file fails its zod schema (missing `id`, duplicate `id`, coordinates outside Toronto, a category not in `labels`)
**When** the script runs
**Then** nothing is loaded and the report lists every failing entry

**Given** a provider removed from `providers.json`
**When** the script runs again
**Then** it is unpublished and flagged "not in catalogue", never deleted; its last-confirmed date is kept

**Given** an Admin at `aal2` on the providers screen
**When** they publish or unpublish a provider, or set its last-confirmed date (today or earlier)
**Then** the change is saved and audited (`provider.published`, `provider.unpublished`, `provider.confirmed`)
**And** publishing a provider with no last-confirmed date is refused with "Confirm this provider first"
**And** there is no way on any screen to edit listing text (text changes go through the catalogue scripts)

**Given** a Coordinator, Director or Ambassador
**When** they call any provider-changing endpoint directly
**Then** it returns 403 and the endpoints are added to the S01.12 permission test list

### Story S02.05 — Admin publishes a directory release residents can download

- **Size:** M · **Estimate:** 7 h · **Actual:** —
- **Traces:** AR-15 (publish), FR-D2, D-5 (`zh-Hant`), AR-20 · **Depends on:** S02.04 · **Branch:** `e02-s05-directory-release`

As a Hub Admin,
I want to publish the directory as one numbered release,
So that every resident gets the same, complete set of listings in their language.

**Acceptance Criteria:**

**Given** an Admin at `aal2` presses "Publish directory"
**When** the publish job runs
**Then** it writes one listing file per launch language, plus `zh-Hant` converted from `zh` with OpenCC and marked `script_converted`, containing only published providers, to the private Storage bucket, then marks the release current and audits `directory.published` with the release number and counts

**Given** a provider text that is null in a language's catalogue file
**When** that language's file is written
**Then** the listing carries the English text with `translation.unavailable`

**Given** a provider translation whose recorded source hash no longer matches the current English text
**When** the release is written
**Then** that stale translation is not published; the listing carries the English text with `translation.unavailable`, and the publish report lists every stale text by provider and language

**Given** the job is stopped part way (function time limit or failure)
**When** it runs again
**Then** it resumes from the last completed file; the current release stays the previous one until every file is written, and a resident never sees a mix of two releases

**Given** a publish fails three times
**When** the job gives up
**Then** the previous release stays current, the failure is recorded in `ops_event`, and the Admin sees "Publish failed" with the reason

**Given** `/api/directory/manifest` (no-store) and `/api/directory/{v}/{lang}.json`
**When** requested
**Then** the manifest returns `DirectoryManifestV1` for the current release, each file is served from the app's own origin with `Cache-Control: public, max-age=31536000, immutable`, and an unknown release or language returns 404
**And** contract tests validate both against the `src/contracts` schemas

**Given** every release
**When** it is written
**Then** it records the catalogue's source version (`catalogue_hash`, the sha256 of the committed `data/catalogue/` files, and the git commit) and keeps each text's traceability fields (English original, source hash, model or conversion, review status)

**Given** a release has no search data (every release until E03)
**When** the manifest is served
**Then** it carries `search: {status: "unavailable"}`, and the client hides the question box and shows browsing only

**Given** a release has been marked current
**When** anything later changes (a provider published, a catalogue update, or E03's search data)
**Then** that release's files and manifest entry are never modified; the change is made by publishing a new, complete release with a new number

**Given** E03 adds search data
**When** the next release is published
**Then** that release contains its listing files and its search data built from the same `catalogue_hash`; the manifest shows `search: {status: "available", embed_model, vectors_path}` for it, and the publish job refuses to mark it current if the search data's `catalogue_hash` or release number differs from its listings
**And** `DirectoryManifestV1` replaces `embed_model` with this `search` field (an AD-20 contract change recorded in the spine in this story)

**Given** a new release is complete
**When** it is made current
**Then** the current-release pointer changes in a single database transaction, so every manifest request returns either the old release or the new one, never a mix

### Story S02.06 — Resident browses and filters the directory

- **Size:** M · **Estimate:** 7 h · **Actual:** —
- **Traces:** FR-D2, UX-DR10 (filters), UX-DR11, NFR-N7 · **Depends on:** S02.05, S02.03 · **Branch:** `e02-s06-directory-browse`

As a resident,
I want to browse providers by category, neighbourhood and "Helps in an emergency",
So that I can find help near me in my language.

**Acceptance Criteria:**

**Given** the current release in the page language
**When** the resident opens the directory
**Then** only published providers are listed, each once, with categories, contacts, day-to-day services, emergency role and "Last confirmed by the Hub {date}"; missing details show "Not known"

**Given** filters R-27 (category, neighbourhood, "Helps in an emergency")
**When** the resident applies one or more
**Then** the list narrows, the applied-filter bar X-11 shows each filter with a remove control, and "Clear all" restores the full list
**And** a combination with no results shows R-11 with the Hub's number

**Given** a provider whose emergency role names a non-emergency service
**When** its listing (R-12) or organisation page (R-13) opens
**Then** "How they can help" (X-14) shows the role and 911 is named for emergencies

**Given** any listing text that was machine-translated
**When** shown
**Then** it carries the machine-translation label and "Show English" reveals the English text in place

**Given** the manifest reports a newer release than the one loaded
**When** the directory is opened
**Then** the new language file is downloaded completely before it replaces the list

**Given** the newer release's file fails to download, is incomplete or fails its schema
**When** the directory is opened
**Then** the previous complete cached release is shown with "Last updated {time}" and no error blocks the list; the download is retried on the next visit with signal (the same rule as S02.12)
**And** if no release has ever been cached, the resident sees "The directory could not load" with the Hub's number and the numbers page link

### Story S02.07 — Resident finds providers and buildings on a map

- **Size:** M · **Estimate:** 7 h · **Actual:** —
- **Traces:** FR-D3, UX-DR12, AR-3 (tile cache) · **Depends on:** S02.06, S01.13 · **Branch:** `e02-s07-map`

As a resident,
I want a map of providers and the 43 buildings,
So that I can see what is close to me.

**Acceptance Criteria:**

**Given** candidate map tile providers
**When** IT chooses one at the start of this story
**Then** the choice is recorded in the spine (closing the open question) with: the licence and whether it allows use in this app; whether browser caching of viewed tiles is permitted, and for how long; the attribution required; and the expected cost for the pilot's estimated tile requests against the free tier
**And** the required attribution is shown on the map in every language

**Given** the map R-14
**When** it opens
**Then** published providers and the 43 buildings appear on a neutral base map with clustered pins (`leaflet.markercluster`); cooling spaces, water fountains and public washrooms use distinct markers with text labels, not colour alone

**Given** a pin
**When** tapped
**Then** the preview card R-16 opens and leads to the same listing (R-12) or building page as the directory

**Given** the list view R-15
**When** opened from the map
**Then** it shows the same providers as the map's current view, so the map is never the only way to reach a listing (screen readers use the list)

**Given** the chosen provider permits caching
**When** tiles are viewed with signal
**Then** viewed tiles are cached up to the limit the provider allows and no more than 200 (least recently used removed first), never fetched ahead of viewing

**Given** the chosen provider does not permit caching
**When** tiles are viewed
**Then** no tile is cached, and offline the map says "The map is not available without signal" and offers the list view

**Given** the map is opened offline
**When** the resident moves between an area viewed before and one never viewed
**Then** viewed areas show their saved tiles, unviewed areas show a plain background with "This part of the map is not saved on your phone", and pins and the list still work from the saved listing file

**Given** any resident page
**When** the end-to-end test inspects requests
**Then** map tiles are the only cross-origin request

### Story S02.08 — Resident sees the facts about a building

- **Size:** S · **Estimate:** 4 h · **Actual:** —
- **Traces:** FR-D4-P, NFR-N7 · **Depends on:** S01.13, S02.02 · **Branch:** `e02-s08-building-page`

As a resident,
I want my building's facts in one place,
So that I know what my building has in a heat wave or outage.

**Acceptance Criteria:**

**Given** a building page
**When** it opens
**Then** it shows storeys, elevators, emergency power, cooling room, air conditioning and barrier-free entrance from the register, with "Last updated {date}"; a missing fact shows "Not known"
**And** "No" and "Not known" are never shown the same way

**Given** the building contact
**When** an Admin enters or changes it on the building's staff screen
**Then** it is saved with its owner (the Hub) and last-updated date, and audited (`building.contact_changed`)
**And** residents see it on the building page and on the essential-numbers page for their chosen buildings, labelled "Provided by the Hub, last updated {date}"; if none is entered they see "Not known"

**Given** a building flagged "not in latest register" (S01.13)
**When** a resident opens its page
**Then** the page still opens, with a note that the Hub is checking its details

### Story S02.09 — Guides and essential numbers are translated and reviewed offline

- **Size:** S · **Estimate:** 4 h · **Actual:** —
- **Traces:** FR-D7, FR-A3 (guides), AR-25, NFR-N7 · **Depends on:** S01.03 · **Branch:** `e02-s09-guide-content`

As a Hub Coordinator,
I want the six guides and the numbers page translated and reviewed before launch,
So that residents read checked text, not a live machine translation.

**Acceptance Criteria:**

**Given** the English guide text in `design/prototype/cvh/data.js` (power, flood, elevator, heat, smoke, fire; before, during, after, when to call 911) and the essential numbers (911, 211, 311, Toronto Hydro, the Hub)
**When** they are moved to `data/catalogue/guides.json` and `data/catalogue/numbers.json` and the existing offline scripts run
**Then** each launch language gets a translation file with the traceability fields for every text, a null entry means English with `translation.unavailable`, and only changed text is re-translated
**And** `zh-Hant` is produced from `zh` with OpenCC and records the source hash, OpenCC version and configuration

**Given** a text whose English source has changed since it was translated
**When** the seed script runs
**Then** it does not load that stale translation; the text shows in English with `translation.unavailable`, and the report lists it, so a resident never sees a translation of old English

**Given** `guides.json` and `numbers.json`
**When** they are prepared
**Then** each guide and the numbers list record a named owner (the Hub Coordinator responsible for that content) and a last-updated date; the English text records a review completed by that owner (reviewer and date); each number records the date it was last checked as correct
**And** each translation records its review status (`machine` or `reviewed`, with reviewer and date)

**Given** the seed script runs
**When** a guide's English review, owner or last-updated date is missing, or a number has no last-checked date
**Then** the script refuses to load that guide or the numbers list and reports why
**And** a translation not marked `reviewed` is not loaded; that text shows in English with `translation.unavailable` until its review is recorded

**Given** the guide and numbers seed script
**When** it runs
**Then** `guide` and `essential_number` are upserted from those files, running it twice changes nothing, and `seed.run` is audited
**And** the 911 number and "when to call 911" text cannot be null in any language (the script refuses to load)

### Story S02.10 — Resident reads a guide and the essential numbers

- **Size:** M · **Estimate:** 6 h · **Actual:** —
- **Traces:** FR-D7, UX-DR13, AR-27 (911 block) · **Depends on:** S02.09, S02.08 · **Branch:** `e02-s10-guides-numbers`

As a resident,
I want short guides and the numbers to call,
So that I know what to do before, during and after a disruption.

**Acceptance Criteria:**

**Given** "Be ready" (R-24)
**When** opened
**Then** it lists the six guides with their reading time

**Given** a guide (R-25)
**When** opened from the list
**Then** it shows before, during and after, with the 911 block at the top, and at the end "Reviewed by the Hub, last updated {date}"
**And** opened from a link with `#during` (used by alerts in E04), it opens scrolled to "During" with focus on that heading

**Given** the numbers page (R-31)
**When** opened
**Then** 911 is shown apart from the others with when to call it, then 211, 311, Toronto Hydro, the Hub and the contacts of the resident's chosen buildings, each a `tel:` link with a text label
**And** the page shows "Checked by the Hub, last updated {date}"

**Given** every guide, the numbers page and later every alert and check-in screen
**When** rendered
**Then** they use the one catalog 911 block component (a test fails if a page in that list renders without it)

### Story S02.11 — Resident home shows their buildings and the current alerts

- **Size:** M · **Estimate:** 6 h · **Actual:** —
- **Traces:** UX-DR5, AR-20 (`FeedV1`), FR-A9 (on the phone) · **Depends on:** S02.03, S02.08 · **Branch:** `e02-s11-resident-home`

As a resident,
I want a home screen that starts with my buildings,
So that I can see at a glance whether anything affects me.

**Acceptance Criteria:**

**Given** `/api/feed?lang=` (owned by `alerting`)
**When** requested before E04 adds alerts
**Then** it returns a valid `FeedV1` with no threads and every building and neighbourhood at status `none`, sets no cookie, and passes the contract test

**Given** home (R-03)
**When** the resident has chosen buildings
**Then** each chosen building appears first with its status in text, icon and colour (never colour alone) and a link to its building page
**And** with no threads it shows "No current alerts" in the page language

**Given** no chosen buildings
**When** home opens
**Then** it shows the neighbourhood view and an invitation to choose where you live (R-35)

**Given** home is visible
**When** 60 seconds pass
**Then** the feed is fetched again; a response with a lower `feed_version` than the highest seen is discarded

### Story S02.12 — Resident installs the CVH and reads it without signal

- **Size:** M · **Estimate:** 7 h · **Actual:** —
- **Traces:** NFR-N3, AR-3, FR-M1 (installs) · **Depends on:** S02.06, S02.07, S02.10, S02.11 · **Branch:** `e02-s12-install-offline`

As a resident on an older phone with poor signal,
I want to install the CVH and still read it when signal drops,
So that I have the numbers and my building's status when I need them most.

**Acceptance Criteria:**

**Given** a supported phone browser
**When** the resident opens the CVH
**Then** it is installable from the browser (web app manifest with name, icons from `design/prototype/assets/logos`, start URL `/{lang}/`), with no app store

**Given** the Serwist service worker
**When** it caches
**Then** it caches only `/{lang}/**`, `/api/feed`, `/api/directory/{v}/**`, static assets and viewed map tiles (only if the tile provider permits caching, S02.07); `/api/directory/manifest` is network-first with the last copy as fallback
**And** a test fails if any `/staff/**` or `/api/staff/**` response is ever stored

**Given** the offline-readable set has been loaded once
**When** the phone goes offline (Playwright offline mode)
**Then** home, essential numbers, opened guides and the directory list open, each showing "Last updated {time}", and pages never loaded show an offline message with the numbers page link

**Given** a new deploy
**When** the resident next opens the app with signal
**Then** the new service worker takes over on the next navigation and old caches are deleted; directory files of the previous release are removed once a newer release is loaded

**Given** the service worker installs
**When** it precaches
**Then** it stores the shell, the numbers page and the 911 block in the current language, so that once installed the numbers are always available offline

**Given** a first visit with no connection
**When** the page cannot load at all
**Then** the browser's own offline page appears (nothing can be cached before a first visit); this is documented in the resident help text, not treated as a defect

**Given** a later visit to a page never loaded, with no connection
**When** it is opened
**Then** the app's offline page appears with the numbers and a list of what is available offline

**Given** a cache update (new service worker, new release or new feed) is interrupted by losing signal
**When** the resident continues offline
**Then** the previous complete version is still used; a new service worker activates only after its precache completed, and a new directory release is used only once its file for the current language is fully cached

**Given** storage is unavailable, full or has been cleared by the browser
**When** the app runs
**Then** it keeps working online, asks once for persistent storage (`navigator.storage.persist()`), treats missing caches as a first visit, and R-34 shows "This phone may not keep pages for offline use"; `localStorage` being unavailable keeps choices for the open session only, with the same note

**Given** the phone returns online
**When** the browser fires `online` or the app becomes visible
**Then** the feed and manifest are fetched at once, "Last updated" is refreshed, and a lower `feed_version` than the highest seen is discarded

### Story S02.13 — Team measures the proposed speed budgets in CI

- **Size:** S · **Estimate:** 3 h · **Actual:** —
- **Traces:** NFR-N3 (proposed engineering budget, not a PRD number) · **Depends on:** S02.12 · **Branch:** `e02-s13-speed-budgets`

As a developer,
I want the resident app's speed measured the same way on every change,
So that older phones and slow connections stay usable as later epics add features.

**Acceptance Criteria:**

**Given** `perf-budget.json` with the proposed budgets below, each marked "proposed engineering budget"
**When** Lighthouse CI runs on the preview build for `/en/`, `/ur/` and the directory page, with a cold cache, Lighthouse's mobile preset (emulated mid-range phone, 4x CPU slowdown) and its default "Slow 4G" throttling (150 ms round trip, 1.6 Mbps down), taking the median of 3 runs
**Then** it records Largest Contentful Paint, Total Blocking Time and the JavaScript transferred

**Given** the proposed budgets
**When** a run exceeds one
**Then** CI fails, naming the page, the measure and the value. Budgets: "usable" means Largest Contentful Paint at most 4 s and Total Blocking Time at most 600 ms; JavaScript transferred for the first load at most 200 KB, measured compressed as sent over the network (gzip or brotli), counting every script the page loads

**Given** the team decides a budget should change
**When** `perf-budget.json` is edited
**Then** the change includes a written reason, and the budgets stay labelled as engineering budgets, separate from PRD requirements

### Story S02.14 — Resident switches to basic mode and uses the CVH with a screen reader

- **Size:** M · **Estimate:** 6 h · **Actual:** —
- **Traces:** NFR-N2, UX-DR18, UX-DR19 · **Depends on:** S02.12 · **Branch:** `e02-s14-basic-mode-a11y`

As a resident who finds the full layout hard to use,
I want a simpler layout and full screen-reader support,
So that I can use the CVH in the way that works for me.

**Acceptance Criteria:**

**Given** basic mode (X-07)
**When** turned on from R-34 or the header
**Then** every resident screen in this epic switches to the prototype's basic layout, the choice is saved in device choices, and nothing reaches the server

**Given** each resident screen in this epic, in normal and basic mode, in `en`, `ur` and `ta`
**When** axe-core runs in CI
**Then** there are no serious or critical WCAG 2.1 AA violations

**Given** a screen reader (VoiceOver on iOS, TalkBack on Android)
**When** a tester follows a written script (choose language, choose building, open directory, open a listing, open numbers)
**Then** every control is announced with a name and role, status is announced in words, and the result is recorded in the story with the device and date

**Given** every interactive element
**When** measured
**Then** touch targets are at least 44 by 44 px and text contrast meets AA (checked in CI on the token pairs used)

### Story S02.15 — Hub counts install events and directory use without tracking anyone

- **Size:** S · **Estimate:** 4 h · **Actual:** —
- **Traces:** FR-M1 (installs), FR-M3 (browsing), AR-26 · **Depends on:** S02.12 · **Branch:** `e02-s15-usage-counts`

As a Hub Director,
I want daily counts of install events and directory and map use by language,
So that the pilot can show use without recording who did what.

**Acceptance Criteria:**

**Given** `/api/metrics` accepts `{evt, lang, nbhd?}` where `evt` is one of `install`, `directory_view`, `listing_view`, `map_view`, `guide_view`, `numbers_view`
**When** a valid event arrives
**Then** the daily count for `(day, evt, lang, nbhd)` in `usage_count` is incremented and nothing else is stored (no IP, no identifier, no timestamp finer than the day)
**And** the app does not log the request's IP or user agent; the Vercel platform's own request logs are covered by the privacy notice in E07

**Given** the allowed fields
**When** an event is built on the phone
**Then** `lang` is the page language; `nbhd` is one of the two neighbourhood ids, taken from the page being viewed (a building or neighbourhood filter), or for `install` from the resident's chosen buildings only when they are all in one neighbourhood; otherwise it is left out
**And** no event carries a building, floor, group, device id, session id or any value that persists between events

**Given** an unknown `evt` or `lang`, an extra field, or a body over 256 bytes
**When** sent
**Then** it returns 400 and nothing is counted

**Given** the browser fires `appinstalled`, or (where that event is not supported) the app is first opened in standalone display mode
**When** that happens
**Then** one `install` event is sent and a local flag (a true/false value, not an identifier) stops this phone sending it again
**And** reports call these "install events observed", not unique installations: a reinstall or cleared storage counts again, and installs on browsers that report neither signal are not counted

**Given** the phone is offline
**When** an event happens
**Then** it is dropped, not queued (counts are approximate by design)

**Given** `/api/metrics`
**When** the no-cookie test runs
**Then** it sets no cookie

## E03 — Residents ask in their own words and get the right provider

Residents type a question in any launch language, romanized or mixed included, and get up to five published listings that clearly match, in the language they wrote in, with a clear route to a person when nothing matches and 911 first on emergency results. The epic starts with the test set so every later story is measured against it.

**Epic estimate:** 49 h across 9 stories (4 S, 5 M) · **Epic actual:** —

**Depends on E01 and E02:** S01.02 (environments and Cohere keys), S01.03 (migrations), S01.04 (audit), S02.05 (releases, manifest `search` field, atomic current-release pointer), S02.06 (directory screens and the failed-update fallback), S02.12 (offline rules), S02.15 (usage events). Each story creates only the tables it needs and names the stories it depends on.

**Definitions used in this epic**

| Term | Meaning |
| --- | --- |
| Search text | What is embedded for each published provider: English name, categories, subcategories, day-to-day services and emergency role. Source notes and contact details are never embedded. |
| Question language | The language the question was written in, detected by `eld` plus script checks. It is **confident** when it is a launch language and passes the per-language check (Pashto by its marker letters, since `eld` has no Pashto; Dari when `eld` reports `fa`). It is **romanized or mixed** when the question is in Latin script but not confidently `en`, `es`, `fr`, `tl` or `sk`, or mixes scripts. It is **ambiguous Arabic script** when it is in Arabic script without the marker letters that separate Urdu, Pashto and Dari. |
| `query_lang` | The language results are shown in: the question language when confident, otherwise the page language. |
| Direct leg | The question as typed is embedded and compared with the release's vectors (cosine similarity). |
| Translated-question leg | For Pashto, Dari, romanized or mixed, and ambiguous Arabic-script questions, the server also translates the question to English, embeds the translation and compares it with the same vectors. The leg covers both the translation and the embedding. The question and its translation are never stored, cached or logged. |
| Request snapshot | At request start the server captures one release's `release_v`, embedding model, vectors, threshold, `emergency_categories` and `catalogue_hash`, and uses only that snapshot to the end of the request. The threshold and `emergency_categories` are recorded on the release when it is published, so changing either means publishing a new release (which reuses existing vectors when the model and `catalogue_hash` are unchanged). |
| Qualifying provider | A provider whose qualifying similarity (the higher of its similarities from the legs that completed) is at or above the snapshot's threshold. |
| Ranking sequence | (1) Compute each provider's similarity in each completed leg. (2) Keep only qualifying providers. (3) If both legs completed, order the qualifying providers by reciprocal rank fusion (RRF, k = 60) of their ranks within each leg's qualifying list; otherwise order by similarity. (4) Return the top 5. An RRF score is never compared with the threshold. |
| Search deadlines | Proposed engineering budgets (not PRD numbers), measured from request start: the translated-question leg (translation and its embedding) must finish by 1.8 s; the direct leg by 2.2 s; the whole server operation, including ranking and the response, by 2.5 s. A leg that misses its deadline is cancelled and its result ignored. All are config values revisited after measurement. |
| No clear match | Zero qualifying providers. One to five qualifying providers are shown as they are, never padded with providers below the threshold. |
| Provisional routes | The Cohere models and routes named in this epic are provisional until production access, exact model identifiers, pricing and measured performance are confirmed (Launch Readiness). |
| Usage allowance | For live test-set runs: known per-unit prices for every model used, or, while prices are unknown, a conservative allowance of calls and tokens per month in config. Runs are checked against it before they start. |
| Emergency result | A result whose provider is in a category listed in `emergency_categories` (config; starts with "Support & Emergency Services"). When any result is one, `emergency_first` is true and the client puts the 911 block above the results. |
| Hit | The expected provider (or one of the acceptable providers) for a test question appears in the top 3 results. Hit rate is computed only over questions that have expected providers; `no_match` questions are excluded from its denominator. |
| No-match accuracy | Share of `no_match` questions that return `no_clear_match`. |
| Emergency accuracy | Share of `emergency` questions that return `emergency_first`. |
| Tuning and evaluation subsets | Every question carries `split`: `tuning` or `evaluation`. The model and threshold are chosen on the tuning subset only; acceptance evidence comes from the evaluation subset, which is never used for tuning. |
| Test set | Questions with their expected providers, stored in `data/search-test-set/`. The launch set has about 150 questions, 10 per language, written with ambassadors, including romanized Urdu, Hinglish, emergency and no-match questions. It contains no personal data. |
| Launch bar | Hub-approved minimums, stored in `data/search-test-set/bar.json`: hit rate per language, no-match accuracy and emergency accuracy, all measured on the evaluation subset. Set from the first full measurement (S03.08). |

### Story S03.01 — Team can measure search with a test set from day one

- **Size:** M · **Estimate:** 6 h · **Actual:** —
- **Traces:** FR-D2-Q (acceptance), AR-24 · **Depends on:** S02.04 · **Branch:** `e03-s01-test-set-runner`

As a developer,
I want a test-set format, a runner and a starter set of about 30 questions,
So that every search change is measured against real questions before it ships.

**Acceptance Criteria:**

**Given** the test-set format, a zod schema in `src/contracts`
**When** a question is added
**Then** it has `id`, `lang`, `q` (at most 200 characters), `kind` (`native`, `romanized`, `mixed`, `emergency`, `no_match`), `expected`, `split` (`tuning` or `evaluation`), `author_role` and `added`
**And** `expected` must be empty for `no_match` and must hold one or more provider ids for every other kind
**And** a file that fails the schema, or names a provider id not in `data/catalogue/providers.json`, fails CI with the line number

**Given** about 30 starter questions written by the team (2 per language, including at least 2 romanized Urdu, 1 Hinglish, 2 emergency and 2 no-match)
**When** they are committed
**Then** each has been checked by a second team member, recorded in the file

**Given** `scripts/search-test-set` run against a search engine (a fake in unit tests, the real `/api/search` use case later)
**When** it finishes
**Then** it reports, separately for the tuning and evaluation subsets, per language and overall: hit rate (top 3, excluding `no_match` questions), top-5 rate, no-match accuracy, emergency accuracy, the number of results returned, and p50 and p95 time per question
**And** it writes the report to `data/search-test-set/reports/{date}-{model}.json` with the release number, model, threshold and whether the translated-question leg was on

**Given** two reports
**When** `scripts/search-test-set --compare a b` runs
**Then** it shows per-language differences, so a change that makes any language worse is visible

### Story S03.02 — Each new release carries the search data that matches its listings

- **Size:** M · **Estimate:** 7 h · **Actual:** —
- **Traces:** AR-15 (search data), FR-D2-Q, AR-20 · **Depends on:** S02.05, S03.01 · **Branch:** `e03-s02-release-search-data`

As a Hub Admin,
I want each new directory release to include the meaning data for its own listings,
So that search can never point to a listing the resident's phone doesn't have.

**Acceptance Criteria:**

**Given** an Admin at `aal2` publishes a new release with search enabled
**When** the publish job runs
**Then** it embeds each published provider's search text once with the configured embedding model (`input_type` for documents), writes the vectors file into the same new release, and records the model, vector count, `catalogue_hash`, threshold and `emergency_categories` on the release
**And** when the model and `catalogue_hash` match the previous release, the existing vectors are copied instead of embedding again
**And** earlier releases are never modified (S02.05)

**Given** the vectors file and the listing files of the new release
**When** the job is about to mark it current
**Then** it refuses unless the vectors cover exactly the providers in the listing files, with the same release number and `catalogue_hash`; on refusal the previous release stays current and the failure is recorded in `ops_event`

**Given** the embedding call fails or is stopped part way
**When** the job runs again
**Then** it resumes from the last completed chunk, and residents keep the previous release (with or without search) until the new one is complete

**Given** each embedding call
**When** it returns
**Then** its usage (model, tokens, release number) is recorded in `spend_event` (created in this story, owned by `spend`); the price per unit may be unknown and is left null until Cohere's pricing is recorded
**And** the publish job refuses to embed when the usage allowance would be exceeded

**Given** the manifest for a release with matching search data
**When** served
**Then** it shows `search: {status: "available", embed_model, vectors_path}`; the vectors file is private and never served to phones

### Story S03.03 — Server tells which language a question was written in

- **Size:** S · **Estimate:** 4 h · **Actual:** —
- **Traces:** FR-D2-Q, AR-15 · **Depends on:** S01.01 · **Branch:** `e03-s03-question-language`

As a resident,
I want results in the language I wrote my question in,
So that I can read them even when my phone is set to another language.

**Acceptance Criteria:**

**Given** `directory/domain/questionLanguage.ts#detect(q, pageLang)`
**When** called
**Then** it returns `{lang, confidence: confident | romanized_or_mixed | ambiguous_arabic | unknown, query_lang}` following the definitions, and is a pure function

**Given** fixture questions for every launch language, plus romanized Urdu, Hinglish, mixed English-Urdu, Urdu without marker letters, a Dari question `eld` reports as `fa`, a Pashto question with marker letters, emoji only and numbers only
**When** the unit tests run
**Then** each returns the expected result; Pashto is never returned as Urdu or Dari when Pashto marker letters are present

**Given** a question that is not confident
**When** `query_lang` is chosen
**Then** it is the page language

### Story S03.04 — Search finds published providers by meaning

- **Size:** M · **Estimate:** 7 h · **Actual:** —
- **Traces:** FR-D2-Q, FR-M3 (search data), AR-15, AR-20 (`SearchV1`), AR-22, AR-26 · **Depends on:** S03.02, S03.03 · **Branch:** `e03-s04-search-endpoint`

As a resident,
I want my question matched to listings by meaning,
So that a question in any language finds an English-sourced listing.

**Acceptance Criteria:**

**Given** `POST /api/search` with `{q, lang, v}`
**When** `q` is empty, over 200 characters, or `lang` is not a `LangCode`
**Then** it returns 400 `{error:{code, message_key}}` and calls no model

**Given** a valid question
**When** it is searched
**Then** the server takes the request snapshot, runs the direct leg with the snapshot's model (`input_type` for queries), applies the ranking sequence, and returns 1 to 5 qualifying providers with their similarities as `SearchV1` `{v, release_v, query_lang, status, emergency_first, results}`
**And** if only one or two providers qualify, only those are returned; providers below the threshold are never added to fill the list
**And** every id comes from the snapshot's release, and `release_v` is that release

**Given** a new release is made current while a search is running
**When** the search completes
**Then** it uses only its snapshot (model, vectors, threshold, categories) and returns the snapshot's `release_v` (integration test publishes during a slowed search)
**And** the next search uses the new release

**Given** the response's `release_v`
**When** the client shows results
**Then** it looks the ids up only in the listing file for exactly that `release_v`; if that file is not on the phone it downloads it first

**Given** the client's `v` is older than the current release
**When** it searches
**Then** the response carries the current `release_v`, and the client refreshes the manifest and loads that release's listing file before showing results (falling back per S02.06 if that download fails, in which case it shows "Search results are being updated, try again" and the category list)

**Given** the current release has `search: {status: "unavailable"}`
**When** a search arrives
**Then** it returns `status: "unavailable"` (an expected outcome) and calls no model

**Given** no provider qualifies
**When** results are returned
**Then** `status` is `no_clear_match` and `results` is empty

**Given** any result is an emergency result
**When** returned
**Then** `emergency_first` is true

**Given** the direct leg fails or misses its deadline and no translated leg completed
**When** the server answers
**Then** it returns `{error:{code: "search_unavailable"}}` within 2.5 s of request start, the leg's call is cancelled, and the failure is counted in `ops_event` without the question

**Given** fakes that make the direct embedding slow (3 s)
**When** a search runs
**Then** the response arrives within 2.5 s and the slow call is cancelled (the fake records the abort)

**Given** each search
**When** it completes
**Then** `search_log` stores only `{at, lang, query_lang, release_v, ms, result_count, status, top_score, translated_leg}`, and embedding usage is recorded in `spend_event`

**Given** an integration test that searches with a unique marker string as the question, including runs where the embedding adapter throws an error that echoes its request
**When** it completes
**Then** the marker appears nowhere in: any database table, log output, `ops_event`, error responses, adapter error objects after wrapping, or tracing spans; vendor errors are wrapped so request bodies are dropped

**Given** one client (salted IP hash) sends more than 30 questions in 10 minutes
**When** the next arrives
**Then** it returns 429 `{error:{code: "rate_limited"}}` and calls no model; the limit is checked in the route handler through `subscriptions`' rate limiter (the `rate_limit` table is created here if E07 has not), and hashes are deleted after 24 hours

**Given** `/api/search`
**When** the no-cookie test and the contract test run
**Then** no cookie is set and every response matches `SearchV1` or the error schema

### Story S03.05 — Questions in Pashto, Dari and romanized text also search through English

- **Size:** M · **Estimate:** 6 h · **Actual:** —
- **Traces:** FR-D2-Q, AR-14 (question leg only), AR-15 · **Depends on:** S03.04 · **Branch:** `e03-s05-translated-question-leg`

As a resident who writes in Pashto, Dari or romanized Urdu,
I want my question understood as well as anyone else's,
So that I am not disadvantaged by the language or script I use.

**Acceptance Criteria:**

**Given** the `translation` module's `Translator` port and Cohere adapter (created here; E04 adds alert routes, caching and checks for alerts)
**When** a question needs the translated-question leg
**Then** it is translated to English with the model set in config `search_question_route` (provisionally North Small Translate for `ps` and `prs`, and Command A Translate for romanized, mixed and ambiguous Arabic script), then embedded, in parallel with the direct leg, using the same request snapshot

**Given** the translation and its embedding finish within 1.8 s of request start and `eld` confirms the translation is English
**When** results are ranked
**Then** the ranking sequence is applied to both legs (threshold first, then RRF over qualifying providers), and `search_log.translated_leg` is `used`

**Given** the translation fails, is not English, or the translated leg misses its deadline
**When** the server answers
**Then** the leg is cancelled, results come from the direct leg alone, the whole response still arrives within 2.5 s, and `translated_leg` is `failed` or `timed_out`

**Given** the direct leg fails or misses its deadline but the translated leg completed
**When** the server answers
**Then** results come from the translated leg alone

**Given** fakes for a slow translation (2 s), a fast translation with a slow translated embedding (translation 0.5 s, embedding 2 s), and a slow direct embedding
**When** each test runs
**Then** the response arrives within 2.5 s, cancelled calls record their abort, and late results are never used

**Given** the translated question
**When** handled
**Then** it is never written to the translation cache, any table, any log, any error or any tracing span (covered by the marker test in S03.04), and its usage is recorded in `spend_event` without text

**Given** the test-set runner
**When** run with the leg on and off
**Then** both reports are produced, so the leg's effect per language is visible

### Story S03.06 — Resident asks a question and sees the right listings

- **Size:** M · **Estimate:** 7 h · **Actual:** —
- **Traces:** FR-D2-Q, UX-DR10, AR-27 (911 block), NFR-N2 · **Depends on:** S03.04, S02.06, S02.10 · **Branch:** `e03-s06-ask-screens`

As a resident,
I want to type my question and see a few listings I can act on,
So that I find help without knowing the provider's name.

**Acceptance Criteria:**

**Given** search entry R-09
**When** the manifest says search is available
**Then** the question box appears with a hint in the page language and the category buttons below it
**And** when search is unavailable, the box is hidden and only the category buttons show
**And** a general "In an emergency, call 911" line with a `tel:` link is always visible on the ask screen, whatever the result

**Given** results R-10
**When** the server returns `status: ok`
**Then** the 1 to 5 qualifying listings are shown exactly as published in `query_lang`, in the returned order, with "Last confirmed by the Hub {date}", the machine-translation label where it applies, and a note "Shown in {language}" when `query_lang` differs from the page language
**And** if the `query_lang` listing file is not on the phone, it is downloaded first; if that fails, the results are shown in the page language with that note

**Given** `emergency_first` is true
**When** results are shown
**Then** the one catalog 911 block appears above the results

**Given** `status: no_clear_match`
**When** shown (R-11)
**Then** the resident sees "We couldn't find a clear match", the category list, the Hub's number as a `tel:` link and the general 911 line

**Given** the phone is offline, the server is rate-limiting, or the server returns `search_unavailable`
**When** the resident asks
**Then** they see a plain message in the page language ("Search needs signal" or "Search is busy, try again in a few minutes"), the category buttons and the Hub's number, never a blank screen or a raw error; category browsing works offline from the cached listing file

**Given** the CVH never writes its own answer
**When** any result screen renders
**Then** it shows only listing content, catalog strings and the 911 block (a test fails if any server text other than ids and scores is rendered)

**Given** the screens in this story, in `en`, `ur` and `ps`, normal and basic mode
**When** axe-core runs
**Then** there are no serious or critical violations, and the result count and "no clear match" are announced to screen readers

### Story S03.07 — Team picks the embedding model and the no-match threshold

- **Size:** S · **Estimate:** 4 h · **Actual:** —
- **Traces:** FR-D2-Q, AR-15 (embedding model open question) · **Depends on:** S03.05 · **Branch:** `e03-s07-model-threshold`

As a developer,
I want the embedding model and threshold chosen by measurement,
So that the choice is evidence, not guesswork, and can be repeated on the full test set.

**Acceptance Criteria:**

**Given** the three candidates `embed-multilingual-v3.0`, `embed-v4.0` and `embed-v5.0-fast`
**When** the runner is run on staging with each, leg on and off, within the usage allowance
**Then** a comparison report is committed with hit rate per language, no-match and emergency accuracy, p50 and p95 time per question, and embedding usage, for the tuning subset

**Given** the comparison
**When** a model is chosen
**Then** the choice and the reason are recorded in the spine (closing the open question for now) and set as config; a later release using a different model needs a new release and a new run

**Given** the scores of correct and no-match questions for the chosen model
**When** the threshold is set
**Then** it is chosen on the tuning subset only, as the value that keeps every tuning no-match question below it while losing the fewest hits, and is recorded with the report; the choice is provisional until S03.08
**And** the evaluation subset is not run until S03.08, so it stays independent of tuning

### Story S03.08 — Ambassadors complete the test set and the Hub sets the launch bar

- **Size:** S · **Estimate:** 4 h · **Actual:** —
- **Traces:** FR-D2-Q (acceptance), Launch readiness · **Depends on:** S03.07 · **Branch:** `e03-s08-full-test-set`

As a Hub Coordinator,
I want about 150 real questions from ambassadors and a bar we agree on,
So that we launch search knowing how well it works in every language.

**Acceptance Criteria:**

**Given** a question template in the format of S03.01 (a spreadsheet converted by `scripts/search-test-set import`)
**When** ambassadors submit questions
**Then** the import validates every row, refuses rows with personal data (phone numbers, email addresses, unit numbers, detected by pattern), and reports rows missing an expected provider

**Given** the imported set
**When** coverage is checked
**Then** every launch language has at least 10 questions, with at least 5 romanized Urdu, 3 Hinglish, 10 emergency and 10 no-match questions overall; CI reports any gap
**And** at least 4 questions per language, and at least 4 emergency and 4 no-match questions, are assigned to the evaluation subset by a fixed random seed before any run, and the assignment is committed
**And** `no_match` rows with an empty expected-provider list are accepted; other rows without one are refused

**Given** the full set
**When** the runner runs with the chosen model, leg and threshold
**Then** the model and threshold are confirmed or revised using the tuning subset only, then the evaluation subset is run once with the final choices, and both reports are committed

**Given** the first full report
**When** the Hub sets the launch bar
**Then** `bar.json` records the Hub-approved minimum hit rate per language, minimum no-match accuracy and minimum emergency accuracy, who approved them and the date
**And** launch readiness is met only when the latest evaluation report meets every minimum
**And** any language whose first measurement is below the bar the Hub would accept is listed in the launch-readiness checklist with the action and owner (for example more catalogue review or a different question route)

### Story S03.09 — The test set guards every search change

- **Size:** S · **Estimate:** 4 h · **Actual:** —
- **Traces:** AR-24, FR-D2-Q · **Depends on:** S03.08 · **Branch:** `e03-s09-test-set-guard`

As a Hub Director,
I want search quality checked whenever something could change it,
So that a model or route change never quietly makes search worse for one language.

**Acceptance Criteria:**

**Given** a change to the embedding model, `search_question_route`, the threshold, `emergency_categories`, the search code or the catalogue
**When** CI runs on that change
**Then** the runner runs the evaluation subset against staging, and CI fails if any language's hit rate, the no-match accuracy or the emergency accuracy falls below its minimum in `bar.json`, naming the measure and the drop

**Given** the monthly schedule and the week before launch
**When** the scheduled run happens
**Then** the report is committed and a drop below any bar is recorded in `ops_event` for the weekly review (E09)

**Given** a live run is about to start
**When** the runner checks the usage allowance
**Then** it refuses to start unless every model used has a known per-unit price or the config holds a usage allowance (calls and tokens per month); it estimates the run's usage from the question count and refuses if that would exceed what remains this month, counted from `spend_event` units (not money) while prices are unknown
**And** each run's usage is recorded in `spend_event` against staging

## E04 — Hub staff write, translate and approve alerts residents can trust

Hub staff log a disruption, post a short acknowledgement, and write an alert for a place and optional groups; the CVH translates it into every launch language with checks, renders the exact texts, and a second person approves exactly what they saw. Approved alerts appear on the web in every language, with origin and verification shown the same way everywhere, ordered and tailored on each resident's phone. Texts are rendered and frozen here but sent in E06; updates, corrections, closing, status and sharing are E05; ambassador posting and the D-1 web-first path are E08.

**Launch gate kept.** E04 alone cannot be launched to residents: production runs with `RESIDENT_ALERTS_ENABLED=false`, so the feed returns no threads there, until E05's corrections and closing are released (S04.08). Staging and previews run with it on.

**Handoff to E07.** E04 freezes text and audience at submit. The recipient snapshot (who receives the text, in which language) is taken at approval through `subscriptions`' `captureRecipients(entry, tx)` port, inside the approval transaction. Until E07 implements it, the port returns no recipients; E07 must implement it inside that same transaction and keep the count check in S04.07.

**Epic estimate:** 59 h across 10 stories (3 S, 7 M) · **Epic actual:** —

**Depends on earlier epics:** S01.04 (audit, refusal records), S01.08 (sessions), S01.10 (`aal2`), S01.12 (policy and permission test list), S01.13 (buildings and floors), S02.02 (resident shell), S02.03 (device choices), S02.10 (guides with `#during`, 911 block), S02.11 (feed contract and home), S03.05 (`Translator` port and Cohere adapter), S03.02 (`spend_event`, usage allowance). Each story creates only the tables it needs and names the stories it depends on.

**Definitions used in this epic**

| Term | Meaning |
| --- | --- |
| Thread | An `alert`: one disruption, `open` until closed. Created when a disruption is logged, with `reported_at` (the time the first report reached the Hub, entered by staff, never later than now). `is_drill` is set at creation and never changes. |
| Entry | An `alert_entry` (`ack`, `update`, `correction`, `withdrawal`, `final`) with the state machine in AD-5. This epic implements `ack` and `update` from `draft` to `approved`, plus return and discard; E05 adds supersession, corrections, withdrawals and closing. |
| Authoring language | Staff write entries in English (`original.lang = 'en'`). |
| Submit | Moves a `draft` to `pending_approval`: translates, renders the SMS bodies, counts segments and computes `content_hash`, then freezes the text, translations, bodies, audience rules, types and valid-until. Nothing frozen is recomputed at approval. Recipient counts and cost shown at submit are a preview, not frozen. |
| Entry version | An integer on the entry, incremented by every submit. Approval binds to `(entry_id, version, content_hash)`, so two pending versions can never share an approval. |
| Recipient snapshot | Taken at approval, in the approval transaction: the actual recipients and each one's language (AD-7, AR-11). The approver confirms the count they reviewed; if the snapshot differs, they must review the new count first (S04.07). |
| Submit idempotency key | A key generated by the browser for each Submit press and stored with the entry. Repeating a submit with the same key returns the first attempt's result; it never creates a second pending version. |
| Translated languages | Every launch language except English, because web readers may use any of them (FR-A3); `zh-Hant` is converted from `zh` with OpenCC. This clarifies AD-10's "every language present in the audience": for web, every language is present. |
| Fallback language | A language whose translation failed every model in its route; its text is English with `translation.unavailable`. |
| Editor | The author and every account that changed the entry's content (`editor_ids`). |
| Approval binding | Approval names the `content_hash` the approver was shown. If the entry's hash differs (it was edited, returned or re-translated since), approval is refused with "This alert changed. Review it again." |
| Web-published | `web_published_at` is set. In this epic only approval sets it (D-1 web-first posting is E08). |
| Valid until | Required on every entry; staff enter it in Toronto time, converted by `platform/clock#fromToronto`. It must be in the future at submit and at approval, and at most 7 days ahead (proposed engineering budget). A local time that does not exist (the spring-forward hour) is refused; a local time that occurs twice (1:00 to 2:00 on 1 November 2026) asks the author to choose "before" or "after" the clock change. "Until resolved" means 24 elapsed hours from now, renewed by each update (Consistency Conventions). |
| Verification marker | "Verified by the Hub" or "Not yet verified", in the same words and position on every surface, with an icon and text, never colour alone. Every entry approved by Hub staff in this epic is verified. |
| Attribution | Role and building only ("Hub", "Building ambassador, {building}"), never a person's name. |
| Neighbourhood-only types | Heat, smoke and winter storm: neighbourhood audience only, authored by Coordinators and Admins only. |
| Attempt timeout | Stored per route position (language, model): that model's measured p99 for the language × 1.25, rounded up to the next second, at most 20 s. A timeout counts as a failed attempt and the next model in the route is tried. |
| Route deadline | The sum of a language's attempt timeouts, at most 30 s from the start of that language's translation. When it is reached, the attempt in flight is cancelled and the language falls back. |
| Submit budget | Proposed engineering budget (not a PRD number): submit finishes within the longest route deadline plus 5 s; the author sees progress per language and is never left without a result. |
| Translation cache key | `(source_hash, lang, model_id, prompt_version, check_version)`, plus the OpenCC version and configuration for `zh-Hant`. Changing the checks, the prompt or OpenCC therefore never reuses an older result. |
| Alert text limit | At most 600 characters of English text (proposed engineering budget, not a PRD number). |
| Acknowledgement aim | The prototype's aim of an acknowledgement out within 5 to 10 minutes of the first report is a team aim that the timings measure; it is not a guaranteed service target. |

### Story S04.01 — Team measures translation latency and sets the timeouts

- **Size:** S · **Estimate:** 4 h · **Actual:** —
- **Traces:** AR-14 (p99-derived timeout), Launch readiness (p99) · **Depends on:** S03.05, S03.02 · **Branch:** `e04-s01-translation-latency`

As a developer,
I want measured translation times for every language and model in its route,
So that timeouts are set from evidence before alerts depend on them.

**Acceptance Criteria:**

**Given** 20 representative English alert texts (10 short acknowledgements, 10 full alerts of 300 to 600 characters, drawn from the prototype's examples) and the provisional routes
**When** `scripts/translation-latency` runs on staging within the usage allowance
**Then** each text is translated into each launch language with every model in that language's route, 3 times, and the report records p50, p95 and p99 latency, failure count and usage per language and model
**And** the report is committed under `data/translation-latency/{date}.json`

**Given** the report
**When** timeouts are set
**Then** each route position (language, model) gets its own attempt timeout by the rule in the definitions, stored in `translation_route`, and each language's route deadline is computed from them; the rule and values are recorded in the spine
**And** the values are provisional: 60 samples per model and language give only a rough p99, so they are re-measured from production call times (recorded per call in `spend_event`, without text) after the first two weeks of the pilot, and again whenever a model or route changes

**Given** a model that failed more than 2 of 60 attempts for a language
**When** the report is reviewed
**Then** it is listed in the launch-readiness checklist with the language and the action (reorder the route or accept fallback)

### Story S04.02 — Alerts are translated by route, checked and never sent in the wrong language

- **Size:** M · **Estimate:** 7 h · **Actual:** —
- **Traces:** FR-A3 (alerts), AR-14, D-4, D-5 · **Depends on:** S04.01 · **Branch:** `e04-s02-translation-routes`

As a resident who reads Pashto,
I want alert translations checked before anyone sees them,
So that I never receive text in the wrong language presented as mine.

**Acceptance Criteria:**

**Given** `translation_route`, seeded by migration from the addendum's routing table (config, not code)
**When** an entry's English text is translated
**Then** every translated language runs in parallel, each trying its route's models in order with each attempt's own timeout and the language's route deadline, and returns `Translated {lang, body, machine, model, status, source_hash}`
**And** a timed-out or deadline-cancelled attempt is aborted (the fake records the abort) and its late result is never used

**Given** a model's output
**When** it is checked
**Then** it passes only if the language check passes (`eld` code where supported, `prs` accepted as `fa`) and the script check passes; Pashto output must contain at least one Pashto marker letter, and Pashto and Dari output must contain none of the Urdu-only letters
**And** a failed check counts as a failure and the next model runs; when every model fails, the status is `fallback_en`

**Given** fixtures that make the fake return Dari for Pashto, Urdu for Pashto, English for Tamil, empty text, a timeout, and an error
**When** the tests run
**Then** each is rejected and the next model is tried, and the last case of each ends in `fallback_en`

**Given** a `zh` translation that passed its checks
**When** `zh-Hant` is produced
**Then** it is converted with OpenCC, marked `script_converted`, and records the `zh` source hash

**Given** the translation cache key in the definitions
**When** the same English text is translated again
**Then** cached results are reused only when every part of the key matches, and only passing results are cached; failures are never cached
**And** a test shows that changing `check_version`, `prompt_version` or the OpenCC version or configuration causes a fresh translation

**Given** each call
**When** it returns
**Then** its usage is recorded in `spend_event` without text, and vendor language codes never leave the adapter

### Story S04.03 — Alert threads and entries follow one lifecycle

- **Size:** M · **Estimate:** 7 h · **Actual:** —
- **Traces:** AR-8, AR-9, FR-A15, AR-24 · **Depends on:** S01.04, S01.12, S01.13 · **Branch:** `e04-s03-alert-lifecycle`

As a Hub Coordinator,
I want the system to allow only the agreed steps for an alert,
So that nothing reaches residents without the checks we promised.

**Acceptance Criteria:**

**Given** `alert`, `alert_entry`, `alert_entry_translation`, `feed_version` and `disruption_type` (seeded by migration with `direct` per type: power, water, elevator, flood true; fire, other false; heat, smoke, winter null)
**When** the migrations run
**Then** the tables exist with RLS locked down, `alert.is_drill` cannot be updated (trigger), and the `nondrill_alert` view exists

**Given** `alerting/domain/lifecycle.ts`
**When** a transition is requested
**Then** only these are allowed in this epic: `[*] → draft`, `draft → pending_approval` (submit), `pending_approval → draft` (edit or return, only if not web-published), `draft|pending_approval → discarded`, `pending_approval → approved`; a database trigger rejects any other transition, tested by direct SQL with the app's credentials

**Given** an approval
**When** the approver's id is in `editor_ids`
**Then** it is refused by the use case and by a trigger (tested both ways), and recorded as a refusal

**Given** two approvals of the same entry at the same time
**When** both run
**Then** exactly one succeeds; every thread-changing use case starts with `SELECT … FROM alert WHERE id = $1 FOR UPDATE` and locks in the order `alert → alert_entry`, re-reads the thread and refuses with `ALERT_CLOSED` if closed (integration test fires both approvals concurrently)

**Given** an edit made while another person is viewing the entry for approval
**When** the approver approves
**Then** the approval binding refuses it because the version or hash changed

**Given** a `pending_approval` entry
**When** direct SQL with the app's credentials tries to change its text, audience, types, valid-until, translations, SMS bodies, `content_hash` or `version`
**Then** a trigger refuses it; content can change only after the entry returns to `draft`, and that return clears the approval binding (tested)

**Given** a `draft` entry
**When** its content is changed
**Then** a trigger requires the acting account (session variable `cvh.actor_id`, set by every use case) and adds it to `editor_ids`; an update without an actor is refused (direct SQL tests)

**Given** "Try translation again" on a pending entry
**When** anyone uses it
**Then** it returns the entry to `draft`, adds that person to `editor_ids`, re-translates and re-submits as a new version with a new hash; the person can no longer approve it

**Given** every successful transition
**When** it commits
**Then** it is audited (`alert.created`, `entry.submitted`, `entry.returned`, `entry.discarded`, `entry.approved`) with entry id and outcome, and refusals are recorded per S01.04

### Story S04.04 — Staff choose who an alert is for with one shared rule

- **Size:** M · **Estimate:** 6 h · **Actual:** —
- **Traces:** FR-A1, AR-11 (matcher), AR-7, UX-DR16 (O-03, O-04) · **Depends on:** S04.03 · **Branch:** `e04-s04-audience-matcher`

As a Hub Coordinator,
I want to pick the neighbourhood, buildings, floors and optional groups for an alert,
So that the web and, later, texts reach exactly the people it is for.

**Acceptance Criteria:**

**Given** `src/contracts/audience.ts` with the `Audience` type and `matches(audience, profile)`
**When** the property tests run (thousands of generated audiences and profiles)
**Then** they confirm the AD-7 rules: neighbourhood matches everyone there; a building matches that building, and with floors those floors or a profile with no floor; a profile with no building matches neighbourhood alerts only; groups intersect; several matching places match once; topic opt-outs apply except the fire and evacuation override
**And** `matches` is pure and imported unchanged by the server and the phone (no copy exists, checked by the dependency rules)

**Given** the place picker (O-03)
**When** a Coordinator chooses the neighbourhood, or buildings with whole building or floors (ranges like "4-9" expanded)
**Then** floors are stored sorted and deduplicated by floor id; a floor not in that building, an empty selection, or a reversed range is refused with a message

**Given** the group picker (O-04)
**When** groups are chosen
**Then** they are stored on the audience, and the screen notes that groups narrow texts but every web reader can still see the alert

**Given** heat, smoke or winter storm
**When** the audience is buildings, or the author is not a Coordinator or Admin
**Then** submit is refused with the reason, by the policy check on the server (direct-request tests added to the S01.12 list)

**Given** an Ambassador author (used in E08)
**When** the audience includes a building they are not assigned to
**Then** it is refused at submit and again at approval against their current assignments

### Story S04.05 — Hub staff log a disruption and write an acknowledgement or alert

- **Size:** M · **Estimate:** 7 h · **Actual:** —
- **Traces:** FR-A4, FR-A1, UX-DR16 (O-11, O-12, O-02), FR-M2 · **Depends on:** S04.02, S04.04 · **Branch:** `e04-s05-log-and-compose`

As a Hub Coordinator,
I want to log a disruption and post a short acknowledgement within minutes,
So that residents know we are on it before we have the details.

**Acceptance Criteria:**

**Given** "Log a disruption" (O-11)
**When** a Coordinator chooses one or more types, the place and the time of the first report
**Then** a thread is created with `reported_at`, and the acknowledgement composer (O-12) opens with a suggested English text built from the type and place, which the author may edit

**Given** the composer (O-12) or the full alert composer (O-02)
**When** the author enters English text (within the alert text limit), the valid-until and the audience
**Then** the draft is saved and the author is added to `editor_ids`
**And** a valid-until in the past, more than 7 days ahead, or in the spring-forward hour is refused with the reason; a time in the repeated autumn hour asks "before or after the clock change"
**And** for fire, evacuation or "Other", the 911 line is placed first

**Given** the author presses Submit
**When** submit runs
**Then** it sends a new submit idempotency key, translates and renders outside any database lock, then in one short transaction checks the draft has not changed since Submit was pressed, writes the frozen content with a new version and hash, and moves the entry to `pending_approval`
**And** progress is shown per language and submit finishes within the submit budget
**And** if any language fell back, the author sees which, with "Try translation again" (S04.03)

**Given** a submit whose outcome the browser did not see (lost connection, closed tab, server error)
**When** the author returns to the entry
**Then** the browser fetches the entry's authoritative state: if the submit committed, it shows the pending entry; if it is still running, it shows progress for that same key; if it failed, the entry is still a `draft` with its text and nothing half-frozen
**And** retrying with the same key returns the first attempt's result, and a new press after a confirmed failure uses a new key; translations already done are reused from the cache
**And** an integration test drops the connection after commit and after failure, and confirms there is never more than one pending version

**Given** the draft was changed by another editor while a submit was running
**When** the submit's transaction checks it
**Then** the submit is refused with "This alert changed while it was being prepared. Submit again." and nothing is frozen

**Given** a thread with a possible duplicate (an open non-drill thread overlapping in audience and type)
**When** the author submits
**Then** the approver will see a "possible duplicate" link (merging is E05)

### Story S04.06 — Each text is rendered once and frozen at submit

- **Size:** M · **Estimate:** 6 h · **Actual:** —
- **Traces:** AR-19 (renderer), FR-A5, FR-A3 · **Depends on:** S04.02 · **Branch:** `e04-s06-sms-renderer`

As a Hub Coordinator approving an alert,
I want to see the exact text each person will receive,
So that what I approve is what residents get, byte for byte.

**Acceptance Criteria:**

**Given** `messaging/domain/smsBody.ts#render(entry, lang, isDrill, slug)`
**When** an entry is submitted
**Then** for each language it builds the body from catalog strings in exactly this order, leaving out parts that do not apply:
1. exercise marker (drills only);
2. correction marker (corrections only);
3. the 911 line, here only when a type is fire, evacuation or "Other";
4. verification marker;
5. attribution;
6. the text;
7. the machine-translation label (translated or fallback text only);
8. the 911 line, here for every other type;
9. the `/a/{slug}` link built from `PUBLIC_BASE_URL`;
10. "Reply STOP".

**And** every alert body has exactly one 911 line; a drill or correction of a fire alert keeps its exercise or correction marker first, then the 911 line (fixture tests cover drill, correction and drill-correction for both 911 positions)
**And** no other code builds an SMS body (a dependency rule forbids imports of the Twilio adapter outside `messaging`)

**Given** each rendered body
**When** it is counted
**Then** the renderer applies its own fixed character normalisation (for example curly quotes to straight quotes) before freezing, so the frozen body is the final text; the approver sees that body
**And** encoding (GSM-7 or UCS-2) and segments (160/153 or 70/67) are computed from that same frozen body and stored with it; fixtures per language check the count
**And** Twilio Smart Encoding must be off on the Messaging Service, so the provider sends the frozen body byte for byte; E06 checks this setting before sending (AD-21 updated to say so)

**Given** the frozen bodies and web texts
**When** `content_hash` is computed in `alerting/domain/hash.ts`
**Then** it is sha256 of the RFC 8785 canonical JSON of `{kind, alert_id, supersedes_id, types, phase, audience, channels, is_drill, valid_until, sms_bodies, web_texts}` with lists sorted by language; a fixture test pins the hash for a known entry

**Given** a fallback language
**When** its body is rendered
**Then** it is the English text with `translation.unavailable` in that language

**Given** the estimated cost
**When** shown
**Then** it is segments × recipients × the configured price per segment (integer cents CAD), labelled an estimate; at submit it uses the preview count, and at approval the snapshot count

### Story S04.07 — A second person approves exactly what they reviewed, on a phone

- **Size:** M · **Estimate:** 7 h · **Actual:** —
- **Traces:** FR-A15, FR-A3 (recipients per language), AR-19 (approval view), UX-DR16 (O-05), FR-M2 · **Depends on:** S04.03, S04.05, S04.06 · **Branch:** `e04-s07-approval`

As a Hub Coordinator,
I want to approve an alert in one action from my phone, seeing exactly what goes out,
So that a mistake is caught by a second person before residents see it.

**Acceptance Criteria:**

**Given** the approval view (O-05) at 390 px
**When** a Coordinator or Admin who is not an editor opens a pending entry
**Then** above the fold they see the English text, the audience in words, the channels, the SMS recipient count, the estimated cost and any fallback languages; every other language's web text and SMS body is one tap away; Approve is within thumb reach

**Given** SMS recipients per language
**When** shown
**Then** they come from `subscriptions`' recipient-count port as the count when the view loaded (the reviewed count); until E07 provides it, the view shows "Text sign-up is not open yet" and a count of 0, and the channels list web only

**Given** the approver presses Approve
**When** the session is `aal2`, the approver is not an editor, the policy allows it at approval time, the version and hash match what was shown, and the valid-until is still in the future
**Then** in one transaction the recipient snapshot is captured through `captureRecipients(entry, tx)`, the entry becomes `approved`, `web_published_at` is set and `feed_version` is incremented; `revalidateTag('feed')` runs after commit, and `entry.approved` is audited with the version, hash and recipient count
**And** if any condition fails, nothing changes and the refusal is recorded with the reason shown

**Given** the snapshot count differs from the reviewed count
**When** the approver presses Approve
**Then** approval is refused with "The number of people who will get this text changed from {a} to {b}", the view shows the new count per language and cost, and the approver must confirm the new count before approving

**Given** an entry whose valid-until passed while it waited
**When** someone tries to approve it
**Then** it is refused with "This alert's valid-until has passed"; the author must return it to draft and set a new time

**Given** the approver chooses "Return to author" with a note, or "Discard"
**When** confirmed
**Then** the entry returns to `draft` (keeping its text) or becomes `discarded`, the author sees the note on their incidents list, and the action is audited

**Given** the timestamps on the thread and entry
**When** an entry is approved
**Then** time from `reported_at` to the first approved acknowledgement, and from the author's first save to approval, are recorded for the pilot measures (FR-M2), with drills kept apart

### Story S04.08 — Residents read approved alerts in their language, with origin and verification

- **Size:** M · **Estimate:** 7 h · **Actual:** —
- **Traces:** FR-A1 (web), FR-A3, FR-A5, AR-7 (`FeedV1`), AR-6 (drill isolation), UX-DR6 · **Depends on:** S04.07, S02.11, S02.10 · **Branch:** `e04-s08-feed-and-alert-detail`

As a resident,
I want each alert in my language with who sent it and whether it is verified,
So that I can trust what I read and act on it.

**Acceptance Criteria:**

**Given** `/api/feed?lang=`
**When** requested
**Then** when `RESIDENT_ALERTS_ENABLED` is on, it returns `FeedV1` with open threads that have a web-published entry, each entry's text in the requested language (or the fallback), the English original, attribution, verification and `published_at`, with `feed_version` and `server_now`; the response is edge-cached for at most 15 seconds and sets no cookie

**Given** a drill thread inserted directly in the database
**When** an integration test calls every resident route and API (feed, home, alert detail, building page)
**Then** the drill appears nowhere; resident queries read only `nondrill_alert` (a lint rule forbids other alert relations in those files)

**Given** alert detail (R-07)
**When** opened
**Then** it shows the type words and icons (X-13), the origin and verification marker (X-02) with a link to "what verified means" (R-28), the text with the machine-translation label (X-04) and "Show English", valid-until, the not-911 statement (X-01) and the 911 block, and a link to the matching guide opened at "During"

**Given** an approved entry and a resident with the page open, visible and online, whose polls succeed
**When** the feed is next polled
**Then** they see it within 75 seconds of approval (15-second cache plus 60-second poll; a proposed engineering budget, not a service guarantee), measured in an end-to-end test with the clock controlled

**Given** production with `RESIDENT_ALERTS_ENABLED=false`
**When** any resident route or API is requested
**Then** no thread is returned or shown, and a test checks the production configuration keeps it off until E05 is released

**Given** a fallback language
**When** a resident reads the alert in it
**Then** they see the English text with "Translation not available" in their language

### Story S04.09 — Each phone puts the alerts that matter to its owner first

- **Size:** S · **Estimate:** 4 h · **Actual:** —
- **Traces:** FR-A13, FR-A9 (on the phone), AR-26, UX-DR5 (X-12) · **Depends on:** S04.08, S04.04 · **Branch:** `e04-s09-tailored-order`

As a resident,
I want alerts for my buildings, floors and groups shown first,
So that I see what affects me without missing anything else.

**Acceptance Criteria:**

**Given** the feed and the device choices
**When** home renders
**Then** alerts matching the device profile (by `matches`) come first and are highlighted, the rest follow, and nothing is hidden

**Given** a matching alert and a chosen group with advice for that type
**When** shown
**Then** one line of advice from the catalog is added (X-12), never naming the group or the reason it was shown

**Given** the end-to-end privacy test from S02.03
**When** it runs with alerts present
**Then** no request carries the saved selection

### Story S04.10 — Hub staff see what is waiting and what went where

- **Size:** S · **Estimate:** 4 h · **Actual:** —
- **Traces:** UX-DR16 (O-01, O-06), FR-M2 · **Depends on:** S04.07 · **Branch:** `e04-s10-hub-home`

As a Hub Coordinator,
I want one screen with open incidents and anything waiting for me,
So that nothing sits unapproved while residents wait.

**Acceptance Criteria:**

**Given** the Hub home (O-01)
**When** a Coordinator or Admin opens it
**Then** entries waiting for their approval (excluding ones they edited) are at the top with how long they have waited, then open threads, most recent first; drills are in a separate labelled section

**Given** the published confirmation (O-06)
**When** an entry is approved
**Then** it shows what went where: web in which languages, fallback languages, and the texts that will go out once texting is live (E06)

**Given** a Director
**When** they open the Hub home
**Then** it is read-only, and every action endpoint returns 403 (S01.12 list)

## E05 — Alerts stay current: updates, corrections, closing, status and sharing

A disruption stays one running thread: staff add updates, correct or withdraw what residents saw (shown in place, never quietly replaced), close it with a final entry or let it expire, and residents see building and neighbourhood status derived from those threads, a readable archive, and a one-step share that always shows the live, standard alert. With E05 done, `RESIDENT_ALERTS_ENABLED` may be turned on in production.

**Epic estimate:** 47 h across 8 stories (2 S, 6 M) · **Epic actual:** —

**Depends on E04:** S04.03 (lifecycle, triggers, thread lock, entry versions), S04.05 (compose and idempotent submit), S04.06 (renderer and hash), S04.07 (approval, recipient snapshot hook), S04.08 (feed, alert detail, drill isolation). Each story creates only the tables it needs and names the stories it depends on.

**Handoffs.** Sending is E06 and recipients are E07. Every use case in this epic that supersedes an entry, discards entries or closes a thread calls `messaging`'s `cancelQueued(entryIds, tx)` port inside its transaction; it does nothing until E06 implements it, and E06 must keep it in the same transaction. Corrections and withdrawals capture recipients at approval through `captureRecipients(entry, tx)` with the AD-7 rule (the target's recipients ∪ the entry's own audience, opt-outs never removing them); a final has no target and captures the thread union (definitions). E07 implements these rules. The dispatcher (E06) must claim a delivery only by locking its row and re-checking that it is still `queued`, so a merge or close that holds the row lock cannot be overtaken (S05.05).

**Definitions used in this epic**

| Term | Meaning |
| --- | --- |
| Update | An `update` entry added to an open thread. It does not supersede anything; earlier entries stay readable in order. Promoting an acknowledgement (O-13) is posting the first update. |
| Phase | Required on every `ack`, `update` and `correction`: `problem` or `in_progress`. It drives derived status. |
| Correction | A `correction` entry that names one target entry. When approved, the target becomes `superseded`; residents see the correction above the original, with the original's wording still readable and marked "Corrected". |
| Substantive entry | An `ack`, `update`, `correction` or `final`. Withdrawal notices (human or system) are never substantive. |
| Withdrawal | A `withdrawal` entry that names one target. When approved, the target becomes `superseded` and residents see "Withdrawn" with the reason in its place. If no published, non-superseded substantive entry remains, the thread closes `withdrawn`; the withdrawal notice itself does not keep the thread open. |
| Valid target | An entry that is `approved`, or `pending_approval` and web-published (the D-1 case in E08), and not already superseded. A correction itself can be corrected. |
| Final | A `final` entry that closes the thread `resolved` when approved. "Mark resolved" by an ambassador or Hub staff submits one. It has no target. |
| Final recipients | The union, deduplicated by recipient and channel, of the recipients of every entry in the thread on the channels each was sent on, plus the final's own audience; opt-outs never remove anyone; language is each recipient's current language. |
| Thread expiry | A thread expires when the valid-until of its latest published, non-superseded substantive entry has passed and it has not been closed. The expire job closes it `expired` with a system `final`. "Until resolved" entries are renewed by each update (24 elapsed hours from that update). Expiry never means resolved. |
| Closed thread | `closed{resolved|expired|withdrawn}`. Only `alerting.closeAlert(alertId, reason, keepEntryId?)` closes a thread; closing discards every `draft` and `pending_approval` entry and calls `cancelQueued` for every entry except `keepEntryId` (the final being approved), in the same transaction. Every later change is refused with `ALERT_CLOSED`. |
| Covering entry | The latest published, non-superseded substantive entry of a thread. A thread covers a place when that entry's audience covers it, so a narrowing update stops the thread covering the places it dropped. |
| Status threads | The non-drill threads used for status: every open thread, plus threads closed `resolved` within the last 12 hours. This set is queried separately from the live feed list, which holds open threads only. |
| Derived status | Computed only by `alerting/domain/status.ts#statusOf(place, threads)` (AD-19) over the status threads that cover the place: `active` (open, covering entry phase `problem`), `in_progress` (open, covering entry phase `in_progress`), `resolved` (closed `resolved` within the last 12 hours), else `none`; precedence active > in_progress > resolved > none. Expired and withdrawn threads never give `resolved`. `verified` is true when at least one thread giving the winning status has a verified covering entry, and false only when all of them are unverified. |
| Archive | Closed non-drill threads, newest first, readable by anyone, with every entry and correction as shown when live. |
| Share link | `/a/{slug}?l={lang}`: always the standard (untailored) alert in its current state. Sharing is never recorded. |

### Story S05.01 — Hub staff post updates to a running alert

- **Size:** M · **Estimate:** 6 h · **Actual:** —
- **Traces:** FR-A7, FR-A4 (update), UX-DR16 (O-13, O-14), AR-8 · **Depends on:** S04.07 · **Branch:** `e05-s01-updates`

As a Hub Coordinator,
I want to add what we now know to the same alert,
So that residents follow one running story instead of many separate alerts.

**Acceptance Criteria:**

**Given** an open thread with an approved acknowledgement
**When** a Coordinator chooses "Add an update" (O-14), or "Promote to full alert" (O-13) for the first update
**Then** the composer opens with the thread's audience, types and languages carried over, a required phase, and a valid-until defaulting to the previous entry's choice ("until resolved" renews to 24 hours from now)
**And** submit, approval, translation and freezing follow E04 exactly (idempotent submit, second-person approval bound to version and hash)

**Given** an update that widens the audience beyond the thread's
**When** it is submitted
**Then** the new audience is stored on the update and shown to the approver as "Now also for: …"; narrowing is allowed and shown the same way

**Given** an approved update
**When** a resident opens the alert
**Then** entries appear newest first with their times and phases, earlier entries remain readable, and the thread's valid-until is the latest entry's

**Given** the thread was closed while the update was being written or waited for approval
**When** it is submitted or approved
**Then** it is refused with `ALERT_CLOSED` ("This alert is already closed"), and a closed thread offers no "Add an update"

### Story S05.02 — Hub staff correct or withdraw what residents saw, in the open

- **Size:** M · **Estimate:** 7 h · **Actual:** —
- **Traces:** FR-A16 (web), FR-A15, AR-8 (supersession), AR-11 (correction recipients handoff), UX-DR16 (O-15), UX-DR6 · **Depends on:** S05.01 · **Branch:** `e05-s02-corrections-withdrawals`

As a Hub Coordinator,
I want to correct or withdraw an entry so residents see what changed,
So that a mistake is fixed openly and nobody keeps acting on wrong information.

**Acceptance Criteria:**

**Given** a valid target
**When** a Coordinator chooses "Correct" (O-15) and writes the corrected wording, or "Withdraw" with a reason chosen from a catalog list (wrong place, wrong information, duplicate, other with text)
**Then** a `correction` or `withdrawal` entry naming the target is created and goes through submit and second-person approval
**And** an Ambassador may correct or withdraw only their own pending entries (E08); Coordinators and Admins any valid target; Directors none (direct-request tests added to the S01.12 list)

**Given** the correction or withdrawal is approved
**When** the transaction commits
**Then** the target becomes `superseded`, `cancelQueued` is called for the target, `feed_version` is incremented, and both changes are audited, all in one transaction under the thread lock

**Given** a target that is not valid (already superseded, discarded, a draft, or in a closed thread)
**When** a correction or withdrawal of it is submitted or approved
**Then** it is refused with the reason; two corrections of the same target approved at the same time result in exactly one success (concurrency test)

**Given** a direct SQL change that marks an entry `superseded` without an approved correction or withdrawal naming it
**When** run with the app's credentials
**Then** the trigger refuses it

**Given** a resident opens a corrected alert (R-07)
**When** it renders
**Then** the correction is shown above the original with the correction marker, and the original's wording stays readable, marked "Corrected"; a withdrawn entry shows "Withdrawn" and the reason in its place
**And** the feed, the alert detail and the share preview all show the same state

**Given** a withdrawal leaves no published, non-superseded substantive entry in the thread
**When** it is approved
**Then** `closeAlert(alertId, 'withdrawn', keepEntryId = the withdrawal)` runs in the same transaction, even though the new withdrawal notice is itself published, so the withdrawal's own texts are kept and sent

**Given** a thread with one approved acknowledgement, and a thread with an acknowledgement and one update
**When** the only substantive entry is withdrawn in the first, and only the update in the second
**Then** the first thread closes `withdrawn`, and the second stays open on its acknowledgement (integration tests)

**Given** the correction recipients rule
**When** a correction or withdrawal is approved
**Then** `captureRecipients` is called with the target and the entry's own audience (handoff to E07), and the approval view says it will go to everyone who got the original

### Story S05.03 — Hub staff close an alert once, with a final word

- **Size:** M · **Estimate:** 7 h · **Actual:** —
- **Traces:** FR-A7, AR-8 (single close path), AR-9, UX-DR16 (O-16) · **Depends on:** S05.02 · **Branch:** `e05-s03-close-thread`

As a Hub Coordinator,
I want to close an alert with a final message when the problem is fixed,
So that residents know it is over and nothing more goes out for it.

**Acceptance Criteria:**

**Given** an open thread
**When** a Coordinator or an assigned Ambassador chooses "Mark resolved" (O-16) and writes the final message
**Then** a `final` entry is submitted, and its approval by a second person runs, in one transaction under the thread lock: `closeAlert(alertId, 'resolved', keepEntryId = the final)`, which cancels queued deliveries of every other entry; then the final's recipients are captured as the final recipients union (handoff to E07)
**And** the approval view says the final goes to everyone who got any entry of this alert, on the channels they got it on

**Given** `closeAlert`
**When** it runs
**Then** under the thread lock it sets the thread `closed` with its reason and time, moves every `draft` and `pending_approval` entry other than `keepEntryId` to `discarded`, calls `cancelQueued` for every entry except `keepEntryId`, increments `feed_version` and audits `alert.closed`, all in one transaction

**Given** a thread with an update whose texts are still queued
**When** its final is approved
**Then** the update's queued deliveries are cancelled and the final's deliveries are created and stay queued (integration test with a fake `cancelQueued` and `captureRecipients` recording calls; E06 repeats it with real deliveries)
**And** no other code path can close a thread (a trigger refuses any other update of `alert.state`, tested by direct SQL)

**Given** a closed thread
**When** anyone submits, approves, corrects, withdraws or updates in it
**Then** it is refused with `ALERT_CLOSED`, and the refusal is recorded

**Given** concurrent actions on one thread (an approval and a close; a correction approval and the expire job; two finals)
**When** they run at the same time
**Then** the results are as if they ran one after the other in lock order, no entry is approved in a closed thread, and only one final closes it (integration tests fire each pair concurrently)

**Given** a closed thread
**When** a resident opens it
**Then** it shows its close reason with distinct wording and icon for each ("Resolved", "Expired", "Withdrawn"), the final message and every earlier entry, and it is no longer in the live feed

### Story S05.04 — Alerts that run past their time close on their own

- **Size:** S · **Estimate:** 4 h · **Actual:** —
- **Traces:** FR-A7, AR-8 (system entries) · **Depends on:** S05.03 · **Branch:** `e05-s04-expire-job`

As a resident,
I want old alerts to close when nobody has updated them,
So that I am not worried by a problem that is long over.

**Acceptance Criteria:**

**Given** `/api/jobs/expire`, called every minute by pg_cron with the environment's job secret
**When** a thread's latest published, non-superseded entry is past its valid-until
**Then** the job, under the thread lock, adds a system `final` (`published_system`, web-only, text from the catalog "This alert has expired without a further update. The problem may continue. Contact the Hub for current information.") and calls `closeAlert(alertId, 'expired')`

**Given** the `published_system` transition
**When** it is attempted without the session variable `cvh.system_actor` set by the expire job or the discard use case
**Then** the trigger refuses it (direct SQL test)

**Given** the job runs twice at once, or is retried after a failure
**When** it processes the same thread
**Then** the thread is closed once and has one system final (idempotent; concurrency test)

**Given** a valid-until across the daylight-saving changes (8 March 2026 and 1 November 2026)
**When** the job decides expiry
**Then** it compares UTC instants only, and tests cover a valid-until set in the repeated autumn hour and "until resolved" spanning each change

**Given** an expired thread
**When** residents see it, its status and its share preview
**Then** it is labelled "Expired", never "Resolved", and it gives no `resolved` status

**Given** the job fails or a pg_cron run fails
**When** it happens
**Then** an `ops_event` is recorded (picked up by the health job in E09), and the next run closes any overdue thread

### Story S05.05 — Hub staff merge duplicate alerts before texts go out

- **Size:** S · **Estimate:** 4 h · **Actual:** —
- **Traces:** AR-8 (duplicates), FR-A7 · **Depends on:** S05.03 · **Branch:** `e05-s05-merge-duplicates`

As a Hub Coordinator,
I want to fold a duplicate alert into the one already running,
So that residents get one story, not two versions of the same problem.

**Acceptance Criteria:**

**Given** the "possible duplicate" link shown at approval (S04.05)
**When** a Coordinator chooses "Merge into the running alert"
**Then** in one transaction it locks both threads in id order, then locks every delivery row of the newer thread (`FOR UPDATE`, waiting for any claim in progress), and only if every one is `queued` or `cancelled` does it cancel the queued ones, discard the newer thread's entries (web-published ones get a system `withdrawal` with reason "duplicate"), close the newer thread `withdrawn`, and record the merge on both threads in the audit trail

**Given** any delivery of the newer thread is `claimed`, `submitted` or in any later state
**When** a merge is attempted
**Then** it is refused with "Texts have already gone out or are going out; correct or withdraw instead", and nothing changes

**Given** a merge and a dispatcher claim on the same delivery at the same time
**When** both run
**Then** either the claim wins and the merge is refused, or the merge wins and the claim finds the row `cancelled` and skips it; never both (concurrency test with a fake dispatcher that claims by row lock and re-checks `queued`, the rule E06 must follow)

**Given** a merge of a thread into itself, into a closed thread, of a closed thread, or between a drill and a real thread
**When** it is attempted
**Then** it is refused with the reason, and the refusal is recorded

**Given** a merge
**When** a resident opens the newer thread's link
**Then** they see "This alert was merged" with a link to the running alert

### Story S05.06 — Residents see the status of each building and neighbourhood

- **Size:** M · **Estimate:** 6 h · **Actual:** —
- **Traces:** FR-D6, AR-24, FR-D4-P, UX-DR5 · **Depends on:** S05.03 · **Branch:** `e05-s06-derived-status`

As a resident,
I want to see at a glance whether my building has a problem now,
So that I know whether to act before reading every alert.

**Acceptance Criteria:**

**Given** `statusOf(place, threads)`
**When** the table-driven unit tests run
**Then** they cover each status, the precedence, a neighbourhood thread covering every building in it, a superseded entry being ignored, a withdrawn or expired thread giving `none`, the 12-hour resolved window measured from closing time, drills ignored, an update that narrows the audience from buildings A and B to A (B no longer covered by that thread), and for each affected place: a verified and an unverified thread with the same winning status (`verified: true`), only unverified threads (`verified: false`), and an unverified active thread beside a verified in-progress one (active, `verified: false`)

**Given** the feed
**When** served
**Then** `places.buildings` and `places.neighbourhoods` carry each place's derived status and `verified`, computed at request time from the status threads, which include threads closed `resolved` in the last 12 hours even though they are no longer in the feed's thread list (no stored status; the `building` table holds facts only)

**Given** home and the building page
**When** they render
**Then** status shows as text and icon as well as colour ("Active problem", "Work in progress", "Resolved", or nothing), with "Not yet verified" when `verified` is false, and links to the threads behind it

**Given** a resolved status
**When** 12 hours have passed since closing (using the feed's `server_now`, not the phone's clock)
**Then** it shows `none`

### Story S05.07 — Every phone shows the latest state of each alert, and an archive

- **Size:** M · **Estimate:** 6 h · **Actual:** —
- **Traces:** AR-25, FR-A7 (archive), NFR-N3, UX-DR8 · **Depends on:** S05.03, S02.12 · **Branch:** `e05-s07-feed-currency-archive`

As a resident,
I want what I see to be the current state of each alert, even after a correction or close,
So that I never act on something that was withdrawn or is over.

**Acceptance Criteria:**

**Given** the client and the service worker
**When** a feed response arrives with a lower `feed_version` than the highest seen on this phone
**Then** it is discarded by both, so an older cached copy can never replace a newer one (test serves versions out of order)

**Given** an alert shown from the cache while offline
**When** its valid-until has passed by the phone's clock adjusted by the last known `server_now` offset
**Then** it is shown as "This alert may have ended. Check again when you have signal" instead of as current

**Given** a thread closed, corrected or withdrawn after the phone last loaded the feed
**When** the phone next polls successfully
**Then** the closed thread leaves the live list and the correction or withdrawal appears in place, within the same poll

**Given** `/api/feed/archive?lang=&page=`
**When** requested
**Then** it returns closed non-drill threads, newest first, 20 per page, with every entry as shown when live, edge-cached for at most 60 seconds, with no cookie; the archive screen (R-08) shows them with their close reason and dates

**Given** a drill thread
**When** the archive is requested
**Then** it never appears (added to the drill isolation test)

### Story S05.08 — Residents share an alert in one step

- **Size:** M · **Estimate:** 7 h · **Actual:** —
- **Traces:** FR-A11, AR-25 (share URL), AR-10 (drill 404), UX-DR7 · **Depends on:** S05.02, S05.06 · **Branch:** `e05-s08-share`

As a resident,
I want to share an alert to WhatsApp or anywhere else in one step,
So that neighbours without the app still get trustworthy information.

**Acceptance Criteria:**

**Given** an alert and the share control (R-29)
**When** the resident taps Share
**Then** the phone's share sheet opens (Web Share API) with a short text in the page language: type, place, verification marker, attribution, time and the link `/a/{slug}?l={lang}`; where the share sheet is unavailable, "Copy" and "WhatsApp" (`https://wa.me/?text=…`) are offered
**And** the shared text is always the standard version, never tailored, and an unverified alert is shared as "Not yet verified"

**Given** the share link is pasted in WhatsApp
**When** the preview is generated (R-30)
**Then** the server-rendered page at `/a/{slug}` gives Open Graph title and description in language `l` showing type, place, verification, correction or close state and time, readable without opening the link
**And** the app's guarantee covers its own server only: metadata it serves reflects the current state within 15 seconds; when WhatsApp or another app refreshes a preview it already showed is outside the app's control, and the shared message text is a snapshot from the moment of sharing

**Given** a thread is corrected, an entry is withdrawn, or the thread is closed
**When** the metadata is fetched again more than 15 seconds later
**Then** it shows the new state (tests fetch the page after each change)

**Given** the link is opened
**When** the page loads
**Then** it always shows the alert's current state: the live alert with any correction above the original, in language `l`, then switches to the device's saved language if one is set; a closed thread shows its closed state; a merged thread shows the merge note

**Given** a drill thread, an unknown slug, or a thread with no web-published entry
**When** `/a/{slug}` is requested
**Then** it returns 404 with no detail

**Given** sharing
**When** it happens
**Then** nothing about it is sent to the server: no usage event, no request other than loading the shared page by the recipient, and `/a/**` sets no cookie (added to the no-cookie test)

**Given** E05 is complete
**When** the Hub decides to show alerts to residents in production
**Then** an Admin changes `RESIDENT_ALERTS_ENABLED` to true through a production deploy, the change is recorded in the launch-readiness checklist, and the S04.08 configuration test is updated to expect it on

## E06 — Texts go out safely

Every outbound text goes through one queue and one sender: in a fixed priority order, at a shared, controlled pace, with no automatic duplicate submissions, never after it was cancelled before hand-off, and with delivery status tracked from signed callbacks. Drills reach only the drill roster, an Admin can pause all sending, and a stuck queue alerts the on-call Admin. This epic proves the whole path end to end with drills to staff phones before any resident signs up (E07), and removes the E01 spike.

**Epic estimate:** 48 h across 9 stories (4 S, 5 M) · **Epic actual:** —

**Depends on earlier epics:** S01.02 (production-only Twilio, `SMS_MODE`), S01.04 (audit), S01.10 (`aal2`), S01.12 (policy), S01.15 (spike, removed here), S04.03 (lifecycle and thread lock), S04.06 (frozen bodies and segments), S04.07 (approval transaction and `captureRecipients` hook), S05.02 to S05.05 (`cancelQueued`, closing entry, final recipients, merge guard), S03.02 (`spend_event`). Each story creates only the tables it needs and names the stories it depends on.

**Handoffs.** This epic implements `cancelQueued(entryIds, tx)` and the claim rule that E05's merge relies on, and repeats E05's merge and final-delivery tests with real deliveries. `captureRecipients` is implemented here for drills only (drill roster); E07 adds subscribers.

**What the sender guarantees.** It prevents automatic duplicate submissions: a text is handed to the provider at most once unless an Admin deliberately resends it (E09). It does not guarantee exactly-once delivery: a text whose outcome is unclear is marked `unknown`, never re-sent automatically, and may or may not have arrived.

**Definitions used in this epic**

| Term | Meaning |
| --- | --- |
| Delivery | One `delivery` row per text to one recipient: `kind` (`alert`, `transactional`, `campaign`), `recipient_kind` (`subscriber`, `roster`, `staff`, `oncall`), recipient id, language, frozen body, segments, cost estimate, `idempotency_key` (unique), an opaque random `callback_ref`, the provider id once known, attempts, state and timestamps. It never stores a phone number. |
| Unresolved states | `queued`, `claimed`, `submitted`, `unknown`. `unknown` means the outcome is unclear; it can still be resolved by a late callback. |
| Terminal states | `delivered`, `undelivered`, `failed`, `cancelled`, `skipped`, `skipped_env`. A terminal state never changes. A resend (E09) creates a new row. |
| Closing entry | The entry whose approval closed the thread: its `final`, or the withdrawal that left no substantive entry (E05). Its deliveries stay sendable after the thread closes; every other entry's do not. |
| Sendable (every kind) | The row is still `claimed` by this worker under a valid sender lease, its recipient still exists, its `send_by` time (if any) has not passed, and the pause does not apply to it. The pause applies to `alert`, `campaign` and resident `transactional` texts; on-call texts to `oncall` recipients are still sent during a pause so Admins hear about problems. |
| Sendable (`alert`) | Also: its entry is approved and not superseded or discarded; its thread is open, or the entry is the closing entry; for `ack`, `update` and `correction`, the entry's valid-until has not passed (finals and withdrawals have no valid-until check); drill entries only to `roster` recipients. |
| Sendable (`transactional`) | Also: its `purpose` is on the allow-list for the module that created it (`alerting`: approver notices; `subscriptions`: confirmation, welcome, menu and prompt replies, edit links; `checkins`: escalations; `ops`: on-call alerts), checked by a trigger at insert; and the recipient is still eligible for that purpose at hand-off (a confirmation only to a still-pending sign-up, other subscriber texts only to an active subscriber, on-call texts only to a number still on the on-call roster, staff texts only to an active staff account). Each purpose sets a `send_by` (for example 30 minutes for a menu reply, 48 hours for a confirmation). |
| Sendable (`campaign`) | Also: the campaign was started by an Admin at `aal2` and is not cancelled, and the recipient is a subscriber still in the campaign's target state (D-7: `reconsent_pending`). Campaign texts are created in E09. |
| Claim | The dispatcher takes a row only by locking it (`FOR UPDATE SKIP LOCKED`), re-checking it is still `queued` and due, and committing `claimed` with its worker id and `claimed_at` in its own short transaction. |
| Hand-off point | Immediately before the provider call, one short transaction takes these locks in this order, re-checks that the row is sendable, and commits `handed_off_at`: (1) the sender lease row `FOR SHARE`, checking this worker's token; (2) the `messaging_control` row (which holds the pause) `FOR SHARE`; (3) for `alert` rows, the thread `FOR SHARE`, then the entry `FOR SHARE`; (4) the recipient's row `FOR SHARE` (subscriber, roster entry, on-call entry or staff account); (5) the delivery row `FOR UPDATE`. Competing changes take conflicting locks on the same rows: pause and resume lock `messaging_control` `FOR UPDATE`; supersession, discard, merge and close lock the thread `FOR UPDATE`; deleting a recipient locks its row. So a change committed before the hand-off transaction takes its locks stops the send, and a change that waits behind the hand-off sees the text as already handed off and cannot recall it. |
| Lock order | Extends AD-18: sender lease → `messaging_control` → `alert` → `alert_entry` → recipient row → `delivery` → `checkin` → `checkin_tally` → `spend_cap`. Every use case that touches more than one of these takes them in this order. |
| Claim order | Fire and evacuation alert entries first, then on-call and other transactional texts, then building-level before neighbourhood-level alerts, then oldest first. |
| Sender lease | Only one dispatcher sends at a time, across every function instance and pg_cron run. It holds the single `dispatcher_lease` row, taken by a conditional update when the previous lease has expired, which writes a new random ownership token and an expiry 60 s ahead. Every renewal, claim and hand-off includes `token = mine AND expires_at > now()`; a renewal that updates no row, or a claim or hand-off that finds the token changed or expired, makes that worker stop at once without calling the provider. Each claimed row records the token that claimed it. |
| Send pace | The lease holder submits at most the configured segments per second (default 3, Twilio's default toll-free rate) and claims only as many rows as it can send at that pace before its time limit, leaving 10 s of margin. |
| Not accepted | The provider answered with HTTP 429 and an error body, or the connection failed before any of the request was sent. Only these are retried: the row returns to `queued` with backoff (30 s, 2 min, 10 min), at most 3 attempts, then `failed`. |
| Permanent error | A provider 4xx error other than 429 (for example invalid number, or recipient opted out): the row becomes `failed` with the code; never retried. |
| Ambiguous outcome | Anything else after the request may have been sent: a 5xx response, a timeout, a dropped connection, or an acceptance followed by an error. The row becomes `unknown` and is never re-sent automatically. |
| Lease expiry of a row | A row `claimed` for more than 5 minutes without a hand-off returns to `queued`; one claimed with a hand-off but no recorded outcome for 5 minutes becomes `unknown`; a `submitted` row with no terminal status after 24 hours becomes `unknown`. |
| Pause | Set by an Admin on the single `messaging_control` row. While paused, nothing it applies to is claimed or handed off; queued and claimed-but-not-handed-off rows wait. On-call texts are exempt. |
| Drill roster | Staff-owned phone numbers entered by Admins, each with a label and language. Drill texts can go only to them. |
| On-call roster | Admin phone numbers entered by Admins, for operational alerts (`ops.oncall_roster`). |

**State transitions** (every other change is refused by a trigger)

| From | To | Cause |
| --- | --- | --- |
| `queued` | `claimed` | claim |
| `queued` | `cancelled` | `cancelQueued` (supersession, discard, merge, close) |
| `claimed` | `queued` | not accepted (retry with backoff), pause before hand-off, claim expired before hand-off, or claimed under a lease token that is no longer current (requeued by the new lease holder) |
| `claimed` | `cancelled` | not sendable at the hand-off point because the entry was superseded, discarded or its thread closed |
| `claimed` | `skipped` | not sendable at the hand-off point because the recipient was deleted or is no longer eligible, the valid-until or `send_by` passed, or the campaign was cancelled |
| `claimed` | `skipped_env` | `SMS_MODE=log` |
| `claimed` | `submitted` | provider accepted |
| `claimed` | `failed` | permanent error, or retries exhausted |
| `claimed` | `unknown` | ambiguous outcome, or no outcome 5 minutes after hand-off |
| `claimed`, `submitted`, `unknown` | `delivered`, `undelivered`, `failed` | signed callback with a terminal status |
| `claimed`, `unknown` | `submitted` | signed callback with a non-terminal status (`queued`, `sending`, `sent`) |
| `submitted` | `unknown` | no terminal status after 24 hours |

### Story S06.01 — Every outbound text is one queued record, never a phone number

- **Size:** M · **Estimate:** 6 h · **Actual:** —
- **Traces:** AR-12, AR-17 (no phone in delivery), FR-A17 · **Depends on:** S04.07 · **Branch:** `e06-s01-outbox`

As a Hub Admin,
I want every text recorded once before it is sent,
So that we can always see what went out and nothing is submitted twice automatically.

**Acceptance Criteria:**

**Given** the `delivery` table owned by `messaging`
**When** the migration runs
**Then** it has the fields in the definitions, a unique `idempotency_key` (`entry_id:recipient:channel` for alerts, `kind:subject:purpose:nonce` otherwise), a unique `callback_ref`, no phone number column, RLS locked down, and `recipient_id` set to null if the recipient is deleted

**Given** the state transition table
**When** a change not in the table is attempted, or a terminal state is changed
**Then** the trigger refuses it (direct SQL tests with the app's credentials for every row of the table and for each forbidden change, including `delivered → failed` and `cancelled → queued`)

**Given** two inserts with the same idempotency key
**When** they run at the same time
**Then** exactly one row exists and the other insert returns the existing row (no error to the caller)

**Given** `alert` deliveries
**When** created
**Then** they are created only inside an approval transaction (a trigger refuses an `alert` delivery unless the approval use case set its transaction-local marker for that entry)

**Given** a `transactional` or `campaign` delivery
**When** it is inserted
**Then** a trigger refuses a `transactional` row whose purpose is not on the creating module's allow-list or has no `send_by`, and a `campaign` row with no campaign started by an Admin at `aal2` (direct SQL tests)

**Given** the `ContactResolver` port, wired in the composition root to `subscriptions`, `identity` and `ops`
**When** the dispatcher needs a number
**Then** it resolves it at the hand-off point and never stores it; logs mask numbers to the last two digits (test)

### Story S06.02 — One sender submits each text at most once, in priority order and at a shared pace

- **Size:** M · **Estimate:** 7 h · **Actual:** —
- **Traces:** AR-12, AR-19 (byte-for-byte), FR-M2 (delivery data) · **Depends on:** S06.01 · **Branch:** `e06-s02-dispatcher`

As a Hub Coordinator,
I want approved texts sent quickly, fire alerts first, and never submitted twice automatically,
So that residents get the most urgent text first and nobody gets duplicates from a retry.

**Acceptance Criteria:**

**Given** the dispatcher is started right after an approval commits and every minute by pg_cron (`/api/jobs/dispatch`, with the environment's job secret)
**When** a run starts
**Then** it sends only if it takes the sender lease; otherwise it exits without claiming
**And** three runs started at once result in one sender, and over a 60-second window with a fake clock and fake provider the total submitted never exceeds 3 segments per second (concurrency test)

**Given** a lease holder that stalls for more than 60 seconds (fake clock)
**When** a replacement takes the lease and the old worker then resumes
**Then** the replacement requeues the old worker's claimed rows that were not handed off; the old worker's next renewal, claim or hand-off finds its token changed and stops without calling the provider; no row is handed off twice (test)
**And** a row the old worker had already handed off before stalling keeps its hand-off and is left for its callback or the lease-expiry sweep

**Given** the lease holder
**When** it sends
**Then** it claims only as many rows, in claim order, as it can send at the send pace before its time limit, and for each row: passes the hand-off point, calls the Twilio Messaging Service with the frozen body, `SmartEncoded=false` on every request, and a status callback URL of `PUBLIC_BASE_URL/api/twilio/status?ref={callback_ref}`, then records the outcome

**Given** a burst of 300 queued texts and a fire alert approved during it
**When** the dispatcher continues
**Then** the fire alert's rows are claimed before the remaining lower-priority rows, and the next run picks up where the last stopped

**Given** each provider outcome
**When** the call returns
**Then** acceptance gives `submitted` with the provider id; not accepted re-queues with backoff; a permanent error gives `failed`; an ambiguous outcome gives `unknown`
**And** fake-provider tests cover: 429; connection refused before sending; 400 invalid number; 500; timeout after the request is sent; acceptance followed by a dropped connection; and acceptance followed by an error

**Given** the outcome is written after a callback already moved the row on
**When** the dispatcher records it
**Then** the write applies only if the row is still `claimed` (or only fills a missing provider id that matches), so a late response never overwrites a callback's state (test)

**Given** the row lease rules
**When** the sweep runs (every minute)
**Then** expired claims return to `queued` or become `unknown` as defined, each `unknown` is recorded in `ops_event`, and nothing is re-sent automatically

**Given** `SMS_MODE=log` (every environment except production)
**When** the dispatcher runs
**Then** each row becomes `skipped_env` with its body length and segments logged, no provider call is made, and no Twilio credentials are read

**Given** the Messaging Service configuration
**When** the health job runs daily, and on every change to the service recorded in the procedures
**Then** it reads the service's Smart Encoding setting and raises an on-call alert if it is on; this is defence in depth, because every request already sets `SmartEncoded=false`
**And** the procedures state the configuration-control assumption: only named Admins change the Messaging Service, and texts are paused while they do

### Story S06.03 — Cancelled, merged and closed alerts never send stale texts

- **Size:** S · **Estimate:** 4 h · **Actual:** —
- **Traces:** AR-12, AR-9, FR-A16 (cancellation side) · **Depends on:** S06.02, S05.05 · **Branch:** `e06-s03-cancel-queued`

As a Hub Coordinator,
I want texts for withdrawn, corrected or closed alerts stopped before they are handed off,
So that nobody receives something we already took back, while the final word still goes out.

**Acceptance Criteria:**

**Given** `cancelQueued(entryIds, tx)`
**When** called by supersession, discard, merge or close
**Then** it locks the entries' `queued` rows in lock order (after `alert_entry`, before `checkin`) and sets them `cancelled` in the caller's transaction; `claimed` rows not yet handed off are stopped at the hand-off point by the sendable check; rows already handed off are left and reported to the caller

**Given** E05's final-delivery test with real deliveries
**When** a thread with an update whose texts are still queued gets its final approved, including while texts are paused and after resuming
**Then** the update's queued rows are `cancelled`, the final's rows are created, stay `queued` during the pause, and are sent after resume even though the thread is closed

**Given** a withdrawal that closes its thread
**When** it is approved
**Then** it is the closing entry, its rows are created and sent after the close, and the withdrawn entry's queued rows are cancelled

**Given** E05's merge race with the real dispatcher
**When** a merge and a claim of the same row run at the same time
**Then** either the claim wins and the merge is refused, or the merge wins and the claim skips the cancelled row; never both (concurrency test repeated 50 times)

**Given** the hand-off transaction and each competing change (a pause, a resident or roster entry being deleted, a correction approval, a close, a merge)
**When** they race with controlled interleaving on two database connections, in both orders
**Then** if the change commits first the row is not handed off (returned to `queued`, `skipped` or `cancelled`), and if the hand-off commits first the change waits, then sees the row as in flight; no deadlock occurs with a 5-second lock timeout, and each case follows the lock order (integration tests)

**Given** a correction approved while the original's texts are part-sent
**When** it commits
**Then** the original's queued rows are cancelled, claimed rows not yet handed off become `cancelled` at the hand-off point, handed-off and submitted rows are untouched, and the correction goes to every recipient of the original (drill roster in this epic; subscribers in E07)

### Story S06.04 — Delivery status comes only from signed provider callbacks

- **Size:** M · **Estimate:** 6 h · **Actual:** —
- **Traces:** AR-12 (status webhooks), FR-M2, Consistency Conventions (webhook signatures) · **Depends on:** S06.02 · **Branch:** `e06-s04-status-webhooks`

As a Hub Admin,
I want each text's real delivery status recorded,
So that we know who received an alert and can follow up on failures.

**Acceptance Criteria:**

**Given** `POST /api/twilio/status?ref={callback_ref}`
**When** a callback arrives
**Then** its `X-Twilio-Signature` is validated against the full URL (including `ref`) built from `PUBLIC_BASE_URL` and the request body before any work; an invalid signature returns 403, does nothing, and is counted in `ops_event` (more than 5 in 10 minutes raises an on-call alert, S06.07)

**Given** a valid callback whose `ref` matches a delivery
**When** the delivery has no provider id yet
**Then** the callback's `MessageSid` is stored as its provider id and the status is applied by the transition table
**And** when the delivery already has a different provider id, nothing changes and the mismatch is recorded in `ops_event`

**Given** the race where the callback arrives before the dispatcher has recorded Twilio's response
**When** both complete in either order
**Then** the row ends with the callback's status and the provider id, and the dispatcher's late write changes nothing (test)

**Given** an ambiguous send that never recorded a response
**When** a callback with its `ref` arrives later
**Then** the row moves from `unknown` to the callback's status, and the `unknown` is marked resolved in `ops_event` (test)

**Given** callbacks repeated, out of order, or after a terminal state
**When** processed
**Then** a terminal state never changes, a repeat changes nothing, and a non-terminal status arriving after a terminal one is ignored

**Given** a valid callback with no `ref`, or a `ref` matching no delivery
**When** processed
**Then** it returns 200, changes nothing and is counted in `ops_event`

**Given** the callback route
**When** the no-cookie and logging tests run
**Then** it sets no cookie and never logs the phone number or body from the request

### Story S06.05 — Admins run drills that reach only the drill roster

- **Size:** M · **Estimate:** 7 h · **Actual:** —
- **Traces:** FR-A17, AR-10, NFR-N6, FR-M4 (drills) · **Depends on:** S06.03, S06.04 · **Branch:** `e06-s05-drills`

As a Hub Admin,
I want to rehearse a real alert on the live system with staff phones only,
So that we practise sending without any chance of reaching residents.

**Acceptance Criteria:**

**Given** the drill roster screen
**When** an Admin at `aal2` adds, edits or removes a roster entry (label, Canadian `+1` number, language)
**Then** the change is saved and audited without the number; numbers are never stored in the repository or CI

**Given** an Admin at `aal2` chooses "Start a drill"
**When** the thread is created
**Then** `is_drill` is true and immutable, every screen shows the exercise marker, and staff lists show it in the separate drills section

**Given** a drill entry is approved by a second person
**When** `captureRecipients` runs
**Then** it creates deliveries only for drill roster entries, each in the entry's frozen body for the roster member's language, with the exercise marker first

**Given** any attempt to create a delivery for a drill entry to a non-roster recipient, or for a real entry to a roster recipient
**When** it reaches the database
**Then** the trigger refuses it (direct SQL tests)

**Given** a drill thread
**When** anyone tries to change `is_drill`, merge it with a real thread, or open its share link
**Then** it is refused, and `/a/{slug}` returns 404

**Given** a drill completes
**When** the Hub reviews it
**Then** the drill view shows per roster member and language how many texts were handed off, delivered, undelivered, failed and unknown, and drill counts are stored apart from real alert counts (FR-M4)

**Given** a production drill
**When** run as part of launch readiness
**Then** it covers an alert, an update, a correction and a final, and each roster phone receives each text in its language with the exercise marker, with no automatic duplicate submission; any `unknown` is investigated before launch

### Story S06.06 — An Admin can pause all sending at once

- **Size:** S · **Estimate:** 4 h · **Actual:** —
- **Traces:** AR-12 (pause), NFR-N6 · **Depends on:** S06.02 · **Branch:** `e06-s06-pause`

As a Hub Admin,
I want one switch that stops every text not yet handed to the provider,
So that we can stop a mistake or a provider problem immediately.

**Acceptance Criteria:**

**Given** an Admin at `aal2`
**When** they choose "Pause all texts" with a reason
**Then** the pause is recorded on `messaging_control` and audited, every Hub screen shows "Texts are paused" with who paused, when and why, nothing it applies to is claimed, and claimed rows not yet handed off return to `queued` at the hand-off point
**And** on-call texts to Admins continue during the pause, and the screen says so

**Given** texts already handed off when the pause commits
**When** the pause screen shows
**Then** it says "{n} texts were already handed to the provider and cannot be recalled", with the same wording on the sending progress view

**Given** a pause
**When** texts are approved or created during it
**Then** they queue normally, and the approver sees "Texts are paused; this will send when resumed"

**Given** "Resume texts"
**When** an Admin at `aal2` resumes
**Then** the pause ends, is audited, and the dispatcher continues in claim order; each row is checked for sendability at the hand-off point, so rows whose entry was superseded, discarded, past its valid-until or in a closed thread are cancelled or skipped, while a closing entry's rows are sent

**Given** anyone other than an Admin, or an Admin without `aal2`
**When** they call pause or resume directly
**Then** it returns 403 (S01.12 list)

### Story S06.07 — A stuck queue or failing sender alerts the on-call Admin

- **Size:** M · **Estimate:** 6 h · **Actual:** —
- **Traces:** AR-21 (minimal), NFR-N6 · **Depends on:** S06.04, S06.06 · **Branch:** `e06-s07-stuck-queue-alert`

As the on-call Admin,
I want a text when sending is stuck or failing,
So that a problem is fixed before residents miss an alert.

**Acceptance Criteria:**

**Given** the on-call roster screen
**When** an Admin at `aal2` adds or removes an on-call number
**Then** it is saved in `ops.oncall_roster` and audited without the number; at least one on-call number is required before any non-drill alert can be approved in production

**Given** `/api/jobs/health`, called every minute by pg_cron
**When** a delivery is `queued` and due for more than 5 minutes outside a pause, a row becomes `unknown`, the sender lease has not been renewed for 3 minutes while rows are due, Smart Encoding is found on, or signature failures exceed 5 in 10 minutes
**Then** it writes an `ops_event` (no personal data) and creates one `transactional` text per on-call number, at most once per condition per 30 minutes

**Given** an on-call text
**When** it is queued
**Then** it follows the claim order: after fire and evacuation alerts, before every other alert; if the sender itself is failing, the `ops_event` and the Hub banner still record it (an independent outside check is added in E09)

**Given** the condition clears
**When** the health job next runs
**Then** it records the recovery in `ops_event`, and no further alerts are sent for it

### Story S06.08 — Each text records its cost and timing

- **Size:** S · **Estimate:** 4 h · **Actual:** —
- **Traces:** FR-M2, FR-M5 (cost data), FR-M4 · **Depends on:** S06.04 · **Branch:** `e06-s08-cost-timing`

As a Hub Director,
I want each alert's cost and delivery times recorded,
So that the pilot can report cost per alert and how quickly texts arrived.

**Acceptance Criteria:**

**Given** a delivery handed off
**When** it is recorded
**Then** its segments and estimated cost (segments × configured price per segment, integer cents CAD) are written to `spend_event` with kind `sms`, language, entry id and `is_drill`

**Given** a delivery with a provider id reaches a terminal state
**When** the price job runs (hourly)
**Then** it fetches the Message resource from Twilio and stores `price`, `price_unit` and `num_segments` beside the estimate; while `price` is still empty it retries hourly for up to 72 hours, then records "price not reported"
**And** reports use the actual price when present (converted to CAD at the configured rate, labelled), otherwise the estimate, labelled as an estimate

**Given** an alert entry's deliveries
**When** the pilot measures are computed
**Then** per entry and language, the denominator is the rows handed off (excluding `cancelled`, `skipped` and `skipped_env`); time from approval to first hand-off, and to the moment delivered rows reach 90% of that denominator, are reported; if 90% is never reached, the measure shows "not reached" with the final delivered share; drills are reported apart

**Given** a correction
**When** its reach is computed
**Then** it reports attempted reach (recipients of the original, and correction rows handed off to them) separately from confirmed reach (correction rows `delivered`), drills apart (FR-M4)

### Story S06.09 — The first-text spike is replaced, and the Hub sees what went where

- **Size:** S · **Estimate:** 4 h · **Actual:** —
- **Traces:** UX-DR16 (O-06), AR-12 · **Depends on:** S06.05 · **Branch:** `e06-s09-remove-spike-progress`

As a Hub Coordinator,
I want to see the sending progress of an alert, and only one way texts are sent,
So that I know who has been reached and no test path can send by accident.

**Acceptance Criteria:**

**Given** the E01 spike (S01.15)
**When** this story is done
**Then** its screen, route, allowlist variable and `sms.test_sent` action are removed; the Twilio adapter is imported only by the dispatcher and the price job (dependency rule); a test fails if any other module calls it

**Given** the published confirmation (O-06) and the alert's staff view
**When** an entry is sending
**Then** they show per language: waiting, in flight (handed to the provider), delivered, undelivered, failed, unknown and cancelled counts, refreshed every 15 seconds, with drills in their own view

**Given** a failed, undelivered or unknown text
**When** shown
**Then** it shows the meaning in plain words (for example "Number not in service", "Outcome unclear; not re-sent"), without the phone number on screen

## E07 — Residents sign up and get alerts by text

Residents read plain-language terms, sign up for texts on the web or with a staff member's help, and confirm by replying YES themselves. They change their choices or leave by text or a short-lived web link, approved alerts reach exactly the matching subscribers in their language, corrections and finals reach everyone who got the original, and Admins see spend against the budget with a cap that warns but never blocks.

**Epic estimate:** 54 h across 10 stories (5 S, 5 M) · **Epic actual:** —

**Depends on earlier epics:** S01.04 (audit), S01.12 (policy), S01.13 (buildings and floors), S02.03 (device choices), S03.04 (`rate_limit`), S04.04 (`matches`), S04.06 (renderer), S04.07 (approval, reviewed-count check, `captureRecipients` hook), S05.02 and S05.03 (correction and final recipient rules), S06.01 to S06.07 (outbox, sendability by kind, sender, callbacks, pause, on-call), S06.08 (cost data). Each story creates only the tables it needs and names the stories it depends on.

**Handoffs.** Reply 3 (withdraw a check-in request) is routed to `checkins`' `withdrawRequest(subscriberId)` port; until E08 implements it, it replies "You have no check-in request". The sign-up form's optional check-in request is added in E08. Re-consent campaigns at the end of the pilot are E09.

**Definitions used in this epic**

| Term | Meaning |
| --- | --- |
| Canadian number | An E.164 `+1` number whose area code is on the Canadian area-code list in config. Anything else is refused. |
| Pending sign-up | A `pending_signup` holding the number, language, neighbourhood, optional places, groups and topics, `consent_version` and how it started (`web` or `staff`). It expires 48 hours after its confirmation text was created. At most one per number per 48 hours. |
| Subscriber | A confirmed number with language, neighbourhood (required), places (`subscriber_place`: buildings, each with optional floors; any number of buildings), groups, topic opt-outs, `consent_version` and `retention_state`. No name, unit, email or password is ever stored. |
| Confirmation | Only the resident replying YES from that number confirms. YES is accepted as `YES` or `Y` in any case, or the catalog's word for yes in the pending sign-up's language. YES resolves to the open prompt with the latest `sent_at` for that number. |
| Reply normalisation | Inbound text is trimmed and case-folded; Arabic-Indic, Extended Arabic-Indic, Bengali, Devanagari, Gujarati, Gurmukhi, Tamil and full-width digits are mapped to 0–9 before matching. Inbound bodies are never stored, only daily keyword counts. |
| Decision table | One router, `subscriptions/application/handleInbound`, chooses the action from (keyword, the number's state `none`, `pending` or `active`, open prompt). Every row has a test. |
| Menu | Reply 1 (street → building on that street → floor) or 2 (language by list number), state in `sms_prompt`. Every step offers 0 to go back and 9 for the Hub's number; options that do not fit page with 9 → "more" replaced by 8 (so 9 always means the Hub); a menu idle for 10 minutes resets with a message saying so; at most 5 menus per number per day. Every menu message is a catalog string that fits one segment in its language's encoding. |
| Edit link | A single-use web link valid for 30 minutes, sent by text on request, to change choices or delete the subscription. |
| Matching subscribers | Active subscribers for whom `src/contracts/audience.ts#matches` is true; the SQL query in `subscriptions` must return exactly the same set (property test). |
| Monthly cap | An Admin-set SMS spend limit per calendar month in `America/Toronto`. Exceeding it shows the shortfall and notifies Admins; it never blocks a send. |
| Overnight notice | The welcome text says, in the resident's language, that messages are checked by Hub staff and may not be sent overnight (accepted risk R-11). |

### Story S07.01 — Residents can read plain terms before signing up

- **Size:** S · **Estimate:** 4 h · **Actual:** —
- **Traces:** NFR-N5 (terms), AR-17, FR-A2 · **Depends on:** S02.09 · **Branch:** `e07-s01-terms`

As a resident,
I want to read in my language what the CVH keeps about me and who handles it,
So that I can decide whether to sign up.

**Acceptance Criteria:**

**Given** the terms and privacy page at `/{lang}/terms`
**When** opened
**Then** it states in plain words: only the phone number, language, neighbourhood and optional choices are kept; no name, unit, email or password; who processes data (Twilio, Cohere, Vercel, Supabase) and where; the community owns the data; how to stop (reply STOP or 0) and that stopping deletes the subscription; that backups keep deleted data for the backup window; the minimum age of 16, or younger with a parent's or guardian's help; the privacy contact; and that messages are checked by Hub staff and may not be sent overnight

**Given** the terms text
**When** it is published
**Then** it carries a version (`consent_version`), is translated and reviewed offline like the guides (S02.09 rules, owner and last-updated date shown), and every sign-up records the version shown
**And** a new version applies to new sign-ups only; existing subscribers keep theirs until the end-of-pilot re-consent (E09)

**Given** the counsel review in launch readiness
**When** the terms are changed after it
**Then** the new version is not published until the review is recorded

### Story S07.02 — Resident signs up for texts on the web

- **Size:** M · **Estimate:** 7 h · **Actual:** —
- **Traces:** FR-A2, FR-A9 (SMS), FR-A12, AR-13, AR-20, UX-DR9 (R-05, R-06) · **Depends on:** S07.01, S06.07 · **Branch:** `e07-s02-web-signup`

As a resident,
I want to sign up for text alerts with just my number, language and neighbourhood,
So that I get alerts even when I am not using the app.

**Acceptance Criteria:**

**Given** "Get text alerts" (R-05)
**When** opened
**Then** the form is filled from the device choices (language, neighbourhood from chosen buildings, buildings, floors, groups) and asks only for the phone number; the resident can change any choice, must agree to the terms (linked, version shown) and confirm the minimum-age statement

**Given** the form is submitted
**When** the number is not a Canadian number, the neighbourhood is missing, or the terms are not agreed
**Then** it is refused with the reason in the page language and nothing is stored

**Given** a valid submission
**When** it is accepted
**Then** a pending sign-up is created and one `transactional` confirmation text (purpose `confirmation`, `send_by` 48 hours) is queued in the chosen language: "Reply YES to get CVH alerts. Reply STOP to stop."; R-06 shows what to expect, how to stop and how to change choices
**And** this POST is the only resident request that carries places or groups (AD-3 exception), and it sets no cookie

**Given** a number with a pending sign-up in the last 48 hours, or already subscribed
**When** submitted again
**Then** the response is a success body with `status: already_pending` or `already_subscribed` and the same neutral wording ("If this number can get texts, a message is on its way"), so the form never reveals whether a number is subscribed; no second confirmation is sent

**Given** one client (salted IP hash) submits more than 5 sign-ups in an hour
**When** the next arrives
**Then** it returns 429 and nothing is stored

**Given** the confirmation is refused by the provider because the number earlier texted STOP (permanent error)
**When** the callback arrives
**Then** the pending sign-up is deleted, and R-06 has told the resident in advance: "No text within 5 minutes? Text START to {number}, then sign up again"

### Story S07.03 — Staff help a resident sign up at an event or the Hub desk

- **Size:** S · **Estimate:** 4 h · **Actual:** —
- **Traces:** FR-A2 (helped sign-up), AR-20, NFR-N5 (staff-assisted) · **Depends on:** S07.02 · **Branch:** `e07-s03-staff-assisted-signup`

As a Hub Coordinator at a launch event,
I want to start a sign-up for a resident on my phone,
So that residents without the app can join, while still confirming for themselves.

**Acceptance Criteria:**

**Given** the staff sign-up screen (Coordinators, Ambassadors and Admins)
**When** the staff member enters the resident's number, language, neighbourhood and optional choices, and confirms the resident has heard the terms summary (shown on screen in the resident's language)
**Then** a pending sign-up with `started_by = staff` is created and the same confirmation text is queued; the resident must reply YES themselves

**Given** the per-staff limit
**When** a staff account starts more than 40 sign-ups in a day
**Then** further ones are refused with a message (limits per staff account, not per IP)

**Given** the audit trail
**When** a staff-assisted sign-up is started
**Then** `signup.assisted` is audited with the staff id and outcome, never the phone number

**Given** a staff member
**When** they later look for that resident
**Then** no staff screen lists subscribers or their numbers (access requests are E09)

### Story S07.04 — Residents confirm, get a welcome, and STOP deletes them

- **Size:** M · **Estimate:** 7 h · **Actual:** —
- **Traces:** FR-A2, FR-D-6, AR-13, AR-17 · **Depends on:** S07.02 · **Branch:** `e07-s04-inbound-router`

As a resident,
I want my YES to start my alerts and STOP to remove me completely,
So that I control whether I get texts.

**Acceptance Criteria:**

**Given** `POST /api/twilio/inbound`
**When** a message arrives
**Then** the signature is validated against `PUBLIC_BASE_URL` before any work; the body is normalised and passed to the decision table, then discarded; only the daily keyword count is stored

**Given** a pending sign-up and the reply YES from that number before it expires
**When** it is handled
**Then** in one transaction the subscriber is created from the pending sign-up and the pending row deleted; a welcome text is queued in the subscriber's language explaining reply 1 (change building or floor), 2 (change language), 3 (withdraw check-in), 0 (stop and delete) and STOP, with the overnight notice
**And** a repeated YES is answered "You are already signed up" and changes nothing

**Given** YES with no pending sign-up, or after it expired
**When** handled
**Then** the reply gives the sign-up link and no subscriber is created

**Given** Twilio Advanced Opt-Out handles STOP, START and HELP
**When** the inbound webhook reports an opt-out (`OptOutType = STOP`)
**Then** the subscriber, its places, opt-outs, prompts, edit links and any pending sign-up for that number are hard-deleted in one transaction; the app sends no reply of its own; queued texts to that subscriber are skipped at hand-off
**And** START with no subscription is answered with the sign-up link; HELP replies are Twilio's and are tested on the verified number before launch

**Given** reply 0 from an active subscriber
**When** handled
**Then** the subscription is deleted as for STOP, and one final text confirms it in the subscriber's language

**Given** any other text from a number with no state
**When** handled
**Then** it is answered at most once a day with the sign-up link and "Reply STOP to stop"; otherwise ignored

**Given** every row of the decision table
**When** the tests run
**Then** each (keyword, state, open prompt) combination has a test, including normalised digits in Urdu, Bengali and Gujarati script

### Story S07.05 — Residents change building, floor or language by numbered text menus

- **Size:** M · **Estimate:** 7 h · **Actual:** —
- **Traces:** FR-D-6, AR-13, AR-19 (one-segment menus), AR-20 · **Depends on:** S07.04 · **Branch:** `e07-s05-sms-menus`

As a resident with a basic phone,
I want to change my building, floor or language by replying with numbers,
So that I can keep my alerts right without a smartphone.

**Acceptance Criteria:**

**Given** reply 1
**When** the menu runs
**Then** it lists streets with the 43 pilot buildings by number, then buildings on the chosen street, then floors (or "whole building"); each step offers 0 to go back and 9 for the Hub's number; long lists page with 8 for more
**And** the chosen building and floor replace the subscriber's places only when the last step is completed, with a confirmation text

**Given** reply 2
**When** the menu runs
**Then** it lists the 15 languages each in its own name, by number, and the choice changes the subscriber's language with a confirmation in the new language

**Given** every menu and prompt message in every language
**When** CI runs the fixture
**Then** each renders to exactly one segment with the real encoder (GSM-7 or UCS-2, `SmartEncoded=false`), or CI fails naming the message and language

**Given** a menu idle for 10 minutes
**When** the resident replies after that
**Then** the menu has reset, the reply says so, and the number is treated as a new keyword

**Given** a number that has started 5 menus today
**When** it sends 1 or 2 again
**Then** the reply says the daily limit is reached and offers the edit link and the Hub's number

**Given** reply 3
**When** handled
**Then** it calls `checkins`' `withdrawRequest` port (E08); until then the reply is "You have no check-in request"

### Story S07.06 — Residents change or delete their subscription with a one-time web link

- **Size:** S · **Estimate:** 4 h · **Actual:** —
- **Traces:** FR-A2, AR-13, AR-17 · **Depends on:** S07.05 · **Branch:** `e07-s06-edit-link`

As a resident with a smartphone,
I want a link to change my choices on a web page,
So that I don't have to step through text menus.

**Acceptance Criteria:**

**Given** a menu step offering the edit link, or reply 1 or 2 when the daily menu limit is reached
**When** the resident asks for it
**Then** a single-use token valid for 30 minutes is created (stored hashed) and texted as `/{lang}/subscription/{token}`

**Given** the link opened in time
**When** the resident changes language, places, groups or topic opt-outs, or chooses "Delete my subscription"
**Then** the change is saved (or the subscription hard-deleted), the token is used up, and a confirmation text is queued
**And** the page sets no cookie and shows no phone number beyond its last two digits

**Given** an expired or used token
**When** opened
**Then** the page says "This link has expired" (a success body with `status: expired`) and explains how to get a new one by text

### Story S07.07 — Approved alerts reach exactly the matching subscribers

- **Size:** M · **Estimate:** 7 h · **Actual:** —
- **Traces:** FR-A1 (SMS), FR-A2, FR-A16 (SMS), AR-11, FR-A3 (recipients per language) · **Depends on:** S07.04, S06.03 · **Branch:** `e07-s07-subscriber-fanout`

As a resident subscriber,
I want texts only for my buildings, floors and groups, in my language,
So that every text I get matters to me.

**Acceptance Criteria:**

**Given** the SQL recipient query in `subscriptions` and `matches` in `src/contracts`
**When** the property test runs on thousands of generated audiences and subscriber profiles in a local database
**Then** the query returns exactly the profiles `matches` accepts, including topic opt-outs and the fire and evacuation override

**Given** the recipient-count port used by the approval view
**When** an entry is reviewed
**Then** it returns the count of matching active subscribers per language

**Given** an entry is approved
**When** `captureRecipients(entry, tx)` runs inside the approval transaction
**Then** it locks the matching subscriber rows `FOR SHARE` in lock order, creates one `alert` delivery per subscriber with the frozen body for the subscriber's current language (or the English fallback body with `translation.unavailable` for a fallback language), and returns the count to S04.07's reviewed-count check
**And** a subscriber who signs up, changes places or unsubscribes during approval is either fully included or fully excluded (concurrency test)

**Given** a correction or withdrawal
**When** approved
**Then** recipients are the target's recipients (from its deliveries, opt-outs never removing them) plus the entry's own audience, deduplicated; a recipient deleted since gets nothing

**Given** a final
**When** approved
**Then** recipients are the union of every entry's recipients in the thread plus the final's own audience, deduplicated by subscriber

**Given** an SMS alert to 120 subscribers that is corrected
**When** the correction is approved (integration test with a fake provider)
**Then** the same 120 receive the correction by text, each in their current language, marked as a correction (FR-A16 acceptance), and the web shows the correction above the original

**Given** an entry in a language whose translation fell back
**When** subscribers in that language receive it
**Then** they get the English body with `translation.unavailable` in their language, and the approver saw how many

### Story S07.08 — Admins see spend against the budget and set a monthly cap

- **Size:** M · **Estimate:** 6 h · **Actual:** —
- **Traces:** FR-G6, NFR-N9, FR-M5, AR-12 (spend cap) · **Depends on:** S07.07, S06.08 · **Branch:** `e07-s08-spend-cap`

As a Hub Admin,
I want spend to date and a monthly SMS cap that warns me,
So that we stay within the pilot budget without ever blocking an urgent alert.

**Acceptance Criteria:**

**Given** the spend view
**When** an Admin or Director opens it
**Then** it shows SMS and Cohere spend this month and for the pilot to date against the pilot budget (CAD 1,000), using actual prices where Twilio reported them and labelled estimates otherwise; Directors see it read-only

**Given** an Admin at `aal2`
**When** they set or change the monthly cap
**Then** it is saved in `spend_cap` and audited

**Given** an approval
**When** it runs
**Then** after the recipient snapshot it takes the `spend_cap` lock (last in lock order), writes a `spend_reservation` for the estimate, and if month-to-date plus the estimate exceeds the cap, the approver has already been shown the shortfall on the approval view, the approval still succeeds, `cap_overrun` is audited, and Admins are notified by a `transactional` text
**And** two approvals at the same time each see the other's reservation (concurrency test)

**Given** the month boundary in `America/Toronto`
**When** spend is totalled
**Then** a send at 23:59 and one at 00:01 Toronto time fall in different months (test)

### Story S07.09 — Abuse of sign-up and texting is limited

- **Size:** S · **Estimate:** 4 h · **Actual:** —
- **Traces:** AR-20, NFR-N9 · **Depends on:** S07.04 · **Branch:** `e07-s09-abuse-limits`

As a Hub Admin,
I want the sign-up form and replies protected from scripts,
So that nobody can use the CVH to send texts to strangers or run up costs.

**Acceptance Criteria:**

**Given** the Twilio Messaging Service
**When** the daily configuration check runs (S06.02)
**Then** it also confirms geo permissions allow Canada only and SMS pumping protection is on, and raises an on-call alert otherwise

**Given** the daily ceiling on `transactional` texts (config)
**When** it is crossed
**Then** an `ops_event` is recorded and on-call is alerted once that day; texts keep sending

**Given** inbound messages from one number
**When** more than 20 arrive in an hour
**Then** further ones that day get no reply (counted only), and the count is recorded

**Given** the rate-limit hashes
**When** 24 hours pass
**Then** they are deleted (job test)

### Story S07.10 — The Hub counts subscribers and correction reach

- **Size:** S · **Estimate:** 4 h · **Actual:** —
- **Traces:** FR-M1 (subscribers), FR-M4 (correction reach), FR-M5 · **Depends on:** S07.07 · **Branch:** `e07-s10-subscriber-measures`

As a Hub Director,
I want daily subscriber numbers and how far corrections reached,
So that the pilot can report reach without identifying anyone.

**Acceptance Criteria:**

**Given** the daily measures job
**When** it runs
**Then** it stores active subscribers, pending sign-ups, confirmations and deletions by language and neighbourhood, as counts only, with no identifiers; groups of fewer than 5 are shown as "fewer than 5"

**Given** each correction, withdrawal and final sent to subscribers
**When** measured
**Then** attempted reach and confirmed reach are reported against the original's recipients (S06.08 definitions), drills apart

**Given** cost per alert
**When** reported
**Then** it shows SMS cost by language (actual where reported, otherwise labelled estimate) and the alert's share of Cohere usage, drills apart
