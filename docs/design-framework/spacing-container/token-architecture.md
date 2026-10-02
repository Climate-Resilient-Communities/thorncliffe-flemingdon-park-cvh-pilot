# Spacing token architecture

> **Status: approved framework (2026-10-01); token values decided by the design owner on 2026-10-02 (G1–G10, section 11).** The rules, primitives and token values here are implementation requirements for S01.16 and the stories that use them. Values come from `design/prototype/ds/cvrh/tokens.json`; rare values and where they are used are in [`rare-spacing-inventory.md`](rare-spacing-inventory.md). The plan changes were applied from the change proposal [`docs/planning/pilot/change-proposals/2026-10-01-spacing-framework.md`](../../planning/pilot/change-proposals/2026-10-01-spacing-framework.md) to `epics.md` and AD-16.

How spacing, sizing and layout values reach CVH screens. Every value in this document is copied from `design/prototype/ds/cvrh/tokens.json` (the only source of design tokens, AD-16). The design owner's decisions behind the screen values are in [section 11](#11-decisions-g1g10).

Where a value appears in the prototype's `design/prototype/cvh/cvh.css`, it is quoted as evidence for a token, never used directly.

## 1. Three layers

The layering comes from the source framework (`_bmad/wds/data/design-system/token-architecture.md`: raw → semantic → component, "use Level 2 or 3 in components, never Level 1 directly") and its theming rule (`dilawriweb/packages/ui/THEMING.md`: no component file may reference a primitive directly).

| Layer | What it holds | Where it lives in CVH | Who writes it | May be used by |
| --- | --- | --- | --- | --- |
| 1. Primitive | The values in `tokens.json`, copied with their names unchanged | `src/ui/tokens/tokens.generated.css` | `npm run gen:tokens` (S01.16). Never edited by hand | Layer 2 only |
| 2. Semantic | Names for a job ("gap between icon and label"), each one a `var()` of a primitive | `src/ui/tokens/semantic.css` | A developer, reviewed against this document | Layout primitives, layer 3, the Tailwind theme |
| 3. Component | Values one component needs ("inset of the 911 block"), each one a `var()` of a semantic token | Next to the component in `src/ui/` | A developer | That component only |

Rules:

1. Layer 1 is generated from the app groups of `tokens.json` (`spacing.app`, `size`, the "Screens" type groups, `type.lineHeights`, `radius` and `color`). A snapshot test (S01.16) fails if any generated value differs from `tokens.json`.
2. Layer 2 and layer 3 never contain a number. Every right-hand side is `var(--…)`. A CI check enforces this (see [Automated checks](#10-automated-checks)).
3. Components and screens use layer 2 or 3. A file under `src/app/` or a content component under `src/ui/` that references an `--app-*` primitive directly fails the check.
4. Spacing does not change with theme, language, script or basic mode. Only colour changes between light and navy (section 5). Line height changes by script (section 6); type, icon, target and navigation sizes change in basic mode (section 8); spacing does not.

## 2. Layer 1: primitives from `tokens.json`

### 2.1 Spacing

`tokens.json` → `spacing.app` is the app's one spacing scale (decision G1). The common steps are the values the approved prototype uses most; the rare steps are kept only because a pilot component uses them, each with its locations recorded in `tokens.json` and in [`rare-spacing-inventory.md`](rare-spacing-inventory.md).

| CSS custom property | Value | Kind | `tokens.json` usage (shortened) |
| --- | --- | --- | --- |
| `--app-space-1` | 2px | common | Heading to its one-line sub-text |
| `--app-space-2` | 4px | common | Label to its control |
| `--app-space-3` | 6px | common | Closely related lines and chips |
| `--app-space-4` | 8px | common | Related items; minimum space between separate controls |
| `--app-space-5` | 10px | common | Icon to label; tiles in a grid |
| `--app-space-6` | 12px | common | Default stack gap; compact card padding |
| `--app-space-7` | 14px | common | Component-specific card padding |
| `--app-space-8` | 16px | common | Resident gutter and section gap; default card padding; narrow Hub inset |
| `--app-space-9` | 20px | common | Hub section gap; stacked two-column gap |
| `--app-space-10` | 24px | common | Resident bottom inset; Hub page inset; panels |
| `--app-space-1px` | 1px | rare | Optical alignment of a check box or small icon |
| `--app-space-3px` | 3px | rare | Optical alignment of an icon with body text |
| `--app-space-7px` | 7px | rare | Hub side-nav count badge |
| `--app-space-18px` | 18px | rare | Large resident buttons; Hub review sections; row metadata; type grid |
| `--app-space-22px` | 22px | rare | Hub main-column sections |
| `--app-space-28px` | 28px | rare | Main column to aside on Hub review pages |

1 px is real spacing in these places (optical alignment), not only a border width.

`tokens.json` → `spacing.tokens` (`space-1` to `space-7`: 4, 10, 17, 24, 29, 48 and 67 px) keeps its names and values for slides and documents. The design system's slide and document stylesheet (`components/bundle.css`) and the prototype read those names. It is **not generated for the app**, so the app still has exactly one spacing scale; prototype boards and slide spacing never reach `src/`.

### 2.2 Radius

| CSS custom property | Value | `tokens.json` usage (shortened) |
| --- | --- | --- |
| `--radius-none` | 0 | Slide containers |
| `--radius-card` | 16px | Everything you can touch, and document and screen containers |
| `--radius-header` | 88px | The one swooping corner of the PageHeader, once per page |
| `--radius-disc` | 50% | Icon discs and portrait crops |

Radius is listed because containers and content components share it. Layout primitives never set a radius (see `component-boundaries.md`).

### 2.3 Sizes

`tokens.json` → `size` (decisions G3, G5, G7, G8):

| CSS custom property | Value | Job |
| --- | --- | --- |
| `--app-tap` | 44px | Minimum control size; inline-text links exempt |
| `--app-tap-basic` | 56px | Minimum control size in basic mode |
| `--app-icon`, `--app-icon-basic`, `--app-icon-staff` | 24px, 28px, 20px | Default icon: resident, basic mode, Hub and ambassador |
| `--app-min-header-resident` | 56px | Resident header minimum block size (the prototype's earlier 60 px is overridden by 56 px) |
| `--app-min-topbar-hub` | 60px | Hub top bar minimum block size |
| `--app-min-nav-item-resident`, `--app-min-nav-item-resident-basic` | 64px, 80px | Resident navigation item minimum block size |
| `--app-page-staff` | 1040px | Default Hub page maximum inline size, where no screen-specific maximum exists |
| `--app-page-staff-review` | 1080px | Only the pages that already use it: O-02, O-03, O-04, O-05, O-07, O-13 |
| `--app-page-staff-partner` | 1140px | Only partner-space pages (P-01 to P-16, MVP) |
| `--app-page-staff-published`, `--app-page-staff-log`, `--app-page-staff-update`, `--app-page-staff-resolve` | 960px, 920px, 980px, 900px | Only the pages that already use them: O-06; O-11; O-14 and O-15; O-16 |
| `--app-side-nav` | 240px | Hub side navigation |
| `--app-aside-staff` | 380px | Aside on two-column Hub pages |
| `--app-aside-staff-compact` | 300px | Side column on the pages that already use it: O-01, O-12 |

The shell sizes are minimums. Translated text may make the header, top bar and navigation items taller.

### 2.4 Type

`tokens.json` → `type.groups` "Screens: resident", "Screens: basic mode" and "Screens: staff" (decision G7), and `type.lineHeights` (decision G10). Sizes in px:

| Role | Resident | Basic mode | Staff | Line height |
| --- | --- | --- | --- | --- |
| Caption, body | 18 | 22 | 16 | `lh-body` (staff: `lh-body-staff`) |
| Alert | 20 | 24 | 18 | `lh-body` |
| Lead | 21 | 24 | 18 | `lh-body` |
| H3 | 20 | 24 | 18 | `lh-tight` |
| H2 | 23 | 26 | 21 | `lh-tight` |
| H1 | 27 | 30 | 27 | `lh-tight` |

Line heights are in section 6. The "Slides" and "Documents and screens" groups stay for slides and documents and are not generated for the app.

### 2.5 Build-time values: breakpoint and container

`tokens.json` → `breakpoint` and `container` (decision G4 and its 2026-10-02 refinement):

| Token | Value | What it measures | Used for |
| --- | --- | --- | --- |
| `app-breakpoint-hub` | 700px | The viewport | The Hub shell only: below it the side navigation is hidden |
| `app-container-hub-two-column-min` | 800px | The available content width inside the page padding | Two-column Hub pages only: below it main and aside stack |

They are two different tokens and must not be swapped. CSS cannot read a custom property inside `@media` or `@container`, so the generator writes these two literals into Tailwind's `@theme` (section 9) and nowhere else.

## 3. Layer 2: semantic tokens

Each semantic token is one `var()` of a primitive and is named by its job (`naming-conventions.md`). Nothing here is a new number.

### 3.1 Spacing

| Semantic token | Resolves to | Value | Job |
| --- | --- | --- | --- |
| `--gap-subline` | `var(--app-space-1)` | 2px | Heading to its one-line sub-text |
| `--gap-label` | `var(--app-space-2)` | 4px | Label to its control; `Stack gap="label"` |
| `--gap-tight` | `var(--app-space-3)` | 6px | Closely related lines and chips |
| `--gap-related` | `var(--app-space-4)` | 8px | Related items in a row or list |
| `--gap-target` | `var(--app-space-4)` | 8px | Minimum space between two separate controls (G3) |
| `--gap-icon` | `var(--app-space-5)` | 10px | Icon to label; `Inline` default |
| `--gap-grid` | `var(--app-space-5)` | 10px | Tiles in a grid (prototype home tiles) |
| `--gap-stack` | `var(--app-space-6)` | 12px | Default stack gap |
| `--gap-section-resident` | `var(--app-space-8)` | 16px | Between sections of a resident screen (G1) |
| `--gap-section-hub` | `var(--app-space-9)` | 20px | Between sections of a Hub page; gap of a stacked two-column page (G1) |
| `--gap-panel` | `var(--app-space-10)` | 24px | Between panels; column gap on O-01, O-12 and O-14 |
| `--gap-paragraph` | `var(--app-space-10)` | 24px | Guide paragraphs |
| `--gap-columns-hub` | `var(--app-space-28px)` | 28px | Main column to aside on O-02, O-03, O-04, O-05, O-07, O-13 |
| `--gap-section-hub-main` | `var(--app-space-22px)` | 22px | Main-column sections on O-01, O-03, O-04, O-14, O-15 |
| `--gap-section-hub-review` | `var(--app-space-18px)` | 18px | Main-column sections on O-07, O-12 |
| `--gap-meta-inline` | `var(--app-space-18px)` | 18px | Column gap of list-row metadata (O-01) |
| `--gap-type-grid-inline` | `var(--app-space-18px)` | 18px | Column gap of the disruption type grid (X-13) |
| `--gap-meta-block` | `var(--app-space-2)` | 4px | Row gap of list-row metadata (O-01); the items are text, not targets |
| `--gap-type-grid-block` | `var(--app-space-7)` | 14px | Row gap of the disruption type grid (X-13); the items are text, not targets |
| `--gap-columns-inner` | `var(--app-space-5)` | 10px | Gap of an equal-column block inside a Hub page (O-06, O-12), not the page's 24px |
| `--gutter-resident` | `var(--app-space-8)` | 16px | Resident inline inset and block-start inset (G2) |
| `--inset-screen-end` | `var(--app-space-10)` | 24px | Resident block-end inset (G2) |
| `--inset-page-staff` | `var(--app-space-10)` | 24px | Hub page inset at and above the Hub breakpoint |
| `--inset-page-staff-narrow` | `var(--app-space-8)` | 16px | Hub page inset below the Hub breakpoint |
| `--inset-card` | `var(--app-space-8)` | 16px | Default card padding (G6) |
| `--inset-card-compact` | `var(--app-space-6)` | 12px | Compact card padding (G6) |
| `--inset-card-snug` | `var(--app-space-7)` | 14px | Card padding where an approved component shows 14px (G6) |
| `--inset-button-large-inline` | `var(--app-space-18px)` | 18px | Inline padding of large resident buttons |
| `--inset-count-badge-inline` | `var(--app-space-7px)` | 7px | Inline padding of the Hub side-nav count badge |
| `--offset-align-hairline` | `var(--app-space-1px)` | 1px | Aligns a check box or small icon with the first text line |
| `--offset-align-icon` | `var(--app-space-3px)` | 3px | Aligns an icon with the first line of body text |

Gutter and insets are the same in basic mode (G2). Asymmetric card padding shown in an approved component is written as that component's layer 3 tokens over these semantic tokens.

### 3.2 Sizes

| Semantic token | Resolves to | Value |
| --- | --- | --- |
| `--tap`, `--tap-basic` | `var(--app-tap)`, `var(--app-tap-basic)` | 44px, 56px |
| `--size-icon`, `--size-icon-basic`, `--size-icon-staff` | `var(--app-icon)`, `var(--app-icon-basic)`, `var(--app-icon-staff)` | 24px, 28px, 20px |
| `--size-header-resident-min` | `var(--app-min-header-resident)` | 56px |
| `--size-topbar-hub-min` | `var(--app-min-topbar-hub)` | 60px |
| `--size-nav-item-resident-min`, `--size-nav-item-resident-min-basic` | `var(--app-min-nav-item-resident)`, `var(--app-min-nav-item-resident-basic)` | 64px, 80px |
| `--size-page-staff` | `var(--app-page-staff)` | 1040px |
| `--size-page-staff-review` | `var(--app-page-staff-review)` | 1080px |
| `--size-page-staff-partner` | `var(--app-page-staff-partner)` | 1140px |
| `--size-page-staff-published`, `--size-page-staff-log`, `--size-page-staff-update`, `--size-page-staff-resolve` | `var(--app-page-staff-published)` and so on | 960px, 920px, 980px, 900px |
| `--size-side-nav` | `var(--app-side-nav)` | 240px |
| `--size-aside-staff` | `var(--app-aside-staff)` | 380px |
| `--size-aside-staff-compact` | `var(--app-aside-staff-compact)` | 300px |

Resident content has no maximum inline size: it fills the shell at every width (G5).

### 3.3 Removed

| Former name | Why |
| --- | --- |
| `--gap-section` | Split into `--gap-section-resident` (16px) and `--gap-section-hub` (20px), so neither is forced through the other's value |
| `--size-reading` | Resident content stays uncapped (G5) |
| `--rule-length`, `--rule-thickness`, `--bar-thickness` | Slide and document decorations; no pilot screen uses them (the prototype's `.cvh-rule` is a 1px border) |

## 4. Layer 3: component tokens

Component tokens are declared next to the component and alias layer 2. Examples of the pattern (names only; values follow from layer 2):

```css
/* src/ui/layout/screen.css */
.screen[data-surface="resident"] {
  --screen-inset-inline: var(--gutter-resident);
  --screen-gap: var(--gap-section-resident);
}
.screen[data-surface="staff"] {
  --screen-inset-inline: var(--inset-page-staff);
  --screen-gap: var(--gap-section-hub);
  --screen-max-inline-size: var(--size-page-staff);
}

/* src/ui/alerting/not-911-block.css (content component) */
.not-911-block {
  --not-911-block-inset: var(--inset-card);
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
| Pilot launch | Both themes are generated (UX-DR1, S01.16). Pilot screens launch in the light theme and the pilot ships no theme selector (G9; `tokens.json` → `color.launch`). The light and navy layout check in S02.02 stays, so navy cannot drift. |

## 6. Right to left, scripts and fonts

`ur`, `ps` and `prs` are right to left (`design/prototype/cvh/data.js`, AD-16). Spacing tokens are direction-free. Direction is handled by which CSS properties use them.

| Rule | Detail |
| --- | --- |
| Logical properties only | Use `padding-inline`, `padding-inline-start`, `padding-block`, `margin-inline-end`, `inset-inline-start`, `border-inline-start`, `inline-size`, `max-inline-size`. Never `left`, `right`, `margin-left`, `padding-right`, `border-left` and similar. |
| No 3- or 4-value shorthands | `padding: 6px 10px 6px var(--gutter)` (prototype `.cvh-rhead__top`) is physical on the inline axis and needed a `[dir="rtl"]` override. Write `padding-block` plus `padding-inline-start` and `padding-inline-end` instead. The 1- and 2-value forms are allowed because they are symmetric. |
| No directional box-shadow | `box-shadow: inset 3px 0 0` (prototype `.cvh-side__item.is-active`) needed a `[dir="rtl"]` override. Use `border-inline-start` for a side indicator. Block-axis shadows (`inset 0 3px 0`) are allowed. |
| Mirrored icons | Direction icons mirror, media and clock icons do not (prototype `cvh.css` rule on `.cvh-ico--arrow` and others). This is an icon rule, not a spacing one; listed because it is the only `[dir="rtl"]` rule that stays. |
| Line height by script | `tokens.json` → `type.lineHeights` (G10): default body 1.5 and tight 1.25; staff body 1.45; Arabic script (`ur`, `ps`, `prs`) body 1.9 and tight 1.6; Indic (`hi`, `pa`, `gu`, `bn`, `ta`) body 1.75 and tight 1.45; Chinese (`zh-Hans` and `zh-Hant`) body 1.7, tight 1.25. This changes block size, not spacing tokens. Stacks must not assume a fixed row height. |
| Fonts | Only the active language's Noto subset is loaded (AD-16, S02.02). Spacing does not change by font. |

### Tailwind utilities allowed for direction-sensitive spacing

| Allowed (logical) | Banned (physical) |
| --- | --- |
| `ps-*`, `pe-*`, `ms-*`, `me-*`, `px-*`, `py-*`, `mx-*`, `my-*`, `start-*`, `end-*`, `border-s`, `border-e`, `rounded-s-*`, `rounded-e-*` | `pl-*`, `pr-*`, `ml-*`, `mr-*`, `left-*`, `right-*`, `border-l`, `border-r`, `rounded-l-*`, `rounded-r-*`, `space-x-*` (relies on margins) |

In Tailwind v4, `px-*` and `mx-*` compile to `padding-inline` and `margin-inline`, so they are safe. Confirm this against the pinned Tailwind 4.3.3 output in the S01.16 test.

## 7. Breakpoints, container queries and test widths

| Surface | Layout switch | Test widths |
| --- | --- | --- |
| Resident | None. Resident screens are fluid (`ResidentApp_320` and `ResidentApp_768` render the same layout at a different width). | 320, 390, 768 px (UX-DR3, S02.02) |
| Hub shell | One viewport breakpoint, `app-breakpoint-hub` 700px: below it the side navigation is hidden and the narrow inset applies; at or above it the side navigation is shown. | 390, 699, 700, 1280 px (S01.09) |
| Two-column Hub pages | One container query, `app-container-hub-two-column-min` 800px of available content width, measured inside the page padding (the staff `Screen` content box is the query container). | Content width 799 and 800 px (S01.16 fixture; viewport 1087 and 1088 px with the side navigation) |
| Ambassador | None (A-xx run in the phone layout). | 390 px |

Two-column Hub pages (O-01, O-02, O-03, O-04, O-05, O-06, O-07, O-12, O-13, O-14):

- **Below 800 px of content width:** one column, main content first, then the aside, which fills the available width and is not sticky. The gap is `--gap-section-hub` (20px), as in the prototype's one-column variants.
- **At 800 px and above:** a flexible main column (`minmax(0, 1fr)`) and the aside at `--size-aside-staff` (380px), with the page's approved gap: `--gap-columns-hub` (28px) on O-02, O-03, O-04, O-05, O-07, O-13. O-01 and O-12 keep their 300px side column (`--size-aside-staff-compact`) and O-14 its two equal columns, with `--gap-panel` (24px); both follow the same 800px rule. The equal-column blocks inside O-06 and O-12 keep the prototype's 10px gap (`--gap-columns-inner`).
- **Actions:** approval and publish actions stay in `Screen`'s sticky `actions` slot (the prototype's `.cvh-pubbar`) in both layouts.
- **Why a container, not the viewport:** at 700px the side navigation (240px) and page inset (2 × 24px) leave 412px, too narrow for a 380px aside. The content width reaches 800px only at a viewport of 1088px; below the shell breakpoint it is at most 668px, so pages are always stacked there.

Boundary checks: viewport 699 and 700 px for the shell; content width 799 and 800 px for two-column pages; each in `en` and `ur`, including the longest translated labels; neither layout may overflow horizontally (`scrollWidth` is not greater than `clientWidth` on the document or the page container).

Tailwind's default breakpoints are removed so nobody uses `md:` or `lg:` by habit. The only responsive variants are `hub:` (shell) and `@hub-two-column:` (page columns).

## 8. Basic mode

Basic mode (X-07) is a device choice that switches to the prototype's basic layouts (AD-16). The prototype implements it as a class on the root (`.cvh-basic`) that overrides variables.

| What changes in basic mode (prototype) | Token status |
| --- | --- |
| Touch target 44 → 56 px | `--tap-basic` (G3) |
| Type sizes up (body 22, alert 24, h1 30) and icon 24 → 28 px | "Screens: basic mode" type group, `--size-icon-basic` (G7) |
| Resident nav item minimum 64 → 80 px | `--size-nav-item-resident-min-basic` (G8) |
| Two-column tile grids become one column (`.cvh-basic .cvh-find-tiles`) | Behaviour, no token: `Grid` collapses (see `components/grid.md`) |
| Decorative items and secondary lines hidden (`.cvh-decor`, `.cvh-hide-basic`) | Behaviour, no token |
| Gaps and insets, including the resident gutter (16px) and bottom inset (24px) | **Unchanged** (G2). Spacing tokens have one value in both modes. |

In the app, basic mode is a `data-basic="true"` attribute on `<html>`, set from device choices before first paint. Primitives and component tokens read it; nothing else does.

## 9. Generated output and Tailwind v4 theme (S01.16)

`npm run gen:tokens` reads `tokens.json` and writes `src/ui/tokens/tokens.generated.css`. A hand-written `src/ui/tokens/semantic.css` adds layer 2. `src/ui/tokens/theme.css` maps layer 2 into Tailwind.

```css
/* src/ui/tokens/tokens.generated.css — GENERATED from design/prototype/ds/cvrh/tokens.json. Do not edit. */
:root {
  --app-space-1: 2px; --app-space-2: 4px; --app-space-3: 6px; --app-space-4: 8px; --app-space-5: 10px;
  --app-space-6: 12px; --app-space-7: 14px; --app-space-8: 16px; --app-space-9: 20px; --app-space-10: 24px;
  --app-space-1px: 1px; --app-space-3px: 3px; --app-space-7px: 7px;
  --app-space-18px: 18px; --app-space-22px: 22px; --app-space-28px: 28px;
  --app-tap: 44px; --app-tap-basic: 56px; /* … every size token … */
  --app-fs-body: 18px; /* … resident type set … */ --lh-body: 1.5; --lh-tight: 1.25;
  --radius-none: 0; --radius-card: 16px; --radius-header: 88px; --radius-disc: 50%;
  --surface: #fafafa; --surface-raised: #ffffff; /* … every colour token, light value … */
}
[data-basic="true"] { --app-fs-body: 22px; /* … basic-mode type set … */ }
:lang(ur), :lang(ps), :lang(prs) { --lh-body: 1.9; --lh-tight: 1.6; } /* … Indic, Chinese … */
[data-theme="dark"] {
  --surface: #002a45; --surface-raised: #1f4068; /* … every colour token with a dark value … */
}
```

The exact names of the generated type properties are S01.16's choice; they follow the `tokens.json` names. The staff type set applies on the staff surface.

```css
/* src/ui/tokens/semantic.css — layer 2. Every value is a var() of a generated primitive (section 3). */
:root {
  --gap-subline: var(--app-space-1);
  --gap-label: var(--app-space-2);
  --gap-icon: var(--app-space-5);
  --gutter-resident: var(--app-space-8);
  --gap-columns-hub: var(--app-space-28px);
  --tap: var(--app-tap);
  --size-aside-staff: var(--app-aside-staff);
  /* … every token in section 3 … */
}
```

```css
/* src/ui/tokens/theme.css — Tailwind v4 */
@import "tailwindcss";
@import "./tokens.generated.css";
@import "./semantic.css";

@theme inline {
  /* Remove Tailwind's numeric spacing scale, default breakpoints and container sizes. */
  --spacing-*: initial;
  --breakpoint-*: initial;
  --container-*: initial;

  /* Build-time values from tokens.json, written by the generator as literals (section 2.5). */
  --breakpoint-hub: 700px;              /* app-breakpoint-hub: variant hub:, the shell only */
  --container-hub-two-column: 800px;    /* app-container-hub-two-column-min: variant @hub-two-column:, page columns only */

  /* Spacing: semantic names only. Gives gap-icon, p-card, ps-gutter, and so on. */
  --spacing-label: var(--gap-label);
  --spacing-icon: var(--gap-icon);
  --spacing-card: var(--inset-card);
  --spacing-gutter: var(--gutter-resident);
  --spacing-target: var(--gap-target);
  --spacing-tap: var(--tap);
  /* … one line per spacing token in section 3.1 … */

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
- Primitives (`--app-*`) are deliberately **not** exposed as Tailwind utilities, so `p-app-space-2` cannot be written. This applies the source rule "never Level 1 directly" through the build rather than by review.
- Check in the S01.16 test that the reset really removes the default scale in Tailwind 4.3.3: a fixture using `p-4`, `gap-2`, `md:flex` and `@md:flex` must produce no CSS, while `hub:flex` compiles to `@media (width >= 700px)` and `@hub-two-column:grid` to `@container (width >= 800px)`.
- The reset does not stop arbitrary values: Tailwind compiles `p-[13px]` whatever the theme defines. The spacing check (section 10) rejects them instead.

## 10. Automated checks

These are the testable rules behind this document. They run in CI on `src/`.

| Check | Fails when | Proposed story |
| --- | --- | --- |
| Token snapshot | A generated value differs from `tokens.json` | S01.16 |
| Semantic purity | A declaration in `semantic.css` or a component token has a value that is not a single `var(--…)` | S01.16 |
| No primitives outside layer 2 | `var(--app-` appears in any file except `semantic.css` | S01.16 |
| No layout literals | `700px` or `800px` appears in a media or container query in `src/` outside the generated `@theme` | S01.16 |
| Shell breakpoint boundary | At a 699 px viewport the side navigation is hidden and at 700 px it is shown, in `en` and `ur`, with no horizontal overflow | S01.09 |
| Two-column boundary | At 799 px of content width the page is one column (main first, aside full width) and at 800 px it is two columns with the page's gap, in `en` and `ur` with the longest translated labels, with no horizontal overflow; a 1280 px viewport with a 799 px container stacks | S01.16 (primitive), each two-column page story |
| Spacing from tokens only (proportionate) | A `padding*`, `margin*`, `gap`, `row-gap` or `column-gap` value in `src/` is a literal length that is not `0` and not an approved spacing token; or a Tailwind spacing class uses an arbitrary value (`p-[13px]`, `gap-[1rem]`). It does **not** check border widths, icon and image sizes, positioning (`top`, `inset*`, `translate`) or line height. A reviewed exception is allowed with a `/* spacing-exception: reason */` comment, which the check lists in its report | S01.16 |
| Logical CSS only | Any of `left`, `right`, `margin-left`, `margin-right`, `padding-left`, `padding-right`, `border-left*`, `border-right*`, `float: left/right`, `text-align: left/right`, a 3- or 4-value `margin`/`padding` shorthand, or a physical Tailwind utility (section 6) appears in `src/` | S02.02 (already named; widened here) |
| No negative margins without a reason | A negative `margin*` or a `-m*` Tailwind utility appears in `src/` without a `spacing-exception` comment | S01.16 |
| One value per theme | An `--app-space-*`, size or `--radius-*` property appears inside a `[data-theme]` block | S01.16 |
| No undeclared custom property | A `var(--x)` in `src/` has no matching `--x:` declaration in the generated, semantic or component token files (the check the source framework's `audit-css-custom-properties.js` runs) | S01.16 |
| Touch targets | A control's box is smaller than `--tap` (44 px; 56 px in basic mode) at 320 px, or two separate controls are closer than `--gap-target` (8 px); links inside text are exempt | S02.14 |

## 11. Decisions G1–G10

Decided by the design owner on 2026-10-02; recorded in `tokens.json` version 3. These are final: the values above are implementation requirements.

| # | Gap | Decision |
| --- | --- | --- |
| G1 | Spacing scale | Common steps 2, 4, 6, 8, 10, 12, 14, 16, 20 and 24 px (`spacing.app`). Rarer values are kept where a pilot component uses them, with semantic names and recorded locations ([`rare-spacing-inventory.md`](rare-spacing-inventory.md)): 1, 3, 7, 18, 22 and 28 px. Prototype presentation boards and slide spacing are not generated for the app. Resident section gaps (16px) and Hub section gaps (20px) have separate semantic names. 1px is sometimes real spacing (alignment, badge padding), not only a border. |
| G2 | Resident gutter | 16px on both inline sides and at the screen's top; 24px at the bottom. Unchanged in basic mode. |
| G3 | Touch targets | Minimum 44 × 44px, 56 × 56px in basic mode; 8px between separate controls. The inline-text link exception stays. |
| G4 | Breakpoints | One Hub shell breakpoint at 700px of viewport: narrow below, wide at or above; below it the side navigation is hidden. Resident pages stay fluid; 320, 390 and 768px are test widths. **Refined on 2026-10-02:** pages that need two columns use a container query at 800px of available content width inside the page padding (`app-container-hub-two-column-min`), a separate token from the shell breakpoint (section 7). |
| G5 | Containers | Hub page maximum 1040px; side navigation 240px; aside 380px. 1080px and 1140px are named variants only for the screens that already use them. Resident content stays uncapped within its shell. |
| G6 | Card padding | Default 16px, compact 12px. 14px or asymmetric padding only where an approved component shows it. The claim that screen cards use 24px is removed. |
| G7 | Typography | Resident, basic-mode and staff type sets as in section 2.4, and default icons 24, 28 and 20px. |
| G8 | Shell dimensions | Minimums: resident header 56px (the prototype's earlier 60px is overridden by 56px), Hub top bar 60px, resident navigation items 64px or 80px in basic mode. Translated text may grow them. |
| G9 | Navy theme | Both themes are generated; pilot screens launch in light mode; no theme selector in the pilot. |
| G10 | Line height by script | Default body 1.5, tight 1.25; staff body 1.45; Arabic script body 1.9, tight 1.6; Indic body 1.75, tight 1.45; Chinese body 1.7, for both Simplified and Traditional Chinese. |

**Confirmed by the design owner on 2026-10-02 (second round):**

- The 800px container rule also applies to O-01, O-06, O-12 and O-14, which keep their existing column proportions.
- `--gap-subline` (2px), `--gap-tight` (6px) and `--gap-related` (8px) name the 2, 6 and 8px steps; the home-tile grid gap is 10px; the slide-only decorations (`--rule-length`, `--rule-thickness`, `--bar-thickness`) are not generated for the app; check-in mark buttons are 8px apart.
- The prototype is preserved for the remaining differences: list-row metadata keeps a 4px row gap and the disruption type grid a 14px row gap (`--gap-meta-block`, `--gap-type-grid-block`; their items are text, not targets, so the 8px target spacing does not apply); the equal-column blocks inside O-06 and O-12 keep 10px; each Hub screen with its own maximum keeps it as a named variant (O-06 960px, O-11 920px, O-14 and O-15 980px, O-16 900px), and 1040px is the default only where no screen-specific maximum exists. O-18 stays out of the pilot.
