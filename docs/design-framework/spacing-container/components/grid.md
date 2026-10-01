# Grid

> **Status: approved framework (2026-10-01); unresolved token values are still draft.** The rules and primitives here are implementation requirements for S01.16 and the stories that use them. Token values marked **unresolved** have no approved value, stay draft until the design owner decides them in `tokens.json`, and nothing may hard-code them. The plan changes were applied from the change proposal [`docs/planning/pilot/change-proposals/2026-10-01-spacing-framework.md`](../../../planning/pilot/change-proposals/2026-10-01-spacing-framework.md) to `epics.md` and AD-16.

**Status:** Pilot · **File:** `src/ui/layout/grid.tsx` · **Built in:** S01.16

## Purpose

Lays out children in equal columns, or in a main column plus an aside on the Hub, with one gap. Collapses to one column in basic mode (resident) and below the Hub breakpoint (staff). Used for the home "Every day" tiles, the round page's three mark buttons, the Hub's main-and-aside screens (compose, approval view) and the Hub side navigation next to the main area.

Source: `Grid` in `LayoutPrimitives.tsx` (`cols` 1–6 or 12, `gap`). Prototype equivalents: `.cvh-find-tiles` (2 columns, 1 in basic), `.cvh-marks` (3 columns), `.cvh-ha-cols` (main plus 380px aside, one column when narrow), `.cvh-hub` (240px side nav plus main).

## Anatomy

```text
Grid  (div | ul | ol)  display: grid; grid-template-columns; gap
├─ cell
├─ cell
└─ cell
```

Columns are always `minmax(0, 1fr)` so long translated words cannot push a column wider than its share.

## Props

| Prop | Type (allowed values only) | Default | Notes |
| --- | --- | --- | --- |
| `cols` | `1 \| 2 \| 3 \| 4` | `1` | Equal columns at every width (resident, and staff below the Hub breakpoint) |
| `colsAtHub` | `1 \| 2 \| 'main-aside'` | same as `cols` | Staff only: columns at and above the Hub breakpoint. `'main-aside'` = `minmax(0, 1fr)` plus an aside of `--size-aside-staff` |
| `gap` | `'grid' \| 'panel'` and, once closed, `'target' \| 'stack' \| 'section'` | `'grid'` | |
| `collapseInBasic` | `boolean` | `true` | One column when basic mode is on. Set `false` only with a reason in the screen spec (for example, the 3 mark buttons on the round page, which is a staff screen where basic mode does not apply) |
| `as` | `'div' \| 'ul' \| 'ol'` | `'div'` | |
| `testId` | `string` | none | |

Not included: `cols` 5, 6 and 12 (source has them; the largest pilot grid is the 4-item resident nav, which belongs to the shell), `auto-fill` with a minimum item width (the prototype uses it on Hub type pickers with 190px and 220px minimums, which are not tokens; those lists use `cols={2}`, which is what the prototype shows at 390 px, at every width until a wider count is agreed), spans, areas, `className`, `style`.

## Tokens used

| Prop value | Semantic token | Primitive | Value |
| --- | --- | --- | --- |
| `gap="grid"` | `--gap-grid` | `--space-3` | 17px ("Gutter inside a card grid") |
| `gap="panel"` | `--gap-panel` | `--space-4` | 24px ("Gutter between panels") |
| `gap="target"` | `--gap-target` | — | Blocked by G3 |
| `gap="stack"` | `--gap-stack` | — | Blocked by G1 |
| `gap="section"` | `--gap-section` | — | Blocked by G1 |
| `colsAtHub="main-aside"` | `--size-aside-staff` | — | Blocked by G5 (prototype 380px) |
| Hub breakpoint | `--breakpoint-hub` | — | Blocked by G4 (prototype switches below 700px) |

Note: the prototype uses 10px between home tiles and 6px between mark buttons, not `--gap-grid` (17px). Whether to use `gap="grid"` or a screen token is part of G1.

## Responsive behaviour

| Surface | Below Hub breakpoint | At or above Hub breakpoint |
| --- | --- | --- |
| Resident | `cols` | `cols` (no breakpoint is applied on resident routes) |
| Staff | `cols` | `colsAtHub` |

Only `Grid` and the Hub shell read the Hub breakpoint.

## RTL behaviour

Grid columns follow the writing direction: the first cell is at the inline start. In `'main-aside'`, the aside sits at the inline end (left in RTL). No `[dir]` selectors; no `grid-column-start` with physical meaning.

## Basic mode

With `collapseInBasic` (the default), `:root[data-basic="true"]` sets `grid-template-columns: minmax(0, 1fr)`. Gap unchanged. This reproduces the prototype's `.cvh-basic .cvh-find-tiles` rule.

## Accessibility

- DOM order is reading order in every layout; `Grid` never places cells out of order, so collapsing to one column does not change focus order.
- With `as="ul"`/`"ol"`, adds `role="list"` (same reason as `Stack`).
- `Grid` is for layout only; tabular data on Hub screens (counts by building and floor, O-17) uses a `table`, not a `Grid`.

## Do and don't

| Do | Don't |
| --- | --- |
| `<Grid cols={2} gap="grid">` for the home tiles | Hard-code `grid-template-columns: 1fr 1fr` in a screen |
| `<Grid cols={1} colsAtHub="main-aside" gap="panel">` for the approval view | Hide the aside below the breakpoint; it moves below the main column |
| Keep cells as content components with no margin | Use `Grid` to draw table rows with borders |

## Acceptance criteria

**Given** `<Grid cols={2} gap="grid">` with four tiles on a resident screen
**When** rendered at 320, 390 and 768 px in `en`
**Then** there are two equal columns at each width, the column and row gap equal `--gap-grid` (17px), and there is no horizontal scroll

**Given** the same grid with basic mode on (`<html data-basic="true">`)
**When** rendered at 390 px
**Then** there is one column, the gap is unchanged, and the tiles' DOM and focus order is unchanged

**Given** `<Grid cols={1} colsAtHub="main-aside" gap="panel">` on a staff screen
**When** rendered at 390 px and at 1280 px
**Then** there is one column at 390 px with the aside after the main column, and at 1280 px two columns where the aside's inline size equals `--size-aside-staff` and the gap equals `--gap-panel`

**Given** the 1280 px case in a right-to-left language
**When** rendered
**Then** the main column is at the right and the aside at the left, with no `[dir]` selector in `grid.css`

**Given** `<Grid cols={3} gap="target" collapseInBasic={false}>` of mark buttons on the round page (A-04)
**When** rendered at 320 px
**Then** each cell is at least `--tap` by `--tap` and the gap equals `--gap-target`

**Given** `<Grid cols={6}>`, `<Grid gap="17px">` or `<Grid colsAtHub="main-aside">` used under a resident route
**When** `tsc --noEmit` runs or the resident-route lint runs
**Then** the first two fail the type test and the third fails the lint (resident screens may not use Hub-only props)

**Given** `src/ui/layout/grid.css`
**When** the CI checks run
**Then** it contains no literal length other than `0` and no physical property, and every gap and size is a `var()` of a semantic token
