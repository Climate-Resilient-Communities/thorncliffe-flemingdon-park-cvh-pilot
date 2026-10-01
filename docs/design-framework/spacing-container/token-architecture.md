# Spacing token architecture

> **Status: approved framework (2026-10-01); unresolved token values are still draft.** The rules and primitives here are implementation requirements for S01.16 and the stories that use them. Token values marked **unresolved** have no approved value, stay draft until the design owner decides them in `tokens.json`, and nothing may hard-code them. The plan changes were applied from the change proposal [`docs/planning/pilot/change-proposals/2026-10-01-spacing-framework.md`](../../planning/pilot/change-proposals/2026-10-01-spacing-framework.md) to `epics.md` and AD-16.

How spacing, sizing and layout values reach CVH screens. Every value in this document is either copied from `design/prototype/ds/cvrh/tokens.json` (the only source of design tokens, AD-16) or is listed under [Gaps and decisions needed](#11-gaps-and-decisions-needed) with no value assigned.

Where a value appears in the prototype's `design/prototype/cvh/cvh.css` but not in `tokens.json`, it is quoted as an observation, never as a token.

## 1. Three layers

The layering comes from the source framework (`_bmad/wds/data/design-system/token-architecture.md`: raw → semantic → component, "use Level 2 or 3 in components, never Level 1 directly") and its theming rule (`dilawriweb/packages/ui/THEMING.md`: no component file may reference a primitive directly).

| Layer | What it holds | Where it lives in CVH | Who writes it | May be used by |
| --- | --- | --- | --- | --- |
| 1. Primitive | The values in `tokens.json`, copied with their names unchanged | `src/ui/tokens/tokens.generated.css` | `npm run gen:tokens` (S01.16). Never edited by hand | Layer 2 only |
| 2. Semantic | Names for a job ("gap between icon and label"), each one a `var()` of a primitive | `src/ui/tokens/semantic.css` | A developer, reviewed against this document | Layout primitives, layer 3, the Tailwind theme |
| 3. Component | Values one component needs ("inset of the 911 block"), each one a `var()` of a semantic token | Next to the component in `src/ui/` | A developer | That component only |

Rules:

1. Layer 1 is generated. A snapshot test (S01.16) fails if any generated value differs from `tokens.json`.
2. Layer 2 and layer 3 never contain a number. Every right-hand side is `var(--…)`. A CI check enforces this (see [Automated checks](#10-automated-checks)).
3. Components and screens use layer 2 or 3. A file under `src/app/` or a content component under `src/ui/` that references `--space-N` directly fails the check.
4. Spacing does not change with theme, language or script. Only colour changes between light and navy (section 5). Line height changes by script (section 6), spacing does not.

## 2. Layer 1: primitives from `tokens.json`

### 2.1 Spacing

Copied from `tokens.json` → `spacing.tokens`. The `usage` column is the text in `tokens.json`.

| CSS custom property | Value | `tokens.json` usage |
| --- | --- | --- |
| `--space-1` | 4px | Short rule thickness; gap between label and input. |
| `--space-2` | 10px | Accent bar thickness; icon-to-label gap. |
| `--space-3` | 17px | Gutter inside a card grid. |
| `--space-4` | 24px | Gutter between panels; paragraph gap; card padding on screens. |
| `--space-5` | 29px | Card padding on slides. |
| `--space-6` | 48px | Outer margin of card rows; the short rule's length. |
| `--space-7` | 67px | Page inset for title blocks on slides. |

This is not a regular 4 px or 8 px grid. It was derived from slides and documents (`tokens.json` → `meta.source`). `--space-5` and `--space-7` are slide values and have no use on pilot screens.

### 2.2 Radius

| CSS custom property | Value | `tokens.json` usage (shortened) |
| --- | --- | --- |
| `--radius-none` | 0 | Slide containers |
| `--radius-card` | 16px | Everything you can touch, and document and screen containers |
| `--radius-header` | 88px | The one swooping corner of the PageHeader, once per page |
| `--radius-disc` | 50% | Icon discs and portrait crops |

Radius is listed because containers and content components share it. Layout primitives never set a radius (see `component-boundaries.md`).

### 2.3 Type sizes that affect layout

`tokens.json` → `type.groups["Documents and screens"]` gives `doc-body` 16px / 1.5, `doc-body-sm` 15px, `doc-cta` 17px, `doc-heading` 21px and others. Spacing primitives do not depend on them. They matter here only because the resident type minimums used by the prototype (18 px body, 20 px alert, 22 px in basic mode) are not in `tokens.json` (gap G7).

### 2.4 Values the prototype uses that are not primitives

The prototype's own stylesheet adds values on top of `tokens.json`. Its header says "Additions below them come from the brief, Section 9". These are **observations, not tokens**. The S01.16 generator will not produce them, and nothing in `src/` may hard-code them. Each one is a gap in section 11.

| Name in `cvh.css` | Observed value | Where | Gap |
| --- | --- | --- | --- |
| `--gutter` | 16px | `:root`; used 19 times for screen and bar insets | G2 |
| `--tap` | 44px (56px under `.cvh-basic`) | `:root`, `.cvh-basic` | G3 |
| `.cvh-stack` default gap | 12px | `--gap` fallback | G1 |
| `.cvh-row` default gap | 10px | `--gap` fallback (equals `--space-2`) | none |
| `.cvh-screen` | padding 16px / gutter / 24px, gap 16px | resident screen body | G1, G2 |
| `.cvh-hubbody` | padding 24px (16px when narrow) | Hub body | G1 for 16px |
| `.cvh-card` | padding 16px (12px for `--tight`) | card | G6 |
| Raw spacing values across `cvh.css` | 8px (203 uses), 10px (187), 12px (170), 6px (131), 14px (110), 4px (99), 16px (80), 2px (57), 24px (17), 20px (17), 18px (13) | padding, margin and gap declarations | G1 |
| Raw spacing values in screen markup (`*.dc.html` inline `--gap`) | 8px (147), 6px (106), 10px (76), 4px (45), 2px (41), 12px (17) | inline `style` attributes | G1 |

Only 4, 10 and 24 px from this list are on the `tokens.json` scale. `Lib_Foundations.dc.html` says "Spacing from the design system (4, 10, 17, 24, 29, 48, 67)", but the stylesheet mostly uses a different set. This drift is the same kind the source framework records in its README ("Known drift" between `Spacing.mdx` and `globals.css`) and has to be settled before S01.16 (gap G1).

## 3. Layer 2: semantic tokens

### 3.1 Semantic tokens that can be defined now

Each one aliases a primitive whose `tokens.json` usage text describes the same job (one exception, `--inset-screen-end`, is marked). Nothing here is a new number.

| Semantic token | Resolves to | Value | Basis in `tokens.json` | Used by |
| --- | --- | --- | --- | --- |
| `--gap-label` | `var(--space-1)` | 4px | "gap between label and input" | Field label to control; `Stack gap="label"` |
| `--gap-icon` | `var(--space-2)` | 10px | "icon-to-label gap" | `Inline gap="icon"`; button, chip and nav item internals |
| `--gap-grid` | `var(--space-3)` | 17px | "Gutter inside a card grid" | `Grid gap="grid"` (find tiles, card grids) |
| `--gap-panel` | `var(--space-4)` | 24px | "Gutter between panels" | `Grid gap="panel"` (Hub main and aside columns) |
| `--gap-paragraph` | `var(--space-4)` | 24px | "paragraph gap" | `Stack gap="paragraph"` (guide text) |
| `--inset-card` | `var(--space-4)` | 24px | "card padding on screens" | Layer 3 tokens of cards (see G6 before use) |
| `--inset-page-staff` | `var(--space-4)` | 24px | "Gutter between panels"; matches `.cvh-hubbody` padding 24px in the prototype | `Screen surface="staff"` at wide widths |
| `--inset-screen-end` | `var(--space-4)` | 24px | Not named in `tokens.json`; the prototype's `.cvh-screen` bottom padding is 24px, which is `space-4` | `Screen surface="resident"` block-end inset (room above the bottom nav) |
| `--rule-length` | `var(--space-6)` | 48px | "the short rule's length" | The short accent rule (content component) |
| `--rule-thickness` | `var(--space-1)` | 4px | "Short rule thickness" | The short accent rule |
| `--bar-thickness` | `var(--space-2)` | 10px | "Accent bar thickness" | Accent bars on panels and callouts |

`--space-5`, `--space-6` (as an outer margin) and `--space-7` are slide and document values. They get no semantic name in the app. If a pilot screen needs them, add a semantic name here first.

### 3.2 Semantic tokens that need a value (no value assigned)

These names are reserved so specs and code can refer to them. Until the design owner sets a value in `tokens.json` (section 11), they are **not generated**, and the primitive specs in `components/` list them as "blocked by Gn".

| Reserved semantic token | Job | Observed in prototype (not a token) | Gap |
| --- | --- | --- | --- |
| `--gutter-resident` | Inline inset of resident screens, header, bars, sheets | 16px (`--gutter`) | G2 |
| `--inset-page-staff-narrow` | Inline and block inset of Hub screens below the Hub breakpoint | 16px | G1 |
| `--gap-section` | Space between sections of a screen | 16px resident (`.cvh-screen`), 20px Hub (`.cvh-hpage`) | G1 |
| `--gap-stack` | Default gap between related items in a stack | 12px (`.cvh-stack`) | G1 |
| `--gap-tight` | Gap between a title and its one-line sub-text | 2px to 6px | G1 |
| `--gap-target` | Minimum space between two touch targets | 8px (`Lib_Foundations`: "8px between targets") | G3 |
| `--tap` | Minimum touch target size | 44px (also the spine's Accessibility convention and UX-DR19) | G3 |
| `--tap-basic` | Minimum touch target in basic mode | 56px (`Lib_Foundations`: "56 in bigger-text mode") | G3 |
| `--size-page-staff` | Maximum inline size of a Hub page | 1040px, 1080px, 1140px in different screens | G5 |
| `--size-side-nav` | Hub side navigation width | 240px | G5 |
| `--size-aside-staff` | Hub aside column width (approval view, compose) | 380px | G5 |
| `--size-reading` | Maximum inline size of resident reading content at 768 px | none (content stretches) | G5 |

## 4. Layer 3: component tokens

Component tokens are declared next to the component and alias layer 2. Examples of the pattern (names only; values follow from layer 2):

```css
/* src/ui/layout/screen.css */
.screen[data-surface="resident"] {
  --screen-inset-inline: var(--gutter-resident);   /* blocked by G2 */
  --screen-gap: var(--gap-section);                /* blocked by G1 */
}
.screen[data-surface="staff"] {
  --screen-inset-inline: var(--inset-page-staff);
  --screen-max-inline-size: var(--size-page-staff); /* blocked by G5 */
}

/* src/ui/alerting/not-911-block.css (content component) */
.not-911-block {
  --not-911-block-inset: var(--inset-card);         /* see G6 */
  --not-911-block-gap: var(--gap-icon);
}
```

Rule: a component token name starts with the component's file name (`--screen-…`, `--not-911-block-…`). See `naming-conventions.md`.

## 5. Themes: light and navy

`tokens.json` declares two colour themes: `light` ("Light") and `dark` ("Navy"). Only colour tokens have per-theme values. Spacing, radius and type have one value.

| Concern | Rule |
| --- | --- |
| Where theme values go | Light values on `:root`; navy values under `[data-theme="dark"]` (the selector the design system's `components/bundle.css` already uses). The generator keeps the theme id `dark` from `tokens.json`; docs call it "navy". |
| Spacing per theme | None. The generator writes spacing and radius once, on `:root`. A test asserts that no `--space-*` or `--radius-*` property appears inside a `[data-theme]` block. |
| Layout per theme | None. Changing theme must not move anything. Screenshot tests at the same width in both themes must have identical element boxes (only colours differ). |
| Prototype status | `cvh.css` defines only the light values; no prototype screen uses navy. Generating navy is required by UX-DR1 and S01.16. Whether any pilot screen uses it is a design decision (G9), not a spacing one. |

## 6. Right to left, scripts and fonts

`ur`, `ps` and `prs` are right to left (`design/prototype/cvh/data.js`, AD-16). Spacing tokens are direction-free. Direction is handled by which CSS properties use them.

| Rule | Detail |
| --- | --- |
| Logical properties only | Use `padding-inline`, `padding-inline-start`, `padding-block`, `margin-inline-end`, `inset-inline-start`, `border-inline-start`, `inline-size`, `max-inline-size`. Never `left`, `right`, `margin-left`, `padding-right`, `border-left` and similar. |
| No 3- or 4-value shorthands | `padding: 6px 10px 6px var(--gutter)` (prototype `.cvh-rhead__top`) is physical on the inline axis and needed a `[dir="rtl"]` override. Write `padding-block` plus `padding-inline-start` and `padding-inline-end` instead. The 1- and 2-value forms are allowed because they are symmetric. |
| No directional box-shadow | `box-shadow: inset 3px 0 0` (prototype `.cvh-side__item.is-active`) needed a `[dir="rtl"]` override. Use `border-inline-start` for a side indicator. Block-axis shadows (`inset 0 3px 0`) are allowed. |
| Mirrored icons | Direction icons mirror, media and clock icons do not (prototype `cvh.css` rule on `.cvh-ico--arrow` and others). This is an icon rule, not a spacing one; listed because it is the only `[dir="rtl"]` rule that stays. |
| Line height by script | The prototype raises line height for Arabic-script (`ur`, `ps`, `prs`: 1.9), Indic (1.75) and Chinese (1.7) text. This changes block size, not spacing tokens. Stacks must not assume a fixed row height. |
| Fonts | Only the active language's Noto subset is loaded (AD-16, S02.02). Spacing does not change by font. |

### Tailwind utilities allowed for direction-sensitive spacing

| Allowed (logical) | Banned (physical) |
| --- | --- |
| `ps-*`, `pe-*`, `ms-*`, `me-*`, `px-*`, `py-*`, `mx-*`, `my-*`, `start-*`, `end-*`, `border-s`, `border-e`, `rounded-s-*`, `rounded-e-*` | `pl-*`, `pr-*`, `ml-*`, `mr-*`, `left-*`, `right-*`, `border-l`, `border-r`, `rounded-l-*`, `rounded-r-*`, `space-x-*` (relies on margins) |

In Tailwind v4, `px-*` and `mx-*` compile to `padding-inline` and `margin-inline`, so they are safe. Confirm this against the pinned Tailwind 4.3.3 output in the S01.16 test.

## 7. Breakpoints and test widths

`tokens.json` has **no breakpoints** (gap G4). What the plan and the prototype require:

| Surface | Widths in the plan | What changes at those widths in the prototype |
| --- | --- | --- |
| Resident | 320, 390, 768 px (UX-DR3, S02.02) | Nothing. Resident screens are fluid; `ResidentApp_320` and `ResidentApp_768` render the same layout at a different frame width. No media query, no width logic in any `R*.dc.html`. |
| Hub | 390 and 1280 px (UX-DR15, S01.09) | One switch. Every `O*.dc.html` sets `narrow = w < 700`; `.cvh-hub--narrow` hides the side navigation and collapses two-column layouts to one. |
| Ambassador | phone (A-xx run inside the phone frame) | Nothing. |

Consequences for the pilot:

- The resident surface needs **no breakpoint**. 320, 390 and 768 are test widths for screenshots, not layout switches.
- The Hub needs **one breakpoint** (side navigation and two columns at and above it). Its value is not in `tokens.json`; the prototype switches at 700 px of frame width. Gap G4.
- Tailwind's default breakpoints are removed so nobody uses `md:` or `lg:` by habit. The one Hub breakpoint is added once G4 is settled.

## 8. Basic mode

Basic mode (X-07) is a device choice that switches to the prototype's basic layouts (AD-16). The prototype implements it as a class on the root (`.cvh-basic`) that overrides variables.

| What changes in basic mode (prototype) | Token status |
| --- | --- |
| Touch target 44 → 56 px (`--tap`) | Not in `tokens.json` (G3) |
| Type sizes up (body 22, alert 24, h1 30) and icon 24 → 28 px | Not in `tokens.json` (G7) |
| Resident nav item min-height 64 → 80 px | Not in `tokens.json` (G8) |
| Two-column tile grids become one column (`.cvh-basic .cvh-find-tiles`) | Behaviour, no token: `Grid` collapses (see `components/grid.md`) |
| Decorative items and secondary lines hidden (`.cvh-decor`, `.cvh-hide-basic`) | Behaviour, no token |
| Gaps and insets | **Unchanged** in the prototype. Spacing tokens have one value in both modes. |

In the app, basic mode is a `data-basic="true"` attribute on `<html>`, set from device choices before first paint. Primitives and component tokens read it; nothing else does.

## 9. Generated output and Tailwind v4 theme (S01.16)

`npm run gen:tokens` reads `tokens.json` and writes `src/ui/tokens/tokens.generated.css`. A hand-written `src/ui/tokens/semantic.css` adds layer 2. `src/ui/tokens/theme.css` maps layer 2 into Tailwind.

```css
/* src/ui/tokens/tokens.generated.css — GENERATED from design/prototype/ds/cvrh/tokens.json. Do not edit. */
:root {
  --space-1: 4px; --space-2: 10px; --space-3: 17px; --space-4: 24px;
  --space-5: 29px; --space-6: 48px; --space-7: 67px;
  --radius-none: 0; --radius-card: 16px; --radius-header: 88px; --radius-disc: 50%;
  --surface: #fafafa; --surface-raised: #ffffff; /* … every colour token, light value … */
}
[data-theme="dark"] {
  --surface: #002a45; --surface-raised: #1f4068; /* … every colour token with a dark value … */
}
```

```css
/* src/ui/tokens/semantic.css — layer 2. Every value is a var() of a generated primitive. */
:root {
  --gap-label: var(--space-1);
  --gap-icon: var(--space-2);
  --gap-grid: var(--space-3);
  --gap-panel: var(--space-4);
  --gap-paragraph: var(--space-4);
  --inset-card: var(--space-4);
  --inset-page-staff: var(--space-4);
  --inset-screen-end: var(--space-4);
  --rule-length: var(--space-6);
  --rule-thickness: var(--space-1);
  --bar-thickness: var(--space-2);
  /* Reserved, blocked by gaps G1–G5: --gutter-resident, --inset-page-staff-narrow, --gap-section,
     --gap-stack, --gap-tight, --gap-target, --tap, --tap-basic, --size-page-staff,
     --size-side-nav, --size-aside-staff, --size-reading */
}
```

```css
/* src/ui/tokens/theme.css — Tailwind v4 */
@import "tailwindcss";
@import "./tokens.generated.css";
@import "./semantic.css";

@theme inline {
  /* Remove Tailwind's numeric spacing scale and default breakpoints. */
  --spacing-*: initial;
  --breakpoint-*: initial;

  /* Spacing: semantic names only. Gives gap-icon, p-card, ps-gutter, and so on. */
  --spacing-label: var(--gap-label);
  --spacing-icon: var(--gap-icon);
  --spacing-grid: var(--gap-grid);
  --spacing-panel: var(--gap-panel);
  --spacing-paragraph: var(--gap-paragraph);
  --spacing-card: var(--inset-card);
  --spacing-page-staff: var(--inset-page-staff);
  /* Added when the gaps are closed: --spacing-gutter, --spacing-section, --spacing-stack,
     --spacing-tight, --spacing-target, --spacing-tap, --spacing-tap-basic,
     --breakpoint-hub (G4). */

  /* Radius */
  --radius-*: initial;
  --radius-card: var(--radius-card);   /* see note below */
  --radius-disc: var(--radius-disc);

  /* Colour (switches with [data-theme="dark"] because it points at the generated variables) */
  --color-surface: var(--surface);
  --color-surface-raised: var(--surface-raised);
  /* … one line per colour token … */
}
```

Notes for S01.16:

- Tailwind v4 theme variables are themselves CSS custom properties. A theme variable may not point at a variable with the same name (`--radius-card: var(--radius-card)` is circular). Either have the generator write the radius values straight into `@theme`, or prefix the generated radius tokens. Pick one in S01.16 and add a test; the spacing namespace (`--spacing-*`) does not collide with `--space-*`.
- Primitives (`--space-N`) are deliberately **not** exposed as Tailwind utilities, so `p-space-2` cannot be written. This applies the source rule "never Level 1 directly" through the build rather than by review.
- Check in the S01.16 test that the reset really removes the default scale in Tailwind 4.3.3: a fixture using `p-4`, `gap-2` and `md:flex` must produce no CSS.
- The reset does not stop arbitrary values: Tailwind compiles `p-[13px]` whatever the theme defines. The spacing check (section 10) rejects them instead.

## 10. Automated checks

These are the testable rules behind this document. They run in CI on `src/`.

| Check | Fails when | Proposed story |
| --- | --- | --- |
| Token snapshot | A generated value differs from `tokens.json` | S01.16 |
| Semantic purity | A declaration in `semantic.css` or a component token has a value that is not a single `var(--…)` | S01.16 |
| No primitives outside layer 2 | `var(--space-` appears in any file except `semantic.css` | S01.16 |
| Spacing from tokens only (proportionate) | A `padding*`, `margin*`, `gap`, `row-gap` or `column-gap` value in `src/` is a literal length that is not `0` and not an approved spacing token; or a Tailwind spacing class uses an arbitrary value (`p-[13px]`, `gap-[1rem]`). It does **not** check border widths, icon and image sizes, positioning (`top`, `inset*`, `translate`) or line height. A reviewed exception is allowed with a `/* spacing-exception: reason */` comment, which the check lists in its report | S01.16 |
| Logical CSS only | Any of `left`, `right`, `margin-left`, `margin-right`, `padding-left`, `padding-right`, `border-left*`, `border-right*`, `float: left/right`, `text-align: left/right`, a 3- or 4-value `margin`/`padding` shorthand, or a physical Tailwind utility (section 6) appears in `src/` | S02.02 (already named; widened here) |
| No negative margins without a reason | A negative `margin*` or a `-m*` Tailwind utility appears in `src/` without a `spacing-exception` comment | S01.16 |
| One value per theme | A `--space-*` or `--radius-*` appears inside a `[data-theme]` block | S01.16 |
| No undeclared custom property | A `var(--x)` in `src/` has no matching `--x:` declaration in the generated, semantic or component token files (the check the source framework's `audit-css-custom-properties.js` runs) | S01.16 |
| Touch targets | An interactive element's box is smaller than `--tap` (44 px; 56 px in basic mode) at 320 px | S02.14 (already named for 44 px; basic size added) |

## 11. Gaps and decisions needed (all unresolved)

These need a decision by the design owner (the person who maintains `tokens.json`) before S01.16. No value is proposed here; where the prototype shows a value, it is cited so the decision is quick.

| # | Gap | Evidence | Recommendation |
| --- | --- | --- | --- |
| G1 | **Unresolved.** The screen spacing scale used by the prototype (2, 6, 8, 12, 14, 16, 20 px and others) is not in `tokens.json`; `tokens.json` has 4, 10, 17, 24, 29, 48, 67 | Section 2.4 counts | Reconcile `tokens.json` with the approved prototype: replace its spacing steps with the values the prototype actually uses, so the app still has exactly one spacing scale (no second "screens" set). Rare values are not folded automatically: each is kept as a named step where an approved screen needs it, or changed by a recorded design decision. Details are in the change proposal. |
| G2 | Resident gutter | `--gutter: 16px` in `cvh.css` | Add as a named screen token in `tokens.json`. |
| G3 | Touch target sizes and target spacing | `--tap: 44px`, basic `56px`, "8px between targets" in `Lib_Foundations` | Add to `tokens.json` (44 is already required by the spine and UX-DR19; having it in the token file gives one source). |
| G4 | No breakpoints | Hub switches at a frame width of 700 px (`O*.dc.html`); design system `bundle.css` uses `max-width: 767px` | Add one Hub breakpoint to `tokens.json`. No resident breakpoint is needed for the pilot. |
| G5 | No size tokens for containers | Hub page max widths 1040, 1080, 1140; side nav 240; aside 380; resident content unbounded at 768 | Add one Hub page width, the side nav width and the aside width. Decide whether resident content should stop stretching at 768 px; the prototype does not cap it. |
| G6 | Card padding disagrees | `tokens.json` says 24px "card padding on screens"; `.cvh-card` uses 16px, most cards 12–14px | Decide which wins. Until then content components use their own component tokens, flagged for review. |
| G7 | Resident type minimums and basic-mode type sizes are not in `tokens.json` | `--fs-body: 18px`, basic `22px` etc. in `cvh.css` (brief Section 9) | Outside spacing, but it blocks basic mode the same way. Add a "screens" type set and a basic-mode set. |
| G8 | Shell dimensions | Header min-height 60, nav item 64 (basic 80), Hub top bar 60 | Add as component tokens in `tokens.json`, or accept them as derived from `--tap` plus padding once G1 and G3 are settled. |
| G9 | Navy theme on screens | `tokens.json` has navy; `cvh.css` and every screen are light only | Generate both (S01.16 requires it). Record that no pilot screen uses navy unless the design owner says otherwise. |
| G10 | Line height by script | `cvh.css` sets 1.9 / 1.75 / 1.7 for Arabic, Indic, Chinese | Add to `tokens.json` type, so S02.02 does not hand-copy them. |

Until a gap is closed, the related semantic token stays reserved and unset, and the story that needs it carries an open item rather than a hard-coded number.
