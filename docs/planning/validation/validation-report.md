# Validation Report — Community Virtual Hub (CVH) — MVP PRD v2

- **PRD:** `CVH - PRD v2.docx` (converted from `docs/CVH - PRD v2.docx`)
- **Rubric:** `BMad PRD validation checklist`
- **Run at:** 2026-09-30T23:42:33+00:00
- **Grade:** Poor

## Overall verdict

The PRD is well grounded. Its problem framing, community voice and principles are specific to Thorncliffe Park and Flemingdon Park, and many FRs (A2, A11, A12, C7, E2) are unusually precise about behaviour and privacy. It is not ready for architecture yet. The non-functional section has no numbers where architecture needs them most (load, latency, availability, device floor). Several "Must" requirements depend on "Should" or out-of-scope items. The channel model contradicts itself (app/push vs. no install; PA in and out). No role/permission model or data classification exists, and the registry and SMS-subscriber boundary depends on both. Fix those four things before the architect starts. The rest can be tightened in parallel.

The three extra reviewers all reach the same verdict independently: not ready for architecture. They also go further than the rubric. The adversarial review calls the MVP an enterprise incident-management platform with no budget, team, timeline or legal controller, and names safety exposures the rubric only brushes: an offline list of isolated seniors with unit numbers on volunteers' personal phones; free-text alerts machine-translated into 15 languages with no human check; corrections that can never reach SMS recipients or forwarded WhatsApp copies; and a design that ignores the power outage, its most frequent disruption. The architecture-readiness review names 10 phase-blockers that must be answered before the spine is drawn: client form factor, channels and SMS provider, official-alert ingestion, privacy regime and residency of processors, operator identity and roles, server-side targeting vs. 'choices stay on her device', real-time translation, numeric NFRs, hosting ownership and budget, and the registry data model. The UX reconciliation finds that the PRD's two-way 'emergency loop' Musts (B1–B4, A8, E1, D6) and its everyday-layer Musts (D1, D4, D5, D8) were never prototyped. It also finds that the UX brief has no push channel while the PRD requires one, and that check-in requests from web-only residents cannot exist under P3/N5 as written. Together they move the picture from 'tighten four things' to 'answer 15 product-owner questions first'. The consolidated list is below.

## Dimension verdicts
- Decision-readiness — adequate
- Substance over theater — adequate
- Strategic coherence — adequate
- Done-ness clarity — thin
- Scope honesty — adequate
- Downstream usability — thin
- Shape fit — adequate

## Findings by severity

Totals across all reviewers: 25 critical, 48 high, 54 medium, 28 low (155).

### Critical (25)

**[Rubric: Substance over theater]** — N4 Reliability has no bounds (§8 N4)
"Stay up and stay fast" and "a whole neighbourhood checking it at once" give architecture nothing to size against. §2 supplies the population (~43,000 to 50,000+ across ~34 buildings), but the PRD gives no peak concurrency, page-load or alert fan-out time (e.g. SMS to all subscribers in X minutes), availability target, or behaviour when upstream (SMS gateway, open-EWS) is down.
Fix: Add numbers: peak concurrent users, alert end-to-end delivery time per channel, availability during declared disruptions, time to first render on a named low-end device over 3G, and degraded-mode behaviour.

**[Rubric: Strategic coherence]** — Priority grading contradicts the thesis and creates Must→Should dependency inversions (§3 Goal 2; §7 B1/B3, A8/E1, C6-C7/E3, F4-F5-F7-F9/F1-F6; D2)
These pairs cannot be built as graded:
  - B3 Must routes signals that B1 (Should) creates.
  - E1 Must shows "which residents have not yet confirmed receipt", which needs A8 (Should).
  - E3 Must "includes the check-in round (C7)", but C6/C7 are Should.
  - F6 Must is "built from F4 and F5" (both Should) plus commitments (F7, Should) and playbooks (F9, Should).
  - F1 Must opens spaces "carrying … its playbook (F9) and matching standing commitments (F7)" (Should).
  - D2 Must includes a disruption-filtered help list that "depend[s] on" tagging, which §6 puts out of scope.

  If the Shoulds slip, as §7 permits, the Musts are unbuildable.
Fix: Re-grade (B1 to Must at minimum, given Goal 2), or rewrite each dependent Must so it degrades cleanly without the Should ("E1 shows unconfirmed residents when A8 is enabled").

**[Adversarial]** — C-1. "Device-only" privacy promise contradicts per-resident confirmation tracking by ambassadors (§5 P3, §7.1 A8, A12, §7.5 E1, §8 N5, §5 P4)
P3 promises that choices "stay on her own device until she signs up for text alerts". N5 says "groups, building and floor are stored centrally only as part of a text subscription". Yet A8 says "Ambassadors can then see which residents on their floor or in their building have not confirmed", and E1 repeats "which residents have not yet confirmed receipt". An ambassador can't see who has *not* confirmed unless the system holds a central, identified roster of who is on each floor. For a web-only resident with device-held choices that roster can't exist. For an SMS subscriber it exists, but it exposes a neighbour's phone number and floor to another resident (the ambassador). P4 says names and addresses are "never visible to ... other residents", and ambassadors *are* residents. As written, A8/E1 either can't be built or break P3, P4 and N5.
Fix: Pick one. (a) Confirmation tracking covers only people in the registry (C1), who have explicitly consented to ambassador visibility, and ambassadors see a pseudonymous handle plus the contact method, never a phone number. Or (b) drop per-resident non-confirmation lists and show ambassadors only floor-level counts. Rewrite A8, E1, P3 and N5 so they agree, and state exactly which fields an ambassador can see.

**[Adversarial]** — C-2. Life-safety messages go out in 15 languages with no possible human translation check (§8 N1, §7.1 A3, A10, §7.5 E2, §11 (AI risk row))
N1: "Before production, people check alerts, announcements and interface text". That covers *templates*. But E2 lets ambassadors post directly ("power, water, elevator, and flood or leak go out directly"), "Other" requires "a line of text", and A10 says non-template official alerts are "shown in its official language with a labelled machine translation". Free text written at 2 a.m. can't be human-checked in 15 languages before an SMS goes out. So some live alerts *will* be machine-translated with no check. Translation errors in Pashto or Dari on "do not use the elevator" or "evacuate / shelter in place" are exactly the life-safety failure this product exists to prevent. The PRD never says which languages MT handles poorly, or what happens when it fails.
Fix: State a rule: free-text alert content is sent in the author's language plus English, and the pre-approved template for that disruption type is sent in every language. Non-template free text is never machine-translated into the SMS body. MT is allowed only behind a "machine translation, may contain errors" label in the web view. Name a quality bar for each language. Pashto, Dari and Punjabi-Shahmukhi MT quality is notoriously weak.

**[Adversarial]** — C-3. 24/7 operations are assumed, not provided (§7.1 A4, A10, §5 P6, §7.5 E2, §7.6 F2, §10 ("The Hub can approve ... at any hour an ambassador might post"))
A4 wants acknowledgement "within five to ten minutes of a disruption starting". A10 says "A person at the Hub confirms each relay". E2 holds fire and evacuation posts "wait[ing]" for Hub approval. F2 says "nothing reaches frontline teams without a person confirming it". P6 says "every ambassador post is reviewed by the Hub as a priority". Every one of these needs a staffed human, at any hour, on every day of the year. The only support offered is a one-line assumption in §10. There is no rota, no staffing budget, no on-call model, no escalation if nobody answers, and no statement of what the system does when the Hub is unreachable. A fire-alarm post that "waits" at 3 a.m. with no one on duty is worse than no feature. The ambassador learns the tool fails exactly when it matters.
Fix: Add an operating-hours NFR: covered hours, on-call rota, maximum approval latency, and an automatic fallback when the approval timeout expires. The fallback must be decided for each disruption type: auto-release as "Not yet verified", or auto-reject with the ambassador told to use door-to-door/911. If the Hub can't fund 24/7, say so, and change A4, A10, E2 and F2 to state their behaviour outside covered hours.

**[Adversarial]** — C-4. Safeguarding exposure: a target list of isolated seniors with unit numbers, held by volunteers (§7.3 C1, C6, C7, §7.5 E1, E6, §10 (ambassador assumptions))
C6 collects "a unit number ... only for a knock" from residents who have self-identified as seniors or as wanting a check-in (i.e., living alone or needing support). C7 shows this to "the ambassadors covering it", and they are neighbours and volunteers. C7 also works "without signal", which means the data is cached on a personal phone. Put together: an offline list, on an unmanaged personal device, of vulnerable people who live alone, with their unit numbers, held by a volunteer with no stated screening. That is a burglary, fraud and elder-abuse target list. The PRD states no vulnerable-sector check, no code of conduct for ambassadors, no device security, no remote wipe, no offboarding, and no audit of who viewed what. The claim that the CVH "is not designed to manage a vulnerable population registry" (§1) is contradicted by what C1/C6/C7 actually store.
Fix: Make ambassador vetting (police vulnerable-sector check or equivalent), a signed confidentiality agreement and training preconditions for seeing any check-in record. Show only the unit number, and only while a round is active, with time-boxed offline cache and remote revocation. Log every view. Reword §1 honestly: this *is* a minimal vulnerable-persons list, and the controls must match that.

**[Adversarial]** — C-5. No legal controller, no applicable-law analysis, and a data-residency claim the named channels can't meet (§5 P9, §7.3 C4, §8 N5, N8, §10 (privacy assumption), §11)
P9 says "stores it in Canada". The PRD never names *who* is the data controller or custodian: the Hub, TNO, a partner, the City? That decides whether PIPEDA, MFIPPA (City involvement), PHIPA (health partners doing "wellness call[s]", "health access" signals) or none of them applies. Ontario non-profits outside commercial activity may fall under *no* statute, which makes contracts the only protection. Meanwhile the requirements depend on services that commonly process data outside Canada: SMS gateways (A2), web push via Apple/Google push services (A2), semantic search and chatbot models (D2, D10), machine translation (N1, A10), and WhatsApp forwarding (A11). "Stored in Canada" doesn't cover processing and transit. CASL is never mentioned, although the seasonal heads-ups (D12) and weekly summaries could be commercial electronic messages if partner programs are promoted. Retention periods are defined only for check-in records.
Fix: Before architecture, get a privacy impact assessment and legal memo that name: the controller for each data set (registry, SMS subscribers, incident reports, partner space), the applicable statute(s), the residency rule for storage *and* processing (including subprocessors), CASL position, retention per data class, and breach-notification duty. Turn "privacy review before registry data is collected" (N5) into a gate on the whole launch, not just the registry.

**[Adversarial]** — C-6. The "need help" signal has no response guarantee, no timeout and no escalation, so it invites reliance instead of 911 (§7.2 B1, B3, §4 User Flow, §7.3 C6, §10 (911 assumption))
B3: "Route 'need help' signals to the right ambassador or staff member for follow-up, and track that follow-up happened". It gives no time bound, no acknowledgement to the resident, no escalation when the ambassador doesn't respond, and no behaviour when nobody covers her floor (C6 handles this only for check-ins). During a heat wave, a senior with heat exhaustion who taps "need help" and waits is in danger. A disclaimer saying "not 911" won't stop that. The UI design of a one-tap help button does more to set expectations than any disclaimer. B1 is also only a *Should*, while A1 says "Getting help to those who need it is the priority" and the goals call it the priority. So a stated priority sits at the lowest delivery tier.
Fix: For each signal, state the resident-facing acknowledgement ("Received. An ambassador will contact you within X. If this is urgent, call 911 now"). Set a maximum unacknowledged time before auto-escalation to the Hub, and a rule for what happens when the Hub is also unavailable. Put the heat-illness and "when to call 911" triage *before* the signal is sent, not after. Promote B1 to Must, or change the goals.

**[Adversarial]** — C-7. Ambassador direct posts reach whole buildings by SMS unverified, and account compromise isn't considered (§7.5 E2, §5 P6, §11 (row "An ambassador post reaches a whole building by text...", rated Medium))
E2: power, water, elevator and flood posts "go out directly", as "Not yet verified". §11 rates the risk "Medium". An SMS to every subscriber in a 30-storey tower saying the water is contaminated, or that there is flooding on floor 3, reaches hundreds of households. A "Not yet verified" label in an SMS doesn't undo panic. The PRD also never considers a stolen, borrowed or compromised ambassador account, a disgruntled ex-ambassador (no offboarding requirement), or an ambassador targeting a landlord dispute. No authentication requirement exists for ambassadors (MFA, device binding, session lifetime).
Fix: Re-rate to High. Require ambassador authentication (MFA or at least SMS OTP), immediate revocation, rate limits on direct posts per ambassador per hour, and a two-ambassador or Hub-within-N-minutes rule before a direct post goes to *SMS*. The web feed can stay instant. Add an audited "withdraw" that sends a correction SMS to the same recipients automatically.

**[Adversarial]** — C-8. Corrections can't reach recipients of SMS and forwarded copies, by design (§5 P6 ("A correction is shown as a correction, never a quiet replacement"), §7.1 A5, A7, A11)
A11 says forwarded alerts must be "useful without its link", i.e., a self-contained text blob with origin and time. Once that text is in a WhatsApp group, no correction will ever reach it. SMS can't be edited. P6 promises corrections are "shown", but on which surface? Only the live web alert. The PRD doesn't require a correction SMS to be sent to everyone who got the original, or define what happens to forwarded copies. In an evacuation or boil-water scenario, a stale forwarded message outlives the correction indefinitely. That is the rumour problem §2 blames on WhatsApp, now carrying a "Verified by the Hub" badge.
Fix: Require that every correction, withdrawal or "all clear" is pushed on *every channel the original went out on*, to the same recipient set. Require forwarded text to include "valid until [time]" and "check [short link] for updates". Add a test: correction delivery ratio equals original delivery ratio.

**[Adversarial]** — C-9. Power outages break the channels the design depends on, and the PRD never says so (§8 N3, N4, §7.1 A2, A3, §7.3 C7 ("without signal"), §2 ("Power outages hit some buildings every two to three months"))
Power outage is the most frequent disruption, yet no requirement deals with it. In an outage: in-building Wi-Fi is gone; phones drain (the asset map even lists "device charging" as a service, which admits the problem); cell sites on battery backup may degrade; elevators stop, so ambassadors can't reach upper floors quickly; audio alerts (A3) need data; web push needs connectivity. N3's "Key information is still readable if the connection drops" is vague. It doesn't say *which* information, how fresh, or what happens if the page was never loaded before the outage. The Hub's own power and connectivity (operators confirming relays) are never assumed or planned.
Fix: Add an explicit degraded-mode NFR. SMS is the primary channel during a power outage. Messages must fit in N segments. The last-known alert and essential numbers are cached offline in the web app. Hub operators need backup power and connectivity (or a mobile-only operator workflow). The printed-notice kit (A2) is pre-positioned in each building. Test it in a drill with Wi-Fi off.

**[Adversarial]** — C-10. MVP scope is an enterprise incident-management platform. No budget, timeline or team is stated (§6 In scope, §7 (roughly 55 numbered requirements, most of them Must), §7.6 F1 to F13, §8 N6, §12)
The "MVP" includes the following, all shipping together "because each depends on the other" (§6):
- multi-channel alerting (open-EWS adaptation) in 15 languages, with audio for 7 templates in each (105+ recordings, all human-checked)
- an official-alert relay integration with Alert Ready, ECCC and the City
- two separate applications (N6)
- a vulnerable-outreach registry and check-in rounds
- a directory with semantic search, a chatbot (D10), an asset map, a hazard directory, a calendar integration, a weekly summary and a preparedness toolkit with quizzes
- moderation queues
- a partner incident-management suite: activation triggers, frontline paging, supply inventory, capacity dashboards, standing commitments, versioned playbooks, drills, decision log, indicators and after-action review

No team size, no budget, no pilot duration and no launch date appear anywhere. §10 admits the open-source spike happens "before estimates are locked in". Nobody has estimated it. §11 rates cost overrun only "Medium".
Fix: Cut to a real pilot: one neighbourhood or 3 to 5 buildings; alerts (template-only), SMS plus web; the check-in registry with strict controls; directory read-only from the asset map; F1/F2/F3/F8 only. Move F4, F5, F7, F9 to F13, D8 quizzes, D10 and D12 to a later phase. Add pilot duration, budget envelope, team and explicit go/no-go criteria.

**[Architecture readiness]** — CR-1. Resident client form factor: web app, installable PWA or native app? (§ 7.1 A2; 8 N3; 5 P2; 9 (metrics table))
A2 requires delivery "in the website, by push notification (app), and by text message (SMS)". N3 says it "Works in an ordinary phone browser without installing anything (a 'web app')". §9 measures "Downloads, logins". "Push notification (app)" means either a native iOS/Android app (store accounts, review cycles, APNs/FCM) or Web Push. On iOS, Web Push only works after the user adds the PWA to the Home Screen, which is an install. It is also unclear whether ambassadors get a different surface; C7 and the brief (A-04) need offline queueing, which pushes toward a PWA with a service worker. This choice decides the client stack, the push provider, the offline strategy and the release process.
Status: Contradictory
Question for PO: "For v1, is the resident and ambassador client (a) a mobile web app only, (b) an installable PWA using Web Push, or (c) native iOS/Android apps as well? If push is required on iPhone, do we accept that residents must add the app to their Home Screen to get it? And what does 'Downloads' in §9 count?"
Label: Phase-blocker

**[Architecture readiness]** — CR-2. Authoritative channel list, SMS provider model, throughput and cost envelope (§ 7.1 A2; 4 (note, Non-Users, Success state); 10 (SMS cost bullet); 12 ("WhatsApp Business API / SMS gateway costs"))
The channel set is inconsistent. A2 lists web, app push and SMS. §4 Non-Users says "PA, print, SMS, ambassadors, in-person". The §4 note says "A PA system is not included". The Success state lists "text, audio, app, PA, print". §12 raises the WhatsApp Business API as an open cost question, yet no requirement makes WhatsApp a delivery channel (A11 is share-sheet forwarding only). Email is never mentioned, including for partner/frontline activation in F3. There is no SMS sender type (short code, toll-free or 10-digit long code), no Canadian carrier throughput requirement, no subscriber estimate and no budget ceiling. A single alert in Urdu, Pashto or Dari is UCS-2 encoded (70 characters per segment), so a building alert costs several segments per recipient. A2 also requires two-way SMS (reply to confirm, STOP, keywords per A12 and C6), which needs a provider that supports inbound SMS in Canada.
Status: Vague / Contradictory
Question for PO: "Confirm the v1 outbound channels exactly (web, push, SMS; is WhatsApp Business API in or out; is email used for partner and frontline activation?). What is the expected SMS subscriber count at launch and at the end of the pilot, the monthly SMS budget ceiling, and is a dedicated short code (with its lead time and cost) acceptable, or must we use a long code or toll-free number?"
Label: Phase-blocker

**[Architecture readiness]** — CR-3. Official alert ingestion: sources, feeds, licensing, automation and verbatim relay (§ 1 Overview; 7.1 A10; 7.6 F2; 10 (last bullet); 11 (last row); 12 ("terms on which official alerts can be relayed"))
A10 requires relaying "the City of Toronto, Environment and Climate Change Canada and Alert Ready (including Amber Alerts)", with "the official wording never edited". The PRD does not say whether ingestion is automated (NAAD System CAP feed from Pelmorex, ECCC MSC Datamart CAP alerts, a City of Toronto feed if one exists) or done by Hub staff copy-pasting. Redistribution licensing is still an open question (§12), but the feature is a Must. Latency is undefined, and "A person at the Hub confirms each relay" adds an unbounded human delay. Mapping an alert's "affected area" (CAP polygons and geocodes) to the 34 buildings is not specified. There is also a verbatim contradiction: "Known alert types carry a pre-written template in every launch language, with the official text one tap away" means the primary text the resident sees is *not* the official wording. The F2 triggers ("ECCC heat warning, special air quality statement, power outage lasting longer than an agreed time") need machine-readable feeds, and there is no Toronto Hydro outage feed named for the last one.
Status: Vague / Contradictory
Question for PO: "Which exact official feeds must v1 ingest (NAAD/Alert Ready CAP, ECCC CAP, a named City of Toronto source, Toronto Hydro outages?), and do we have or expect written redistribution terms for each before build? Is ingestion automatic with a human 'confirm relay' step, or fully manual? What is the target time from the official issue to the resident receiving it? When an official alert matches a template, is the template text or the verbatim official text the primary message?"
Label: Phase-blocker

**[Architecture readiness]** — CR-4. Privacy regime, data residency scope and third-party processors (§ 5 P9; 7.3 C3–C4; 8 N5, N8; 10 (privacy bullet); 11 (privacy row))
"All personal data stored in Canada" and "a privacy review completed before any registry data is collected" are stated, but the governing law is never named: PIPEDA (a non-profit Hub in commercial activity?), Ontario MFIPPA (if the City is a data party), PHIPA (if the seniors team or health partners receive check-in data) or CASL for SMS consent. The "in Canada" boundary is undefined for the processors any design needs: the SMS gateway (most are US-based), APNs and FCM (US), CDN and edge, error tracking, analytics, the machine translation provider (N1), and the AI or embedding provider for "meaning-based" search (D2, N6) and the chatbot (D10). "Personal data" is not scoped either: is a phone number plus building plus floor plus "senior" group personal data? (Yes, in practice.) The data controller is not named (Hub? a partner? a consortium under N8?).
Status: Vague
Question for PO: "Who is the legal data controller, and which privacy statutes apply (PIPEDA, MFIPPA, PHIPA, CASL)? Does 'stored in Canada' also rule out processing or transit through non-Canadian services (SMS gateway, Apple and Google push, machine translation, AI search or chatbot, analytics, error logging)? If it does, which of those features are we allowed to drop or replace?"
Label: Phase-blocker

**[Architecture readiness]** — CR-5. Identity and authentication for ambassadors, Hub staff and partners; role and permission model (§ 5 P3, P4; 7.1 A1, A12; 7.3 C3; 7.5 E1–E2; 7.6 F1–F3, F8, F10; 10)
Residents clearly need no account (P3, A2). But ambassadors live *in the resident app* and can post SMS-reaching alerts to whole buildings, and Hub and partner users can relay official alerts, activate teams and read the registry. The PRD does not say how any of these users sign in, who vets and provisions them, whether MFA is required, how an ambassador is bound to "the building or buildings they are assigned to", or how access is revoked when someone leaves (F11 mentions handover only). The role list is implicit: resident, trusted helper, ambassador, floor contact, Hub staff, Hub approver, moderator, partner org member, partner org admin, registry-authorized person, frontline team member, drill participant. There is no permission matrix, and "only what their role requires" (C3) is not defined per role. "Named, authorized people in trusted organizations" implies per-person identity and audit.
Status: Silent (for operators) / Clear (residents need no account)
Question for PO: "Please provide the v1 role list and a permission matrix (post, approve, relay official, activate, read registry fields, moderate, edit space status, run drills). How do ambassadors and partner users sign in (phone OTP, email plus password, SSO from partner organizations?), is MFA mandatory for anyone who can reach residents by SMS or read the registry, and who approves and revokes these accounts?"
Label: Phase-blocker

**[Architecture readiness]** — CR-6. Targeting model versus "choices stay on her own device" (§ 5 P3, P10; 7.1 A1, A9, A12, A13; 8 N5; 12 ("small-group threshold"))
A1 requires targeting by building, floor and group. P3 and N5 say that for anyone not on SMS, "groups, building and floor … stay on her own device" and "Tailoring happens on the resident's own device". So the server cannot target web or push users by building, floor or group. It would have to broadcast every alert to every push subscriber and filter on the device, which leaks all alerts to all devices, costs bandwidth, and makes A8 per-floor "not confirmed" lists impossible for non-SMS users. Is a push subscription itself stored centrally, and with what attributes? The data model for buildings (34 or more), floors, "neighbourhood" (two neighbourhoods, or sub-areas?) and the canonical building list are unspecified, as is who maintains them. "Following a relative's building" (A9) means one person can have several targets. The small-group threshold (§12) is a k-anonymity control that the architect needs a value for.
Status: Contradictory / Vague
Question for PO: "For residents using web or push without SMS, may the server store their building, floor and groups against a push subscription token, or must alerts be broadcast to all devices and filtered on the phone (accepting that A8 confirm-receipt tracking then only works for SMS)? What are the canonical targeting units (the 2 neighbourhoods, a fixed list of N buildings, floors per building), who maintains that list, and what is the small-group minimum size?"
Label: Phase-blocker

**[Architecture readiness]** — CR-7. Translation workflow for time-critical alerts across 15 languages (§ 7.1 A3, A4, A10; 8 N1; 5 P1; 12 (Punjabi and Mandarin script))
A4 requires "acknowledgment within five to ten minutes". N1 says "people check alerts, announcements and interface text" before production, and A3 covers only "pre-written templates" for 7 disruption types. For a free-text community alert or an ambassador "Other" post (E2), nothing says who translates into 15 languages within minutes. Is it machine translation, labelled? Human translators on call? Only template variables? The same applies to corrections and running-thread updates (A7). The architecture needs to know whether there is a translation service in the send path, a human review queue with an SLA, or template-only sending. RTL support (Urdu, Dari, Pashto) is clear. The Punjabi and Mandarin scripts are open (§12). Template audio "in every launch language" (A3) is covered separately in HI-6.
Status: Contradictory / Vague
Question for PO: "When a Hub staffer or ambassador posts a free-text alert that doesn't fit a template, what do non-English residents receive: (a) a machine translation labelled as such, sent immediately, (b) English only until a human translation is ready, or (c) template-only posting is enforced? If humans translate, who covers the 15 languages and within what time?"
Label: Phase-blocker

**[Architecture readiness]** — CR-8. Measurable availability, latency and scale NFRs (§ 8 N4; 2 (population); 4 (success state "within minutes"); 7.1 A4)
N4 says "must stay up and stay fast … handle a whole neighbourhood checking it at once". There is no availability target, no RTO or RPO, no end-to-end delivery latency (post to SMS delivered to the last recipient), no page-load budget on 3G or older phones, and no concurrency number. Scale inputs are soft: "roughly 43,000 … well above 50,000 across about 34 buildings"; no expected number of residents on the web, push subscribers, SMS subscribers, ambassadors, partner users, or alerts per month. The architecture (hosting tier, multi-AZ, SMS fan-out queueing, CDN) and cost model cannot be sized without these.
Status: Vague
Question for PO: "Please set v1 targets: availability (for example 99.5% or 99.9% monthly), maximum time from 'send' to 95% of SMS recipients delivered, page load on a slow 3G connection, and peak concurrent users (the whole population, or a stated share). What are the pilot-end estimates for SMS subscribers, push subscribers, ambassadors, partner users and alerts per month?"
Label: Phase-blocker

**[Architecture readiness]** — CR-9. Hosting ownership, operating budget and post-pilot owner (§ 8 N6; 10 (SMS cost, spike bullets); 11 ("cannot be maintained after the pilot"); 12 ("Post-pilot funding"))
Nothing says who owns the cloud account, domain, SMS sender registration and app-store accounts (if any), who pays for hosting, SMS and AI services, what the build and run budget is, or who runs production after the pilot ("partner ownership from launch" in §11 names no partner). "A small team" (N6) is unsized. This drives build versus buy, managed versus self-hosted open-EWS and ADMS, and the Canadian-region cloud choice.
Status: Silent
Question for PO: "Which organization will legally own and pay for the production hosting account, the domain and the SMS sender, and what is the annual run budget (hosting plus SMS plus third-party services) for the pilot and after it? Who, by role and headcount, maintains the system after the pilot?"
Label: Phase-blocker

**[UX reconciliation]** — CR-1. [C][U] Check-in and registry data must be stored centrally, but the PRD says web-only choices stay on the device (§ PRD P3 ("Choices a resident makes without signing up … stay on her own device until she signs up for text alerts"); PRD N5 ("groups, building and floor are stored centrally only as part of a text subscription"); PRD C1 ("opt in to a priority-outreach list … The check-in request (C6) is part of the same choice"); PRD C6 ("a phone call, a text message, or a knock on the door — and a unit number is asked for only for a knock"). UX 3.2.6 decision Q9 ("Nothing is stored centrally without a subscription"); UX 3.7.1 / F12 (check-in via R-26 → R-35 → R-33 for web visitors); UX 3.7.2 (A-04 lists "by floor and door … or by number").)
A resident on the web who has not subscribed can ask for a check-in by phone call or knock (F2 → F12). For an ambassador to see that request on A-04, it has to be stored centrally, along with a phone number or unit number, building and floor. Neither document says where a call-back number is collected when the resident has no text subscription. The PRD links three things without saying how they relate: the priority-outreach list (C1), the groups choice (A12) and the text subscription (N5). Is the registry a separate store (C4: "separately from everything else") or the SMS subscription table? The architecture cannot proceed until this is settled.
Fix: Add a short data-inventory section to the PRD. Name each store: device-local choices, SMS subscription, check-in requests, registry, ambassador assignments, partner data. For each, give its fields, who can read it, and its retention. State explicitly that a check-in request is a central record with its own consent, and say what R-33 collects when there is no subscription. Amend P3 and N5 so they carve out check-in requests.

**[UX reconciliation]** — CR-2. [C][U] The ambassador round needs a list of "households not reachable digitally" that no requirement collects (§ UX 3.1.2 ("The number of households that cannot be reached digitally is stated before sending … passed to the ambassadors covering those floors"); UX F19 step 2 ("below them, the households on his floors not reachable digitally"); UX PA-46, PA-48; UX A-04 states. PRD A1–A2, P9 ("minimum personal data"), N5. The PRD has no requirement for a household roster.)
To count or list households that are *not* reachable digitally, the system needs a baseline of every household by building and floor, and to know which are unsubscribed. That is either a household register, which would be a new collection of personal data that P9 and the registry scope (Section 6, "detailed vulnerable-population registry" out of scope) arguably forbid, or an ambassador-kept list. Neither is specified. The PRD never mentions this capability, yet PA-48 makes it an acceptance condition.
Fix: Decide the source: ambassador-maintained door lists, building unit counts minus subscribers, or dropping the feature. Record it as an FR under 7.5, with its privacy basis and retention. If it is only an estimate built from unit counts, say that it is an estimate and that no household is identified.

**[UX reconciliation]** — CR-3. [G] The two-way half of the emergency loop is a set of PRD Musts with no UX coverage (§ PRD User Flow ("taps confirm or 'need help with non emergency services …' … status updates to green when resolved"); PRD B2 (Must), B3 (Must), B1/B4 (Should), A8 (Should), E1 (Must: "which residents have not yet confirmed receipt, and any 'need help' signals"), D6 (Must, live status, "feeds from incident reports in Section 7.2"); PRD Section 11 risk ("clear unique value (building-level, two-way)"). UX Section 11 "Deliberately out of this cut" ("Signalling 'I need help'; incident reporting — PRD 7.2, B1 to B4"; "live status view … D6"); UX 3.1.2 ("Not required for this story: confirmation of receipt by residents (A8)"); UX 3.1.5 ("Resident reporting (PRD B-series) is not in this cut").)
The PRD's critical path and its "two-way" differentiator are exactly the features the prototype excludes. PRD v2 presents itself as brought "in line with" the brief, but none of these Musts has been designed, tested with the Board, or given acceptance criteria. There is also an internal inconsistency: E1 (Must) depends on A8 (Should) and B1 (Should).
Fix: Either (a) schedule a second prototype cut covering B1–B4, A8, E1 and D6 before architecture locks, or (b) state in PRD Section 6 and 13 that these Musts are untested by the prototype, and raise that as an explicit risk. Align priorities: if A8 and B1 stay Should, E1 cannot be Must as written.

**[UX reconciliation]** — CR-4. [C] The channel set differs between the documents: push is required in the PRD and absent from the UX; email appears in the UX and not in the PRD (§ PRD A2 ("in the website, by push notification (app), and by text message (SMS)"); PRD F3 ("using the same multi-channel delivery already required for resident alerts (A2)"); PRD N3 ("a 'web app'" without installing anything); PRD Section 4 note and Non-Users ("PA, print, SMS, ambassadors, in-person"). The UX brief never mentions push notifications (zero occurrences); UX 3.6.4 / P-06 ("by text message and by email"); UX 3.1.1 ("Channels are listed as a status"); UX Section 9 ("A mobile-first responsive web application … nothing installed").)
Push needs either an installed app or web-push subscription and permission, which the brief never designs: no permission prompt, no state, no R-screen. Email activation for staff is a UX decision that A2 does not cover, so F3's "same multi-channel delivery … (A2)" is false as written. The PRD also contradicts itself on the PA system: "A PA system is not included in the CVH's channel set" (Section 4 note) against "(text, audio, app, PA, print)" (Success state) and "(PA, print, SMS, ambassadors, in-person)" (Non-Users).
Fix: Publish one channel matrix in the PRD with these columns: resident web, web push (yes, no or later), SMS, printed notice, ambassador in person; staff SMS and email. Rewrite A2 and F3 against it. Remove PA from the success state and Non-Users, or mark it "existing channel, not operated by the CVH".

### High (48)

**[Rubric: Decision-readiness]** — Human-confirmation vs. 24/7 staffing trade-off unacknowledged (§7.1 A10, §7.5 E2, §7.6 F2, §10 "at any hour")
Every alert path requires a Hub person. The PRD does not say what happens when no one is available: whether a relay or an approval-pending post times out, escalates, or goes out as "Not yet verified". It does not reconcile this with A4's 5–10 minute acknowledgement benchmark.
Fix: Add an explicit decision covering Hub coverage hours, fallback behaviour when no approver responds within N minutes (per disruption type), and who carries on-call. Record it as a `[NOTE FOR PM]` if it is unresolved.

**[Rubric: Substance over theater]** — N3 device/connection floor unspecified (§8 N3)
"older phones and slow connections" and "Key information is still readable if the connection drops" do not say which browsers or OS versions, what bandwidth, or what is cached offline and for how long. C7 requires one-tap marking "without signal", which is an offline-write requirement with sync.
Fix: Name a minimum device/browser, a target bandwidth, and an explicit offline scope (cached alerts, essential numbers, check-in round queued writes).

**[Rubric: Done-ness clarity]** — Unbounded qualifiers in Must/Should FRs
Flag list:
  - A4 "Post an acknowledgment quickly"; the 5–10 minute figure is framed as "the community's stated benchmark", not the requirement, and is measured "of a disruption starting", which the system cannot observe.
  - A7 "the period set for its disruption type" (unset, §12).
  - A1 group alerts with no "small-group threshold" (unset, §12), which is a privacy-critical number.
  - B3 "track that follow-up happened" (what counts as follow-up, by when?).
  - D5 "published at a set time".
  - E2/P6 "reviewed by the Hub as a priority".
  - F8 "reaches … at once" and "an agreed period".
  - P5 "never more than a few taps away".
  - E1 "in order for ambassadors to know … in what order" (ordering rule unstated).
Fix: For each, set a number or a named configurable parameter with a default and owner. Restate A4 as "time from first report or relayed official alert to published acknowledgement ≤ 10 min (target), measured in incident logs".

**[Rubric: Done-ness clarity]** — D10 chatbot has no acceptance bounds (§7.4 D10)
The PRD specifies "a resident asks a plain-language question and gets a direct answer" and nothing else: no grounding source (D2 listings only?), no behaviour for emergency-sounding questions (the PRD insists elsewhere on 911 first: D7, E2 "Other", E6), no languages, no "I don't know" behaviour, no labelling as automated. In a product whose risk table rates AI content "High until checked", this is an open-ended liability.
Fix: Constrain D10: answer only from D2/D3/D7 content with citations to listings, surface 911 for urgent intents, label it as automated, cover launch languages or a named subset, and fall back to the D2 search.

**[Rubric: Scope honesty]** — Open questions block Must requirements without being linked to them (§12 vs. A1, A2, A7, A10, A12)
Architecture will design around undecided inputs without knowing it.
Fix: Tag each blocking OQ with the FR IDs it gates and a decision-by date; mark the gated FRs `[BLOCKED BY OQ-n]`.

**[Rubric: Downstream usability]** — Channel/platform model contradicts itself (§ A2 "by push notification (app)"; §9 "Downloads"; P2 "No web application or mobile application required"; N3 "Works in an ordinary phone browser without installing anything"; §4 note "A PA system is not included in the CVH's channel set" vs. §4 Success state "(text, audio, app, PA, print)" and Non-Users "(PA, print, SMS, ambassadors, in-person)")
Architecture cannot tell whether to build a native app, a PWA with web push (which on iOS requires home-screen install), or web plus SMS only, nor whether PA integration exists.
Fix: Add one channel table: channel, in or out of MVP, who it reaches, what it needs from the resident (install, sign-up, nothing). Remove PA from §4 Success state and Non-Users.

**[Rubric: Downstream usability]** — No consolidated role/permission model (§ scattered across A1, A10, C3, D9, E2, E4, F1, F8, F10)
Implied roles: anonymous resident, SMS subscriber, trusted helper, ambassador (building-scoped), Hub staff, Hub approver/relay confirmer, partner org staff, space operator, registry-authorized user, moderator, drill enrollee, and future building management. Each is defined only by the FRs that mention it.
Fix: Add a role × capability matrix (post alert, approve, relay official, see registry, see check-ins, edit space status, moderate) with scoping (building, floor, organization).

**[Rubric: Downstream usability]** — Data classification and registry boundary ambiguous (§ A2, A12, C1, C4, N5)
N5 says groups/building/floor "are stored centrally only as part of a text subscription". An SMS subscriber who ticks "seniors" or "would like a check-in" is therefore centrally stored with vulnerability-adjacent attributes, which is functionally registry data. C1 says the check-in request "is part of the same choice" as the registry opt-in. It is unclear whether SMS subscriptions fall under C3/C4 (separate storage, role-restricted, privacy review first).
Fix: Define data classes and state for each: storage location, retention, who can read it, and whether the privacy-review precondition (§10) applies.

**[Adversarial]** — H-1. Floor-level targeting relies on self-declared, unverified, and sometimes deliberately "other" floors (§7.1 A1, A9, A12, §7.5 E2)
Floors are chosen by the resident with no verification. A9 even encourages "Following a relative's building as well as one's own". So "residents on floor 12" means "people who said they care about floor 12". The PRD doesn't define the building/floor data model: tower vs. street address (several complexes have multiple towers per address), skipped floor 13, mezzanines, ground vs. lobby, basements and parking levels. The flood and parking-garage cases are in scope, yet A12 has no way to choose them. Wrong-floor targeting means someone doesn't get an alert they needed and someone else gets one they didn't.
Fix: Define a canonical building/floor registry maintained by the Hub, including non-residential levels. Keep "lives here" separate from "follows". Target "lives here" first. Write a requirement for how an ambassador picks floors that matches the building's real numbering.

**[Adversarial]** — H-2. Direct contradiction on the PA system (§4 Note ("A PA system is not included in the CVH's channel set") vs. §4 Success state ("text, audio, app, PA, print") vs. §4 Non-Users ("multi-channel design (PA, print, SMS, ambassadors, in-person)") vs. §6 Out of scope ("Replacing ... the PA system"))
The PRD tells the architect three different things about the PA system.
Fix: State once: "The PA system is outside the CVH. The CVH gives ambassadors/management a PA script in each language." Remove PA from the success state and Non-Users.

**[Adversarial]** — H-3. "No app required" vs. push notifications, "Downloads" and the channel list (§5 P2, §8 N3 ("without installing anything"), §7.1 A2 ("push notification (app)"), §9 ("Downloads, logins"))
Web push on iOS works only after the site is installed to the Home Screen. That is an install. There is no native app in scope, so "Downloads" measures nothing, and "logins" contradicts anonymous use (P3). Either there is an installable PWA or native app (and P2/N3 are softened), or push isn't a guaranteed channel on iPhones.
Fix: Declare the app form factor (PWA with optional install). State that push is best-effort and SMS is the guaranteed channel. Replace the "Downloads" metric with "installed PWAs / push subscriptions / SMS subscriptions".

**[Adversarial]** — H-4. Check-in deletion at "disruption close" conflicts with recovery support (§7.3 C5 vs. C7; §8 N5; §2 (fires: "roughly 40 units remained vacant"))
C5: "Keep working after the first response ends. The registry supports check-ins during recovery." C7: "Individual check-in records are deleted when the disruption closes." Who closes a disruption, and when? The fires in §2 showed that institutions "close" long before households recover. If the Hub closes the disruption, C7 wipes the very records C5 says must survive. The PRD's founding story is the failure mode its own rule reproduces.
Fix: Define disruption lifecycle states (active, recovery, closed) and who can move between them. Keep check-in records through recovery with a hard maximum retention. Delete at "closed" only after an explicit review that no household is still unresolved.

**[Adversarial]** — H-5. The fire-recovery problem needs cross-organization sharing of household data, which the PRD forbids without resolving it (§2 (fire narrative: "organizations could not share information with one another"), §7.6 F1 ("ordinary conversation, each attributed to both the organization and the person"), §8 N8, §12)
The motivating problem is that insurers, condo boards, property managers, the Red Cross and the City couldn't share *household-level* information. The CVH's partner space allows "ordinary conversation". Partners will therefore paste names, units, family situations and health details into it, because that is how coordination works. None of that is scoped, consented, retained or governed. N8's governance framework is a Must with no content, and it depends on "data-sharing agreements" that §12 leaves open. Either the partner space holds personal information (a major privacy regime and a PHIPA risk), or it can't solve the problem in §2.
Fix: Decide explicitly: "The partner space must not contain identifiable resident information. Case-level coordination happens in partners' own systems under their own agreements". Enforce this with UI warnings, moderation and retention. Or scope a consent-based referral mechanism with a legal basis. Either way, rewrite §2's promise to match.

**[Adversarial]** — H-6. Relaying Alert Ready / Amber Alerts: terms, duplication and fatigue (§7.1 A10, §1, §11 (relay row), §10, §12)
Amber Alerts aren't disruptions, and no co-design session is cited for them. Alert Ready content comes via the NAAD feed, which has redistribution conditions. A10 requires "the official wording is never edited" and also that "Known alert types carry a pre-written template in every launch language, with the official text one tap away". So the resident sees the template first, not the official wording. That is an edit in all but name. Relaying Amber Alerts by SMS to tens of thousands of numbers duplicates the wireless public alerting they already receive, costs money on every send, and feeds the notification fatigue A9 says drives abandonment. A10 is a Must that depends on terms §12 lists as open.
Fix: Downgrade A10 to "Should" pending written terms. Exclude Amber Alerts from SMS. Clarify that the template is labelled "Hub summary of official alert" and that official text is shown verbatim alongside it. Add the relay latency target and fallback when no Hub person is available (see C-3).

**[Adversarial]** — H-7. "Verified by the Hub" creates liability no one has accepted (§5 P6, §7.1 A5, §7.5 E2)
The Hub verifies ambassador posts, often remotely, which means relying on the ambassador's word. "Verified by the Hub" on a wrong evacuation or water-safety message transfers reliance, and so liability, to the Hub. The PRD doesn't define what verification *means* operationally (seen in person? second source? phone call to the super?). A5 says residents can find out "what 'verified' means" but doesn't say what it means.
Fix: Define the verification standard for each disruption type. Get legal and insurance sign-off on the verification claim and the terms of use. Consider "Confirmed by [role] at [time]" wording, which says what was confirmed, instead of an unqualified "Verified".

**[Adversarial]** — H-8. Fire and evacuation posts wait for approval, and the PRD never tells residents not to wait for the CVH (§7.5 E2, §7.1 A3, §7.4 D7)
Fire alarm and evacuation posts "wait" for Hub approval. That is sensible for a text broadcast. But no requirement says that during a fire the CVH must actively tell residents to follow the building alarm and fire service instructions rather than wait for a CVH message. If residents learn that the CVH is where building news comes from, some will check their phones instead of leaving. Lac-Mégantic and Grenfell-type "stay put vs. leave" confusion is exactly the kind of harm here.
Fix: Add a requirement that the fire guide, onboarding and every fire-type alert template put "Follow the alarm and firefighters' instructions. Do not wait for a message from the CVH" first. Add a test in the fire drill.

**[Adversarial]** — H-9. Drills can leak to residents, and a single operator can broadcast to everyone (§7.6 F10, §7.1 A10, F2)
F10 drills cover "targeting" and "activation" but must "never [reach] residents". The same pipelines send real SMS. The 2018 Hawaii false missile alert happened because a single operator picked the wrong template in a shared system. The PRD requires one Hub person to confirm relays and activations, with no second-person rule, no "exercise" environment separation, and no send preview showing recipient counts.
Fix: Require drills to run in a separate environment or tenant with no production SMS credentials. Require a two-person rule for any send above N recipients or to all neighbourhoods. Show a mandatory preview with recipient count and language breakdown before every send.

**[Adversarial]** — H-10. Throughput, SMS cost and Unicode segmentation are unanalyzed (§8 N4, §7.1 A2, A3, §10 (SMS cost), §12 ("SMS gateway costs at neighbourhood scale"))
N4 ("stay up and stay fast", "handle a whole neighbourhood") has no numbers. Urdu, Pashto, Dari, Bengali, Tamil, Gujarati, Punjabi, Hindi, Mandarin and Greek SMS are UCS-2 encoded: 70 characters per segment, not 160. Every alert carrying origin, verification label, time, valid-until, a tailoring line (A13), STOP instructions (A2) and a link is likely to run to 3 to 5 segments, multiplied by recipients and by updates (A7 running threads). Canadian throughput on long codes is low. Short codes need carrier (CWTA) approval with lead time. A 20,000-recipient alert could take a long time on a long code. No provider, cost model or throughput target is stated, but the goals depend on "within minutes".
Fix: Add quantified NFRs: peak concurrent web users, SMS recipients per alert, maximum time to deliver to 95% of recipients, and maximum segments per alert per language. Do the SMS provider and short-code decision *now*. Model cost per alert and per month under realistic update frequency.

**[Adversarial]** — H-11. Consent by "trusted helper" and minors are unresolved (§7.1 A2, A12, §7.3 C1, C2, §12 ("Age rules for youth users"))
A trusted helper can sign someone up, choose her groups and add her to the registry. A2's "the resident confirms the sign-up herself by replying" fails when the helper holds the resident's phone, which is common for seniors and exactly the design's target user. Controlling family members and abusers can enrol people into check-in lists (with a unit number) or remove them. Minors: no age gate on SMS sign-up, the registry, content submission (D9) or incident reports. School-age children are likely users of shared family phones. Age rules are an open question, yet the Must features go ahead without them.
Fix: Define a helper-consent protocol (recorded consent, confirmation delivered through a second channel or by an ambassador in person, easy unilateral withdrawal). Set a minimum age for SMS/registry/contribution, or ban under-16 registry entries, before build.

**[Adversarial]** — H-12. The disability gap in groups undercuts the "anchored on" population (§4 ("Design is anchored on ... residents with disabilities"), §7.1 A1, A12 (groups: seniors, newcomers, families with young children, check-in))
The elevator-outage harm in §2 falls hardest on residents with mobility impairments. Yet no group lets someone say "I can't use stairs". Only "seniors" and "check-in" come close. Either this is a deliberate data-minimization choice (then say so and explain how elevator outages reach them) or it is a gap. Adding it creates sensitive health-adjacent data (see C-5).
Fix: Decide explicitly. For example, add "need help if the elevator is out" as a functional need, not a diagnosis, with the same controls as check-ins. Document the choice.

**[Adversarial]** — H-13. The language set leaves out languages the PRD's own background names (§2 ("Urdu most of all, followed by Pashto, Tagalog, Farsi, and Gujarati"), §8 N1)
§2 names Farsi among the top Thorncliffe languages. N1 lists Dari but not Farsi. They are mutually intelligible but not identical in script conventions and register, and assuming one covers the other is a political and trust risk. Arabic isn't in N1 at all, despite a notable Arabic-speaking newcomer population in these neighbourhoods. Spanish, Mandarin and Hindi are included without justification from §2. Punjabi script and Mandarin form are still open (§12) even though audio and templates are Musts.
Fix: Publish the evidence behind N1 (census home-language counts for the 34 buildings plus co-design input). Explicitly decide on Farsi and Arabic. Resolve the scripts before templates are commissioned.

**[Adversarial]** — H-14. Non-smartphone, low-literacy residents get less than the PRD claims (§5 P2, §7.1 A14 (voice deferred), §8 N3 ("No feature depends on owning a smartphone"), §7.2 B1, §7.4 D2)
N3 is false as written. The "need help" tap (B1), one-tap confirm (A8), the directory (D2), the map (D3), audio alerts (A3), check-in requests (A12) and forwarding (A11) are all web features. Text-keyword paths exist only for STOP, groups and check-in withdrawal. With voice deferred (A14), a resident who can't read SMS comfortably in her own script has *no* direct channel. She depends on an ambassador who may not exist on her floor (E5). For that resident the "multi-channel" claim reduces to "a neighbour might knock".
Fix: Rewrite N3 honestly: list which functions have an SMS-keyword equivalent (at minimum: confirm, need help, check-in request, subscribe, stop). Pull a minimal IVR/call-in line (A14 "a number residents can call to hear the latest alert") into scope, since it's cheap compared with the rest of §7.6.

**[Adversarial]** — H-15. Moderation capacity across 15 languages is assumed (§5 P7, §7.4 D3, D9, §7.5 E4, §8 N7)
D9 says "Nothing appears without review". D3 is "maintained by ambassadors and community contributors with a moderation layer". E4 is a "lighter-touch" path. Who reads a Tamil or Pashto submission? What is the review SLA? What happens to the queue during a disruption, when moderators are busy with alerts? N7 wants "a moderation plan ... before launch" but gives no staffing or language coverage.
Fix: Specify moderator roles, languages covered, SLA, and behaviour when a language has no moderator (e.g., held with a notice, or accepted as "unreviewed" with a label).

**[Adversarial]** — H-16. Post-pilot funding and ownership are unknown, and the mitigation is circular (§11 ("The CVH cannot be maintained after the pilot", High), §12 (post-pilot funding, sponsorship), §8 N6)
The mitigation for "cannot be maintained" is "sustainability planned in the pilot". That doesn't reduce anything. Recurring costs (SMS, hosting in Canada, translation updates, 24/7 operations, moderation, security patching of a forked open-EWS) have no owner. A life-safety-adjacent channel that residents learn to rely on and that then disappears is worse than never launching. Sponsorship (§12) collides with P7's "never a marketplace or advertising channel".
Fix: Before the build, name the legal owner and operator after the pilot, a costed run budget per year, and a documented shutdown plan (notify subscribers, return or delete data, hand over to another channel) if funding lapses.

**[Architecture readiness]** — HI-1. Outreach registry: data model, field-level access and the meaning of "stored separately" (§ 7.3 C1–C7; 8 N5, N8; 10 (privacy precondition))
C4 says "Store registry data separately from everything else". That could mean a separate schema, a separate database, a separate encryption key, or a separate hosting tenant. C1 limits fields to contact, language and groups; C6 adds a check-in method plus a unit number "only for a knock". C3 does not say which roles see which fields, whether access is audit-logged, whether break-glass access exists, or how C2 tickets are triaged. C4 deletion "at any time" needs a defined path (SMS keyword? web? via a helper?). C7 deletion "when the disruption closes" conflicts with C5 "Keep working after the first response ends" for recovery check-ins. The privacy review is a precondition to collecting any of this.
Status: Vague
Question for PO: "Define the registry fields, which roles can read each field, whether every read is logged and reviewable, and what 'stored separately' requires (separate database and encryption key, or a logically separate table?). During a long recovery (C5), when does a check-in record count as 'closed' and get deleted?"
Label: Phase-blocker (for the registry subsystem only; the rest can proceed)

**[Architecture readiness]** — HI-2. Security threat model: spoofed alerts, operator takeover, SMS abuse (§ 5 P6; 7.1 A2, A5, A11; 7.5 E2; 7.6 F10; 11)
A trust-critical broadcast system has obvious threats the PRD never names. (1) A spoofed SMS alert impersonating the CVH sender. (2) Faked "forwarded" alerts in WhatsApp: A11 says forwards must be "useful without its link", so the text itself carries the "Verified by" claim and is trivially forgeable. (3) Takeover of an ambassador or Hub account leading to a building-wide SMS (E2 direct posts go out before review). (4) SMS pumping or toll fraud through the unauthenticated sign-up form (A2). (5) Registry exfiltration. (6) A drill leaking to residents (F10). No requirements exist for rate limits, send quotas, second-person approval for large sends, audit logs, or incident response.
Status: Silent
Question for PO: "Which of these must v1 mitigate, and how strictly: two-person approval above a recipient threshold, per-ambassador send limits, mandatory MFA, CAPTCHA or rate limits on SMS sign-up, and a verification page residents can check a forwarded alert against? Who is the security incident contact?"
Label: Can-defer (the architect proposes controls; the PO confirms thresholds)

**[Architecture readiness]** — HI-3. 24/7 operations: approvals, moderation, stale flags and support (§ 5 P6; 7.1 A7; 7.5 E2; 7.4 D9; 10 ("The Hub can approve … at any hour"); 7.6 F8)
E2 holds fire and evacuation posts and "Other" posts for Hub approval. §10 assumes the Hub can approve "at any hour". Nothing says whether the Hub is actually staffed 24/7, what the approval SLA is, or what happens if no approver responds (stuck forever? escalate? auto-release?). Stale-alert (A7) and stale-space (F8) flags "to staff" need an on-call target: email, SMS or pager. There is no resident support channel and no technical on-call owner.
Status: Vague
Question for PO: "Is there a 24/7 Hub approver rota? If an approval-required post gets no response within X minutes, should it escalate to another approver, go out as 'Not yet verified', or stay held? Who gets stale-alert notifications and technical outage pages outside business hours?"
Label: Can-defer (build configurable escalation; the PO sets policy before launch)

**[Architecture readiness]** — HI-4. Offline, low-bandwidth and power-outage behaviour (§ 8 N3; 7.3 C7; 4 (outage scenarios); brief A-04)
N3 says "Key information is still readable if the connection drops" without saying which information (the latest alerts? the essential numbers D7? guides? the directory?), how stale it may be, or the storage budget on older phones. C7 requires check-in rounds "without signal", which means offline queue plus sync plus conflict rules (two ambassadors marking the same door). Behaviour during a building power outage (Wi-Fi down, cell congestion, low batteries) is not stated. SMS is the implicit fallback, but that is not written down.
Status: Vague
Question for PO: "Which content must be available offline on a phone that has opened the CVH before (latest alerts for her building, essential numbers, the 6 guides, spaces-open list?), and how old may it be? For offline check-in rounds, if two ambassadors record different outcomes for the same resident, which one wins?"
Label: Can-defer (assume a PWA service-worker cache of alerts, numbers and guides, last-write-wins with audit)

**[Architecture readiness]** — HI-5. open-EWS and ADMS adoption depends on an unrun spike (§ 8 N6; 10 (spike bullet); 11 (open-source row); 7.4 D3)
N6 fixes the base components ("open-EWS for sending alerts … ADMS model for the community directory"), but §10 makes this conditional on a spike with "a go/no-go decision per component". The architecture spine changes a great deal if open-EWS cannot do floor or group targeting, two-way SMS, 15-language templates or Canadian hosting.
Status: Clear intent, outcome unknown
Question for PO: "Can the open-EWS and ADMS spike run as the first architecture task, and if either component fails, is building or buying an alternative within scope and budget?"
Label: Can-defer (run the spike first in the architecture phase; record a fallback)

**[Architecture readiness]** — HI-6. Audio versions: recorded or synthetic, and for which content (§ 7.1 A3; 8 N1, N2; 5 P1)
A3 requires "an audio version in every launch language" for templates. N2 says "supports audio versions of announcements". This could mean human-recorded audio for 7 templates × 15 languages (105 or more recordings), or text-to-speech for every alert, including free text. TTS quality varies for Pashto, Dari and Gujarati, and a TTS vendor raises data residency (CR-4). P1 also mentions "video with captions", which implies media hosting.
Status: Vague
Question for PO: "Is audio required only for the pre-written templates (recorded once by people), or for every alert and announcement (which needs text-to-speech in all 15 languages)? Is video in scope for v1, and who produces it?"
Label: Can-defer

**[Architecture readiness]** — HI-7. SMS content constraints, two-way keywords and consent law (§ 7.1 A2, A12, A13; 7.3 C6; 12 (keywords per language))
The PRD requires inbound keywords (STOP, change groups, withdraw check-in, "what verified means") in each launch language, but those are an open question (§12). The system needs a multilingual keyword parser, and the list must be fixed early for carrier registration. UCS-2 segment limits constrain message length (A13 adds "one line" of tailoring). "Someone else signed her up" plus reply-to-confirm is double opt-in; consent-record retention for CASL is not specified.
Status: Vague
Question for PO: "Do STOP and the other keywords need to work in all 15 languages at launch or only in English and French? What is the maximum SMS length (in segments) we may send per alert? How long must we keep proof of each subscriber's consent?"
Label: Can-defer

**[Architecture readiness]** — HI-8. Success metrics conflict with data-minimisation choices (§ 9; 7.1 A11; 7.6 F12; 8 N5; 5 P3)
§9 requires "Statistics by language, age, and building", but age is never collected, and groups and building stay on the device for non-SMS users (P3, N5). "Downloads" presumes a native app (CR-1). "Reactions" is not a feature. "Sharing is not recorded" (A11) removes forwarding reach. The architect needs to know which events may be collected centrally, whether any analytics tool is allowed (residency), and whether client-side aggregate beacons (for example, "a device with building X opened alert Y") are acceptable.
Status: Contradictory
Question for PO: "Which metrics can we instrument centrally, given that building and groups stay on the device? Is an anonymous, aggregate usage event that includes language and building acceptable? If not, should 'by age' and 'by building' come only from the periodic survey?"
Label: Can-defer

**[Architecture readiness]** — HI-9. AI features: chatbot (D10) and meaning-based search (D2, N6) (§ 7.4 D2, D10; 8 N6; 11 (AI content row))
"Search matches on meaning" and a "chatbot-style query" imply embedding models and possibly an LLM. The model provider, hosting (a Canadian region?), the languages supported, guardrails (never giving emergency advice; 911 first), cost per query and logging of resident queries are all unaddressed. A wrong answer during a disruption is a safety issue.
Status: Vague
Question for PO: "Is D10 in the v1 build or deferred? For meaning-based search, may we use a hosted AI or embedding service, and if so must it run in Canada and never retain resident queries?"
Label: Can-defer

**[Architecture readiness]** — HI-10. Content integrations: Hub calendar, partner content, asset map (§ 7.4 D1, D2, D3; 6 (out of scope: "Re-typing content"); 10; 12 ("exact arrangement for connecting … the Hub calendar"))
D1 must be "connected to the Hub and partner sources rather than retyped", but the source systems (Google Calendar? a WordPress site? ICS feeds?), formats, update frequency and authentication are unknown. D3 depends on a partner asset-mapping deliverable ("end of August 2026"; its status as of 30 Sep is unknown) in the "ADMS data structure". Are these one-time imports or continuous syncs?
Status: Vague
Question for PO: "List each content source v1 must connect to (Hub calendar, each partner's services and programs, the asset-map output), with system and format (ICS, RSS, API, spreadsheet), and whether it is a one-time import or an ongoing sync. Has the asset-map dataset been delivered, and in what format?"
Label: Can-defer

**[Architecture readiness]** — HI-11. Retention and deletion schedule (§ 7.1 A7 ("archive where it stays readable"); 7.3 C4, C7; 7.6 F11, F13; 8 N5)
Only two retention rules exist (registry on request; check-ins deleted at disruption close). Missing: the alert archive (forever?), SMS subscriber records after STOP, consent logs, incident reports and their photos (B2), help signals (B3), the partner space conversation, the decision log (F11), audit logs, backups (deleted data persisting in backups), and drill records.
Status: Vague
Question for PO: "Please provide a retention period for each record type: alerts and archive, SMS subscriptions and consent, incident reports and photos, help requests, partner conversations and decision logs, audit logs and backups."
Label: Can-defer

**[UX reconciliation]** — H-1. [C] Ambassadors see unit numbers, but P4 says unit numbers are never visible to other residents (§ PRD P4 ("Names, unit numbers, and addresses are never visible to landlords, superintendents, or other residents"); PRD C6/C7. UX Section 6 ("Rashid, who is a resident who volunteers"); UX A-04 ("by floor and door"); UX F19 step 9 (ambassador adds "floor, door").)
Ambassadors are residents, and the knock method shows them door numbers. The PRD is inconsistent with itself (P4 against C6 and C7), and the brief makes the conflict concrete.
Fix: Amend P4 to name the exception: "…except the floor ambassador working a check-in the resident requested, for the duration of the disruption." Put the same carve-out in the data inventory (CR-1).

**[UX reconciliation]** — H-2. [C] P4 implies residents give a first name, but A2 and the brief say no name is ever collected (§ PRD P4 ("'First name Resident from Building X' in any shared space"); PRD A2 ("no name, unit number, email, password or account"). UX 3.2.1 ("No name, no unit number … anywhere"); UX F3 step 13. The brief has no resident-attributed shared space at all.)
P4 describes a resident posting surface that the brief does not have, and a data field (first name) that A2 forbids. Contributed map entries (UX 3.4.2) have no stated attribution either.
Fix: Rewrite P4 to fit v2: residents are never named on any surface; contributions show "Community contribution" or equivalent. Or, if a first name is wanted for contributions, add it to the data inventory as optional.

**[UX reconciliation]** — H-3. [C] "Level" means two different things, and the PRD never defines disruption levels (§ PRD Overview ("two levels of alert: official … and community"); PRD A10 ("each message opens with its level"); PRD F2/F3/F10 ("by disruption type and level"); PRD Overview ("Standard operating procedures will define which disruptions trigger which level of response"). UX 3.1.5 ("Two levels of alert"); UX O-18 ("Extreme heat — Level 2"); UX sample data ("The six disruption types at two levels"); UX P-13 grid.)
"Alert level" means official versus community. "Disruption level" means a severity or response tier, never defined anywhere: how many tiers, what the criteria are, who classifies. Activation (F2), drills (F10) and the P-13 grid all depend on it. The overview's split between "larger disruption triggers Hub and partner coordination" and "smaller one … surfaces the main building contacts" is another undefined tiering.
Fix: Rename the official/community distinction to "alert source" (or "alert origin"). Add a disruption-level definition to the PRD (e.g. Level 1 building, Level 2 neighbourhood or partner activation), or list it as an open question with an owner. Define who classifies a disruption.

**[UX reconciliation]** — H-4. [C] PRD F4 says ambassadors can see resources; the UX makes supplies partner-only and keeps ambassadors out of the partner app (§ PRD F4 ("visible to Hub staff, ambassadors, and partner organizations"). UX 3.6.6 ("Supply records are partner-facing only"); UX PA-81 ("supplies are visible to partners only"); UX Section 6 ("Residents and ambassadors have no route to any Hub, partner or readiness screen").)
Fix: Decide and align. Either remove "ambassadors" from F4, or add a read-only ambassador view of resource availability to 7.5. The brief's A-05, which reads the directory, may be enough.

**[UX reconciliation]** — H-5. [C] Machine-translated free text reaches residents inside alerts, but N1 requires human checks on alerts (§ PRD N1 ("Before production, people check alerts, announcements and interface text; listings, contributed entries … may use machine translation"); PRD A3 (templates human-checked). UX 3.1.4 ("Rashid types his optional line in Bengali; residents reading in any other language see it with the machine-translation label"); UX O-15 ("one line saying what changed"); UX O-02 ("message entered"); UX 3.1.1 ("Translation is never a step the operator performs").)
Correction lines, Hub free text in updates, and ambassador "Other" lines (which are *required*) are all alert content that has to be translated in real time into 15 languages. N1's rule cannot hold for them, and the PRD does not say what happens instead.
Fix: Add to N1: "Free-text lines in alerts (ambassador lines, corrections, update text) are machine-translated in real time and labelled; templates and tailored blocks are human-checked." Add the translation service to the architecture dependencies.

**[UX reconciliation]** — H-6. [C] The recovery-phase registry (C5) conflicts with deleting check-in records when a disruption closes (C7) (§ PRD C5 ("Keep working after the first response ends. The registry supports check-ins during recovery"); PRD C7 ("Individual check-in records are deleted when the disruption closes"); PRD Section 2 (about 40 units left unresolved after the fires). UX 3.7.2, PA-61; UX Section 11 ("After the disruption: recovery thread … Stories 3.8.1 to 3.8.4" out of cut).)
The fire-recovery case that motivates the product, displaced households followed for months, has no design. The deletion rule actively works against it.
Fix: Separate the heat and outage check-in round (ephemeral, deleted at close) from recovery follow-up (registry-based and consented, with retention stated). Put recovery (epic 3.8) on the roadmap explicitly.

**[UX reconciliation]** — H-7. [U] Ambassador identity, sign-in and assignment records are unspecified (§ UX Section 6 ("Ambassador screens sit inside the resident application under a role"; the two apps share "not … sign-in"); UX Assumption A4 ("an assignment record saying which buildings and floors each ambassador covers"); UX 3.1.4 ("Other buildings are still absent"). The PRD has no FR for ambassador accounts, onboarding, assignment or offboarding. PRD P3 and A2 stress "no account".)
The resident app is built around having no account, yet ambassadors need an authenticated role, an assignment and revocation. The Hub and partner app needs organisation and person accounts (UX 3.6.2, "Both names on every statement"). Neither appears in the PRD.
Fix: Add FRs covering ambassador accounts and assignments (who creates them, how they are revoked, how coverage E5 is derived), partner-organisation and person accounts for the Hub and partner space, and a role/permission matrix: resident, trusted helper, ambassador, Hub staff, partner author, partner coordinator, moderator.

**[UX reconciliation]** — H-8. [U] The brief's measurable time and performance targets are missing from the PRD (§ UX F14 ("Acknowledge in under two minutes"); UX PA-45 ("no more than four taps and one selection"); UX PA-47 ("three-building selection … under thirty seconds"); UX PA-53 ("ambassador building update … under one minute, one-handed"); UX Section 6 depth rules (e.g. "A hazard guide: two taps from home"). PRD A4 ("five to ten minutes"); PRD P5 ("never more than a few taps away"); PRD N4 (no numbers).)
Fix: Put the depth rules and the timing targets into PRD P5 and N-series as testable NFRs. Keep the community's 5–10 minute benchmark as the outcome and the 2-minute target as the operator-task target.

**[UX reconciliation]** — H-9. [U] The brief's accessibility and visual floors go beyond N2 and are not recorded in the PRD (§ UX Section 9 (body text ≥18 px, alert text ≥20 px, basic mode 22 px with at most five items per screen, 7:1 contrast target for alerts and basic mode, 44×44 px targets, 200% resize, a reserved status palette); UX Section 10 (per-block language declaration, no timeouts, keyboard paths, "Works on an older Android handset"); UX RTL rules (numerals decided per language). PRD N2 ("WCAG 2.1 AA … simplified basic mode").)
Fix: Extend N2 with the non-negotiable floors: basic-mode definition, minimum sizes, contrast target, language tagging, no-timeouts, and a reference device and connection profile. Put the rest in the design system.

**[UX reconciliation]** — H-10. [U] The moderation time budget and the Q2 bound shape the design but are neither requirements nor confirmed (§ UX 3.4.3 ("A realistic week of submissions can be cleared within the moderation time the Hub has committed" — adopted, Q2); UX Assumption A2 ("Priya has roughly twenty minutes a week … a number nobody has confirmed"); UX PA-68. PRD P7, D9, N7 (a moderation plan and named owner, with no capacity bound). PRD Section 12 does not list this.)
Fix: Add the Q2 bound to D9 or N7, and add "Hub moderation time committed per week" to PRD Section 12 with an owner. The size of the contribution form depends on it.

**[UX reconciliation]** — H-11. [G] Several everyday-layer Musts have no UX: calendar, weekly summary, hazard directory, education content (§ PRD D1 (Must, calendar and cultural or religious dates), D4 (Must, hazard directory), D5 (Must, weekly summary), D6 (Must, live status), D8 (Must, quizzes, workshop listings, practice runs). UX Section 11 ("Consolidated calendar; weekly summary; live status view; hazard directory — PRD D1, D5, D6, D4" out of cut). The brief has no mention of D8. UX RQ6 ("Is there a reason to open the CVH on an ordinary Tuesday") is tested without these features.)
The PRD's everyday-use thesis, and its User Flow ("sees her building's status … and this week's 2–4 minute summary"), rest on features that were never prototyped. The brief's home screen, with destinations Now, Find help, Map and Be ready, has no place for a calendar or weekly summary. Adding them later breaks the "four destinations and no more" rule.
Fix: Decide now where D1, D5 and D8 live in the information architecture, then either extend the brief or downgrade them. Flag in PRD Section 6 that RQ6 was tested without them.

**[UX reconciliation]** — H-12. [C] Success metrics need data the product deliberately refuses to collect (§ PRD Section 9 ("Representative use across languages, ages, buildings, and abilities … Statistics by language, age, and building"; "Downloads, logins"). UX 3.1.3 ("No age field, no household composition … The absence is the design"); UX A-series (no account, no install); UX 3.6.11 ("Trust and usefulness are measured by asking").)
Age and ability can come only from surveys. Downloads and logins do not exist in an installation-free product without accounts.
Fix: Rewrite the Section 9 "How" column: age and ability come from the periodic survey only; replace downloads and logins with web visits and SMS subscribers. Align the metrics with the P-15 indicator list (UX 3.6.11).

**[UX reconciliation]** — H-13. [C] Requirement IDs collide across the two documents, and the brief's traceability is stale (§ PRD F1–F13 (partner coordination) against UX F1–F27 (flows); PRD A1–A14 against UX Assumptions A1–A13 (the UX O6 row cites "A6" meaning its own Assumption A6); PRD Q-style references ("Brief decision Q7") against UX RQ, Q and O sets. The UX story table still maps 3.1.7 → "A5 (new, TBC)" (PRD is now A11), 3.2.6 → "A1, A2 (new, TBC)" (now A12), 3.2.7 → "A1, A3 (new, not yet in backlog)" (now A13), 3.4.4 → "D3 (new, TBC)" (now D3/F8), 3.5.4 → "D7, A9 (new, TBC)" (now D12), 3.6.x → "7.6 (new, TBC)" (now F1–F13), 3.7.x → "C-series (new, TBC)" (now C6, C7, E6). UX O9 lists backlog updates still pending.)
Fix: Prefix the IDs: PRD `FR-A1`; UX `FLOW-1`, `ASM-1`, `DEC-Q1`, `OPEN-O1`. Issue a brief v9 traceability refresh against PRD v2 numbering, and confirm that the backlog updates in UX O9 are done before stories are cut.

### Medium (54)

**[Rubric: Decision-readiness]** — Scope-vs-capacity tension not surfaced (§6, §8 N6)
N6 commits to "Custom code is kept small so a small team can maintain the CVH". The Musts include a separate Hub/partner application (F1, N6), activation and triggers (F2/F3), an automated coverage view (F6), semantic search (D2), an asset map with live space status (D3/F8), and on-device tailoring (A13). The PRD never names this tension or what would be cut first.
Fix: State the de-scope order explicitly, for example "if the open-EWS/ADMS spike fails, F-section Musts drop to F1+F8".

**[Rubric: Strategic coherence]** — Success metrics measure activity, carry no targets or counter-metrics (§9)
"Downloads, logins", "return visits", "reactions" measure activity. "Targets will be set … once a baseline exists" leaves the pilot with no pass/fail line. No counter-metrics cover opt-out/STOP rate, alert corrections/withdrawals, or unverified posts later withdrawn.
Fix: Replace "Downloads" with web-app reach (unique devices, SMS subscribers by language and building). Add at least two counter-metrics (STOP/unsubscribe rate after alert bursts; share of ambassador posts corrected or withdrawn). State a provisional pilot threshold for the core hypothesis metric.

**[Rubric: Strategic coherence]** — Building-level delivery, the stated reason the CVH exists, is hedged throughout (§2 "at the level where disruption is actually lived: the building and the floor"; §3 Goal 1 "if possible building"; §4 "if information is publicly available"; D6 "for each building (if possible)")
The PRD never says what makes it "not possible": no data source, no ambassador coverage, or policy. Architecture cannot tell whether building/floor granularity is a core data model or an optional field.
Fix: Make building/floor a first-class entity. State that status is populated by ambassadors/Hub (E2, B2) and shown as "no report" where there is no coverage (ties to E5).

**[Rubric: Done-ness clarity]** — Must FRs whose done-ness depends on external artifacts (§ A3, D7 "checked by people before production"; D2 "Connected to the neighbourhood asset map … (expected completion end of August 2026)"; D3 "Built on the ADMS data structure")
Done is defined by work outside the build. The asset-map date has already passed at this PRD's date (2026-09-30) with no status given.
Fix: State the acceptance condition the build owns (e.g. "imports ADMS-format records; displays source and confirmation date"), and update the asset-map dependency status.

**[Rubric: Done-ness clarity]** — Semantic search has no quality bar (§ D2 "Search matches on meaning as well as keywords"; N6)
The quality bar is untestable as written, especially across 15 languages and mixed scripts.
Fix: Define a small acceptance set (N representative queries per launch language with expected top-3 results) or scope semantic search to named languages.

**[Rubric: Scope honesty]** — Assumptions not tagged inline or indexed (§10)
For example, E2/A10 rest on the "at any hour" assumption, and C7/E6 on "Ambassadors are willing and able", but nothing at the FR links back to them.
Fix: Number the assumptions (AS1…) and cite them inline at the FRs they underwrite.

**[Rubric: Scope honesty]** — Pilot parameters absent
The PRD never states pilot duration, launch date, the number of buildings or ambassadors in the pilot, or whether both neighbourhoods launch at once (§10 says "from the start" but gives no size). These drive capacity, SMS budget (§10 bullet 9) and the size of the partner space.
Fix: Add a short "Pilot envelope" subsection.

**[Rubric: Downstream usability]** — "In v2:" markers conflate document version with product scope
"v1" means the MVP (§6 "In scope (v1)"), but "In v2:" inside FRs (A1, D2, D3, D7, E2, F4; §4 rows) means "added in document version 2". A reader can easily take it as "product v2 / post-MVP".
Fix: Remove the inline "In v2:" prefixes and rely on §14 for change history, or rename them "(added in PRD rev. 2)".

**[Rubric: Downstream usability]** — User journeys too thin for a multi-stakeholder product (§4 "User Flow")
Only two compressed resident flows exist, with a pronoun protagonist ("her") and no name or context. There are no journeys for an ambassador posting and running a check-in round, a Hub coordinator opening a shared space and activating teams, a partner joining "six hours in" (F6), or a trusted helper signing someone up (A2, A12, C1).
Fix: Add 4–5 short journeys with named protagonists (e.g. a senior on a high floor in Thorncliffe; an ambassador in a Flemingdon condo; a Hub on-call coordinator; a partner staffer).

**[Rubric: Downstream usability]** — External references don't resolve inside the PRD (§14 "Brief decision Q7", "O13", "Backlog 3.3.6"; §12 "backlog story 3.3.6")
The architect cannot follow these without the companion documents.
Fix: Link or path the companion docs once, and give one-line context for decisions an architect needs (e.g. Q3 separate partner app).

**[Rubric: Shape fit]** — Dual audience not separated (§1 "written for review by the Community Experts Board"; §13)
Plain language for the community is the right call, but architecture needs precise tables that would clutter the Board read.
Fix: Add an "Engineering annex" (or addendum.md) holding the role matrix, data classes, channel table, NFR numbers and a configurable-parameters table, and cross-reference it by FR ID.

**[Adversarial]** — M-1. Tailoring transparency contradicts P10 (§5 P10 ("never shows why she received an alert"), §7.1 A13 ("Residents can see what the tailoring is based on"))
These contradict each other, and the tailoring line itself leaks the reason. A "one line" of heat advice for seniors in an SMS tells anyone reading the phone that she is flagged as a senior.
Fix: Define precisely what the resident sees (on her own device, behind a tap, never in SMS). Require tailoring lines to be written so they don't imply group membership. Test with the Community Experts Board.

**[Adversarial]** — M-2. "Colour-coded" status contradicts "never relies on colour" (§7.4 D6 ("colour-coded: red ... amber ... green"), §7.1 A5 ("never relies on colour"), §8 N2 (WCAG 2.1 AA))
Fix: D6 must pair every colour with a text label and icon. Say so in D6.

**[Adversarial]** — M-3. Success metrics need data the PRD forbids collecting (§9 ("Statistics by language, age, and building"; "logins"; "reactions"), §5 P3, P9, §8 N5)
Age isn't collected (groups are optional and not ages). Building is device-only for non-SMS users. "Reactions" are never defined as a feature, and comments are out of scope (§6). "Logins" contradicts no-account use. The core hypothesis ("Is the CVH alive between emergencies?") can't be measured as specified.
Fix: Specify privacy-preserving analytics (aggregate, on-device-bucketed, opt-in surveys) and drop metrics that can't be collected. Define the analytics stack and its residency.

**[Adversarial]** — M-4. No targets means no pilot verdict (§9 ("Targets will be set ... once a baseline exists"), §12)
With no targets, no pilot duration and no decision criteria, the pilot can't fail, so it can't succeed either.
Fix: Set provisional targets and a decision date now. Revise them once the baseline exists.

**[Adversarial]** — M-5. The acknowledgement benchmark can't be measured (§7.1 A4 ("within five to ten minutes of a disruption starting"))
The CVH can't know when a disruption *started*. It knows only when someone reported it.
Fix: Measure from the first report or official alert received by the CVH, to the first resident-visible acknowledgement. State percentile targets.

**[Adversarial]** — M-6. Crowd confirm/flag can be gamed or can wrongly close incidents (§5 P6, §7.2 B4, §7.4 D6)
"Flag that it appears resolved" with no identity lets one person (or a landlord's agent) mass-flag an unresolved elevator outage as fixed, turning the status green. Flags without authentication are trivially spammable.
Fix: Resident flags only prompt an ambassador or staff check. They never change status by themselves. Rate-limit and dedupe per device or number.

**[Adversarial]** — M-7. Incident report photos and content are unmanaged privacy leaks (§7.2 B2 ("optional photo"), §6 ("ambassador posts keep an optional photo"))
Hallway and unit photos capture faces, unit numbers and people's homes. No EXIF stripping, face-blur guidance, retention or visibility rule is given.
Fix: Strip metadata. Photos are visible to Hub/ambassadors only unless approved. Set a retention period. Add capture guidance.

**[Adversarial]** — M-8. Directory filters on immigration and ID status risk exposure through logs (§7.4 D2 ("whether ID or immigration status is asked for"), D10 (chatbot), N6 (semantic search))
Search queries like "food bank no ID" or "legal aid refugee claim" are sensitive. Semantic search and chatbot providers may log them outside Canada.
Fix: Require no server-side logging of search and chatbot queries (or aggregate-only), and in-Canada model hosting. State this in the NFRs.

**[Adversarial]** — M-9. A chatbot giving service and eligibility answers is an unguarded hallucination risk (§7.4 D10)
A plain-language "direct answer" about eligibility, hours or immigration requirements, wrong once, harms trust and people. It isn't mentioned in the risks table.
Fix: Answers must only quote directory listings with source and date, and must refuse otherwise. Or defer D10.

**[Adversarial]** — M-10. The partner-space audit trail doesn't cover the resident app (§7.6 F11 (decision log), §7.5 E2, E3, §7.3 C3)
A decision log exists for partners. No audit log is required for who sent, approved, withdrew or viewed registry records.
Fix: Add an immutable audit-log NFR covering sends, approvals, registry access and exports, with its own retention period.

**[Adversarial]** — M-11. Identity and access management is undefined for every non-resident role (§7.3 C3 ("named, authorized people"), §7.5, §7.6, §8 N5)
Fix: Specify how ambassadors, Hub staff and partner users are provisioned, authenticated (MFA), reviewed periodically and offboarded, and who approves role grants.

**[Adversarial]** — M-12. Shared phones and cleared devices break device-held choices (§5 P3, §7.1 A12, §8 N5)
"Families with basic phones" (§4) share numbers and devices. One SMS subscription carries one language and one floor. Private browsing or cleared storage silently erases web choices, so the resident stops getting relevant tailoring without knowing it.
Fix: Allow more than one language per SMS subscription (or bilingual messages). Show a visible "your settings" state so loss is noticed.

**[Adversarial]** — M-13. Unratified dependencies are treated as Musts (§7.4 D2, D3 ("Built on the ADMS data structure", asset map "expected completion end of August 2026"), §8 N6 (open-EWS), §10)
Today is 2026-09-30. Did the end-of-August asset map deliver? "ADMS" is never defined. The open-EWS spike hasn't happened, yet N6 fixes the architecture on it.
Fix: Update the dependency status. Define ADMS. Make N6 conditional on the spike result, with a named fallback.

**[Architecture readiness]** — ME-1. WhatsApp integration scope (§ 1 Overview ("connects existing channels"); 6 Out of scope; 7.1 A11; 12)
A11 (share-sheet forwarding) is clear. It is unclear whether the CVH should also *post* into community WhatsApp groups or offer a WhatsApp subscription channel (implied by the §12 API cost question). The WhatsApp Business API cannot post into ordinary groups.
Status: Vague
Question for PO: "Is WhatsApp limited to residents forwarding via the share sheet in v1, or do you expect the CVH to send alerts over WhatsApp as a subscribed channel?"
Label: Can-defer

**[Architecture readiness]** — ME-2. Building, floor and neighbourhood master data (§ 2; 7.1 A1, A12; 7.5 E5; brief R-05 ("My building isn't listed"))
Someone has to supply the list of about 34 buildings, their addresses, floor counts, and which neighbourhood each belongs to, and keep it maintained. Mixed-use and townhouse complexes and "not listed" handling need a rule.
Status: Silent
Question for PO: "Who provides and maintains the authoritative building list (address, floors, neighbourhood), and what happens when a resident's building isn't on it?"
Label: Can-defer

**[Architecture readiness]** — ME-3. Help-signal and incident routing rules (§ 7.2 B1–B3; 7.5 E1)
B3 says "Route … to the right ambassador or staff member … and track that follow-up happened", without saying how "right" is determined (floor assignment → building ambassador → Hub?), the escalation timers, or what happens when no ambassador is assigned.
Status: Vague
Question for PO: "What is the routing order for a help signal (floor ambassador, building ambassador, Hub), and after how long without acknowledgement does it escalate?"
Label: Can-defer

**[Architecture readiness]** — ME-4. Configurable thresholds still unset (§ 7.1 A7; 7.6 F8; 12 ("The numbers still to set"))
Stale-alert periods per type, the space-status confirmation period and the small-group threshold are open. They can be configurable, except for the small-group threshold (see CR-6).
Status: Vague (acknowledged as open)
Question for PO: "Can these be admin-configurable with provisional defaults, and who sets the defaults before launch?"
Label: Can-defer

**[Architecture readiness]** — ME-5. Photo handling contradiction (§ 6 (out of scope: "Photo uploads in community contributions (ambassador posts keep an optional photo)"); 7.2 B2 ("optional photo"); 7.4 D9)
B2 lets *residents* report incidents "with a description and optional photo", while §6 and D9 exclude photos from community contributions. Photo storage, moderation, EXIF and location stripping, and faces or unit numbers in images are privacy concerns.
Status: Contradictory
Question for PO: "Can residents attach photos to incident reports (B2), or only ambassadors? If photos are allowed, must they be reviewed before anyone else sees them?"
Label: Can-defer

**[Architecture readiness]** — ME-6. Youth and minors (§ 12 ("Age rules for youth users"))
This affects SMS sign-up consent, registry eligibility and content moderation.
Status: Open
Question for PO: "Is there a minimum age for SMS sign-up and contributions in v1, and must we verify it or only state it?"
Label: Can-defer

**[Architecture readiness]** — ME-7. Resident app and partner space separation (§ 7.6 F1; 8 N6; 1 Overview)
The partner space is "a separate application from the resident and ambassador app". It is not stated whether that means a separate deployment, domain, identity domain and database, or only a separate front end on a shared backend. This matters for blast radius and for registry isolation.
Status: Clear intent, vague depth
Question for PO: "Does 'separate application' require separate hosting and data stores, or is a separate front end with role-restricted shared services acceptable?"
Label: Can-defer

**[Architecture readiness]** — ME-8. Drill isolation guarantees (§ 7.6 F10; 9 (Readiness))
"never reaching residents" needs an architectural guarantee (a separate send path or sandbox sender, with enrolled recipients only). Should drills use real SMS to enrolled staff (a cost)?
Status: Clear intent
Question for PO: "Do drills send real SMS and push to enrolled staff, and is a hard technical block on resident recipients during exercises required, or is a procedural control enough?"
Label: Can-defer

**[Architecture readiness]** — ME-9. Real-time propagation of status changes (§ 7.1 A6; 7.4 D3, D6; 7.6 F8 ("reaches … at once"))
"At once" is not quantified. Do residents need live updates (websocket or server-sent events) or refresh-on-open? This affects cost and complexity on low-end phones.
Status: Vague
Question for PO: "Is refresh within about 60 seconds (or on next open) acceptable for space and partner status, or must open screens update live?"
Label: Can-defer

**[Architecture readiness]** — ME-10. Forwarded-alert link design (§ 7.1 A11)
The link "always opens the live alert … in the language of the person opening it" and must be public, unguessable enough and short for SMS and WhatsApp. The domain choice matters for trust and for carrier filtering of URL shorteners.
Status: Clear behaviour, vague implementation
Question for PO: "Do we have, or can we register, a short, recognisable domain for alert links? Should the links stay live forever or expire when the alert is archived?"
Label: Can-defer

**[Architecture readiness]** — ME-11. Launch timeline and pilot duration (§ 1; 13)
There is no target launch date, pilot length or phasing. This affects build versus adapt choices, short-code lead time (8–12 weeks) and heat-season readiness.
Status: Silent
Question for PO: "What is the target production launch date and pilot length? Must v1 be live before a particular season (winter storms, or next summer's heat)?"
Label: Can-defer

**[UX reconciliation]** — M-1. [C] Language is a group-targeting dimension in the UX but not in the PRD (§ UX 3.1.3 / O-04 ("exactly two dimensions: language, and the four categories"); UX PA-49. PRD A1 (groups are "seniors, newcomers, families with young children, and residents who would like a check-in"; language is not listed as a targeting dimension).)
Fix: Add "and by language" to A1 (it is self-declared, so it is consistent with "nothing is inferred"), or remove it from O-04.

**[UX reconciliation]** — M-2. [C] Partner and space status colour: D6 applies red/amber/green to partners; the UX forbids status colours on space status (§ PRD D6 ("partner organizations and their services, colour-coded: red … amber … green"). UX 3.4.4 ("It must not borrow the reserved status colours: a closed cooling centre is not an active emergency"); UX Section 9 (the "third signal set"); UX P-05 (capacity: available, stretched, at capacity).)
Fix: Limit D6 colour-coding to incidents. Specify partner status as capacity (F5) and space status (F8) with their own vocabulary.

**[UX reconciliation]** — M-3. [G] Partner status changes pushed as alerts (A6) have no UX (§ PRD A6 (Must: an alert on "a partner closing, reducing hours, or losing capacity … updated on D2, D3, D6"). UX: space status (P-07) updates listings; P-05 capacity is partner-facing only. There is no design for a resident-facing alert about a partner's own status.)
Fix: Extend F23 / P-07 with "notify residents" for closure or reduced service, or narrow A6 to cover listing updates only.

**[UX reconciliation]** — M-4. [G] The lighter-weight outreach ticket (C2), registry access (C3) and leaving the registry (C4) have no UX (§ PRD C2, C3, C4 (Must). UX Section 11 ("The outreach registry beyond the check-in request — PRD 7.3, C1 to C5").)
Fix: Add them to the next prototype cut, or record in the PRD that registry UX is deferred and that the privacy review (N5) must see designs before any build.

**[UX reconciliation]** — M-5. [G] Ambassador coverage gaps between disruptions (E5) and outreach reporting (E3) are only partly designed (§ PRD E5 (Should: which floors and buildings have an ambassador, "before a disruption"); PRD E3 (Must). UX P-04 read-only panel shows "floors with and without an ambassador" for *affected floors during* a disruption only; the brief has no E5 citation; UX O-17 covers check-in counts.)
Fix: Add a Hub coverage screen to the readiness area (P-11 to P-16) for E5.

**[UX reconciliation]** — M-6. [G] Community content submission is designed only for map entries; events, flyers and updates (D9) have no UX (§ PRD D9 ("events, resources, updates, flyers"); PRD E4 ("events, resource updates, asset map entries"). UX 3.4.2 / R-17 to R-23 (asset map entries only).)
Fix: State whether event submission reuses the R-19 template or waits for D1. Adjust D9 and E4.

**[UX reconciliation]** — M-7. [G] Chatbot query (D10) against meaning-based search: the UX does not address D10 (§ PRD D10 (Should). UX 3.3.1 (meaning-based search, R-11 route to a person). The brief never mentions a chatbot.)
Fix: Mark D10 Later, or state that meaning-based search satisfies D10's intent.

**[UX reconciliation]** — M-8. [G] Printed alert notices for ambassadors (A2) are not designed; X-05 is an onboarding notice (§ PRD A2 ("Printed notice templates should be available for ambassadors to use when residents cannot be reached digitally"). UX X-05 (onboarding sheet with QR and language); UX A-04 ("with the alert text to carry").)
Fix: Add a printable alert-notice specimen (per disruption template, origin marker, not-911 statement) or record it as a gap.

**[UX reconciliation]** — M-9. [U] Home and navigation structure is a UX decision with no PRD counterpart (§ UX Section 6 ("Four destinations and no more"; home in two sections "Alerts now" and "Every day"; "Get text alerts" at the top). UX PA-106 / F1 step 9 say "no more than five destinations", which is inconsistent within the brief. PRD User Flow describes a building status plus weekly summary home.)
Fix: Record the information architecture as a decision in the PRD (or reference the brief as normative for it), and reconcile it with the User Flow and with D5 and D6 (see H-11). Fix the four-versus-five inconsistency in the brief.

**[UX reconciliation]** — M-10. [U] Search and directory specifics are UX decisions without PRD requirements (§ UX 3.3.1 (ten named categories; R-11 "route to a named person" when nothing is found; five-query standing test set); UX 3.3.3 (nine fixed listing attributes, "an absent row reads as 'not required'"); UX 3.4.1 (default order by distance, neutral faith icon, clusters read "3 places"). PRD D2 and D3 cover filters and sources, but not the category list, the no-results route, the test set or the unknown-attribute rule.)
Fix: Add to D2: the category list (or a reference to it), "no-results always offers a named person", the "unknown stated as unknown" rule, and the search acceptance test set. The last belongs in N6 or the quality plan.

**[UX reconciliation]** — M-11. [U] SMS content rules go beyond A2 and A13: fixed order, level line, nearest open space line (§ UX microcopy "Text message alert" (fixed order: type and headline, what is not known, level and verification, where, one action, STOP); UX 3.4.4 ("In a text message, one line naming the nearest open space"); UX F4 step 6 ("the only tailored line"). PRD A2, A10, A13, and Section 10 (SMS cost).)
A "nearest" space line needs a location, but building is optional for text subscribers. The check-in line, the open-space line, the correction lines and STOP all add to per-message cost.
Fix: Add an SMS content spec to the PRD: order, maximum segments, which optional lines are allowed, and the fallback when no building is known.

**[UX reconciliation]** — M-12. [U] Official alert types with templates are listed only in the UX (§ UX 3.1.5 ("heat warning, special air quality statement, rainfall warning, winter storm warning"); UX Amber Alert shown only as a fictional state. PRD A10 ("Known alert types carry a pre-written template") does not list them. PRD A3's hazard templates (outage, flood, elevator, fire, heat, smoke, winter storm) are a different list.)
Fix: List the official alert types and the community disruption types separately in the PRD, together with the X-13 icon set.

**[UX reconciliation]** — M-13. [O] Retention is unspecified for everything except check-in records (§ UX 3.1.6 ("Nothing is ever deleted from a resident's view; it only moves"); UX P-09 (decision log "kept with the disruption's record"); UX 3.6.12 (past records). PRD C4 (leave the registry), C7 (check-in deletion), N5; no retention for SMS subscriptions after STOP, the archive, partner statements, drill records, or submissions.)
Fix: Add retention rules to the data inventory (CR-1). They are needed for the privacy review, which N5 makes a launch precondition.

**[UX reconciliation]** — M-14. [O] The Hub's decisions (tailoring, official relay) are not co-design outputs, but the PRD's provenance claim says every requirement is (§ PRD Section 1 ("Every requirement in it comes from the four co-design sessions"); PRD Section 14 lists sources such as "Brief decision Q18". UX Q18 ("raised by the Hub"), Q7, Q20 ("raised by the Hub").)
This is a trust issue. The Board is asked (PRD Section 13) to check "that nothing in scope crosses the lines the community drew", but the document claims community provenance for Hub-originated features.
Fix: Amend Section 1: "…and decisions made by the Hub while specifying the prototype (Section 14)". In Section 13, ask the Board to review tailoring (A13) and official relay (A10) explicitly.

**[UX reconciliation]** — M-15. [O] The brief's assumptions do not appear in PRD Section 10 or 12 (§ UX Assumptions A1 (testing in seven languages), A2 (20 min per week moderation), A4 (assignment record), A7 (Red Cross, City and TNO each nominate a coordinator and permit their marks), A9 (no privacy review needed for the prototype), A10 (component library with RTL support), A11 ("The CVH carries the Hub's identity rather than a new identity"). PRD Section 10 covers A3, A6, A8, A12 and A13 equivalents only.)
Fix: Add A2, A4, A7 and A11 to PRD Section 10 as dependencies. A11 is also a brand and governance decision and belongs in the PRD.

**[UX reconciliation]** — M-16. [O] The brief's open items are missing from PRD Section 12 (§ UX O2 (backlog personas: Nasrin "Farsi-speaking"), O8 (real versus illustrative entries; note the UX Q10 row answers a different question than it asks), O12 (Board "Colours" note, "Not known"), Section 9 (Nastaliq versus Naskh, "Test both with Urdu readers before locking the type scale"), Section 7 RTL (numeral convention "must be decided per language with a native reader"), Section 9 brand assets ("a light-background lockup is required"). PRD Section 12 carries O1, O3, O4, O5, O7 and O17 equivalents only.)
Fix: Add the typography, numerals and brand-asset items to PRD Section 12 as build prerequisites. Fix the Q10 mismatch in the brief.

**[UX reconciliation]** — M-17. [O] The asset-map dependency date has passed (§ PRD D2 ("asset map (D3) being developed by partners (expected completion end of August 2026)"); PRD Section 10 ("due end of August"). UX Assumption A3. Review date: 2026-09-30.)
Fix: Update the status (delivered, partial or slipped) and its effect on D2, D3, F4 and the sample data.

**[UX reconciliation]** — M-18. [Q] Persona stop conditions, the brief's pass/fail bar, have no place in the PRD (§ UX Section 1 ("A design that satisfies an acceptance criterion while triggering a stop condition has not passed"); UX Section 2 table (e.g. Nasrin: "Feeling exposed by the act of asking"; Rashid: "If the CVH takes longer than knocking on the door … the CVH will stay empty"; Daniel: "he will not use a fourth one"). The PRD has a Primary User and Job to Be Done, and no failure conditions.)
Fix: Add a short "Stop conditions" list to PRD Section 4 or 9. These are the most direct statement of what the community will not tolerate.

**[UX reconciliation]** — M-19. [Q] Dignity and non-disclosure are enforced in the UX by testing, but the PRD states them only as rules (§ UX F16 ("Stop condition to watch: a resident in testing can correctly guess why they were selected"); UX Section 10 testing ("asked afterwards whether the question felt exposing"; "what it would tell someone looking over their shoulder"); UX 3.2.7 (tailoring "add rather than filter, so that no resident ever misses part of an alert"); UX F6 (Nasrin's alert pre-applies "does not ask for ID", which is itself an inference from "newcomer" that needs dignity review). PRD P10, A13.)
Fix: Add to A13: "Tailoring adds and never filters; its effect is validated by asking residents what it reveals." Flag the newcomer → no-ID pre-filter for Board review, since it presumes status.

### Low (28)

**[Rubric: Substance over theater]** — Duplicated user framing (§4 table vs. "Users & Context")
Two descriptions of the same users drift apart (see the PA contradiction below).
Fix: Fold "Users & Context" into the table or delete it.

**[Rubric: Scope honesty]** — Implicit non-goals worth making explicit
Examples: no integration with 911/CAD dispatch; no native app-store app (see the channel contradiction); whether residents can post publicly at all (P7 describes "a community space with a code of conduct", and the building-management row mentions "resident conversation", yet no FR defines resident-to-resident posting).
Fix: Add these as `[NON-GOAL for MVP]` lines or an FR.

**[Adversarial]** — L-1. Board review is labelled "optional" despite co-design commitments (§13 ("the Community Experts Board (optional)") vs. §1 ("written for review by the Community Experts Board"))
Fix: Remove "(optional)" or explain why it's there.

**[Adversarial]** — L-2. The population figure is ambiguous (§2 ("roughly 43,000 people — with community estimates well above 50,000"))
Capacity planning needs one number.
Fix: State the planning figure (use the upper bound for sizing).

**[Adversarial]** — L-3. Goal 1 hedges on building level, while A1 makes it a Must (§3 Goal 1 ("(if possible building)"), §7.4 D6 ("(if possible)") vs. §7.1 A1 (Must))
Fix: Align them. Building level is Must for alerts; building-level *status* (D6) is conditional on ambassador coverage.

**[Adversarial]** — L-4. Undefined and inconsistent terms (§ Throughout ("the Hub", "TNO" not named, "ADMS", "open-EWS", "N1" used as both a principle ref and an NFR ref in P1))
Fix: Add a glossary. Name the operating legal entity.

**[Adversarial]** — L-5. Section 14 cites sources the reader can't see (§14 ("Brief decision Q7", "Backlog 3.2.6", etc.))
Fix: Link or attach the brief and backlog, or summarize each decision inline.

**[Adversarial]** — L-6. Seasonal heads-up "never sent by text" leaves out the non-smartphone users most exposed to heat (§7.4 D12)
Fix: Reconsider for heat season specifically, or make sure ambassadors carry it.

**[Adversarial]** — L-7. Typos and conversion artefacts (§1 ("this work.It provides"), §3 Goal 2 ("( ambassadors"), §7.4 D4 ("areas);residents"), D1 missing a closing period, "neighborhood" and "neighbourhood" mixed)
Fix: Copy-edit.

**[Architecture readiness]** — LO-1. Lobby screens and digital signage (§ Not addressed (brief mentions "lobby noticeboard" print only))
Printed notices (A2) are covered. Digital lobby displays are never mentioned.
Status: Silent
Question for PO: "Are digital lobby screens out of scope for v1?"
Label: Can-defer (assume out of scope)

**[Architecture readiness]** — LO-2. Voice and IVR (§ 6 Out of scope; 7.1 A14)
Keep the data model voice-ready (per-language audio assets per alert).
Status: Clear (deferred to a later phase)
Question for PO: "Confirm that no IVR or voice-call work is expected in v1 beyond keeping the design ready for it."
Label: Can-defer

**[Architecture readiness]** — LO-3. PA system references are inconsistent (§ 4 (note vs Success state and Non-Users))
The §4 note says "A PA system is not included", but the PA is listed as a channel elsewhere.
Status: Contradictory (editorial)
Question for PO: "Please remove PA from the Success state and Non-Users lists, or confirm it is only a channel people already use outside the CVH."
Label: Can-defer

**[Architecture readiness]** — LO-4. Accessibility standard (§ 8 N2)
WCAG 2.1 AA exceeds the AODA baseline (WCAG 2.0 AA). WCAG 2.2 AA is not mentioned. Screen-reader behaviour in RTL scripts is required (N1). A testing method and assistive-technology matrix are missing.
Status: Clear
Question for PO: "Is WCAG 2.1 AA the acceptance bar, or should we target 2.2 AA? Which screen readers and devices (VoiceOver on iOS, TalkBack on Android) are in the test matrix?"
Label: Can-defer

**[Architecture readiness]** — LO-5. Supported device and browser matrix (§ 8 N3 ("older phones and slow connections"))
The oldest iOS and Android versions, the minimum screen size and the data budget are unstated.
Status: Vague
Question for PO: "What are the oldest iOS and Android versions and browsers we must support?"
Label: Can-defer

**[Architecture readiness]** — LO-6. Map tiles and base map provider (§ 7.4 D3; 8 N6)
The tile hosting provider, cost and residency are not specified (OpenStreetMap tile usage policy forbids heavy use of the public servers).
Status: Clear intent ("open base map")
Question for PO: "Is a commercial OSM-based tile provider acceptable, or must tiles be self-hosted in Canada?"
Label: Can-defer

**[Architecture readiness]** — LO-7. Expansion beyond the two neighbourhoods (§ 6 (Out of scope: accounts outside the community); 10)
Whether the design should be multi-tenant for other Toronto neighbourhoods affects data modelling.
Status: Silent
Question for PO: "Should the architecture anticipate other neighbourhoods reusing the CVH after the pilot, or optimise for this single deployment?"
Label: Can-defer

**[UX reconciliation]** — L-1. [C] The background names Farsi; the launch set names Dari (§ PRD Section 2 ("Urdu most of all, followed by Pashto, Tagalog, Farsi, and Gujarati"); PRD N1 (Dari, no Farsi). UX O2 (backlog still says Nasrin is "Farsi-speaking").)
Fix: Reconcile the terms (e.g. "Dari/Farsi (Persian)") and state which written variant is in the launch set.

**[UX reconciliation]** — L-2. [C] Video with captions (P1) has no UX (§ PRD P1 ("text, audio, and video with captions"). UX 3.2.3 ("Audio and captions are part of the alert template set"); the brief has no video anywhere.)
Fix: Drop video from P1 for v1, or add it to Later.

**[UX reconciliation]** — L-3. [C] The brief contradicts itself about text-alert sign-up fields (§ UX 3.2.6 criterion ("in text-message sign-up it follows language and building"); UX Assumption A5 ("The only sign-up is a phone number, a language and a building"); against UX 3.2.1 revision, F3 and PRD A2 (neighbourhood required, building optional).)
Fix: Fix the brief in v9. The PRD is correct here.

**[UX reconciliation]** — L-4. [C] The brief's tailoring inputs are inconsistent (PA-28 omits building and floor) (§ UX PA-28 ("language, the groups she chose and her check-in request"); UX 3.2.7 first criterion and PRD A13 (include building and floor).)
Fix: Align PA-28 with A13.

**[UX reconciliation]** — L-5. [C] The PRD's User Flow shows a green status when an item is "linked to the Hub" (§ PRD User Flow ("status updates to green when resolved or linked to the Hub"); PRD D6 (green = resolved). UX status set includes "unknown" (Section 7), which is not in D6.)
Fix: Green means resolved only. Add "unknown" to D6.

**[UX reconciliation]** — L-6. [C] The Community Experts Board's review is optional in one place and required in others (§ PRD Section 13 ("Community Experts Board (optional)"); PRD Section 1 ("written for review by the Community Experts Board"); PRD F12 (definitions "agreed with partners and the Community Experts Board"); UX 3.6.11.)
Fix: Remove "(optional)", or state which approvals need the Board.

**[UX reconciliation]** — L-7. [U] Brand architecture ("fronted by the organisations residents already recognise") is not in the PRD (§ UX Section 9 Brand architecture ("One mark in the header. The Hub"; Sprout "never on an alert"). PRD: no requirement.)
Fix: Add one line to the PRD, since it affects the SMS sender identity and origin marker governance.

**[UX reconciliation]** — L-8. [U] Seasonal heads-up delivery is limited and accepted, with no PRD note (§ UX 3.5.4 ("Delivery gap … reaches only a resident who opens the CVH. The Hub has accepted this for now"). PRD D12 (no note of the gap); PRD A9 (topic choice) is not covered in UX (story 3.2.4 is out of cut).)
Fix: Add the gap to D12 and note that A9 is untested.

**[UX reconciliation]** — L-9. [O] The prototype-only privacy stance needs a PRD statement (§ UX Assumption A9 ("If any field is wired to storage … the privacy review becomes a precondition of the test itself"); UX Section 11 ("No real personal information is entered"). PRD N5 and Section 10 (review before registry data only).)
Fix: Add to PRD Section 10: "Any prototype or pilot that stores resident choices triggers the privacy review."

**[UX reconciliation]** — L-10. [O] PRD open items with no UX counterpart (§ PRD Section 12 ("Age rules for youth users and the pathway into schools (K–12)"; "WhatsApp Business API / SMS gateway costs"; "Post-pilot funding … sponsorship"). The UX does not touch these (one mention of "youth" in a category name). PRD P7 and Section 6 exclude advertising, which may be in tension with sponsorship.)
Fix: Note that sponsorship must respect P7 and "no business promotion". Clarify whether WhatsApp Business API is a candidate channel; it is not in A2.

**[UX reconciliation]** — L-11. [O] The winter storm (seventh hazard) question has three knock-ons (§ PRD Section 12; UX O4; PRD A3 includes "winter storm" templates; UX X-13 includes a winter-storm icon; guides and playbooks are fixed at six (UX PA-84).)
Fix: When O4 is decided, update A3, D7, F9 and X-13 together.

**[UX reconciliation]** — L-12. [Q] Microcopy tone rules have no home in the PRD (§ UX Section 8 microcopy (e.g. "'More information to come' … Should read as a commitment, not as an apology"; "Not yet verified must not read as false"; basic mode "'Bigger text, fewer things' rather than 'simplified' or 'lite'"; heads-up "positive framing, no fear"; "Translated by machine … Should invite correction rather than warn"; decline reasons "make moderation teach rather than block"; search prompt "Different examples per language, not a translation"; "written for translation, not translated afterwards"); UX 3.1.4 (ambassador post "visibly distinct … without being visibly lesser"); UX 3.4.1 (informal "alongside, not below"); UX Section 9 ("No stock photography of people in distress"); UX elapsed-time indicator ("not to reprimand"). PRD P5 and P6 cover plainness and accuracy but have no voice or tone principle. N7 content management mentions templates, not tone.)
Fix: Add a principle P11, "Voice: calm, respectful, plain; commitments not apologies; never fear-led; never implies a resident cannot cope", and add a content-style guide as an N7 deliverable. Treat the brief's microcopy table as its seed.

## Consolidated phase-blocking questions

De-duplicated across all four reviews and ordered by how much of the architecture depends on the answer. Each must be answered by the product owner (or explicitly assigned an owner and a decide-by date) before the architecture spine is drawn.

1. **Resident client form factor and the one authoritative channel matrix**
   - **Question:** For v1, is the resident and ambassador client (a) a mobile web app only, (b) an installable PWA using Web Push (accepting that iPhone users must add it to the Home Screen to get push), or (c) native iOS/Android apps? And which channels are in v1 exactly: web, push, SMS, printed notice, ambassador in person for residents; SMS and/or email for staff and frontline activation; WhatsApp Business API in or out; PA confirmed out?
   - **PRD refs:** A2, F3, P2, N3, §4 note / Success state / Non-Users, §9 ("Downloads, logins"), §12 (WhatsApp API)
   - **Raised by:** Rubric (Downstream usability, high); Adversarial H-2, H-3, Q19; Architecture CR-1, CR-2, ME-1; UX CR-4

2. **Data inventory: what is stored centrally vs. on the device, and who sees which fields**
   - **Question:** For residents who use the web or push without SMS, may the server store their building, floor and groups (against a push token), or must targeting be broadcast-and-filter-on-device? Is a check-in request (C6) always a central record with its own consent, and what does it collect when there is no SMS subscription? Is an SMS subscription carrying 'seniors' or 'would like a check-in' registry data under C3/C4? Is per-resident 'not yet confirmed' tracking (A8/E1) in or out, and if in, exactly which fields does an ambassador see given P4?
   - **PRD refs:** P3, P4, P10, N5, A1, A8, A12, A13, C1, C3, C4, C6, C7, E1; UX 3.1.2 'households not reachable digitally'
   - **Raised by:** Rubric (Downstream usability, high: data classification); Adversarial C-1, Q24, Q25; Architecture CR-6, HI-1; UX CR-1, CR-2, H-1, H-2

3. **Legal owner, data controller, privacy regime and residency of processing**
   - **Question:** Which legal entity owns and operates the CVH (hosting account, domain, SMS sender) during and after the pilot, and who is the data controller for each data set? Which statutes apply (PIPEDA, MFIPPA, PHIPA, CASL), under whose legal opinion? Does 'stored in Canada' also mean processed and transited in Canada, which would exclude most SMS gateways, Apple/Google push, machine translation, embedding/LLM providers and analytics, and if so which features may be dropped or replaced? Is the privacy review a gate on the whole launch or only on the registry?
   - **PRD refs:** P9, C3, C4, N5, N8, §10 (privacy bullet), §11 (privacy row), §12 (post-pilot funding)
   - **Raised by:** Adversarial C-5, H-16, Q1-Q3; Architecture CR-4, CR-9; UX L-9

4. **Role list, permission matrix and operator identity**
   - **Question:** What is the v1 role list (resident, trusted helper, ambassador, Hub staff, Hub approver, moderator, partner author/coordinator, registry-authorized user, frontline, drill participant) and the permission matrix (post, approve, relay official, activate, read registry fields, see check-ins, edit space status, moderate, run drills) with its scoping by building, floor and organization? How do ambassadors, Hub and partner users sign in, is MFA mandatory for anyone who can reach residents by SMS or read the registry, who creates the ambassador assignment record, and who approves, reviews and revokes accounts?
   - **PRD refs:** C3, E1, E2, E5, F1-F3, F8, F10, F11, P3, A2; UX Assumption A4
   - **Raised by:** Rubric (Downstream usability, high: no role model); Adversarial C-7, M-11, Q8; Architecture CR-5; UX H-7

5. **Planning numbers and measurable NFRs**
   - **Question:** What are the planning figures (residents in scope, SMS and push subscribers at launch and pilot end, buildings, floors, ambassadors, partner users, alerts per month), and the v1 targets: availability during declared disruptions, peak concurrent users, time from send to 95% of SMS recipients delivered, first render on a named low-end device over slow 3G, oldest supported iOS/Android/browser, and operator-task times (e.g. UX's 2-minute acknowledgement)?
   - **PRD refs:** N3, N4, A4, P5, §2 (43,000 to 50,000+), §4 Success state ("within minutes")
   - **Raised by:** Rubric (Substance, critical N4; high N3); Adversarial H-10, M-5, L-2, Q11, Q16; Architecture CR-8, LO-5; UX H-8

6. **Official alert ingestion and verbatim relay**
   - **Question:** Which official feeds must v1 ingest (NAAD/Alert Ready CAP, ECCC CAP, a named City of Toronto source, Toronto Hydro outages for F2 triggers), are written redistribution terms in hand for each, is ingestion automated with a human confirm step or fully manual, what is the target official-issue-to-resident time, are Amber Alerts in or out (especially over SMS), and when an alert matches a template, is the resident's primary text the template or the verbatim official wording?
   - **PRD refs:** A10, F2, §1 Overview, §10 (last bullet), §11 (relay row), §12 (relay terms)
   - **Raised by:** Rubric (Scope honesty, high: OQs gate A10); Adversarial H-6, Q26; Architecture CR-3; UX M-12

7. **SMS provider, throughput, segment budget and keywords**
   - **Question:** Which SMS provider and sender type (short code with its 8-12 week lead time, toll-free, or long code), what minimum throughput in recipients per minute, what monthly SMS budget ceiling, what maximum UCS-2 segments per alert per language (and which lines are dropped when over), and must STOP and the other inbound keywords work in all 15 languages and scripts at launch?
   - **PRD refs:** A2, A12, A13, C6, §10 (SMS cost), §12 (gateway costs; keywords per language)
   - **Raised by:** Rubric (Scope honesty, high); Adversarial H-10, Q17, Q18, Q21; Architecture CR-2, HI-7; UX M-11

8. **Real-time translation of free-text alert content**
   - **Question:** When a Hub staffer or ambassador posts free text that fits no template (E2 'Other' lines, corrections, running-thread updates), what do non-English residents receive: (a) machine translation, labelled, sent immediately; (b) author's language plus English, with the human-checked template for that disruption type in every language; (c) template-only posting enforced? If humans translate, who covers 15 languages and within what time, and which languages are excluded from MT because quality is too poor?
   - **PRD refs:** N1, A3, A4, A7, A10, E2, §11 (AI content row)
   - **Raised by:** Adversarial C-2; Architecture CR-7; UX H-5

9. **Canonical building/floor master data and disruption levels**
   - **Question:** Who supplies and maintains the authoritative building list (address vs. tower, floor numbering, non-residential levels such as garages and basements, neighbourhood), is 'lives here' separate from 'follows' in subscriptions and which drives targeting and check-ins, is building/floor a first-class entity rather than 'if possible', and what are the disruption levels (how many tiers, criteria, who classifies) that drive activation, drills and response?
   - **PRD refs:** A1, A9, A12, D6, E2, E5, F2, F3, F10, §1 (SOPs), §3 Goal 1 ("if possible building")
   - **Raised by:** Rubric (Strategic coherence, medium: building-level hedged); Adversarial H-1, L-3, Q23, Q24; Architecture CR-6, ME-2; UX H-3

10. **Disruption lifecycle and retention per data class**
   - **Question:** Who opens a disruption, moves it to recovery and closes it, on what criteria? Do check-in records survive through recovery (C5) rather than being deleted at close (C7)? What is the retention period for each record type: alert archive, SMS subscriptions and consent proof after STOP, check-ins, registry, incident reports and photos, help requests, partner conversation and decision log, audit logs, backups, analytics?
   - **PRD refs:** A7, C4, C5, C7, F11, F13, N5, B2
   - **Raised by:** Adversarial H-4, Q4, Q13; Architecture HI-1, HI-11; UX H-6, M-13

11. **Hub operating hours and approval/relay timeout behaviour**
   - **Question:** What hours is the Hub staffed for approvals, relays and activations, is there an on-call rota, what is the maximum approval latency, and for each disruption type what happens automatically when no one responds within N minutes: escalate to another approver, release as 'Not yet verified', or auto-reject with the ambassador told to go door-to-door or call 911? Who receives stale-alert and technical outage pages out of hours?
   - **PRD refs:** A4, A7, A10, E2, F2, F8, P6, §10 ("at any hour")
   - **Raised by:** Rubric (Decision-readiness, high); Adversarial C-3, Q10, Q11; Architecture HI-3; UX Appendix B (assumption only)

12. **'Need help' signal: priority, routing and response guarantee**
   - **Question:** Is B1 ('I need help') promoted to Must given Goal 2, and what is the routing order (floor ambassador, building ambassador, Hub), the resident-facing acknowledgement, the maximum unacknowledged time before escalation, and the behaviour when no ambassador covers her floor and the Hub is unavailable? Given the UX brief excluded B1-B4, A8, E1 and D6, will a second prototype cut cover the two-way loop before architecture locks?
   - **PRD refs:** B1-B4, A8, E1, D6, C6, §3 Goal 2, §4 User Flow
   - **Raised by:** Rubric (Strategic coherence, critical); Adversarial C-6, Q11; Architecture ME-3; UX CR-3

13. **Broadcast safety: corrections, two-person rule, drill isolation, send limits**
   - **Question:** Must every correction, withdrawal and all-clear be re-sent on every channel the original used, to the same recipients, with forwarded text carrying 'valid until' and a check link? Above what recipient count is a two-person rule required, what per-ambassador send limits apply, must drills run in a separate environment with no production SMS credentials, and must ambassador direct posts to SMS wait for a second confirmation while the web feed stays instant?
   - **PRD refs:** P6, A5, A7, A11, E2, F10, §11 (ambassador post row)
   - **Raised by:** Adversarial C-7, C-8, H-9, Q14, Q15; Architecture HI-2, ME-8

14. **Safeguarding: ambassador vetting, helper consent, minors**
   - **Question:** What vetting (e.g. vulnerable-sector check), confidentiality agreement and training must an ambassador complete before seeing any unit number or check-in record; how long may that data sit offline on a personal phone, and is remote revocation and view logging required? What is the trusted-helper consent protocol that guards against coercion, and what is the minimum age for SMS sign-up, registry entry and contributions?
   - **PRD refs:** C1, C6, C7, E1, E6, A2, A12, P4, §1 ("not ... a vulnerable population registry"), §12 (age rules)
   - **Raised by:** Adversarial C-4, H-11, Q6-Q8; Architecture ME-6; UX H-1

15. **MVP scope cut, pilot envelope and unresolved build dependencies**
   - **Question:** After re-grading the Must/Should inversions (B3/B1, E1/A8, E3/C7, F1 and F6/F4-F9, D2/tagging), what is the final Must list, and which of F4-F13, D8, D10 and D12 move out? What are the pilot duration, launch date, buildings and neighbourhoods at launch, team, build and run budget, and go/no-go criteria? What was the outcome of the open-EWS/ADMS spike and its fallback, and was the asset map (due end of August 2026) delivered, in what format?
   - **PRD refs:** §6, §7 (B1/B3, A8/E1, C6-C7/E3, F1-F13, D1, D2, D5, D8, D10, D12), N6, §9, §10, §11, §12
   - **Raised by:** Rubric (Strategic coherence, critical; Scope honesty, medium; Done-ness, medium); Adversarial C-10, H-16, M-13, Q27, Q28, Q31-Q34; Architecture CR-9, HI-5, HI-9, HI-10, ME-11; UX CR-3, H-11, M-17

## Mechanical notes

- **Glossary absent; term drift:**
  - "outreach registry" / "priority-outreach list" / "outreach list" / "registry" / "vulnerable population registry" (§1, C1, C2, §6).
  - "shared coordination space" / "Hub and partner space" / "partner coordination channel" (§10) / "shared dashboard" (§1) / "shared space" (F9, F10).
  - "ambassadors" / "floor contacts" / "volunteers" / "grassroots leaders" / "resident ambassadors" (§3).
  - "hub services" (lowercase, §6, D1) vs. "the Hub".
  - "live status view" / "live building updates" / "status".
  - "website" (A2) vs. "web app" (N3).
  - "neighborhood" (§3, §4) vs. "neighbourhood" elsewhere.
- **Cross-reference errors:** F7 ties commitments to "real-time resource availability (F5)", but availability is F4 and F5 is capacity. A13 says tailored content "is never forwarded", which duplicates A11; fine, but it should cite A11.
- **Language list:** §2 names Farsi as a top Thorncliffe language; N1 includes Dari but not Farsi. This may be intentional, since the scripts overlap, but it should be stated.
- **Review status:** §1 says the document is "written for review by the Community Experts Board", but §13 marks the Board "(optional)". Pick one.
- **Formatting:** §4 "that already do this work.It provides" (missing space); D4 "problem areas);residents"; the §6 bullet list has an orphan " ;" before "spaces open now".
- **IDs:** A, B, C, D, E, F, N and P series are contiguous and unique; no duplicates. There are no SM IDs, so §9 rows cannot be cited from F12 or elsewhere; consider SM1–SM10.
- **Assumptions Index roundtrip:** Not applicable in the tagged sense (no inline `[ASSUMPTION]` tags); see the Scope honesty finding.
- **Dated dependency:** §10 and D2 cite the asset map as "due end of August" (2026); as of the PRD date (2026-09-30), its status should be updated.

## Reviewer files
- `review-rubric.md`
- `review-adversarial-general.md`
- `review-architecture-readiness.md`
- `review-ux-reconciliation.md`
