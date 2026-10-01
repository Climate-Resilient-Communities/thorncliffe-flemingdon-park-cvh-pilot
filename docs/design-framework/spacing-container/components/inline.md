# Inline

**Status:** Pilot · **File:** `src/ui/layout/inline.tsx` (with `Inline.Grow`) · **Built in:** S02.01

## Purpose

Lays out children in the inline direction (left to right in most launch languages, right to left in `ur`, `ps`, `prs`) with one gap, and wraps them onto new lines when they do not fit. Used for icon plus label, a row of chips, a header with a title at one end and a control at the other, and button pairs.

It covers both the source framework's `Row` (`LayoutPrimitives.tsx`) and the "Cluster" pattern (a wrapping row of chips). The prototype equivalents are `.cvh-row`, `.cvh-row.cvh-wrap` and `.cvh-grow`.

## Anatomy

```text
Inline  (div | ul | p)  display: flex; flex-direction: row; flex-wrap; gap; align-items; justify-content
├─ child
├─ Inline.Grow        flex: 1 1 auto; min-inline-size: 0  (takes the remaining space, may shrink and wrap text)
│   └─ child
└─ child
```

`flex-direction: row` follows the writing direction, so the first child sits at the inline start in every language.

## Props

| Prop | Type (allowed values only) | Default | Notes |
| --- | --- | --- | --- |
| `gap` | `'label' \| 'icon' \| 'grid' \| 'panel'` and, once closed, `'tight' \| 'stack' \| 'target'` | `'icon'` | `--gap-icon` (10px) matches the prototype's `.cvh-row` default |
| `align` | `'center' \| 'start' \| 'end' \| 'baseline' \| 'stretch'` | `'center'` | Block-axis alignment |
| `justify` | `'start' \| 'center' \| 'end' \| 'between'` | `'start'` | `'between'` puts the first and last child at opposite ends |
| `wrap` | `boolean` | `true` | Translated labels vary in length; wrapping is the default so nothing overflows at 320 px |
| `as` | `'div' \| 'ul' \| 'p'` | `'div'` | `ul` for a list of chips or links |
| `testId` | `string` | none | |

`Inline.Grow` takes no props other than `children` and `as` (`'div' \| 'span'`).

Not included: `justify="around" | "evenly"` (source has them; unused), `direction` or `reverse` (would break reading order), `className`, `style`, numeric `gap`.

## Tokens used

| Prop value | Semantic token | Primitive | Value |
| --- | --- | --- | --- |
| `label` | `--gap-label` | `--space-1` | 4px |
| `icon` | `--gap-icon` | `--space-2` | 10px |
| `grid` | `--gap-grid` | `--space-3` | 17px |
| `panel` | `--gap-panel` | `--space-4` | 24px |
| `tight` | `--gap-tight` | — | Blocked by G1 |
| `stack` | `--gap-stack` | — | Blocked by G1 |
| `target` | `--gap-target` | — | Blocked by G3 (prototype "8px between targets") |

When `wrap` is on, the same token is used for the row gap and the column gap (one value, `gap`). A wrapping row of touch targets uses `gap="target"`.

## Responsive behaviour

No breakpoint. Wrapping is the only width response. At 320 px, a header `Inline justify="between"` whose children do not fit wraps the second child to a new line at the inline start; that is expected.

## RTL behaviour

- The visual order mirrors automatically; DOM order and reading order stay the same.
- `justify="start"` and `"end"` compile to `flex-start`/`flex-end`, which follow direction. Never `left`/`right`.
- Directional icons inside an `Inline` mirror through the icon rule, not through `Inline`.
- Text inside `Inline.Grow` that holds a phone number, building code or English original keeps its own direction through `<bdi>` or `dir="ltr"` on that element (the prototype's `.cvh-ltr`, `.cvh-bdi`); `Inline` does not handle this.

## Basic mode

No change to gap or wrapping. Larger type and `--tap-basic` targets make children wider, so rows wrap sooner; this is intended.

## Accessibility

- `Inline` never reorders children visually (`order`, `row-reverse` are not available), so focus order matches visual order in both directions.
- With `as="ul"`, `Inline` adds `role="list"` (same reason as `Stack`) and children must be `li`.
- Two adjacent touch targets in an `Inline` must use `gap="target"` or be at least `--tap` apart edge to edge (see `touch-target.md`).

## Do and don't

| Do | Don't |
| --- | --- |
| `<Inline gap="icon">` for an icon and its label | Put `margin-inline-start` on the label |
| `<Inline justify="between">` for the header's logo and language button | Use `margin-inline-start: auto` on the language button (prototype `.cvh-langbtn`) |
| Wrap the growing text in `Inline.Grow` | Set `flex: 1` and `min-width: 0` on a content component's root |
| Let chips wrap | Set `white-space: nowrap` on a row of translated labels |

## Acceptance criteria

**Given** `<Inline gap="icon">` with an icon and a label
**When** rendered in `en` at 390 px
**Then** the computed `column-gap` equals `--gap-icon` (10px), the icon is at the left, and the label starts 10px after the icon's right edge

**Given** the same in `ur`
**When** rendered at 390 px
**Then** `<html dir="rtl">`, the icon is at the right, the label ends 10px before the icon's left edge, and the CSS of `Inline` contains no `[dir]` selector

**Given** an `Inline wrap` of six chips whose combined width exceeds 320 px, in the longest launch language for those labels
**When** rendered at 320 px
**Then** chips wrap onto two or more lines, the row gap and column gap both equal the token for the `gap` prop, and `document.documentElement.scrollWidth <= 320`

**Given** `<Inline justify="between">` with a logo and a button
**When** rendered at 390 px in `en` and `ur`
**Then** the logo's inline-start edge touches the container's inline-start edge and the button's inline-end edge touches the container's inline-end edge in both languages (±1 px)

**Given** `<Inline.Grow>` holding a long translated title next to a button
**When** rendered at 320 px
**Then** the title wraps inside the available space and the button keeps its full size (at least `--tap` by `--tap`)

**Given** `<Inline gap="10px">`, `<Inline justify="around">` or `<Inline style={{ gap: 8 }}>`
**When** `tsc --noEmit` runs
**Then** it fails (type test)

**Given** `src/ui/layout/inline.css`
**When** the CI checks run
**Then** it contains no physical property, no margin, no `order`, no `row-reverse`, and every gap is `var(--gap-…)`
