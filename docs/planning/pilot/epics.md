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
