---
title: Community Virtual Hub (CVH) — Pilot PRD
status: draft
created: 2026-09-30
updated: 2026-10-01
phase: pilot
companion: docs/planning/mvp/prd.md (MVP PRD, parked)
supersedes: CVH - PRD v2.docx for the pilot phase
---

# Community Virtual Hub (CVH) — Pilot PRD

## 1. Overview

The Community Virtual Hub (CVH) is a digital tool for the Thorncliffe Park and Flemingdon Park community that builds day-to-day resilience and supports communication during disruptions (power outages, floods, fire, elevator failures, heat waves, wildfire smoke). It gets accurate information to residents quickly, in their language, at the level of their building and floor, and between disruptions it is one place to find neighbourhood services, spaces and preparedness guides.

The CVH does not replace 911 or any emergency service, and says so in the tool itself.

This document covers **the pilot only**: a two-month proof of concept, built for about CAD 1,000, covering the 43 registered apartment buildings in Thorncliffe Park and Flemingdon Park and about 100 community providers. Everything the pilot does not include is listed in Section 6.3 and specified in the separate MVP PRD.

The pilot answers one question: **do building- and floor-level alerts in residents' own languages, ambassador posting, voluntary check-ins and a neighbourhood directory work for real residents and real staff, safely and within budget?**

Requirements come from the four co-design sessions (June–July 2026), the Community Experts Board's first prototype testing session, the UX/UI Design Specification and Clickable Prototype Brief (v8), PRD v2, and product-owner decisions recorded on 30 September and 1 October 2026.

## 2. Background

Thorncliffe Park and Flemingdon Park together house roughly 43,000 people (community estimates above 50,000). The City of Toronto's Apartment Building Registration lists 43 registered apartment buildings in the two neighbourhoods (32 in Thorncliffe Park, postal area M4H; 11 in Flemingdon Park, M3C), with about 8,500 units and 3 to 43 storeys. Most households rent. Three out of four Thorncliffe Park residents grew up speaking a language other than English (Urdu most of all, then Pashto, Tagalog, Dari and Gujarati); Flemingdon Park adds Tamil, Greek, Slovak and Bengali.

Disruptions are frequent: power outages every two to three months in some buildings, flooding several times a year, elevators down for days, and towers without air conditioning during heat waves. Official communication is often slow, one-way and English-only. Residents fall back on WhatsApp groups, which move fast but spread rumours and never reach everyone. Seniors living alone, newcomers, residents with disabilities and families without smartphones are reached last.

No existing tool reaches the building and floor in residents' languages with a trusted, verified voice. The pilot tests whether the CVH can.

## 3. Pilot Goals

- **G1. Reach.** Residents in the 43 pilot buildings receive building- and floor-level alerts in their own language, on the web app or by text message, quickly enough to be useful.
- **G2. Ambassadors.** Ambassadors can post building updates and work a check-in round for residents who asked for one, and the Hub can see what was done.
- **G3. Everyday use.** Residents use the directory and map in an ordinary week, not only during a disruption.
- **G4. Safe broadcasting.** Every alert is approved by two people, corrections reach everyone the original reached, and drills never reach residents.
- **G5. Language.** Machine translation across the 15 launch languages is good enough for residents to understand alerts, and the pilot learns where it is not.
- **G6. Evidence for the MVP.** The pilot produces the baseline numbers (speed, reach, cost, translation quality) the MVP needs to set its targets.

## 4. Users

### Residents

Residents of the 43 pilot buildings. Design is anchored on the people most often left out: seniors living alone, newcomers, residents with disabilities, and families with basic phones or no spare time. Nobody has to become an app user: every alert also goes out by text message, and ambassadors reach people in person.

Residents use the CVH in one of two ways:

| | Without signing up | Signed up for text alerts |
|---|---|---|
| What they give | Language; optionally building, floor and groups (senior, newcomer, family with young children) | Phone number, language, neighbourhood; optionally building, floor, groups and a check-in request |
| Where it is kept | On their own device only; never stored by the CVH | Stored centrally by the CVH |
| What they get | Alerts and directory on the web app, shown by their choices | Alerts by SMS for their building, floor and groups, plus everything on the web app |
| Check-in | Not available (the ambassador needs a number to reach them) | Available, by phone call or text message |

The CVH never stores a resident's name.

### Ambassadors

Trusted residents recruited by the Hub and assigned to one or more pilot buildings. They post building updates for any floor of their assigned buildings, work check-in rounds during heat and outages, and report back. Posts are attributed to the role and building ("Building ambassador, Building X"), never the person.

### Hub staff and community leads

Community Hub staff (including IT) administer the CVH: buildings, providers, accounts, alerts, approvals, drills and coverage. Community-side coordinators and directors take part under roles the Hub assigns (Section 7.6).

### Not in the pilot

Partner organizations' coordination space, building management, and people outside the two neighbourhoods.

### Critical path

**Everyday:** a resident opens the CVH → chooses her language, and optionally her building, floor and groups → sees her building's status → finds a service or space in the directory or on the map.

**Disruption:** an ambassador or Hub staff member writes an alert for a building, floors or the neighbourhood → a second authorized person approves it → it reaches residents on the web app (and web push where available) and by SMS, in each resident's language, labelled as machine-translated → residents who asked for a check-in appear on their floor ambassador's round → the ambassador marks each one done, not reached or needs help → anything unresolved passes to the Hub → the alert closes and moves to the archive.

## 5. Design Principles

**P1. Many languages.** The CVH works in 15 languages (N1). Each person's language choice is remembered. In the pilot, all text is machine-translated and labelled, with the English original one tap away.

**P2. No app store required.** The CVH is a web app that can be installed to the home screen. Every alert also goes out by SMS, and ambassadors carry information in person.

**P3. No sign-up needed to see alerts.** Choices made without signing up stay on the resident's device. Signing up for text alerts is the only way her building, floor, groups and check-in request are stored.

**P4. Never identified by name.** No resident names are stored. An ambassador sees a check-in as a phone number with building and floor only. Ambassador posts name the role and building, never the person.

**P5. Simple and fast.** A basic mode for people less comfortable with technology; important information never more than a few taps away; short content with reading time shown.

**P6. Accurate and validated.** Every alert shows who sent it and whether it has been verified, in the same words and place on every surface ("Verified by the Hub", "Not yet verified"). A correction is shown as a correction, never a quiet replacement, and reaches everyone the original reached.

**P7. Moderated, with clear rules.** A code of conduct; never a marketplace or advertising channel.

**P8. Useful every week, not only in emergencies.**

**P9. Minimum personal data.** PIPEDA governs. The community owns the data under the terms of service. For the pilot, non-Canadian service providers (hosting, SMS, push, translation) are acceptable and are named in the terms of service.

**P10. Tailored without exposing.** The CVH adapts what each resident sees to her choices, but never shows why she received an alert, never names her group, and never shares her tailored version.

## 6. Pilot Scope

### 6.1 Pilot envelope

| | |
|---|---|
| Duration | 2 months of live operation; the build happens before the pilot starts and is not counted in it |
| Build budget | About CAD 1,000, including SMS and translation usage |
| Buildings | 43: Thorncliffe Park 32, Flemingdon Park 11 (from the City of Toronto Apartment Building Registration) |
| Providers | About 100 (97 organizations at 99 locations) from the TPCH community asset list v2 |
| Resident surface | Installable web app, works in any phone browser |
| Channels | Web app; SMS; web push if effort allows; share to WhatsApp chats and Status |
| Languages | 15, machine-translated, labelled |
| Staff surface | Web admin for Hub staff, coordinators and ambassadors |

### 6.2 In the pilot

- Targeted alerts by neighbourhood, building, floor and group, with two-person approval, corrections on every channel, drills and an archive (7.1)
- SMS sign-up and opt-out (7.1)
- Voluntary check-ins for SMS subscribers, worked by ambassadors (7.2)
- Directory and map of about 100 providers and the 43 buildings (7.3)
- Live status per building (7.3)
- Preparedness guides for six disruption types and essential numbers (7.3)
- Ambassador posting, check-in rounds, reporting and coverage (7.4)
- Roles, accounts, building and provider data, audit trail (7.5, 7.6)

### 6.3 Not in the pilot (specified in the MVP PRD)

| Deferred capability | v2 reference |
|---|---|
| Native iOS and Android apps; email channel | A2 |
| Human-checked alert templates and audio in every language | A3, N1, N2 |
| Official alert relay (City, ECCC, Alert Ready) — pilot stretch only, see A10 | A10 |
| Partner status alerts | A6 |
| Confirm receipt; unconfirmed list for ambassadors | A8, E1 |
| "I need help" signal and its routing | B1, B3 |
| Resident incident reports; confirm or flag reports | B2, B4 |
| Lighter-weight outreach request; recovery-phase check-ins; knock-on-door check-ins | C2, C5, C6 |
| Trusted helper making choices for a resident | A12, C1 |
| Calendar, hazard directory, weekly summary, education content, seasonal heads-up | D1, D4, D5, D8, D12 |
| Community contributions and moderation queue; ambassador content submissions | D9, E4 |
| Chatbot-style generated answers; advanced directory filters (open now, language spoken, cost, ID asked) | D10, D2 |
| Connecting a resident to a service after a check-in | E6 |
| Hub and partner coordination space, activation, dashboards, playbooks, space status | F1–F13 |
| Reliability targets, Canadian data residency, 3–7 year retention, privacy review, data governance | N4, N5, N8 |
| Safeguarding: ambassador vetting and device controls, minimum age | — |
| Hub operating hours and approval timeouts | — |
| Buildings outside the 43 | — |

### 6.4 Never in scope

Case management or a detailed vulnerable-population registry; replacing WhatsApp or other trusted channels; WhatsApp Business API integration; advertising or marketplace features; embedded Google Maps; photo uploads and comments from residents.

## 7. Functional Requirements

IDs are kept from PRD v2 so the MVP PRD can trace each one; new pilot requirements use new IDs. Where a v2 requirement is reduced for the pilot, the pilot form is what is required.

### 7.1 Alerts

**A1. Targeted alerts.**
Hub staff, coordinators and ambassadors (for their assigned buildings) can write an alert for the neighbourhood, one or more buildings, chosen floors, and optionally one or more groups (seniors, newcomers, families with young children, residents who asked for a check-in). Extreme heat and wildfire smoke are neighbourhood alerts written by Hub staff or coordinators, not ambassadors. Groups come only from what residents chose; nothing is inferred.
- On the web app, every resident in the alert's area can see it; her device puts it first when it matches her own building, floor and groups.
- By SMS, only subscribers whose building, floor and groups match receive it. A subscriber with no building set receives neighbourhood alerts only. A subscriber with a building but no floor receives every alert for that building.
- Acceptance: an alert for Building X, floors 4–6 reaches by SMS exactly the subscribers registered to Building X floors 4–6 and those registered to Building X with no floor.

**A2. Channels and SMS sign-up.**
Every alert is delivered on the web app and by SMS to matching subscribers, and by web push to residents who installed the web app and allowed notifications (web push may be dropped if it exceeds the pilot budget).
SMS sign-up needs only a phone number, a language and a neighbourhood; building, floor, groups and a check-in request are optional. No name, unit number, email, password or account. The resident confirms the sign-up herself by replying, even when someone else helped her start it. Every message says how to stop ("reply STOP"). She can change her choices or unsubscribe at any time, including by text keyword; unsubscribing deletes her subscription data.

**A3. Languages.**
Every alert, guide and interface string is available in the 15 launch languages (N1), machine-translated and labelled as machine-translated, with the English original one tap away. An alert's author sees how many SMS recipients will receive each language before approval.

**A4. Early acknowledgement.**
Staff and ambassadors can post a short acknowledgement before details are known and update it as things change. Time to first acknowledgement is measured (Section 9).

**A5. Verification marker.**
Every alert shows its origin and verification in the same words and place on every surface ("Verified by the Hub", "Not yet verified"), never relying on colour. A resident can find out in one step what "verified" means.

**A7. Running alerts, valid-until and archive.**
An ongoing disruption is one running thread of updates. Every alert has a "valid until"; a resolved or expired alert closes with a final entry and moves to a readable archive.

**A9. Choose buildings and topics.**
Residents choose which buildings (including a relative's) and which alert types they want, on the device or in their SMS subscription.

**A10. Official alerts (stretch).**
Only if effort allows: Hub staff can post an official alert's content with the source named and a link to the original, labelled "Official alert from [source]". Automated feeds are not in the pilot.

**A11. Share a verified alert.**
Residents and ambassadors can share an alert in one step, including to WhatsApp chats and WhatsApp Status, with its origin, verification and time intact and readable without opening the link. The link opens the live alert, with any correction, in the opener's language. A shared alert is always the standard version, never the resident's tailored one; an unverified post is shared as unverified. Sharing is not recorded.

**A12. First-use choices.**
On first use, after choosing a language, a resident can optionally choose her groups and her building and floor (neighbourhood only, a building, or a building and floor; never a unit). These stay on her device. The CVH then invites her to sign up for text alerts and carries her choices into the sign-up if she does.

**A13. Tailoring without exposing.**
Each alert's core is the same for everyone. Tailoring only orders and highlights alerts by the resident's choices and may add one line of advice; it never names a group or a reason.

**A15. Two-person approval.**
No alert, update, correction or withdrawal is sent by SMS or push until a second authorized person, other than its author, approves it. Approval is one action that shows the exact text, the audience (buildings, floors, groups), the channels and the number of SMS recipients.
- Exception for speed (decision D-1): an ambassador post of a lower-risk type (power, water or plumbing, elevator, flood or leak) appears on the web app at once, marked "Not yet verified"; its SMS and push wait for approval. Fire alarm or evacuation and "Other" posts appear nowhere until approved.
- Once approved, the web app post shows "Verified by the Hub". If it is withdrawn instead, the web app shows the withdrawal in its place.

**A16. Corrections reach every original channel.**
A correction or withdrawal is delivered on every channel the original was delivered on, to every recipient of the original, and is marked as a correction. The original alert shows the correction in place.
- Acceptance: after an SMS alert to 120 subscribers is corrected, the same 120 receive the correction by SMS, and the web app shows the original with the correction above it.

**A17. Drills.**
Any alert can be sent as a drill. A drill is marked as an exercise on every screen and message, goes only to people on the drill roster, and can never reach residents. Drills and real alerts are kept apart in every view, count and report.
- Acceptance: the system refuses to send a drill to a number not on the drill roster, and a drill cannot be converted into a real alert.

### 7.2 Check-ins

**C1. Check-in through SMS sign-up.**
A resident who wants to be checked on during heat waves and outages must be signed up for text alerts. Her subscription holds only: phone number, language, neighbourhood, building, floor, groups chosen, and the check-in request with her preferred contact method. Never a name or the reason.

**C3. Role-based access.**
Only the ambassadors covering her floor, and Admins, can see her check-in request, and only during an active heat or outage alert for her building (ambassadors) or as aggregate counts (everyone else). Building management never has access.

**C4. Leaving.**
A resident can withdraw her check-in request, or unsubscribe and have her subscription data deleted, at any time, including by text keyword.

**C6. Asking for a check-in.**
A subscribed resident can ask to be checked on during heat waves and outages, by phone call or text message. Before confirming, she is told plainly what a check-in is and is not, that it is not an emergency service, and when to call 911. If no ambassador covers her floor she is told so at once and offered the Hub's number instead; a check-in is never promised that cannot be made.

**C7. Check-in round.**
When a heat or outage alert is sent for a building, the ambassadors covering it see the check-in requests on their own floors only: phone number, floor and contact method, with no name and no reason. Each is marked done, not reached or needs help in one tap. "Not reached" and "needs help" pass to the Hub immediately. Individual check-in records are deleted when the alert closes; only counts are kept.

### 7.3 Everyday layer

**D2. Directory.**
A searchable directory of the about 100 providers, filterable by category and by neighbourhood (Thorncliffe Park, Flemingdon Park). Each listing shows:
- its categories, address, phone, email, website and social links where known;
- **what it offers day to day** (services and programs, in plain language);
- **its role in an emergency**, or that it has none, with 911 named wherever the provider says it is not an emergency service;
- "Last confirmed by the Hub on [date]".

Search covers names, categories and both descriptions. [ASSUMPTION] Residents can filter to "Helps in an emergency" (providers with an emergency role). One provider can appear in several categories and at several locations without being listed twice. Missing details are shown as "not known", never left blank. Descriptions are machine-translated and labelled like all other text.

**D2-Q. Ask in your own words.**
A resident can type or paste a question in any launch language, including romanized Urdu or Hindi (for example "mujhe bachon ke liye khana chahiye"), and gets the three to five best-matching listings from the directory.
- Results are directory listings exactly as published, in the resident's language, with their "Last confirmed" date. The CVH never writes an answer of its own.
- Matching is by meaning, not keywords, so a question in Pashto finds an English-sourced listing.
- When nothing matches clearly, the resident sees "We couldn't find a clear match", the category list, and the Hub's number. Results in emergency categories always show 911 first.
- Results appear fast enough to feel immediate on a phone; the time per question is measured (Section 9).
- Acceptance: on the pilot test set (about 10 real questions per language, 150 in total, written with ambassadors), the expected provider appears in the top three results for the large majority of questions in every language. The exact bar is set from the first measurement before launch.

**D3. Map.**
Providers and the 43 pilot buildings on a neutral base map, with nearby pins grouped so the about 40 organizations at 45 Overlea Boulevard stay usable. Cooling spaces, water fountains and public washrooms are distinguishable at a glance. Selecting a pin opens the same listing as the directory.

**D4-P. Building facts.**
Each pilot building's page shows the facts relevant to disruptions from the building register (storeys, number of elevators, emergency power, cooling room, air conditioning, barrier-free entrance), maintained by the Hub, with a last-updated date.

**D6. Live status.**
Each of the 43 buildings and each neighbourhood shows a status (active problem, work in progress, resolved) with text and icon as well as colour, set by the alerts and incident reports for it.

**D7. Preparedness guides and essential numbers.**
Plain-language guides for six disruption types (power outage, flood, elevator failure, extreme heat, wildfire smoke, fire evacuation), each with before, during and after. A guide opened from an alert opens at "during". One page of essential numbers, each named by what it is for: 911 set apart with when to call it, 211, 311, and the building contact where known. Guides are written in English, checked by Hub staff, then machine-translated and labelled.

### 7.4 Ambassador tools

**E1. Ambassador view.**
Each ambassador sees the alerts for their assigned buildings and, during a heat or outage alert, the check-in round for their floors (C7).

**E2. Ambassador posting.**
An ambassador can post an update or incident to any floor of their assigned buildings, choosing floors as a range, a list or the whole building, and one or more disruption types (power, water or plumbing, elevator, fire alarm or evacuation, flood or leak) or "Other", which requires a line of text and shows 911 first. The post shows its attribution ("Building ambassador, Building X") before sending and goes to a second person for approval (A15). Ambassadors and Hub staff can mark an incident resolved.

**E3. Report back.**
Check-in rounds are reported to the Hub as counts by building and floor: done, not reached, needs help.

**E5. Coverage.**
Hub staff see which of the 43 buildings and which floors have an assigned ambassador, and which do not.

### 7.5 Administration and data

**G1. Roles.**
Every staff and ambassador account belongs to a named person. Residents have no accounts.

| Role | Who | Can |
|---|---|---|
| Admin | Community Hub staff and IT | Manage accounts and roles, buildings, floors and providers; write, approve and send alerts; correct or withdraw any alert; run drills; see check-in requests, counts and coverage; see spend |
| Coordinator | Community-side coordinators | Write alerts; approve alerts and ambassador posts as second person; see counts and coverage. Cannot manage accounts, buildings or providers |
| Director | Community-side directors | Read-only view of alerts, counts, coverage and spend; cannot write or approve |
| Ambassador | Trusted residents assigned to buildings | Write posts for assigned buildings (sent after approval); work the check-in round for their floors; share alerts |

**G2. Account lifecycle.**
Only an Admin can create, assign, suspend or remove an account. Staff sign in with a username set by an Admin; no email is sent in the pilot. Only an Admin resets a password or a second sign-in factor, and every reset is recorded in the audit trail. There are always at least two active Admins. Removal ends access immediately, including on any device where the account is signed in.

**G3. Buildings and floors.**
The Hub maintains the 43 pilot buildings and their floors, seeded from the City of Toronto Apartment Building Registration, each with a last-updated date. Ambassadors are assigned to buildings and floors from this list.

**G4. Providers.**
The Hub maintains the provider list, seeded from the TPCH community asset list v2 after clean-up (Section 10), each with a last-confirmed date.

**G5. Audit trail.**
Every send, approval, correction, withdrawal, drill and account change records who did it and when. Resident actions are not recorded individually beyond the subscription itself.

**G6. Spend visibility and caps.**
Admins can see SMS and translation spend to date against the pilot budget. Admins can set a monthly SMS cap; an alert that would exceed it shows the shortfall before approval.

## 8. Non-Functional Requirements

**N1. Languages.** English, French, Urdu, Tagalog, Gujarati, Dari, Slovak, Bengali, Tamil, Pashto, Hindi, Mandarin, Greek, Spanish and Punjabi, including right-to-left layout for Urdu, Dari and Pashto. All machine-translated and labelled.

**N2. Accessibility.** Works with screen readers; offers a basic mode; status never relies on colour alone; aims for WCAG 2.1 AA.

**N3. Devices and connection.** Works in an ordinary phone browser and installs to the home screen without an app store; works on older phones and slow connections; the last-loaded alerts, the resident's building status and essential numbers stay readable without a connection. SMS carries every alert, so no feature needed during a disruption depends on a smartphone.

**N4. Reliability.** No numeric targets for the pilot. Outages, failed sends and slow deliveries are logged and reviewed weekly as pilot learnings.

**N5. Privacy and security.**
- No resident names; minimum data (Section 4, C1).
- Staff and ambassador sign-in is personal; Admin and Coordinator accounts use a second sign-in factor.
- Check-in records deleted when the alert closes; reports aggregate only.
- Plain-language terms of use naming the service providers that process data and stating that the community owns the data.
- PIPEDA governs.

**N6. Maintainability.** Small custom codebase. Written procedures for sending, approving, correcting and withdrawing alerts, and for running drills, are part of the pilot deliverable.

**N7. Content freshness.** Buildings, providers and guides each have a named owner at the Hub and a last-updated or last-confirmed date shown to residents.

**N9. Cost.** Total build and running cost within about CAD 1,000 for two months.

## 9. Pilot Measures

No targets are set; the pilot measures to set MVP targets. All measures are aggregate, with drills reported separately.

| Measure | Why | Source |
|---|---|---|
| SMS subscribers and web app installs, by language and neighbourhood | Reach and representativeness | Platform counts |
| Time from disruption report to first acknowledgement; from writing to approval; from approval to delivery | Speed was the community's clearest ask | Audit trail (G5) |
| Check-ins requested, done, not reached, needs help | Does the human network reach those who asked? | Counts (E3) |
| Directory and map use in an ordinary week | Is the CVH useful every week? | Platform counts |
| Translation understood, per language | Is machine translation good enough for alerts? | Short survey of residents and ambassadors |
| Drills run; corrections sent and their reach | Is safe broadcasting practised? | Audit trail |
| Cost per alert, by language; total spend | Can the MVP afford SMS and translation at scale? | Provider billing (G6) |
| Buildings and floors with an ambassador | Coverage | Coverage view (E5) |

## 10. Assumptions and Dependencies

- The Hub recruits and assigns ambassadors for the pilot buildings before launch.
- The Hub cleans the provider list before loading it. Known issues in v2 of the list:
  - 48 entries without a phone number and 77 without email; an invalid postal code (Angela James Arena, "M3C 357"); an invalid email (Saint John XXIII EarlyON); "Fire Station 224" at two addresses; spelling errors ("Yourth", "Orthdox", "Jamat Khanan"); 16 grassroots groups sharing one generic link.
  - The service and emergency-role descriptions contain research notes not meant for residents in 35 rows (for example "homepage would not load", "details from … via search").
  - 13 organizations (18 rows) are marked unconfirmed or "verify before publishing". These are not published until the Hub confirms them.
- The Hub confirms the 43 pilot buildings and their floors; the register lists "85-95 Thorncliffe Park Dr" twice.
- At least two authorized people can be reached whenever an alert must go out. The Hub's hours and approval timeouts are not defined for the pilot.
- Machine translation is acceptable in all 15 languages, or residents are told where it is not (D-4).
- The budget covers hosting, SMS and translation for two months.
- Residents accept the named non-Canadian service providers for the pilot.

## 11. Risks

| ID | Risk | Level | How we reduce it |
|---|---|---|---|
| R-1 | A machine-translated life-safety message is wrong or unclear | High | Labelled as machine-translated; English original one tap away; 911 guidance in every guide checked in English; per-language survey |
| R-2 | A drill reaches residents, or a real alert is taken for a drill | High | Drill roster enforced by the system (A17); exercise label on every message |
| R-3 | Ambassadors see subscribers' phone numbers and floors without formal vetting or device controls (safeguarding is MVP) | High | [ASSUMPTION] Pilot ambassadors are individually known to and recruited by the Hub; own floors only; only during an active alert; no names; deleted when the alert closes; access removable at once (G2) |
| R-4 | Two-person approval delays urgent alerts | Medium | One-action approval on a phone; time to approval measured; lower-risk posts shown on the web app at once (D-1) |
| R-5 | A correction misses people who got the original | Medium | A16 |
| R-6 | The budget runs out mid-pilot (SMS in non-Latin scripts uses more message segments) | Medium | Spend visible and capped (G6); cost per alert measured |
| R-7 | Information goes stale and residents stop coming back | Medium | Last-confirmed dates; named owners |
| R-8 | Web push costs more effort than the pilot allows | Low | Stretch only; SMS and web app carry every alert |
| R-9 | Residents rely on the CVH instead of 911 | High | 911 stated on every alert, guide and check-in screen; check-in explains what it is not |
| R-10 | Residents distrust non-Canadian data processing | Medium | Named in plain-language terms; minimum data; no names |
| R-11 | A fire, evacuation or "Other" post made when no second approver is awake reaches no one until someone approves it | High | Accepted for the pilot. The welcome text says messages are checked by Hub staff and may not be sent overnight. Carried to the MVP as a risk to resolve with Hub hours and approval timeouts |
| R-12 | A machine translation keeps the right language but changes the meaning; approvers cannot read most languages | Medium | Accepted for the pilot. Ambassadors are trusted to report bad translations; residents can see the English original one tap away |

## 12. Decisions and Open Questions

### Decided (1 October 2026)

- **D-1. Ambassador posts and approval.** Lower-risk ambassador posts appear on the web app at once as "Not yet verified"; SMS and push wait for a second approver; fire, evacuation and "Other" wait entirely (A15). *Why:* the web app is cheap to correct and keeps the 5–10 minute acknowledgement possible; SMS is the broadcast that cannot be recalled.
- **D-2. Roles.** Coordinators write and approve; Directors view only; partner organizations have no pilot accounts (G1).
- **D-3. Unit numbers.** Ambassadors never see a unit number in the pilot; check-ins are by call or text only (C6, C7).
- **D-4. Translation.** All translation uses Cohere models, routed by language: Pashto and Dari through North Small Translate (the only model that produced correct Pashto in the product owner's test); the other languages through the Cohere model that supports each one (addendum, "Translation routing"). Every translation is checked automatically for the expected language before it is published or sent; if the check fails, the next model in that language's route is tried, and if all fail the English original is shown, labelled, rather than text in the wrong language. Cohere is also used for search matching. Evidence: `docs/research/multilingual-program-search/research.md`.
- **D-5. Scripts.** Punjabi in Gurmukhi; Shahmukhi readers are offered Urdu. Mandarin in Simplified Chinese, with Traditional Chinese offered as a labelled script conversion.
- **D-6. SMS keywords.** STOP, START and HELP in English work in every language (carrier standard). Everything else uses numbered replies that need no translation, explained in the welcome message in the resident's language: 1 change building or floor, 2 change language, 3 withdraw check-in, 0 stop. Replies 1 and 2 open a short menu by text (street, then building, then floor; or language), written for each language so every message fits in one text message in that language; 0 goes back, 9 gives the Hub's number, and an unfinished menu resets after 10 minutes.
- **D-7. End-of-pilot data.** Subscribers are asked by SMS at the end of the pilot whether to stay subscribed for the MVP; those who do not reply YES within 30 days are deleted. The staff audit trail (no resident data) and aggregate measures are kept for the MVP.
- **D-8. Go / no-go.** The Hub's leadership decides at a week-8 review, using the Section 9 measures, with the Community Experts Board advising.

### Still open

- **Translation time limit.** The per-language translation timeout and the total wait at submit are set from p99 latency tests against Cohere before launch. *Owner: IT.*

## 13. Review and Approval

Reviewed by the Hub and the Community Experts Board before pilot development begins. Reviewers check that the pilot scope (Section 6) is what they expect to test, that the principles (Section 5) match what was said in the co-design sessions, and that nothing in the pilot crosses the lines the community drew.
