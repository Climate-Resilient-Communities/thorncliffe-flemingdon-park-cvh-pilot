# Component boundaries: who owns spacing

> **Status: approved framework (2026-10-01); token values decided by the design owner on 2026-10-02 (G1–G10, `token-architecture.md` section 11).** The rules, primitives and token values here are implementation requirements for S01.16 and the stories that use them. Values come from `design/prototype/ds/cvrh/tokens.json`; rare values and where they are used are in [`rare-spacing-inventory.md`](rare-spacing-inventory.md). The plan changes were applied from the change proposal [`docs/planning/pilot/change-proposals/2026-10-01-spacing-framework.md`](../../planning/pilot/change-proposals/2026-10-01-spacing-framework.md) to `epics.md` and AD-16.

This document says which part of the UI owns each kind of space, so that two components never both add space between the same two things, and RTL and basic mode work without per-screen fixes.

It applies the source framework's "Container + Content" pattern (`_bmad/wds/data/design-system/component-boundaries.md`: "Container provides structure, content is flexible"; "Card is a container, button is an action. Different purposes.") and its "Patterns organized by spacing" idea (`design-process/D-Design-System/00-design-system.md`: spacing is relational, a decision about two object types). In CVH, the relation between two siblings belongs to their parent, never to either sibling.

## 1. Three kinds of part

| Kind | Examples (pilot) | Owns | Never owns |
| --- | --- | --- | --- |
| **Layout primitive** | `Screen`, `Stack`, `Inline`, `Grid` (specs in `components/`) | Gap between its children; inset of the screen region; alignment; maximum inline size; column count, its collapse in basic mode and the two-column switch of Hub pages; the sticky actions region of a screen | Colour, border, radius, shadow, type, any visible surface; any margin on itself |
| **Shell** | Resident shell (`C_ResidentHeader` + scrolling main + `C_ResidentNav`, R-02 overlay layer); Hub shell (`C_HubTop` + `C_HubSide` + body) | The frame around screens: header and nav, scroll container, overlay layer, safe-area padding, which navigation shows at which width | The inside of a screen (that is `Screen`'s job) |
| **Content component** | Button, icon button, chip, tag, status chip (`C_IncidentStatus`), 911 block (X-01), origin and verification marker (X-02), disruption type (X-13), machine-translation label (X-04), exercise marker (X-10), applied-filter bar (X-11), tailored block (X-12), "How they can help" box (X-14), alert card, listing card, field, round item | Its own internal padding, border, radius, background, and the gaps between its own internal parts, all through its component tokens | Any outer margin; its position relative to siblings; its width beyond `100%` of its slot or its intrinsic width |

## 2. Rules

### R1 — Content components have no outer margin

A content component's outermost element sets no `margin`, `margin-block-*` or `margin-inline-*`. The space around it comes from the parent primitive's `gap`.

- Prototype counter-example not to port: `.cvh-disabled-reason { margin-top: 6px }` and 24 other `margin-top` rules in `cvh.css`. In the app, a disabled reason sits in a `Stack gap="label"` with its button.
- Prototype counter-example not to port as a literal: `.cvh-tailored__item .cvh-ico { margin-top: 3px }`, an optical nudge on an inner part. If an icon needs optical alignment, the component uses `align-items: baseline` or a component token that resolves to `--offset-align-icon` (3 px) or `--offset-align-hairline` (1 px), documented with the reason, as the source framework's "optical adjustments via token math" rule requires ("always annotate why"). The offset is set on the component's inner part, never on its outermost element.

### R2 — Siblings are spaced by their parent

Space between two things is a `gap` on the primitive that contains them. A component never adds space "for the next thing". This removes double spacing (margin-bottom of one plus margin-top of the next) and makes order changes safe (the 911 block moves to the top of a guide, or above search results, without spacing changes).

### R3 — Insets belong to the region, not the content

Screen gutters and region insets are set once by `Screen` (or by the shell for header, nav and bars). A content component inside a screen never adds the gutter itself. A content component that must touch the screen edges (a map, a full-width filter bar) is placed in a `Screen` with `inset="none"` or in its `bleed` slot, not pulled out with negative margins.

- Prototype counter-example not to port: `.cvh-pubbar { bottom: -24px; margin-bottom: -24px }` and `.cvh-hub--narrow .cvh-ps-bar { margin: 0 -16px -16px }` pull the sticky action bar out of the body padding. In the app the action bar is `Screen`'s `actions` slot, which sits outside the inset. The "no negative margins" check enforces this.

### R4 — Primitives draw nothing

A layout primitive has no background, border, radius or shadow. If a region needs a surface (a raised card, a band), that is a content component that contains a primitive. This keeps the two-layer theming rule simple: only content components read colour tokens, so switching light and navy cannot change spacing.

### R5 — One way to make a touch target

Every interactive element meets the minimum touch target through the `tap` rule (see `components/touch-target.md`), applied by the interactive content component itself (button, chip, nav item, link-as-button). A primitive never enlarges its children, and a wrapper element is never added just to make something bigger.

### R6 — Logical properties only

All parts use logical properties and the allowed Tailwind utilities listed in `token-architecture.md` section 6. Directional decoration (an active-item stripe) uses `border-inline-start`, not an inset `box-shadow` with an x offset. No part has a `[dir="rtl"]` rule except the icon-mirroring rule.

### R7 — Basic mode is read in one place per part

Basic mode is `data-basic="true"` on `<html>`. Only these react to it:

| Part | What changes |
| --- | --- |
| `tap` rule | Minimum size becomes `--tap-basic` |
| `Grid` with `collapseInBasic` | Becomes one column |
| Content components | Larger type and icons through their component tokens; parts marked decorative or secondary are not rendered (the prototype's `.cvh-decor` and `.cvh-hide-basic`) |
| Resident shell | Nav items use the basic minimum block size, `--size-nav-item-resident-min-basic` (80 px) |

Gaps and insets do not change in basic mode (G2; the prototype keeps them the same). A screen never checks basic mode to change spacing.

### R8 — No component sets its own width from the viewport

Only the Hub shell responds to the Hub breakpoint (with `Screen`'s staff inset, which switches with it), and only `Grid` with `twoColumn` responds to the two-column container width. Content components fill their slot (`inline-size: 100%` where they are blocks) or size to content. This is what lets one component work at 320, 390, 768 and 1280 px.

## 3. Applied to the pilot shells and screens

### 3.1 Resident shell (S02.02; C_ResidentHeader, C_ResidentNav, ResidentApp)

```text
<html dir lang data-basic>
└─ ResidentShell (shell)                         owns: header, scroll container, bottom nav, overlay layer
   ├─ C_ResidentHeader (shell part)              owns its inset: --gutter-resident; tools row as Grid
   │   └─ language button, basic-mode switch, "My choices" (content, each meets tap)
   ├─ main (scrolls)
   │   └─ Screen surface="resident"              owns: gutter inset, block padding, section gap
   │       └─ Stack / Inline / Grid → content components
   ├─ C_ResidentNav (shell part)                 4 equal items; item size from tap rule (basic: larger)
   └─ R-02 overlay (shell layer)                 sheet head and body inset use --gutter-resident
```

- At 320, 390 and 768 px nothing switches; the layout is fluid (`token-architecture.md` section 7).
- In RTL the header's logo and language button swap ends because the row is an `Inline` with `justify="between"`, not because of a `[dir]` rule.
- The 911 block (inline variant on home, full variant on alerts, guides, numbers and check-in) is a child of the screen's top-level `Stack`; its position is decided by the screen, its spacing by the `Stack`.

### 3.2 Hub shell (S01.09; C_HubTop, C_HubSide, HubApp)

```text
HubShell (shell)
├─ below the Hub breakpoint (viewport < 700 px): C_HubTop with menu button; side nav hidden, opens as an overlay
├─ at or above the Hub breakpoint (viewport ≥ 700 px): Grid of side nav (--size-side-nav, 240 px) + main column
├─ C_HubTop (shell part): Inline justify="between"; title; signed-in person and role; sign-out
└─ main
    └─ Screen surface="staff"     inset: --inset-page-staff-narrow (16 px) below, --inset-page-staff (24 px) at or above the breakpoint
                                   max inline size: --size-page-staff (1040 px; 1080 px on review pages)
                                   content box = query container "hub-page"
        └─ Grid twoColumn=…        two-column pages only: one column below 800 px of content width, two at or above
```

The Hub has **one viewport breakpoint and one container query. They are two different tokens and must not be conflated.**

| | Hub breakpoint | Two-column container width |
| --- | --- | --- |
| Token | `app-breakpoint-hub` → `--breakpoint-hub` (variant `hub:`) | `app-container-hub-two-column-min` → `--container-hub-two-column` (variant `@hub-two-column:`) |
| Value | 700 px | 800 px |
| Measured against | The viewport (`@media`) | The available content width inside the page padding: the `Screen` staff content box, the query container `hub-page` (`container-type: inline-size`) (`@container`) |
| Read by | The Hub shell only: below it the side navigation is hidden and the page inset is narrow | `Grid` on two-column pages only (O-01, O-02, O-03, O-04, O-05, O-06, O-07, O-12, O-13, O-14) |
| Below | Side navigation hidden; inset 16 px | One column: main content first, the aside after it filling the available width and not sticky; gap `--gap-section-hub` (20 px) |
| At or above | Side navigation shown; inset 24 px | Flexible main column (`minmax(0, 1fr)`) plus the aside at the page's approved size (380 px, or 300 px compact, or two equal columns) and the page's approved gap (`--gap-columns-hub` 28 px on review pages, `--gap-panel` 24 px on the others) |

- With the side navigation shown, content width = viewport − 240 − 2 × 24. 800 px of content is a viewport of 1088 px; 799 px is 1087 px. Below 700 px the content is at most 668 px, so two-column pages are always one column there.
- Approval and publish actions stay in `Screen`'s sticky `actions` slot (prototype `.cvh-pubbar`) in both layouts.
- The prototype switches its shell at a frame width below 700 px. Page columns no longer follow that switch: a page that is one column at 1087 px and two columns at 1088 px is expected.
- Sign-out and the role display must be reachable at 390 px without horizontal scrolling (S01.09); they are in `C_HubTop`, an `Inline` that may `wrap`.

### 3.3 Approval view (O-05, S04.07)

```text
Screen surface="staff" actions={<ApprovalActions/>}
├─ Grid twoColumn="aside"   two columns at ≥ 800 px of content width (aside 380 px, gap 28 px); one column below (gap 20 px)
│   ├─ Stack gap="section-hub": English text, audience in words, channels, recipient count, cost, fallback languages
│   └─ Stack (aside): other languages, one tap away
└─ actions slot (sticky, outside the inset, full width): Approve, Return to author, Discard
```

- "Above the fold" and "Approve within thumb reach" (S04.07, AD-21) are met by the `actions` slot: sticky at the block end of the screen, buttons full width when the slot is too narrow for them side by side. The prototype's negative-margin sticky bar is not ported (R3).
- The aside is static when the page is one column and sticky in two columns (prototype `.cvh-ha-aside`); this is `Grid`'s concern, not the content's. Which layout applies depends on the content width (800 px), not on the Hub breakpoint.

### 3.4 Ambassador round page (A-04, S08.07)

```text
Screen surface="resident" (phone; staff route, resident-style frame as in the prototype)
├─ Stack gap="section-resident"
│   ├─ round summary (content: counts, "Keep this page open until marks are sent")
│   └─ Stack gap="stack" as="ul": one round item per request (content component)
│       └─ round item: Stack; phone and floor; Grid cols=3 of mark buttons (done / not reached / needs help)
└─ actions slot: queued-marks status
```

- One-handed use: mark buttons are full-width cells of a 3-column `Grid` with `gap="target"` (`--gap-target`, 8 px, G3), each meeting the `tap` rule; in basic mode they meet `--tap-basic`. The prototype draws them at 60 px high and 6 px apart (`.cvh-mark`, `.cvh-marks`); G3 makes separate controls at least 8 px apart.
- The round page holds no spacing state; nothing about layout is persisted (AD-1 page-memory rule is unaffected).

## 4. Decision checklist for a new part

Use this before adding a component or primitive (adapted from the source's "Decision Framework"):

1. Does it only arrange children? → use an existing primitive. Add a new primitive only when two pilot screens need the same arrangement that `Screen`, `Stack`, `Inline` and `Grid` cannot express.
2. Does it draw a surface or hold content? → it is a content component: give it component tokens for its insides and no outer margin.
3. Does it need a new spacing value? → find the semantic token. If none fits, the value goes to the design owner for `tokens.json`; a value off the app scale is added as a rare step with its `locations` (`rare-spacing-inventory.md`). Never add a number in code.
4. Does it behave differently in RTL? → only through logical properties. If a `[dir]` rule seems needed, the part is using a physical property somewhere.
5. Does it change in basic mode? → only through the `tap` rule, `Grid` collapse, or its own type and icon tokens (R7).
