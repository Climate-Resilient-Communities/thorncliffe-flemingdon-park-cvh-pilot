# Grid

> **Status: approved framework (2026-10-01); token values decided by the design owner on 2026-10-02 (G1–G10, `token-architecture.md` section 11).** The rules, primitives and token values here are implementation requirements for S01.16 and the stories that use them. Values come from `design/prototype/ds/cvrh/tokens.json`; rare values and where they are used are in [`rare-spacing-inventory.md`](../rare-spacing-inventory.md). The plan changes were applied from the change proposal [`docs/planning/pilot/change-proposals/2026-10-01-spacing-framework.md`](../../../planning/pilot/change-proposals/2026-10-01-spacing-framework.md) to `epics.md` and AD-16.

**Status:** Pilot · **File:** `src/ui/layout/grid.tsx` · **Built in:** S01.16

## Purpose

Lays out children in equal columns with one gap, or lays out a two-column Hub page (main column plus an aside, or two equal columns) that switches by the width of the page content, not the viewport. Equal-column grids collapse to one column in basic mode (resident). Used for the home "Every day" tiles, the round page's three mark buttons, the two-column Hub pages (compose, audience, approval view and the others in `component-boundaries.md` 3.2) and the Hub side navigation next to the main area.

Source: `Grid` in `LayoutPrimitives.tsx` (`cols` 1–6 or 12, `gap`). Prototype equivalents: `.cvh-find-tiles` (2 columns, 1 in basic), `.cvh-marks` (3 columns), `.cvh-ha-cols` (main plus 380px aside, gap 28px), `.cvh-hcols` (main plus 300px column, gap 24px; `--even` for two equal columns), their `--one` variants (one column, gap 20px), `.cvh-hub` (240px side nav plus main).

## Anatomy

```text
Grid  (div | ul | ol)  display: grid; grid-template-columns; gap
├─ cell
├─ cell
└─ cell
```

Columns are always `minmax(0, 1fr)` (or a fixed aside size next to one) so long translated words cannot push a column wider than its share. A `twoColumn` grid has exactly two children: the main column first, then the aside.

## Props

| Prop | Type (allowed values only) | Default | Notes |
| --- | --- | --- | --- |
| `cols` | `1 \| 2 \| 3 \| 4` | `1` | Equal columns at every width. Not combined with `twoColumn` |
| `twoColumn` | `'aside' \| 'aside-compact' \| 'even'` | none | Staff only. Two-column Hub page: one column below 800px of content width, two columns at or above (see Responsive behaviour). `'aside'`: main plus `--size-aside-staff` (380px), gap `--gap-columns-hub` (28px), on the review pages O-02, O-03, O-04, O-05, O-07, O-13. `'aside-compact'`: main plus `--size-aside-staff-compact` (300px), gap `--gap-panel` (24px), on O-01, O-06, O-12, O-14. `'even'`: two equal columns, gap `--gap-panel` (24px), where those pages use the prototype's `.cvh-hcols--even` |
| `gap` | `'target' \| 'grid' \| 'stack' \| 'panel'` | `'grid'` | Equal-column grids only. A `twoColumn` grid takes its gaps from its variant |
| `collapseInBasic` | `boolean` | `true` | One column when basic mode is on. Set `false` only with a reason in the screen spec (for example, the 3 mark buttons on the round page, which is a staff screen where basic mode does not apply) |
| `as` | `'div' \| 'ul' \| 'ol'` | `'div'` | |
| `testId` | `string` | none | |

Not included: `cols` 5, 6 and 12 (source has them; the largest pilot grid is the 4-item resident nav, which belongs to the shell), `auto-fill` with a minimum item width (the prototype uses it on Hub type pickers with 190px and 220px minimums, which are not tokens; those lists use `cols={2}`, which is what the prototype shows at 390 px, at every width until a wider count is agreed), spans, areas, a viewport-based column prop, `className`, `style`.

## Tokens used

| Prop value | Semantic token | Primitive | Value |
| --- | --- | --- | --- |
| `gap="target"` | `--gap-target` | `--app-space-4` | 8px (G3) |
| `gap="grid"` | `--gap-grid` | `--app-space-5` | 10px |
| `gap="stack"` | `--gap-stack` | `--app-space-6` | 12px |
| `gap="panel"` | `--gap-panel` | `--app-space-10` | 24px |
| `twoColumn="aside"`: column gap | `--gap-columns-hub` | `--app-space-28px` (rare) | 28px |
| `twoColumn="aside"`: aside | `--size-aside-staff` | `--app-aside-staff` | 380px |
| `twoColumn="aside-compact"`: aside | `--size-aside-staff-compact` | `--app-aside-staff-compact` | 300px |
| `twoColumn="aside-compact"` and `"even"`: column gap | `--gap-panel` | `--app-space-10` | 24px |
| `twoColumn` (any), one column: row gap | `--gap-section-hub` | `--app-space-9` | 20px |
| `twoColumn` switch | `--container-hub-two-column` (Tailwind variant `@hub-two-column:`) | `app-container-hub-two-column-min` (build-time literal) | 800px of content width |

Note: the prototype uses 10px between home tiles; `--gap-grid` is now 10px (it was 17px, a slide value). The prototype draws the round page's mark buttons 6px apart; G3 makes separate controls at least 8px apart (`gap="target"`), so the app uses 8px there.

## Responsive behaviour

| Grid | Content width below 800px | Content width at or above 800px |
| --- | --- | --- |
| `cols` (resident and staff) | `cols` | `cols` (no width response) |
| `twoColumn` (staff) | One column: main first, the aside after it filling the available width, not sticky; row gap `--gap-section-hub` (20px) | Main column `minmax(0, 1fr)` plus the aside (380px or 300px), or two equal columns; the variant's column gap (28px or 24px). In `'aside'`, the aside is sticky at the block start (prototype `.cvh-ha-aside`) |

- The content width is the inline size of the `hub-page` query container: the `Screen` staff content box, inside the page padding. `Grid` never reads the viewport or the Hub breakpoint (`hub:`); the breakpoint is for the shell only (`component-boundaries.md` 3.2).
- In the Hub shell with the side navigation shown, content width = viewport − 240 − 2 × 24, so the switch happens between viewports of 1087 and 1088 px. Below the 700 px Hub breakpoint the content is at most 668px, so two-column pages are always one column there.
- `grid.css` writes the switch with the container variant generated from `--container-hub-two-column`, queried on the `hub-page` container. It never contains 800 or any other width literal.
- Approval and publish actions are not in the `Grid`: they stay in `Screen`'s sticky `actions` slot in both layouts.

## RTL behaviour

Grid columns follow the writing direction: the first cell is at the inline start. In a `twoColumn` grid, the aside sits at the inline end (left in RTL). No `[dir]` selectors; no `grid-column-start` with physical meaning.

## Basic mode

With `collapseInBasic` (the default), `:root[data-basic="true"]` sets `grid-template-columns: minmax(0, 1fr)`. Gap unchanged. This reproduces the prototype's `.cvh-basic .cvh-find-tiles` rule. `twoColumn` grids are staff only and do not read basic mode.

## Accessibility

- DOM order is reading order in every layout; `Grid` never places cells out of order, so collapsing to one column does not change focus order.
- With `as="ul"`/`"ol"`, adds `role="list"` (same reason as `Stack`).
- `Grid` is for layout only; tabular data on Hub screens (counts by building and floor, O-17) uses a `table`, not a `Grid`.

## Do and don't

| Do | Don't |
| --- | --- |
| `<Grid cols={2} gap="grid">` for the home tiles | Hard-code `grid-template-columns: 1fr 1fr` in a screen |
| `<Grid twoColumn="aside">` for the approval view | Hide the aside when the page is one column; it moves below the main column |
| Let the content width decide the columns | Use the Hub breakpoint (`hub:`) or a viewport media query for page columns |
| Keep cells as content components with no margin | Use `Grid` to draw table rows with borders |

## Acceptance criteria

**Given** `<Grid cols={2} gap="grid">` with four tiles on a resident screen
**When** rendered at 320, 390 and 768 px in `en`
**Then** there are two equal columns at each width, the column and row gap equal `--gap-grid` (10px), and there is no horizontal scroll

**Given** the same grid with basic mode on (`<html data-basic="true">`)
**When** rendered at 390 px
**Then** there is one column, the gap is unchanged, and the tiles' DOM and focus order is unchanged

**Given** `<Grid twoColumn="aside">` with a main column and an aside, inside a fixture `hub-page` query container whose content box is exactly 799px wide
**When** rendered in `en`
**Then** there is one column, the main column comes first and the aside after it, the aside's inline size equals the container's (799px), the aside's computed `position` is not `sticky`, and the row gap equals `--gap-section-hub` (20px)

**Given** the same grid in a fixture container exactly 800px wide
**When** rendered in `en`
**Then** there are two columns, the aside's inline size equals `--size-aside-staff` (380px), the column gap equals `--gap-columns-hub` (28px), the main column is 392px wide, and the aside is sticky

**Given** `<Grid twoColumn="aside-compact">` and `<Grid twoColumn="even">` in fixture containers 799px and 800px wide
**When** rendered in `en`
**Then** at 799px both are one column with a row gap of 20px; at 800px `aside-compact` has a 300px aside (`--size-aside-staff-compact`), a 476px main column and a 24px column gap (`--gap-panel`), and `even` has two 388px columns and a 24px column gap

**Given** a review page (`Screen surface="staff" width="review"` with `<Grid twoColumn="aside">`) and a page with `<Grid twoColumn="aside-compact">` in the Hub shell
**When** rendered at viewport widths 699, 700, 1087 and 1088 px
**Then** both are one column at 699, 700 and 1087 px (content width 799px or less) and two columns at 1088 px (content width 800px), with column gaps of 28px and 24px respectively, and the action buttons stay in `Screen`'s `actions` slot in every case

**Given** a viewport of 1280 px and a fixture `hub-page` container 799px wide
**When** `<Grid twoColumn="aside">` is rendered inside it
**Then** it is one column: the switch follows the container, not the viewport

**Given** the two-column pages at content widths of 799 and 800px (fixture containers, and viewports of 1087 and 1088 px with the side navigation)
**When** rendered in `en` and in `ur`, with the longest translated labels for each page's strings
**Then** there is no horizontal overflow in either layout: `scrollWidth <= clientWidth` on the document and on the `hub-page` container

**Given** the two-column case in a right-to-left language
**When** rendered
**Then** the main column is at the right and the aside at the left, with no `[dir]` selector in `grid.css`

**Given** `<Grid cols={3} gap="target" collapseInBasic={false}>` of mark buttons on the round page (A-04)
**When** rendered at 320 px
**Then** each cell is at least `--tap` by `--tap` (44px) and the gap equals `--gap-target` (8px)

**Given** `<Grid cols={6}>`, `<Grid gap="17px">`, `<Grid twoColumn="aside" gap="grid">` or `<Grid twoColumn="aside">` used under a resident route
**When** `tsc --noEmit` runs or the resident-route lint runs
**Then** the first three fail the type test and the fourth fails the lint (resident screens may not use Hub-only props)

**Given** `src/ui/layout/grid.css`
**When** the CI checks run
**Then** it contains no literal length other than `0`, no `@media` rule, no 700 or 800 literal and no physical property, and every gap and size is a `var()` of a semantic token
