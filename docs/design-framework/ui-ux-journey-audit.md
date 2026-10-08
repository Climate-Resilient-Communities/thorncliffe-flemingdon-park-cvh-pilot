# CVH screen and journey review

Reviewed on 7 October 2026, branch `design/ui-ux-review`. This is a review of the local implementation, not a claim that production has changed.

## Review standard
For every screen family: identify its audience and purpose; make the next action obvious; provide a way back or recovery route; put essential facts before supporting explanation; keep consent and safety information visible; check mobile and desktop placement, logical-start alignment, and text wrapping.

## Resident screens

| Screen family | Decision / result |
|---|---|
| Home, current alerts, archive, alert detail | Keep alert meaning and emergency instructions prominent. Shared desktop navigation and readable content width replace the stretched mobile layout. |
| Directory and provider detail | Desktop filters stay visible; mobile filters expand on request. Calls stay upfront, secondary listing details expand, full detail remains on the provider page. |
| Search and topic fallback | Quieter topic choices, left-aligned actions, readable desktop columns. Backend search quality is outside this visual check. |
| Map | Reviewed the fallback state. Live tile loading and provider attribution with production configuration still require a live map check. |
| Ready, power guide, emergency numbers, check-in guide | Keep section navigation and emergency guidance. Reading width is constrained on desktop; do not replace necessary safety text with decorative cards. |
| Building details | Keep building context and related information together; shared layout and wrapping apply. |
| Welcome, place and group selection | Keep the existing next/back/skip progression. Optional onboarding must not look like a required staff account. |
| Choices, place, groups and language | Keep the existing confirmation/cancellation actions. English and French lead language choices. Larger text belongs in display settings, not the primary navigation. |
| Text alerts and subscription management | Keep explicit consent and the existing terms link before submission. Recovery and home links remain in invalid-link and completion states. |
| Terms and privacy | Add access from every resident footer, plus a contents list linking to each policy section. Preserve the approved text, owner, version, contact and publication gate. |
| Share and verification | Preserve the purpose and existing return/navigation affordances; apply shared readable widths. |
| Offline and not-found | Reviewed recovery-oriented states. These are not success screens and should never imply fresh data. |

## Staff screens

| Screen family | Decision / result |
|---|---|
| Sign-in | Hub logo, clear audience, desktop form/help columns, mobile form first. New-staff onboarding and expandable password-recovery instructions. Add terms/privacy access. |
| Password, code and authenticator gates | Consistent identity and resident return link. Keep the required setup steps and sensitive-input semantics. Recovery is Admin-managed; no nonfunctional reset-email button. |
| Incidents, closed incidents and next steps | Preserve incident context and status-specific next actions. Apply shared desktop/mobile hierarchy. |
| Log, compose, correction and final | Keep context and audience before submission. Do not shorten safety-critical instructions merely to reduce page length. |
| Approval and update approval | Keep frozen content, translation/audience checks and approval actions. No “edit and approve” shortcut. |
| Published alert and sending | Keep outcomes and uncertain-send warnings visible; published state must not look like an editable draft. |
| Audience and buildings | Keep scope visible alongside the relevant controls. English/French lead language controls where present. |
| Providers | Group each provider's confirmation and publication controls. Add the missing next step: provider changes need a directory release before residents see them. |
| Directory release | Preserve current-release and withheld-translation information. Add links to manage providers and view the resident directory. Publishing remains the primary action. |
| People and promotion | Keep role and permission context; no new account or permission shortcuts. |
| Coverage and on-call | Keep responsibility and availability clear; safety consequences remain visible. |
| Drills, drill roster and drill log | Keep drill-only scope and outcomes explicit. Do not visually blur drills with real sends. |
| Pause texts | Keep the reason and in-flight allowance visible. Pause remains a distinct operational action. |
| Spend | Keep estimates, unknown amounts and pending reconciliation explicit. Do not present uncertain costs as zero. |
| Measures | Keep suppression/privacy explanation visible; move export procedure detail behind a named disclosure so the figures arrive sooner. |
| Campaign | Add the existing end-of-pilot page to Admin navigation, protected by the existing policy. No broader access. |
| Assisted text signup | Keep resident consent and terms in the flow; language order updated. |
| Ambassador home, post, status and resolve | Keep assignment context and next actions visible; shared mobile layout applies. |
| Ambassador round, rounds and escalation | Preserve sensitive-data handling, current status and escalation instructions. No persistent browser storage or new personal-data display introduced. |

## Evidence and limits

- Earlier visual pass: 42 representative staff compositions at mobile/desktop sizes; all 187 rendered staff fixture states checked for document overflow at 320 px. Resident route families captured at mobile/desktop sizes; desktop filter breakpoint checked at 999/1000 px. Screenshots are in this folder.
- This pass: revised directory, providers, measures and staff authentication inspected from the real React components rendered with fixture data; export disclosure opened successfully. Updated resident footer and policy page checked in the local app.
- Static staff fixtures prove presentation, not authenticated server actions. No live messages, approvals, account changes or publication actions were submitted.
- Search backend, live map tiles, real authentication recovery and external delivery behavior are not certified by this review.
- Policy discoverability was changed; legal text and its publication/approval rules were not changed.
- A full keyboard/screen-reader audit and testing with residents/staff would provide evidence this design review cannot substitute for.

## Content-owner follow-up
The current policy's “Who handles your information” section names Twilio, Cohere, Vercel and Supabase, but not the hosted map tile provider discussed for this project. Before launch, the privacy owner should check the policy against the actual production map configuration and its network disclosures. This review does not change or approve legal wording.

## Validation for this follow-up
Production build and type generation passed. 108 focused tests passed across staff navigation, provider management, directory release, measures and staff sign-in. ESLint: zero errors, nine existing warnings. Dependency and logical-CSS checks passed. Policy contents navigation moved keyboard focus to its target; revised resident directory was inspected at desktop width. Earlier full-suite baseline limitations remain in the approval record.

## Display-settings follow-up

The resident header now has a compact Aa button beside language. It opens a native modal with independent Standard/Large text size and Simpler view controls. Large text never turns on simpler view. Changing simpler view preserves the text size. Both preferences remain on the device; the boot script applies them before paint. Older basic-mode preferences retain their previous larger text until the resident changes it. The My choices control now says Simpler view and preserves text size too.

Staff sign-in remains in the resident footer, per the user's latest instruction. The former footer display disclosure is removed.

Validated: production build, 30 preference/token tests, dependency and CSS checks. Browser checks covered independent settings, reload persistence, a 320 px panel, Escape/focus return, and mobile/desktop screenshots. The resident browser tests were updated for the new settings entry point; CI and screenshot baselines still need their normal verification.
