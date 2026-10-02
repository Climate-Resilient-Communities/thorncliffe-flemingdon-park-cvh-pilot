# Screen

> **Status: approved framework (2026-10-01); token values decided by the design owner on 2026-10-02 (G1–G10, `token-architecture.md` section 11).** The rules, primitives and token values here are implementation requirements for S01.16 and the stories that use them. Values come from `design/prototype/ds/cvrh/tokens.json`; rare values and where they are used are in [`rare-spacing-inventory.md`](../rare-spacing-inventory.md). The plan changes were applied from the change proposal [`docs/planning/pilot/change-proposals/2026-10-01-spacing-framework.md`](../../../planning/pilot/change-proposals/2026-10-01-spacing-framework.md) to `epics.md` and AD-16.

**Status:** Pilot · **File:** `src/ui/layout/screen.tsx` · **Built in:** S01.16 (primitive), used first by S01.09 and S02.02

## Purpose

The content area of one screen. `Screen` is the only part that sets the screen's inline gutter, its block padding, the gap between its top-level sections, its maximum inline size, and the sticky actions region at its block end. Shells put exactly one `Screen` inside their scrolling main area.

It replaces the source framework's `BlockLayout` (`dilawriweb/packages/ui/src/components/layout/BlockLayout.tsx`: section wrapper with horizontal padding, vertical padding and a centred max-width inner box) and the prototype's `.cvh-screen` and `.cvh-hubbody`.

## Anatomy

```text
Screen  (div, data-surface)
├─ body        inset: block-start, inline gutter, block-end; max inline size; children stacked with the section gap;
│   │           staff: the content box is the query container "hub-page" (container-type: inline-size)
│   └─ children (Stack, Inline, Grid, content components)
├─ bleed?      optional full-width region at the block start, outside the inline gutter (map, applied-filter bar)
└─ actions?    optional sticky region at the block end, full width, with a surface background, a top border and a stacking level;
    └─ inner   its contents sit inside the same inline inset and maximum inline size as the body, centred like it
```

## Props

| Prop | Type (allowed values only) | Default | Notes |
| --- | --- | --- | --- |
| `surface` | `'resident' \| 'staff'` | required | Picks the inset and width tokens. Ambassador screens use `'resident'` (they are phone screens in the prototype). |
| `width` | `'default' \| 'review' \| 'published' \| 'log' \| 'update' \| 'resolve' \| 'partner'` | `'default'` | Staff only: the maximum inline size. Each named width only on the screens that already use it in the prototype: `'review'` O-02, O-03, O-04, O-05, O-07, O-13; `'published'` O-06; `'log'` O-11; `'update'` O-14, O-15; `'resolve'` O-16; `'partner'` partner-space screens (MVP). `'default'` everywhere else. Not accepted with `surface="resident"` (resident content is not capped). |
| `inset` | `'default' \| 'none'` | `'default'` | `'none'` removes the inline gutter and the section gap (the prototype's `.cvh-screen--flush`, used by the map). Block-end padding stays. |
| `bleed` | `ReactNode` | none | Rendered before the body, full width. |
| `actions` | `ReactNode` | none | Rendered after the body; sticky to the block end of the scroll container; full width. |
| `actionsLabel` | catalog string | required when `actions` is set | Accessible name of the actions region. |
| `testId` | `string` | none | `data-testid`. |

No `className`, `style`, `gap` or `padding` prop. Children are laid out as a column with the section gap; use a `Stack` inside for any other rhythm.

## Tokens used

| Component token | Resolves to (layer 2) | Primitive | Value |
| --- | --- | --- | --- |
| `--screen-inset-inline` (resident) | `--gutter-resident` | `--app-space-8` | 16px (G2) |
| `--screen-inset-block-start` (resident) | `--gutter-resident` | `--app-space-8` | 16px (G2) |
| `--screen-inset-block-end` (resident) | `--inset-screen-end` | `--app-space-10` | 24px (G2) |
| `--screen-gap` (resident) | `--gap-section-resident` | `--app-space-8` | 16px (G1) |
| `--screen-inset` (staff, at or above the Hub breakpoint) | `--inset-page-staff` | `--app-space-10` | 24px |
| `--screen-inset` (staff, below the Hub breakpoint) | `--inset-page-staff-narrow` | `--app-space-8` | 16px |
| `--screen-gap` (staff) | `--gap-section-hub` | `--app-space-9` | 20px (G1) |
| `--screen-max-inline-size` (staff, `width="default"`) | `--size-page-staff` | `--app-page-staff` | 1040px (G5) |
| `--screen-max-inline-size` (staff, `width="review"`) | `--size-page-staff-review` | `--app-page-staff-review` | 1080px (G5) |
| `--screen-max-inline-size` (staff, `width="partner"`) | `--size-page-staff-partner` | `--app-page-staff-partner` | 1140px (G5; MVP) |
| `--screen-max-inline-size` (staff, `width="published"`, `"log"`, `"update"`, `"resolve"`) | `--size-page-staff-published`, `-log`, `-update`, `-resolve` | `--app-page-staff-published` and so on | 960px, 920px, 980px, 900px (G5) |
| `--screen-max-inline-size` (resident) | none | none | Not set: resident content fills the shell's main area at every width (G5) |

The resident values are the same in basic mode (G2). `Screen` never falls back to a literal; the check "spacing from tokens only" stays on.

Hub pages whose main-column sections use another rhythm (22px on O-01, O-03, O-04, O-14, O-15; 18px on O-07, O-12) put a `Stack` with `gap="section-hub-main"` or `gap="section-hub-review"` inside `Screen` (`stack.md`); `Screen`'s own gap stays `--gap-section-hub`.

## Responsive behaviour

- **Resident (320, 390, 768 px):** no change by width. The body fills the shell's main area at every width; resident content is not capped (G5).
- **Staff:** one switch at the Hub breakpoint (700 px viewport, Tailwind variant `hub:`), the same switch that shows the shell's side navigation. Below it, the narrow inset (16px); at or above it, the wide inset (24px). The maximum inline size applies at every width, with the body centred by `margin-inline: auto` on the body (the one margin a primitive may set on its own inner element, because centring is its job).
- **Query container (staff):** the body is the query container `hub-page` (`container-type: inline-size; container-name: hub-page`). Its content box, inside the page padding, is the width a two-column `Grid` measures (switch at 800px, `grid.md`). `Screen` itself never changes columns, and nothing in a page reads the Hub breakpoint to change columns (`component-boundaries.md` 3.2).
- **Actions region:** `position: sticky; inset-block-end: 0`, with the page surface colour (`--surface`) as its background, a 1px top border in `--border` (`--offset-align-hairline`) and `z-index: 2`, so scrolled content never shows through (the prototype's `.cvh-pubbar`). The region itself stays full width; an inner wrapper (`layout-screen__actions-inner`) takes the body's `--screen-inset-inline` and `--screen-max-inline-size` and is centred like the body, so the buttons line up with the page column on both surfaces and in RTL. Action buttons inside it are full width when the slot is narrower than two buttons side by side; they size from the slot, never from the viewport (R8).

## RTL behaviour

Only logical properties: `padding-inline`, `padding-block-start`, `padding-block-end`, `max-inline-size`, `margin-inline: auto`, `inset-block-end`. The same output serves `ur`, `ps` and `prs`; there is no `[dir]` selector.

## Basic mode

No change. Gaps and insets stay the same in basic mode (G2, as in the prototype). Children react on their own (`tap` rule, `Grid` collapse).

## Accessibility

- `Screen` renders a `div`; the shell owns the single `<main>` landmark.
- The `actions` region renders `<div role="region" aria-label={actionsLabel}>` so screen-reader users can find Approve or the round's send status.
- Sticky actions must not cover focused content: the body gets `scroll-padding-block-end` equal to the actions region's size (measured, not a token), so keyboard focus scrolls above it.
- Reading order equals DOM order: bleed, body, actions.

## Do and don't

| Do | Don't |
| --- | --- |
| Put one `Screen` per screen, inside the shell's main | Nest a `Screen` inside another |
| Put a map or filter bar in `bleed` | Pull content to the edges with negative margins (`.cvh-pubbar`'s `margin-bottom: -24px` pattern) |
| Put Approve, Return and Discard in `actions` | Make the action bar a sibling of `Screen` with its own gutter |
| Let `Screen` space its top-level sections | Add `margin-top` to the first child to make room |

## Acceptance criteria

**Given** `Screen surface="resident"` with three child sections
**When** rendered at 320, 390 and 768 px in `en`
**Then** the computed `padding-inline-start`, `padding-inline-end` and `padding-block-start` of the body equal `--gutter-resident` (16px), the computed `row-gap` equals `--gap-section-resident` (16px), `padding-block-end` equals `--inset-screen-end` (24px), at 768 px the body is as wide as the shell's main area (no maximum inline size), and the document has no horizontal scroll (`scrollWidth <= clientWidth`)

**Given** the same screen with basic mode on (`<html data-basic="true">`)
**When** rendered at 390 px
**Then** the paddings and the `row-gap` are the same as with basic mode off (16px, 16px, 24px)

**Given** the same screen in `ur`
**When** rendered at 390 px
**Then** `<html dir="rtl">` is set, the body's computed paddings are identical to `en`, and each child's left edge in `ur` equals the viewport width minus its right edge in `en` (±1 px)

**Given** `Screen surface="staff"` in the Hub shell
**When** rendered at viewport widths 390, 699, 700 and 1280 px
**Then** the inset equals `--inset-page-staff-narrow` (16px) at 390 and 699 px and `--inset-page-staff` (24px) at 700 and 1280 px, and the `row-gap` equals `--gap-section-hub` (20px) at every width

**Given** `Screen surface="staff"` with `width="default"` and with `width="review"`
**When** rendered at a viewport of 1600 px
**Then** the body's inline size is 1040px (`--size-page-staff`) and 1080px (`--size-page-staff-review`) respectively, and the body is centred in the main column
**And** `width="published"`, `"log"`, `"update"` and `"resolve"` give 960px, 920px, 980px and 900px

**Given** `Screen surface="staff"` and `Screen surface="resident"`
**When** the computed styles of the body are read
**Then** the staff body has `container-type: inline-size` and `container-name: hub-page`, and the resident body is not a query container

**Given** `Screen` with `actions`
**When** the body is longer than the viewport and the user scrolls
**Then** the actions region stays visible at the block end, has the accessible name from `actionsLabel`, and tabbing to the last field in the body scrolls it fully above the actions region

**Given** `Screen` with `actions` on a resident screen at 390 px and on a staff screen at 1280 px, in `en` and `ur`
**When** the body has been scrolled so that fields lie behind the actions region
**Then** the region's computed background is opaque and equals `--surface`, it has a 1px solid top border in `--border` and a `z-index` other than `auto`, the element at the region's centre point is inside the region, the region spans the full viewport width, and the first action's inline-start edge equals the inline-start edge of the body's content (left in `en`, right in `ur`)

**Given** `Screen inset="none"` with a map in `bleed`
**When** rendered at 390 px
**Then** the map's box spans the full width of the main area and no element in `src/` has a negative margin

**Given** `src/ui/layout/screen.css` and `screen.tsx`
**When** the CI checks run
**Then** every spacing declaration is a `var()` of a `--screen-*` component token whose value is a `var()` of a semantic token (no literal length other than `0`), and none of `left`, `right`, `margin-left`, `margin-right`, `padding-left`, `padding-right`, or a 3- or 4-value `padding`/`margin` shorthand appears

**Given** a TypeScript file that passes `surface="hub"`, `inset="small"`, `width="wide"`, `width` together with `surface="resident"`, `style` or `className` to `Screen`
**When** `tsc --noEmit` runs
**Then** it fails (checked by a type test with `@ts-expect-error`)
