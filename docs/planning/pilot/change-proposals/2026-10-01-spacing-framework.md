# Change Proposal — Spacing and container framework

- **Date:** 2026-10-01
- **Status:** Proposed, not applied. `docs/planning/pilot/epics.md` and `docs/architecture/ARCHITECTURE-SPINE.md` are unchanged.
- **Source:** the draft framework in `docs/design-framework/spacing-container/`, adapted from `lutic1/personal-website` (`design-framework/spacing-container-framework/`).
- **Estimate impact:** +6 h of development, **proposed, pending review**, plus about 2 h of design-owner time.
- **Not affected:** S01.01 (app skeleton) can start now, independently of every decision here.

## 1. Why

The draft framework found that `tokens.json` and the approved prototype use different spacing scales, so UX-DR1 ("match the prototype exactly") and AD-16 ("tokens only from `tokens.json`") cannot both be met. It also found that the Hub shell (S01.09, in E01) would be built before tokens are generated (S02.01, in E02), and that O-07 has no explicit trace.

## 2. Proposed changes

### 2.1 Reconcile `tokens.json` with the approved prototype (design owner, before the new foundation story)

There must still be one spacing scale. The proposal is to replace the spacing steps in `tokens.json` with the values the approved prototype actually uses, not to add a second "screens" set.

Spacing values in the prototype's spacing declarations (`padding`, `margin`, `gap`) across `cvh/cvh.css` and the `.dc.html` screens, by number of uses:

| Value | Uses | Value | Uses |
| --- | --- | --- | --- |
| 8 px | 379 | 14 px | 143 |
| 10 px | 269 | 16 px | 132 |
| 6 px | 256 | 2 px | 105 |
| 12 px | 224 | 20 px | 59 |
| 4 px | 149 | 24 px | 36 |

Less frequent values: 18 (25), 3 (17), 1 (15), 22 (11), 32 (9), 28 (6), 56 (6), 48 (4), 17 (4).

**Recommendation:**
- Make the spacing scale 2, 4, 6, 8, 10, 12, 14, 16, 20 and 24 px. This covers almost every use in the prototype.
- The design owner decides each less frequent value: fold it into the nearest step, or add it as a named step.
  - 1 px is a hairline border, not spacing.
  - 56 px is the basic-mode touch target, which belongs with the target sizes below.
- `tokens.json`'s current steps 17, 29, 48 and 67 px are described there as slide and document spacing. If the file must keep serving slides, they stay under the slides usage and are not generated for the app.

Also record in `tokens.json`:
- the resident gutter (16 px in the prototype);
- touch targets of 44 px, and 56 px in basic mode;
- 8 px between targets;
- one Hub breakpoint (the prototype switches below 700 px);
- the Hub page, side-nav and aside widths.

Every value comes from the prototype, which the design owner confirms. The other gaps (G6–G10) are decided at the same time.

### 2.2 Move shared token generation into an early E01 foundation story

Making S01.09 depend on S02.01 would reverse the epic order, so it is not proposed. Instead:

- **New story S01.16 — Developer generates the shared design tokens and layout primitives.**
  - **Size and order:** M, 6 h, depends on S01.01. It sits immediately before S01.09 in the document. Story IDs are not renumbered, so S01.16 appears out of numeric order on purpose.
  - **Token generation** (moved from S02.01, about 2.5 h): `npm run gen:tokens` from the reconciled `tokens.json`, the light and navy themes, and a snapshot test.
  - **Layout primitives** (new, about 3.5 h): `Screen`, `Stack`, `Inline`, `Grid` and the `tap` rule, as specified in `docs/design-framework/spacing-container/components/`. Those specs say "Built in: S02.01"; they would point to S01.16 once approved.
  - **Generator behaviour:** when a token the primitives need has no value, the generator fails and names the gap; it never writes a default.
  - **Checks:** the proportionate spacing check in 2.3.
- **S01.09:** depends on S01.07 and S01.16. Add criteria saying the Hub shell uses `Screen` and the Hub breakpoint token only. +0.5 h (4 → 4.5 h).
- **S02.01:** keeps string generation and loses token generation. 6 → 3.5 h. Its criteria about tokens move to S01.16.
- **S02.02:** list the banned physical CSS properties exactly, and check that right to left mirrors English (±1 px). +1 h (7 → 8 h).
- **S02.14:** basic mode is set before first paint, grids collapse, and targets are measured at the basic-mode size in `en`, `ur` and `ta`. +1 h (6 → 7 h).

| Story | Approved | Proposed |
| --- | --- | --- |
| S01.16 (new) | — | 6 h |
| S01.09 | 4 h | 4.5 h |
| S02.01 | 6 h | 3.5 h |
| S02.02 | 7 h | 8 h |
| S02.14 | 6 h | 7 h |
| **Net** | | **+6 h** (E01 81 → 87.5 h; E02 84 → 84.5 h; build 488 → 494 h) |

All figures are proposed, pending review.

### 2.3 Keep enforcement proportionate

The spacing check catches unapproved spacing values without banning legitimate CSS.

- **Checked:** literal lengths in `padding*`, `margin*`, `gap`, `row-gap` and `column-gap` that are not `0` and not an approved token, plus arbitrary Tailwind spacing values such as `p-[13px]`.
- **Not checked:** border widths, icon and image sizes, positioning (`top`, `inset*`, `translate`), line height and other non-spacing properties.
- **Exceptions:** a reviewed `/* spacing-exception: reason */` comment allows one, and the check lists every exception in its report. Negative margins are flagged unless they carry such a comment.
- **Logical CSS check (S02.02):** stays as approved, with the explicit list. It bans only properties that are physical left or right; it does not restrict borders or icons generally.

### 2.4 Allow the inline-link exception, subject to the pilot's accessibility requirements

- **Proposal:** links inside a sentence or block of text, such as guide body text marked `data-tap-exempt="inline-text"`, are exempt from the 44 px minimum. Every control and every important link stays a separate control of at least 44 px (56 px in basic mode).
- **Why it fits WCAG:** this matches the inline exception in WCAG 2.5.5 (WCAG 2.1, level AAA) and 2.5.8 (WCAG 2.2, level AA). The pilot targets WCAG 2.1 AA (NFR-N2), which has no target-size criterion at AA.
- **Still to confirm:** UX-DR19 says "44 px touch targets" without listing exceptions, so the product owner must confirm UX-DR19 means controls rather than inline text. Until then the strict rule stays in S02.14.

### 2.5 O-07 needs a trace, not a story

The prototype's O-07 ("Ambassador post — approve or review") is already built by approved stories:

| O-07 state | Built by |
| --- | --- |
| Moderated type waiting: approve in one tap | S04.07 (one-action approval) |
| Decline with a reason | S04.07 ("Return to author" with a note, or "Discard") |
| Shown at the top as a priority review | S04.10 (entries waiting for approval at the top) |
| Direct type already live as "Not yet verified": verify in one tap | S08.03 (approving a D-1 post shows "Verified by the Hub") |
| Correct, or withdraw with a reason | S05.02 (correction or withdrawal with a reason), S08.03 |

**One deliberate difference:** the prototype offers "edit and approve". Under the two-person rule (AD-5, S04.03) whoever edits becomes an editor and cannot approve. So the pilot keeps "return to author" or "correct" instead, and the approval view must not offer "edit and approve".

**Proposed edit:** add "UX-DR16 (O-07)" to the Traces of S04.07 and S08.03, and one criterion to S04.07 saying the approval view offers no "edit and approve" action. 0 h.

## 3. Decisions requested

1. Approve the reconciled spacing scale (2.1), or adjust it.
2. Approve new S01.16 and the moves in 2.2.
3. Approve the proportionate check in 2.3.
4. Confirm the reading of UX-DR19 in 2.4.
5. Approve the O-07 trace in 2.5.

When approved, the edits are applied to `epics.md` (and AD-16 in the spine notes the reconciled scale). The framework docs then drop their draft banner, except for any gap still unresolved.
