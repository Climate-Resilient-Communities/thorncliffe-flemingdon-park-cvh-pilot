# Screen

> **Status: approved framework (2026-10-01); unresolved token values are still draft.** The rules and primitives here are implementation requirements for S01.16 and the stories that use them. Token values marked **unresolved** have no approved value, stay draft until the design owner decides them in `tokens.json`, and nothing may hard-code them. The plan changes were applied from the change proposal [`docs/planning/pilot/change-proposals/2026-10-01-spacing-framework.md`](../../../planning/pilot/change-proposals/2026-10-01-spacing-framework.md) to `epics.md` and AD-16.

**Status:** Pilot · **File:** `src/ui/layout/screen.tsx` · **Built in:** S01.16 (primitive), used first by S01.09 and S02.02

## Purpose

The content area of one screen. `Screen` is the only part that sets the screen's inline gutter, its block padding, the gap between its top-level sections, its maximum inline size, and the sticky actions region at its block end. Shells put exactly one `Screen` inside their scrolling main area.

It replaces the source framework's `BlockLayout` (`dilawriweb/packages/ui/src/components/layout/BlockLayout.tsx`: section wrapper with horizontal padding, vertical padding and a centred max-width inner box) and the prototype's `.cvh-screen` and `.cvh-hubbody`.

## Anatomy

```text
Screen  (div, data-surface)
├─ body        inset: block-start, inline gutter, block-end; max inline size; children stacked with the section gap
│   └─ children (Stack, Inline, Grid, content components)
├─ bleed?      optional full-width region at the block start, outside the inline gutter (map, applied-filter bar)
└─ actions?    optional sticky region at the block end, full width, outside the inline gutter
```

## Props

| Prop | Type (allowed values only) | Default | Notes |
| --- | --- | --- | --- |
| `surface` | `'resident' \| 'staff'` | required | Picks the inset and width tokens. Ambassador screens use `'resident'` (they are phone screens in the prototype). |
| `inset` | `'default' \| 'none'` | `'default'` | `'none'` removes the inline gutter and the section gap (the prototype's `.cvh-screen--flush`, used by the map). Block-end padding stays. |
| `bleed` | `ReactNode` | none | Rendered before the body, full width. |
| `actions` | `ReactNode` | none | Rendered after the body; sticky to the block end of the scroll container; full width. |
| `actionsLabel` | catalog string | required when `actions` is set | Accessible name of the actions region. |
| `testId` | `string` | none | `data-testid`. |

No `className`, `style`, `gap` or `padding` prop. Children are laid out as a column with the section gap; use a `Stack` inside for any other rhythm.

## Tokens used

| Component token | Resolves to (layer 2) | Value today |
| --- | --- | --- |
| `--screen-inset-inline` (resident) | `--gutter-resident` | Blocked by G2 (prototype 16px) |
| `--screen-inset-block-start` (resident) | `--gutter-resident` | Blocked by G2 (prototype 16px) |
| `--screen-inset-block-end` (resident) | `--inset-screen-end` | 24px (`--space-4`) |
| `--screen-gap` (resident) | `--gap-section` | Blocked by G1 (prototype 16px) |
| `--screen-inset` (staff, at or above the Hub breakpoint) | `--inset-page-staff` | 24px (`--space-4`) |
| `--screen-inset` (staff, below the Hub breakpoint) | `--inset-page-staff-narrow` | Blocked by G1 (prototype 16px) |
| `--screen-gap` (staff) | `--gap-section` | Blocked by G1 (prototype 20px on Hub pages) |
| `--screen-max-inline-size` (staff) | `--size-page-staff` | Blocked by G5 (prototype 1040–1140px) |
| `--screen-max-inline-size` (resident) | `--size-reading` | Blocked by G5 (prototype: none) |

Until a blocked token has a value, `Screen` must not fall back to a literal. The story that builds it records the open gap; the check "spacing from tokens only" stays on.

## Responsive behaviour

- **Resident (320, 390, 768 px):** no change by width. The body fills the shell's main area; at 768 px it stretches unless G5 sets `--size-reading`.
- **Staff:** one switch at the Hub breakpoint (G4). Below it, the narrow inset; at or above it, the wide inset and the maximum inline size, with the body centred by `margin-inline: auto` on the body (the one margin a primitive may set on its own inner element, because centring is its job).
- **Actions region:** `position: sticky; inset-block-end: 0`. Below the Hub breakpoint, action buttons inside it are full width (the buttons' own rule, R8).

## RTL behaviour

Only logical properties: `padding-inline`, `padding-block-start`, `padding-block-end`, `max-inline-size`, `margin-inline: auto`, `inset-block-end`. The same output serves `ur`, `ps` and `prs`; there is no `[dir]` selector.

## Basic mode

No change. Gaps and insets stay the same in basic mode (as in the prototype). Children react on their own (`tap` rule, `Grid` collapse).

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
**Then** the computed `padding-inline-start` and `padding-inline-end` of the body equal the computed value of `--gutter-resident`, the computed `row-gap` equals `--gap-section`, `padding-block-end` equals `--inset-screen-end`, and the document has no horizontal scroll (`scrollWidth <= clientWidth`)

**Given** the same screen in `ur`
**When** rendered at 390 px
**Then** `<html dir="rtl">` is set, the body's computed paddings are identical to `en`, and each child's left edge in `ur` equals the viewport width minus its right edge in `en` (±1 px)

**Given** `Screen surface="staff"`
**When** rendered at 390 px and at 1280 px
**Then** the inset equals `--inset-page-staff-narrow` at 390 px and `--inset-page-staff` at 1280 px, and at 1280 px the body's inline size is at most `--size-page-staff` and it is centred

**Given** `Screen` with `actions`
**When** the body is longer than the viewport and the user scrolls
**Then** the actions region stays visible at the block end, has the accessible name from `actionsLabel`, and tabbing to the last field in the body scrolls it fully above the actions region

**Given** `Screen inset="none"` with a map in `bleed`
**When** rendered at 390 px
**Then** the map's box spans the full width of the main area and no element in `src/` has a negative margin

**Given** `src/ui/layout/screen.css` and `screen.tsx`
**When** the CI checks run
**Then** every spacing declaration is a `var()` of a `--screen-*` component token whose value is a `var()` of a semantic token (no literal length other than `0`), and none of `left`, `right`, `margin-left`, `margin-right`, `padding-left`, `padding-right`, or a 3- or 4-value `padding`/`margin` shorthand appears

**Given** a TypeScript file that passes `surface="hub"`, `inset="small"`, `style` or `className` to `Screen`
**When** `tsc --noEmit` runs
**Then** it fails (checked by a type test with `@ts-expect-error`)
