---
title: Community Virtual Hub (CVH) — Product Requirements Document, version 3 (Pilot and MVP)
status: draft
created: 2026-09-30
updated: 2026-10-01
supersedes: CVH - PRD v2.docx (docs/CVH - PRD v2.docx)
---

# Community Virtual Hub (CVH)

Product Requirements Document — version 3: Pilot and MVP

## 1. Overview

The Community Virtual Hub (CVH) is a digital tool for the Thorncliffe Park and Flemingdon Park community that builds day-to-day resilience and supports communication and coordination during disruptions (power outages, floods, fire, elevator failures, heat waves, wildfire smoke).

During a disruption, the CVH gets accurate information to residents quickly, in their language, at the level of their building and floor. The gap it closes is simple: the right information is not reaching people in the right language at the right time. Between disruptions, the CVH is a useful everyday tool: one place for neighbourhood services, community spaces and preparedness guides. Everyday use is what keeps the tool known, trusted and current when a disruption comes.

The CVH does not replace 911 or any emergency service, and says so in the tool itself.

The CVH supports the people and networks that already do this work (ambassadors, community organizations, neighbours helping neighbours). It connects existing channels rather than replacing them: WhatsApp groups, word of mouth and trusted relationships are assets the CVH coordinates with.

**Version 3 splits delivery into two phases:**

- **Pilot (proof of concept).** Two months, a build budget of about CAD 1,000, 43 buildings in Thorncliffe Park and Flemingdon Park, about 100 community providers, an installable web app with SMS. It proves that building- and floor-level alerts in residents' languages, ambassador posting, voluntary check-ins and a neighbourhood directory work for real residents and real staff.
- **MVP.** The production first version: native apps, email, human-checked translation templates, official-alert relay, two-way help signals, the Hub and partner coordination space, measurable reliability targets, Canadian data residency, retention policy and safeguarding.

Section 6 is the authoritative statement of what each phase includes. Every requirement in Section 7 carries its phase.

Every requirement comes from the four co-design sessions held in June and July 2026, the Community Experts Board's first prototype testing session, and the companion UX/UI Design Specification and Clickable Prototype Brief (v8). Section 14 lists what changed in version 3.

## 2. Background: The Problem

Thorncliffe Park and Flemingdon Park together house roughly 43,000 people, with community estimates above 50,000. The City of Toronto's Apartment Building Registration lists 43 registered apartment buildings in the two neighbourhoods (32 in Thorncliffe Park, 11 in Flemingdon Park), holding about 8,500 units, from 3 to 43 storeys. In Thorncliffe Park, nine out of ten households rent. In Flemingdon Park the split is closer to half and half, and many renters live in condominiums where the landlord is an individual unit owner. Three out of four Thorncliffe Park residents grew up speaking a language other than English (Urdu most of all, then Pashto, Tagalog, Farsi/Dari and Gujarati); Flemingdon Park adds Tamil, Greek, Slovak and Bengali. About one in three residents lives on low income.

Disruptions are frequent and compounding. Power outages hit some buildings every two to three months. Flooding and plumbing failures happen several times a year. Elevators can be down for days, which traps seniors and residents with disabilities in towers. Most towers have no air conditioning: in the building register, 95 of 103 nearby registered buildings report no air conditioning, half report no emergency power, and only 17 report a cooling room. Ontario Line and Eglinton Crosstown construction add sustained disruption.

When these happen, official communication is often slow, one-way, English-only, or missing. Residents fall back on WhatsApp groups, which move fast but spread rumours and never reach everyone. The people at highest risk (seniors living alone, newcomers, residents with disabilities, families without smartphones or time) are reached last.

When an emergency is declared over, coordination stops even when need has not. After the 2025–2026 fires at 11 Thorncliffe Park Drive and 21 Overlea Boulevard, organizations could not share information, and roughly 40 units remained vacant and unresolved after institutions had moved on.

No existing tool fixes this. Government alert systems stop at the city level. Commercial alert apps broadcast one way. The Hub website guides people to services but carries no live alerts or building updates. Building apps handle maintenance; WhatsApp handles rumours. The CVH closes the gap at the level where disruption is lived: the building and the floor.

## 3. Goals

**Pilot goals.** The pilot exists to learn, with real residents and staff, whether:

- **G1.** Residents in the 43 pilot buildings receive building- and floor-level alerts in their own language, on the web app or by text message, quickly enough to be useful.
- **G2.** Ambassadors can post building updates and work a check-in round for residents who asked for one, and the Hub can see what was done.
- **G3.** Residents use the directory and map of about 100 providers and spaces in an ordinary week, not only during a disruption.
- **G4.** Every broadcast is safe: two people approve it, corrections reach everyone the original reached, and drills never reach residents.
- **G5.** Machine translation (Cohere) across the 15 launch languages is good enough for residents to understand alerts, and where it is not.

**MVP goals** carry forward version 2's goals in full:

- Residents learn about a disruption affecting their neighbourhood or building quickly, in an accessible language and format.
- Residents can signal that they need help, and the response network follows up.
- Residents find services, programs and community information in one place, in their language.
- Residents have a reason to open the CVH in an ordinary week.
- Trusted organizations reach residents who need priority outreach, using the least personal data possible.
- Partners coordinate with one another during a disruption from a shared picture.
- Use is representative across languages, ages, buildings and abilities.
- The Hub, partners and ambassadors are practised before a disruption, with commitments, playbooks and drills.

## 4. Who the CVH Is For

### Residents

Residents need timely local information in their language during a disruption, one place to find services and spaces in an ordinary week, preparedness guides, and a way to ask to be checked on. Design is anchored on the people most often left out: seniors living alone, newcomers, residents with disabilities, and families with basic phones or no spare time. Residents who will never use an app are not expected to become app users: they are reached by text message and by the ambassador network.

Residents can use the CVH in two ways:

- **Without signing up.** They choose a language and, optionally, their building, floor and groups (senior, newcomer, family with young children). These choices stay on their own device and are never stored by the CVH. They see alerts relevant to those choices on the web app.
- **Signed up for text alerts.** They give a phone number, language and neighbourhood (building and floor optional). This is required to ask for a check-in, because the ambassador needs a number to reach them.

### Ambassadors

Ambassadors are residents trusted by the Hub and assigned to one or more pilot buildings. They post building updates for any floor of their assigned buildings, work check-in rounds during heat and outages, and report back to the Hub. Their posts are attributed to the role and building ("Building ambassador, Building X"), never to the person.

### Hub staff and partners

Hub staff (including IT) administer the CVH: they maintain the building list, the provider directory and user accounts, approve and send alerts, review ambassador posts, run drills and see coverage. Coordinators and directors on the community side, and partner organizations in the same cluster, take part under roles set by the Hub (Section 7.7).

### Building management (future state only)

A separate, clearly labelled channel for planned disruptions, once building management is engaged. Until then, ambassadors fill this role.

### Non-users

The CVH is not for advertisers or businesses seeking promotion, and not a public platform for people outside Thorncliffe Park and Flemingdon Park.

### User flow (critical path to value)

**Everyday:** a resident opens the CVH → chooses her language, and optionally her building, floor and groups → sees her building's status, then the neighbourhood's → finds a service or space on the directory or map → done.

**Disruption (pilot):** an ambassador or Hub staff member writes an alert for a building, floors or the neighbourhood → a second authorized person approves it → it reaches residents on the web app (and web push where available) and by text message, machine-translated into each resident's language and labelled as such → residents who asked for a check-in appear on their floor ambassador's round → the ambassador marks each one done, not reached or needs help → anything unresolved passes to the Hub → the alert closes and moves to the archive.

## 5. Design Principles (Community Commitments)

**P1. Many languages.** The CVH works in the 15 launch languages (N1). Each person's language choice is remembered. In the pilot, alert and interface text is machine-translated and labelled; in the MVP, people check alert templates and interface text.

**P2. No app required.** Alerts and essential information also reach people by text message and through ambassadors. Nothing requires an app-store install.

**P3. No sign-up needed to see alerts.** Registration is only for optional features. Choices a resident makes without signing up (groups, building, floor) stay on her own device and are used only to show her what is relevant. Signing up for text alerts is the only route by which her building, floor, groups and check-in request are stored centrally.

**P4. Never identified by name.** The CVH stores no resident names. An ambassador sees a check-in as a phone number with building and floor only. Names, unit numbers and addresses are never visible to landlords, superintendents or other residents. Ambassador posts are attributed to the role and building, never the person.

**P5. Simple and fast.** A basic mode for people less comfortable with technology; important information never more than a few taps away; short content with the reading time shown.

**P6. Accurate and validated.** Every alert shows who sent it and whether it has been verified, in the same words and the same place on every surface ("Verified by the Hub", "Not yet verified", "Official alert from …"). A correction is shown as a correction, never a quiet replacement, and reaches everyone the original reached.

**P7. Moderated, with clear rules.** The CVH is a community space with a code of conduct, never a marketplace or advertising channel.

**P8. Useful every week, not only in emergencies.**

**P9. Minimum personal data.** The CVH collects the minimum personal data, shares it only with authorized roles, and is governed by PIPEDA. The community owns the data under the CVH's terms of service. Canadian data residency is required for the MVP; the pilot accepts named non-Canadian processors, disclosed in the terms of service (Section 10).

**P10. Tailored without exposing.** The CVH adapts what each resident sees to what she chose to tell it, but never shows why she received an alert, never names her group, and never forwards her tailored version.

## 6. Scope by Phase

### 6.1 Phase summary

| | **Pilot (proof of concept)** | **MVP** |
|---|---|---|
| Duration | 2 months | To be planned after the pilot |
| Build budget | About CAD 1,000, including SMS and translation costs | To be scoped from pilot costs |
| Buildings | 43 (Thorncliffe Park 32, Flemingdon Park 11) | Both neighbourhoods; extension to nearby buildings to be decided |
| Providers | About 100 from the TPCH community asset list | Ongoing, community-maintained asset map |
| Resident surface | Installable web app; web push if effort allows | Native iOS and Android apps, plus web |
| Channels | Web app, web push (stretch), SMS, share to WhatsApp | Adds email; voice later |
| Languages | 15, machine-translated by Cohere, labelled | 15, alert templates and interface text checked by people; audio |
| Official alerts | Out (stretch: manual relay by Hub staff) | Relayed from City, ECCC and Alert Ready with a person confirming |
| Need-help signal | Out | In |
| Check-ins | In, for SMS subscribers only, by call or text | Adds knock-on-door, recovery-phase check-ins, lighter-weight request path |
| Partner coordination space | Out | In |
| Broadcast safety | Two-person approval, corrections on every channel, drill separation | Same |
| Reliability targets | None set | Uptime, delivery time and scale targets set |
| Data residency | Not enforced; processors disclosed | Canada only |
| Retention | Check-in records deleted when a disruption closes; end-of-pilot handling to be decided | 3 to 7 years for reporting and audit records |
| Safeguarding | Out (see risk R-11) | Ambassador vetting, device controls, consent through a helper, minimum age |
| Hub hours and approval timeouts | Not defined | To be defined |

### 6.2 Out of scope for both phases

- A detailed vulnerable-population registry or case management
- Replacing WhatsApp, the PA system, or any channel people already trust
- WhatsApp Business API integration (sharing an alert into WhatsApp is in scope; see A11)
- Business promotion, advertising or marketplace features
- Accounts for people outside the two neighbourhoods
- Embedding Google Maps (the map uses the CVH's own listings on a neutral base map)
- Photo uploads in community contributions, and comments on listings or alerts
- A building-management posting channel (future state)

### 6.3 Later (after the MVP)

- Spoken alerts by voice call for basic phones (A14)
- Tagging services by category, need, disruption type or utility
- Incentives and light games (D11)

## 7. Functional Requirements

Each requirement keeps its version 2 ID. **Phase** says when it is required: **Pilot** (required for the pilot and carried into the MVP), **MVP**, or **Later**. Where the pilot delivers a reduced form, the pilot form is stated. "Must" and "Should" from version 2 apply within the MVP.

### 7.1 Alerts and notifications

**A1. Targeted alerts** — Pilot.
Send alerts about disruptions by neighbourhood, building and floor, and by group (seniors, newcomers, families with young children, residents who asked for a check-in). Alerts are written by Hub staff or by ambassadors for their assigned buildings. Extreme heat and wildfire smoke are neighbourhood-level alerts raised by the Hub, not ambassadors. Groups come only from what residents choose to tell the CVH; nothing is inferred.
*Pilot form:* every alert is delivered to everyone in its area on the web app, and each resident's device shows or highlights it according to her own choices; SMS is sent only to subscribers whose stored building, floor and groups match.
- Acceptance: an alert for Building X floors 4–6 reaches by SMS only subscribers registered to those floors (or to Building X with no floor given), and appears first on the web app for residents whose device holds those choices.

**A2. Multi-channel delivery** — Pilot (reduced).
*Pilot:* web app, web push to residents who installed the web app and allowed notifications (dropped if effort exceeds the pilot budget), and SMS. *MVP:* adds native app push and email.
Text-message sign-up needs only a phone number, a language and a neighbourhood; building, floor and groups are optional; no name, unit number, email, password or account. The resident confirms the sign-up herself by replying, even when someone else signed her up. Every message says how to stop ("reply STOP").

**A3. Alerts in the launch languages** — Pilot (machine translation); MVP (checked templates).
*Pilot:* every alert, guide and interface string is machine-translated by Cohere into the 15 launch languages and labelled as machine-translated, with the English original one tap away. *MVP:* pre-written templates for common disruption types (outage, flood, elevator failure, fire, heat, smoke, winter storm), checked by people in every launch language, each with an audio version.

**A4. Early acknowledgement** — Pilot.
Hub staff and ambassadors can post an acknowledgement before full details are known, and update it as things change. The community benchmark is an acknowledgement within five to ten minutes; it is a measured learning in the pilot (Section 9), not a gated target.

**A5. Verification marker** — Pilot.
Every alert shows its origin and verification in the same words and place on every surface ("Verified by [organization]", "Not yet verified", "Official alert from [source]"), never relying on colour. A resident can find out in one step what "verified" means. A corrected alert says what changed.

**A6. Partner status changes** — MVP.
An alert can announce a change in a partner organization's own status (closing, reduced hours, lost capacity), which updates the directory, map and live status.

**A7. Running alerts, valid-until and archive** — Pilot (stale flag MVP).
A slowly resolving disruption is one running thread of updates. Every alert carries a "valid until"; a resolved or expired alert closes with a final entry and moves to a readable archive. *MVP:* an alert not updated within the period set for its disruption type is flagged to staff as stale.

**A8. Confirm receipt** — MVP.
Residents confirm receipt in one tap; ambassadors see who on their floor has not confirmed.

**A9. Choose buildings and topics** — Pilot.
Residents choose which buildings (including a relative's) and alert topics they want, on the device or in their SMS subscription.

**A10. Official alert relay** — MVP (pilot stretch).
Relay official alerts from the City of Toronto, Environment and Climate Change Canada and Alert Ready to residents in the affected area. A person at the Hub confirms each relay; the official wording is never edited; the source is named on every surface. *Pilot stretch, only if effort allows:* Hub staff can manually post an official alert's content with the source named and a link to the original.

**A11. Share a verified alert** — Pilot.
Residents and ambassadors can share an alert in one step (including to WhatsApp chats and WhatsApp Status) with its origin, verification and time intact and useful without its link. The link always opens the live alert, with any correction, in the language of the person opening it. A shared alert is always the standard version, never a resident's tailored one; an unverified post is shared as unverified. Sharing is not recorded.

**A12. First-use choices** — Pilot.
On first use, directly after the language choice, residents can optionally choose their groups and the building and floor they want alerts for (neighbourhood only, a building, or a building and floor; never a unit number). Without a text sign-up these choices stay on the device; the CVH then invites her to sign up for text alerts and carries the choices into the sign-up if she does. Every choice can be changed or removed at any time, including by text keyword.
*MVP:* a trusted helper can make these choices with the resident's agreement (pending safeguarding rules).

**A13. Tailoring without exposing** — Pilot (simplified).
Each alert's core is the same for everyone; tailoring only orders and highlights by the resident's building, floor and groups, and may add one line of advice. Tailored content never names a group or reason and is never shared (A11). *MVP:* residents can see what tailoring is based on and view the version everyone gets.

**A14. Spoken alerts for basic phones** — Later.

**A15. Two-person approval** — Pilot. *(New in v3.)*
No alert, update or correction is sent to residents until a second authorized person, other than its author, approves it. Approval is a single action showing the exact text, the audience (buildings, floors, groups), the channels and the estimated number of SMS recipients.
- [NOTE FOR PM] This conflicts with version 2's E2, where ambassador posts for power, water, elevator and flood go out directly. Version 3 applies two-person approval to every send; see Open Question Q-1 on whether ambassador posts on the web app only may go out directly as "Not yet verified" while SMS waits for approval.

**A16. Corrections reach every original channel** — Pilot. *(New in v3.)*
A correction or withdrawal is delivered on every channel the original was delivered on, to every recipient of the original (including SMS recipients and web push subscribers), and is marked as a correction. The original alert shows the correction in place.

**A17. Drill mode** — Pilot. *(New in v3; pilot form of F10.)*
Any alert flow can run as a drill. A drill is marked as an exercise on every screen and message, is delivered only to people enrolled in the drill, and can never reach residents. Drill and real alerts are kept separate in every view, count and report.
- Acceptance: it is impossible to send a drill to a phone number that is not on the drill roster, and impossible to convert a drill into a real alert without re-creating it.

### 7.2 Two-way resident reporting

**B1. "I need help" signal** — MVP.
**B2. Incident reports** — Pilot (ambassadors and Hub only); MVP (residents).
Ambassadors and Hub staff report an incident (description, optional photo) for a building and mark it resolved once addressed. Resident incident reports are MVP.
**B3. Route need-help signals** — MVP.
**B4. Confirm or flag reports** — MVP.

### 7.3 Check-ins and priority outreach

**C1. Priority outreach through SMS sign-up** — Pilot.
A resident who wants to be checked on must be signed up for text alerts (A2). Her subscription then holds the minimum needed: phone number, preferred language, neighbourhood, building, floor, groups chosen and the check-in request, never a name or the reason.
**C2. Lighter-weight request during a disruption** — MVP.
**C3. Role-based access** — Pilot.
Only named, authorized people can see check-in requests, and only what their role requires (Section 7.7). Building management never has access.
**C4. Separate storage and leaving** — Pilot (leaving); MVP (Canadian, separate storage).
A resident can withdraw from check-ins, or unsubscribe and have her subscription data deleted, at any time, including by text keyword.
**C5. Recovery-phase check-ins** — MVP.
**C6. Asking for a check-in** — Pilot (call or text only).
A subscribed resident can ask to be checked on during heat waves and outages and chooses how to be reached: a phone call or a text message. She is told plainly what a check-in is and is not, that it is not an emergency service, and when to call 911. If no ambassador covers her floor she is told so at once and offered the Hub instead; a check-in is never promised that cannot be made. *MVP:* adds a knock on the door, which requires a unit number.
**C7. Check-in round** — Pilot.
When a heat or outage alert is sent for a building, the ambassadors covering it see the check-ins requested on their own floors only: phone number, floor and chosen contact method, with no name and no reason. Each is marked done, not reached or needs help in one tap. "Not reached" and "needs help" pass to the Hub immediately. Individual check-in records are deleted when the disruption closes; only counts are kept.

### 7.4 The everyday layer

**D1. Services and events calendar** — MVP.
**D2. Directory of services and spaces** — Pilot (reduced).
*Pilot:* a searchable directory of the about 100 providers in the community asset list, filterable by category and neighbourhood, covering both Thorncliffe Park and Flemingdon Park. Each listing shows its categories, address, phone, email, website and social links where known, and when it was last confirmed by the Hub. One provider can appear under several categories and at several locations without duplication. *MVP:* plain-question filters (open now, language spoken, cost, ID asked, step-free access, appointment), meaning-based search, a help list reached from an alert, and partner confirmation of listings.
**D3. Neighbourhood map** — Pilot (reduced).
*Pilot:* the directory's providers and the 43 pilot buildings on a neutral base map, with nearby pins grouped so the about 40 organizations at 45 Overlea Boulevard remain usable. Cooling spaces, water fountains and public washrooms are shown as such. *MVP:* community-maintained asset map on the ADMS structure with moderation, space status (F8), preparedness-kit locations and recovery-phase resources.
**D4. Hazard directory** — MVP.
*Pilot form:* each pilot building's page shows the relevant facts from the building register (storeys, number of elevators, emergency power, cooling room, air conditioning, barrier-free entrance), as maintained by the Hub.
**D5. Weekly summary** — MVP.
**D6. Live status per building** — Pilot.
A status for each of the 43 pilot buildings and the neighbourhood (active problem, work in progress, resolved), shown with text and icon as well as colour, updated by ambassadors and Hub staff from alerts and incident reports.
**D7. Preparedness toolkit and essential numbers** — Pilot.
Plain-language guides for the six disruption types (power outage, flood, elevator failure, extreme heat, wildfire smoke, fire evacuation), with before, during and after. A guide reached from an alert opens at "during". One place for essential numbers, each named by what it is for: 911 set apart with when to call it, 211, 311, and the building contact where known. *Pilot:* guides are written in English, checked by Hub staff, and machine-translated and labelled. *MVP:* checked by people in every language and aligned with the Local Preparedness Kit.
**D8. Education content** — MVP.
**D9. Community contributions with moderation** — MVP.
**D10. Chatbot-style questions** — MVP.
**D11. Incentives and games** — Later.
**D12. Seasonal heads-up** — MVP.

### 7.5 Ambassador tools

**E1. Ambassador view** — Pilot (reduced).
Each ambassador sees the alerts for their assigned buildings and the check-in round for their floors (C7). *MVP:* adds unconfirmed residents (A8) and need-help signals (B1).
**E2. Ambassador posting** — Pilot.
An ambassador can post an update or incident to any floor of their assigned buildings, choosing floors as a range, a list or the whole building, and one or more disruption types (power, water or plumbing, elevator, fire alarm or evacuation, flood or leak) or "Other", which requires a line of text and shows 911 first. Posts are attributed to the role and building, shown before posting. Every post requires a second person's approval before it reaches residents (A15).
**E3. Report back** — Pilot.
Ambassadors' check-in rounds are reported to the Hub as counts by building and floor (done, not reached, needs help).
**E4. Ambassador content submissions** — MVP.
**E5. Coverage view** — Pilot.
Hub staff see which of the 43 pilot buildings and which floors have an assigned ambassador and which do not.
**E6. Connect a resident to a service** — MVP.

### 7.6 Partner coordination

**F1–F7, F9, F11–F13** — MVP. The Hub and partner coordination space, frontline activation, resource and capacity dashboards, coverage view, standing commitments, playbooks, decision log, indicators and review carry forward from version 2 unchanged into the MVP.
**F8. Space status (open, full, closed)** — MVP. [ASSUMPTION] Not in the pilot; in the pilot, Hub staff announce cooling-space openings through a neighbourhood alert.
**F10. Drills** — Pilot form is A17; the full partner-space drill is MVP.

### 7.7 Administration, roles and master data *(new in v3)*

**G1. Roles** — Pilot.
The CVH has the following roles. Every staff and ambassador account belongs to a named person; residents have no accounts.

| Role | Who | Can |
|---|---|---|
| Admin | Community Hub staff and IT | Manage accounts and roles, buildings, floors and providers; write, approve and send alerts; review and correct ambassador posts; run drills; see check-in counts and coverage |
| Coordinator | Community-side coordinators | [ASSUMPTION] Write and approve alerts for their neighbourhood; see check-in counts and coverage |
| Director | Community-side directors | [ASSUMPTION] Read-only view of alerts, coverage and counts |
| Partner organization | Organizations in the same cluster | [ASSUMPTION] MVP only (partner space); in the pilot, may be given Coordinator access by an Admin |
| Ambassador | Trusted residents assigned to buildings | Write posts for assigned buildings (sent after approval); see and work the check-in round for their floors |

- [NOTE FOR PM] The permissions for Coordinator, Director and Partner are inferred and need confirmation (Open Question Q-2).

**G2. Account lifecycle** — Pilot.
Only an Admin can create, assign, suspend or remove a staff or ambassador account. Removing an account ends its access at once.

**G3. Building and floor master data** — Pilot.
The Hub maintains the list of pilot buildings and their floors, seeded from the City of Toronto Apartment Building Registration (43 buildings), each with a last-updated date. Ambassadors are assigned to buildings from this list.

**G4. Provider master data** — Pilot.
The Hub maintains the provider list, seeded from the TPCH community asset list (about 100 providers, about 134 category entries), each with a last-confirmed date. One provider can have several categories and locations.

**G5. Audit trail** — Pilot.
Every send, approval, correction, withdrawal and account change records who did it and when.

## 8. Non-Functional Requirements

**N1. Languages.** English, French, Urdu, Tagalog, Gujarati, Dari, Slovak, Bengali, Tamil, Pashto, Hindi, Mandarin, Greek, Spanish and Punjabi, including right-to-left scripts (Urdu, Dari, Pashto). *Pilot:* all machine-translated by Cohere and labelled. *MVP:* people check alerts, announcements and interface text; everyday content may stay machine-translated and labelled, with a way to flag errors.

**N2. Accessibility.** Works with screen readers; offers a basic mode; status never relies on colour alone. Target WCAG 2.1 AA. *MVP:* audio versions of announcements.

**N3. Devices and connection.** Works in an ordinary phone browser and can be installed to the home screen without an app store; works on older phones and slow connections; the last-loaded alerts and essential numbers remain readable offline. No feature depends on owning a smartphone: SMS carries every alert.

**N4. Reliability.** *Pilot:* no numeric targets; outages and slow sends are logged and reviewed as pilot learnings. *MVP:* availability, alert delivery time, peak concurrent users and oldest supported device are set before architecture of the MVP.

**N5. Privacy and security.**
- *Both phases:* minimum data; no resident names; role-based access with named accounts; plain-language terms of use stating that the community owns the data; individual check-in records deleted when a disruption closes; indicators aggregate only; PIPEDA governs.
- *Pilot:* non-Canadian processors (hosting, SMS, push, translation) are acceptable and named in the terms of service.
- *MVP:* all personal data stored and processed in Canada; a privacy review completed before collection; retention of 3 to 7 years for reporting and audit records, with resident subscription data deleted on request.

**N6. Maintainability.** Custom code is kept small so a small team can maintain it. Written operating procedures for sending alerts, approvals, corrections and drills are part of the pilot deliverable. *MVP:* evaluates open-EWS for multi-channel sending and ADMS for the directory before build.

**N7. Content management.** Each content area (buildings, providers, guides) has a named owner and a last-updated or last-confirmed date shown to residents.

**N8. Cross-organization data governance.** *MVP:* a governance framework agreed with partners before any shared data collection.

**N9. Cost.** *Pilot:* total build and running cost within about CAD 1,000, including SMS and translation usage, with spend visible to Admins. [ASSUMPTION] The CVH can cap SMS volume per alert and per month.

## 9. Success Measures

### 9.1 Pilot learning measures

The pilot sets no targets; it measures to set MVP targets. All measures are aggregate, with drills reported separately from real disruptions.

| What we measure | Why | How |
|---|---|---|
| SMS subscribers and web app installs, by language and neighbourhood | Are people joining, and is it representative? | Platform counts |
| Time from disruption report to first acknowledgement, and from writing to approval to delivery | Speed was the community's clearest ask | Audit trail (G5) |
| Check-in rounds: requested, done, not reached, needs help | Does the human network reach those who asked? | Aggregate counts (E3) |
| Directory and map use in an ordinary week | Is the CVH useful every week? | Platform counts |
| Translation understood | Is machine translation good enough for alerts? | Short survey of residents and ambassadors per language |
| Drills run, corrections sent | Is the broadcast-safety process practised? | Audit trail |
| Cost per alert and total spend | Can the MVP afford SMS and translation at scale? | Provider billing |

### 9.2 MVP measures

Version 2's success metrics carry forward, with targets set from the pilot baseline. Version 3 drops "downloads and logins" and "statistics by age", since the CVH does not collect age and residents have no logins. [ASSUMPTION] Representativeness is measured by language, neighbourhood and building, plus periodic survey.

## 10. Assumptions and Dependencies

**Pilot**
- The Hub recruits and assigns ambassadors for the pilot buildings before launch; the check-in round depends on them.
- The Hub cleans the provider list before load (missing contacts, malformed values, duplicates) and confirms the 43 pilot buildings and their floors.
- At least two authorized people are reachable whenever an alert must go out, since every send needs two-person approval. The Hub's hours and approval timeouts are not defined for the pilot.
- Machine translation quality is acceptable in all 15 languages, or residents are told when it is not (Open Question Q-4).
- The budget of about CAD 1,000 covers hosting, SMS and translation for two months.
- Residents and ambassadors accept non-Canadian processors for the pilot, disclosed in the terms of service.

**MVP** (carried from version 2)
- Hub and partners connect their calendars and content, with a shared maintenance arrangement.
- Ambassador role design (boundaries, time, incentives, training) is resolved by the Hub.
- Building management engagement is a future state.
- Official alerts can be relayed on terms their sources allow.
- A technical evaluation of open-EWS and ADMS confirms they can be adapted.
- Privacy compliance, including Canadian data residency, is confirmed before any registry data is collected.

## 11. Key Risks

| ID | Risk | Phase | Level | How we reduce it |
|---|---|---|---|---|
| R-1 | Information goes stale and people stop coming back | Both | High | Named owners, last-confirmed dates, freshness measured |
| R-2 | The most at-risk residents are not reached | Both | High | SMS for every alert, no sign-up to see alerts, ambassadors, representativeness measured |
| R-3 | Privacy failure destroys trust | Both | High | No names, minimum data, role-based access, check-in records deleted after each disruption |
| R-4 | Machine-translated alert text is wrong or unclear in a life-safety message | Pilot | High | Labelled as machine-translated; English original one tap away; 911 guidance fixed in every guide; translation survey (9.1); checked templates in MVP |
| R-5 | Two-person approval slows alerts below what residents need | Pilot | Medium | Approval in one action on a phone; time to approval measured; see Q-1 |
| R-6 | A drill reaches residents, or a real alert is mistaken for a drill | Pilot | High | Drill roster enforced by the system (A17); exercise label on every message |
| R-7 | A correction misses people who received the original | Both | Medium | A16 delivers corrections on every original channel |
| R-8 | The CAD 1,000 budget runs out mid-pilot (SMS in non-Latin scripts costs more per message) | Pilot | Medium | SMS caps, spend visible to Admins, cost per alert measured |
| R-9 | Web push takes more effort than the pilot allows | Pilot | Low | Push is a stretch; SMS and web app carry every alert |
| R-10 | The CVH cannot be maintained after the pilot | Both | High | Small custom codebase, written procedures, partner ownership planned |
| R-11 | Ambassadors see phone numbers and floors of residents who asked for a check-in, without vetting or device controls (safeguarding is MVP) | Pilot | High | [ASSUMPTION] Pilot ambassadors are individually known to and recruited by the Hub; only own-floor check-ins visible; no names; data deleted when each disruption closes; Admin can remove access at once (G2) |
| R-12 | An ambassador post alarms or misleads a whole building | Both | Medium | Two-person approval (A15); 911 shown first for "Other" |
| R-13 | Relayed official alerts breach a source's terms | MVP | Medium | Terms confirmed before build; person confirms every relay |

## 12. Open Questions

### Before the pilot is built

- **Q-1. Ambassador posts vs. two-person approval.** Does every ambassador post wait for a second person, or may a post appear on the web app as "Not yet verified" immediately while its SMS waits for approval? *Owner: Hub.*
- **Q-2. Role permissions.** Confirm what Coordinators, Directors and Partner organizations can do in the pilot (Section 7.7, G1). *Owner: Hub.*
- **Q-3. Unit numbers.** Confirm that ambassadors never see a unit number in the pilot (check-ins by call or text only). *Owner: Hub.*
- **Q-4. Translation coverage.** Confirm the chosen Cohere model supports all 15 launch languages (in particular Pashto, Dari, Tagalog, Gujarati, Punjabi, Tamil, Bengali, Slovak, Urdu) with acceptable quality, and what residents see for any language it does not support. *Owner: Hub / IT.*
- **Q-5. Punjabi script and Mandarin form.** Gurmukhi or Shahmukhi; Simplified or Traditional. *Owner: Hub.*
- **Q-6. SMS keywords.** Stop, change groups, withdraw a check-in, and what "verified" means, in each language. *Owner: Hub.*
- **Q-7. End-of-pilot data.** What happens to subscriber and audit data when the pilot ends: deleted, or carried into the MVP with residents' consent? *Owner: Hub.*
- **Q-8. Pilot success decision.** Who decides, at the end of two months, whether to proceed to the MVP, and on what evidence from Section 9.1? *Owner: Hub and Community Experts Board.*

### Before the MVP

- Hub operating hours and approval timeouts, per disruption type.
- Safeguarding: ambassador vetting and training, device controls, consent through a trusted helper, minimum age for youth users.
- Official alert sources, terms and intake method.
- Reliability, delivery-time and scale targets (from pilot data).
- SMS provider, sender type and budget at neighbourhood scale, within Canadian residency.
- Extension beyond the 43 pilot buildings (the register lists 60 further buildings in neighbouring areas).
- Ambassador incentives, role boundaries, and what they post, escalate and never post.
- Partner and building management engagement, including data-sharing agreements.
- Hub calendar connection and maintenance.
- Post-pilot funding.
- Whether winter storms need a seventh guide and playbook.
- When service tagging and partner confirmation of listings come into scope.

## 13. Review and Approval

This document is reviewed by the Hub and the Community Experts Board before pilot development begins. Reviewers are asked to check that the pilot scope (Section 6) is what they expect to test, that the principles (Section 5) still match what was said in the co-design sessions, and that nothing in the pilot crosses the lines the community drew.

## 14. What Changed in Version 3

| Change | Affects | Source |
|---|---|---|
| Delivery split into Pilot (2 months, about CAD 1,000, 43 buildings, about 100 providers) and MVP | Overview, Section 6, every FR | Product owner decision, 2026-09-30 |
| Pilot surface is an installable web app with optional web push; MVP adds native apps and email | A2, N3 | Product owner |
| Check-in requires SMS sign-up; otherwise choices stay on the device; no resident names stored | P3, P4, C1, C6, C7 | Product owner |
| Pilot translation by Cohere machine translation, labelled; checked templates move to MVP | P1, A3, N1, D7 | Product owner |
| Two-person approval, corrections on every channel, and drill separation required in the pilot | A15, A16, A17, E2 | Product owner |
| Roles, account lifecycle, building and provider master data, audit trail added | Section 7.7 | Product owner; validation report |
| Official alert relay, need-help signal, partner space, retention, safeguarding, reliability targets and data residency move to MVP | A10, B1, B3, F1–F13, N4, N5 | Product owner |
| WhatsApp integration out; sharing to WhatsApp chats and Status in | A11, Section 6.2 | Product owner |
| PA system removed from all user descriptions | Section 4 | Validation report (contradiction) |
| Metrics that need data the CVH does not collect (age, logins) removed | Section 9 | Validation report |
| Building and provider seed data identified | G3, G4, Section 2 | City of Toronto Apartment Building Registration; TPCH community asset list v2 |
