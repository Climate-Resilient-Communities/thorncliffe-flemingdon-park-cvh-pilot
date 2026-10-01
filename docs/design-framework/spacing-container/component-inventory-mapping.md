# Component inventory mapping

Every prototype screen and component in pilot scope, mapped to the layout primitives and spacing tokens it should use, and the story that builds it. Modelled on the source framework's `docs/component-inventory/component-inventory-mapping.md` (one row per inventory item, a resolution per row, a note where a decision was taken), adapted to CVH: the ids come from `design/prototype/cvh/inventory.js` and the `C_*` / `Lib_*` files; scope and stories come from `docs/planning/pilot/epics.md`.

How to read the table:

- **Primitives**: `Screen` (with surface `res` or `staff`), `Stack`, `Inline`, `Grid`, and the `tap` rule. See `components/`.
- **Tokens**: semantic tokens (`token-architecture.md` section 3). Tokens marked † are reserved and blocked by a gap (G1–G10); they have no value yet.
- **Owner**: who owns the spacing around the item: `shell`, `Screen`, or the parent primitive (`parent`). Content components never own outer spacing (`component-boundaries.md` R1).
- **Story**: the story that builds it, from the epics' Traces and acceptance criteria.

## 1. Shells, libraries and shared parts

| Prototype item | What it is | Primitives | Tokens | Owner | Story | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `Lib_Foundations` | Token and foundation specimen | none (source of rules) | all layer 1 | — | S02.01 | States "Spacing from the design system (4, 10, 17, 24, 29, 48, 67)" and "44 by 44 minimum (56 in bigger-text mode), 8px between targets"; `cvh.css` does not follow the first statement (G1) |
| `ResidentApp`, `ResidentApp_320`, `ResidentApp_768` | Resident shell at three frame widths | shell + `Screen res` | `--gutter-resident`†, `--gap-section`†, `--inset-screen-end` | shell | S02.02 | No width logic in the prototype; 320/390/768 are test widths only |
| `C_ResidentHeader` | Resident header: logo, language button, basic-mode switch, "My choices" | `Inline justify="between"` (top row); `Inline` with `Inline.Grow` (tools row); `tap` | `--gutter-resident`†, `--gap-target`†, `--tap`† | shell | S02.02 (basic switch behaviour S02.14) | Prototype uses a 4-value padding with a `[dir="rtl"]` override and `margin-inline-start: auto`; both replaced by `Inline` |
| `C_ResidentNav` | Bottom navigation, 4 equal items | `Grid cols={4} collapseInBasic={false}` inside the shell; `tap` | `--tap`†; nav item block size (G8) | shell | S02.02 | Active indicator is a block-axis inset shadow (allowed); item size grows in basic mode (G8) |
| R-02 overlay sheet (in `ResidentApp`) | Language control sheet and its layer | shell overlay; `Stack as="ul"` of options; `tap` | `--gutter-resident`†, `--gap-stack`† | shell | S02.02 | Sheet head uses a physical 4-value padding with a `[dir]` override in the prototype; not ported |
| `HubApp`, `HubApp_390` | Hub shell, wide and phone | shell; `Grid` (side nav + main) at and above Hub breakpoint; `Screen staff` | `--size-side-nav`†, `--inset-page-staff`, `--inset-page-staff-narrow`†, `--breakpoint-hub`† | shell | S01.09 | Prototype switches at a frame width below 700 px (G4) |
| `C_HubTop` | Hub top bar: menu (narrow), title, signed-in person and role | `Inline justify="between" wrap`; `tap` | `--inset-page-staff`, `--inset-page-staff-narrow`†, `--gap-icon` | shell | S01.09 | S01.09 needs sign-out reachable at 390 px; the prototype top bar has no sign-out, so add it to this `Inline` |
| `C_HubSide` | Hub side navigation | `Stack gap="label"`; `tap` | `--gap-label` (prototype 4px = `--space-1`), `--size-side-nav`† | shell | S01.09 | Active item uses `inset 3px 0 0` shadow with a `[dir]` override; use `border-inline-start` |
| `C_IncidentStatus` | Incident status chip (reserved signal set) | content; used inside `Inline` | component tokens only | parent | S05.06 | No outer margin; status in words, not colour only |
| `C_Placeholder` | Placeholder body for unbuilt screens | — | — | — | not built | Prototype-only |
| `C_ProtoBar` | "Prototype" marker | — | — | — | not built | Prototype-only; must not be confused with X-10 |
| `Lib_Alerting` | Specimens of X-01, X-02, X-13, X-08, X-12 | see X rows | — | — | see X rows | X-08 is MVP |
| `Lib_Places` | Specimens of X-09, X-11, X-14, X-04, X-03, X-07 | see X rows | — | — | see X rows | X-09, X-03 are MVP |
| `Lib_Partner` | Specimens of X-06, X-10, incident status | see X rows | — | — | see X rows | X-06 is MVP |
| `Lib_Notice` | Printed notice X-05 | — | — | — | MVP | Out of pilot scope |

## 2. Shared components (X-xx)

| Id | Name | Primitives inside the component | Placed by | Tokens | Story | Note |
| --- | --- | --- | --- | --- | --- | --- |
| X-01 | Not-911 statement (the one catalog 911 block) | full: `Grid`-like two-column internal layout (number, text); inline: `Inline gap="icon"` | parent `Stack` (top of guide, above results, on alerts, numbers, check-in) | component: `--not-911-block-inset` → `--inset-card` (G6); `--gap-icon` | S02.10 (component, guides and numbers); used by S03.06, S04.08, S08.05 | AD-16 "one 911 block"; no outer margin so it can move between positions; number box keeps `dir="ltr"` |
| X-02 | Origin and verification marker | `Stack gap="tight"`†; `Inline gap="icon"`; verification control has `tap` | parent `Stack` | `--gap-icon`, `--gap-tight`† | S04.08 | Monogram disc uses `--radius-disc` |
| X-04 | Machine-translation label and "Show English" | `Inline wrap gap="icon"`; "Show English" has `tap` | parent `Stack` | `--gap-icon`, `--gap-target`† | S04.08 (alerts), S02.06 (listings) | Pilot: label and English original only, no report control (UX-DR6) |
| X-07 | Basic mode switch | content (switch) with `tap` | `C_ResidentHeader`, R-34, R-01 | `--tap`†, `--tap-basic`† | S02.14 | Sets `data-basic` on `<html>`; see `token-architecture.md` section 8 |
| X-10 | Exercise marker | content band | `Screen` `bleed` slot (full width, block start) | component inset → `--gutter-resident`† | S06.05 (drills), shown on R-07 and staff lists | Prototype pads it with `--gutter`; in the app it sits in `bleed` so it is full width without negative margins |
| X-11 | Applied-filter bar | `Stack` (count, chips); chips in `Inline wrap gap="target"` | `Screen` `bleed` slot, sticky | `--gutter-resident`†, `--gap-target`† | S02.06 | Prototype `position: sticky` bar with `--gutter` padding |
| X-12 | Tailored block "What this means for you" | `Stack gap="stack"`†; list as `Stack as="ul"`; links `Inline wrap` | parent `Stack` on R-03 | `--inset-card` (G6), `--gap-stack`† | S04.09 | |
| X-13 | Disruption type icons | `Inline gap="icon"` | parent | `--gap-icon` | S04.08 | Large variant on alert detail |
| X-14 | "How they can help" box | `Inline gap="icon" align="start"` | parent `Stack` on R-12 | `--inset-card` (G6), `--gap-icon` | S02.06 | |
| X-03, X-05, X-06, X-08, X-09 | Rules, printed notice, statement chip, audio, space status | — | — | — | MVP | Out of pilot scope (epics overview) |

## 3. Resident screens (R-xx)

All resident screens use `Screen surface="resident"` inside the resident shell, a top-level `Stack` with the section gap, and the `tap` rule on every control. The table lists what is specific to each.

| Id | Name | Primitives (beyond the default) | Tokens | Story | Note |
| --- | --- | --- | --- | --- | --- |
| R-01 | Language selection (first run) | `Stack as="ul"` of 15 options; `tap` | `--gap-stack`† | S02.03 | Header uses the `firstRun` variant (no tools row) |
| R-26 | Which groups do I belong to? | `Stack as="fieldset"` of options; `actions` slot (Continue, Skip) | `--gap-stack`†, `--gap-label` | S02.03 | |
| R-35 | Where I live | `Stack as="fieldset"`; building and floor in `Stack gap="label"`; `actions` slot | `--gap-label`, `--gap-stack`† | S02.03 | |
| R-34 | What I have told the CVH | `Stack` of choice rows; each row `Inline justify="between"` with `Inline.Grow` | `--gap-stack`†, `--gap-icon` | S02.03, S02.12, S02.14 | Basic-mode switch lives here too |
| R-03 | Home / Now | sections in `Stack`; alert list `Stack as="ul"`; "Every day" tiles `Grid cols={2} gap="grid"` (collapses in basic); X-01 inline at the end | `--gap-section`†, `--gap-grid` (G1: prototype 10px), `--gap-stack`† | S02.11 (X-12 in S04.09) | Building status in words, icon and colour (UX-DR5) |
| R-04 | Text message specimen | not a web screen | — | reference for S04.06 and E07 | Device frame in the prototype; the SMS layout is text, not CSS |
| R-05 | Text alert sign-up | `Stack gap="label"` per field; `actions` slot | `--gap-label`, `--gap-section`† | S07.02 | |
| R-06 | Sign-up confirmation | `Stack` | `--gap-section`† | S07.02 | |
| R-07 | Alert detail | X-10 in `bleed`; `Stack` for X-13, headline, X-02, text with X-04, action, X-01 | `--gap-section`†, `--gap-paragraph` | S04.08 (corrections S05.02) | Fixed content order (brief 3.1.1) is DOM order |
| R-28 | What "verified" means | `Stack gap="paragraph"` | `--gap-paragraph` | S04.08 | |
| R-29 | Share an alert | `Stack`; share buttons `Stack` or `Grid cols={2}` | `--gap-stack`†, `--gap-grid` | S05.08 | |
| R-30 | Shared alert in a messaging app | not a web screen (preview card is generated) | — | S05.08 | Device frame in the prototype |
| R-08 | Archived alerts | `Stack as="ul"` | `--gap-stack`† | S05.07 | |
| R-09 | Search entry | `Stack`; X-01 | `--gap-section`† | S03.06 | |
| R-10 | Search results | X-01 above results (when `emergency_first`, 911 first); `Stack as="ol"` | `--gap-stack`† | S03.06 | |
| R-27 | Filters | sheet or screen; `Stack as="fieldset"` per filter; chips `Inline wrap gap="target"`; `actions` slot | `--gap-target`†, `--gap-label` | S02.06 | Pilot filters: category, neighbourhood, "Helps in an emergency" |
| R-11 | No results, route to a person | `Stack` | `--gap-section`† | S02.06, S03.06 | |
| R-12 | Listing detail | `Stack` of key-value rows (`Stack gap="tight"`†); X-04; X-14 | `--gap-tight`†, `--gap-section`† | S02.06 | "Not known" shown, never blank |
| R-13 | Organisation page | as R-12 | as R-12 | S02.06 | Prototype priority P2; in UX-DR11 |
| R-14 | Map view | `Screen inset="none"`; map in `bleed`; tools `Inline` | `--gap-icon` | S02.07 | Map pins use `tap` |
| R-15 | Map list view | `Stack as="ul"` | `--gap-stack`† | S02.07 | |
| R-16 | Map preview card | content card in `actions` slot or overlay | `--inset-card` (G6) | S02.07 | |
| (no id) | Building facts page | `Stack` of key-value rows | `--gap-tight`†, `--gap-section`† | S02.08 | No prototype screen id; follow R-12's layout |
| R-24 | Be ready index | `Stack as="ul"` of guide links | `--gap-stack`† | S02.10 | |
| R-25 | Hazard guide | X-01 at the top; before/during/after sections in `Stack gap="paragraph"` | `--gap-paragraph`, `--gap-section`† | S02.10 | Opens at "during" from an alert |
| R-31 | Numbers I might need | X-01; `Stack as="ul"`; each number a `tap` control | `--gap-stack`† | S02.10 | Offline-readable (S02.12) |
| R-33 | Ask for a check-in | `Stack`; consent text; X-01; `actions` slot | `--gap-paragraph`, `--gap-section`† | S08.05 | |
| R-17 to R-23, R-32 | Submissions, seasonal heads-up | — | — | MVP | Out of pilot scope |

## 4. Hub screens (O-xx)

All Hub screens use `Screen surface="staff"` in the Hub shell, at 390 px and 1280 px (UX-DR15). "Main + aside" means `Grid cols={1} colsAtHub="main-aside" gap="panel"`.

| Id | Name | Primitives (beyond the default) | Tokens | Story | Note |
| --- | --- | --- | --- | --- | --- |
| O-01 | Operator home, open incidents | sections `Stack`; incident list `Stack as="ul"` | `--gap-section`†, `--gap-stack`† | S04.10 | Drills in a separate section |
| O-11 | Log a disruption | main + aside; type picker `Grid cols={2}`; `actions` slot | `--gap-panel`, `--gap-grid`, `--size-aside-staff`† | S04.05 | Prototype type picker uses `auto-fill` with a 190px minimum (not a token) |
| O-12 | Acknowledgement composer | main + aside; `actions` slot | `--gap-panel` | S04.05 | |
| O-02 | Compose an alert | main + aside; `Stack gap="label"` per field; `actions` slot | `--gap-panel`, `--gap-label` | S04.05 | |
| O-03 | Audience: place | `Stack`; building list `Stack as="ul"`; floor picker `Grid cols={4}` or `Inline wrap gap="target"` | `--gap-target`†, `--tap`† | S04.04 | Prototype floor grid uses `minmax(44px, 1fr)` auto-fill; use `Inline wrap` with `tap` items |
| O-04 | Audience: group | `Stack as="fieldset"` | `--gap-stack`† | S04.04 | |
| O-05 | Pre-send review (approval view) | main + aside; `actions` slot with Approve, Return, Discard | `--gap-panel`, `--size-aside-staff`† | S04.07 | Approve within thumb reach (AD-21); see `component-boundaries.md` 3.3 |
| O-06 | Publish confirmation and handoff | `Stack` | `--gap-section`† | S04.10, S06.09 | |
| O-13 | Promote acknowledgement to full alert | as O-02 | as O-02 | S05.01 | |
| O-14 | Post an update | as O-02 | as O-02 | S05.01 | |
| O-15 | Correct an alert | as O-02 | as O-02 | S05.02 | |
| O-16 | Resolve and close | as O-02 | as O-02 | S05.03 | |
| O-07 | Ambassador post, approve or review | main + aside; `actions` slot | `--gap-panel` | **none found** | Listed in UX-DR16, but no story's Traces names O-07. Likely S08.02 or S08.03; the plan should say which |
| O-17 | Check-in progress and escalations | summary `Grid cols={2}`; escalation list `Stack as="ul"`; counts in a `table` | `--gap-grid`, `--gap-stack`† | S08.08, S08.09 | Tables are not `Grid` |
| O-18 | Official alert received | as O-02 | as O-02 | S10.01 (stretch) | Only if A10 is built |
| O-08 to O-10 | Moderation | — | — | MVP | Out of pilot scope |

## 5. Ambassador screens (A-xx)

Ambassador screens are staff routes (`/staff/…`) but phone screens in the prototype (they run inside `ResidentApp`'s phone frame). They use `Screen surface="resident"` for inset and gap, under the staff shell's authentication and `no-store` rules.

| Id | Name | Primitives (beyond the default) | Tokens | Story | Note |
| --- | --- | --- | --- | --- | --- |
| A-01 | Ambassador home, my building | `Stack`; alert list `Stack as="ul"` | `--gap-section`†, `--gap-stack`† | S08.01 | |
| A-02 | Post a building update | `Stack gap="label"` per field; `actions` slot | `--gap-label` | S08.02 | Exercise marker in `bleed` during drills |
| A-03 | Post confirmation and channel status | `Stack` | `--gap-section`† | S08.04 | |
| A-04 | My round | round items `Stack as="ul"`; mark buttons `Grid cols={3} gap="target" collapseInBasic={false}`; `actions` slot for queued-mark status | `--gap-target`†, `--tap`† | S08.07 | One-handed; see `component-boundaries.md` 3.4 |
| A-05 | Connect to a service | — | — | MVP | Out of pilot scope |

## 6. Summary

| Count | Items |
| --- | --- |
| In pilot scope and mapped | 7 shell items (including the R-02 overlay), `C_IncidentStatus`, 9 shared components, 24 resident web screens plus the building page, 15 Hub screens (O-18 is stretch), 4 ambassador screens |
| Not built (prototype-only) | `C_Placeholder`, `C_ProtoBar`, device frames R-04 and R-30 (reference only) |
| MVP | R-17 to R-23, R-32, O-08 to O-10, A-05, X-03, X-05, X-06, X-08, X-09, all P-xx partner screens, `Lib_Notice` |
| Plan gap found | O-07 has no story that traces it |
| Blocked tokens most used | `--gap-section`, `--gap-stack`, `--gutter-resident`, `--gap-target`, `--tap` (gaps G1–G3). Closing these three gaps unblocks almost every row |
