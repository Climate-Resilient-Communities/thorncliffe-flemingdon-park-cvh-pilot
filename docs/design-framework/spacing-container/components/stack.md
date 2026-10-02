# Stack

> **Status: approved framework (2026-10-01); token values decided by the design owner on 2026-10-02 (G1–G10, `token-architecture.md` section 11).** The rules, primitives and token values here are implementation requirements for S01.16 and the stories that use them. Values come from `design/prototype/ds/cvrh/tokens.json`; rare values and where they are used are in [`rare-spacing-inventory.md`](../rare-spacing-inventory.md). The plan changes were applied from the change proposal [`docs/planning/pilot/change-proposals/2026-10-01-spacing-framework.md`](../../../planning/pilot/change-proposals/2026-10-01-spacing-framework.md) to `epics.md` and AD-16.

**Status:** Pilot · **File:** `src/ui/layout/stack.tsx` · **Built in:** S01.16

## Purpose

Lays out children in the block direction (top to bottom in every launch language) with one gap between them. `Stack` is how every vertical space between two things on a screen is made. Children never add their own outer margin (`component-boundaries.md` R1, R2).

Source: `Stack` in `dilawriweb/packages/ui/src/components/layout/LayoutPrimitives.tsx` (flex column, `gap`, `align`, `justify`). Prototype equivalent: `.cvh-stack` with a `--gap` variable set inline on most screens.

## Anatomy

```text
Stack  (div | ul | ol | section | fieldset)  display: flex; flex-direction: column; gap
├─ child
├─ child
└─ child
```

## Props

| Prop | Type (allowed values only) | Default | Notes |
| --- | --- | --- | --- |
| `gap` | `'subline' \| 'label' \| 'tight' \| 'related' \| 'target' \| 'icon' \| 'grid' \| 'stack' \| 'section-resident' \| 'section-hub' \| 'section-hub-main' \| 'section-hub-review' \| 'panel' \| 'paragraph'` | `'stack'` | Maps to `--gap-{value}` (table below) |
| `align` | `'stretch' \| 'start' \| 'center' \| 'end'` | `'stretch'` | Cross-axis (inline) alignment; logical by nature |
| `as` | `'div' \| 'ul' \| 'ol' \| 'section' \| 'fieldset'` | `'div'` | Use `ul`/`ol` for lists of alerts, listings, round items |
| `testId` | `string` | none | |

Not included (deliberately): `justify` (source has it; no pilot screen distributes space vertically), `className`, `style`, numeric `gap`.

## Tokens used

| Prop value | Semantic token | Primitive | Value |
| --- | --- | --- | --- |
| `subline` | `--gap-subline` | `--app-space-1` | 2px |
| `label` | `--gap-label` | `--app-space-2` | 4px |
| `tight` | `--gap-tight` | `--app-space-3` | 6px |
| `related` | `--gap-related` | `--app-space-4` | 8px |
| `target` | `--gap-target` | `--app-space-4` | 8px (G3) |
| `icon` | `--gap-icon` | `--app-space-5` | 10px |
| `grid` | `--gap-grid` | `--app-space-5` | 10px |
| `stack` | `--gap-stack` | `--app-space-6` | 12px |
| `section-resident` | `--gap-section-resident` | `--app-space-8` | 16px (G1) |
| `section-hub` | `--gap-section-hub` | `--app-space-9` | 20px (G1) |
| `section-hub-main` | `--gap-section-hub-main` | `--app-space-22px` (rare) | 22px; only the main-column sections of O-01, O-03, O-04, O-14, O-15 |
| `section-hub-review` | `--gap-section-hub-review` | `--app-space-18px` (rare) | 18px; only the main-column sections of O-07, O-12 |
| `panel` | `--gap-panel` | `--app-space-10` | 24px |
| `paragraph` | `--gap-paragraph` | `--app-space-10` | 24px |

Use `section-resident` on resident and ambassador screens and `section-hub` on Hub pages; the two rare section gaps are only for the pages named, where the prototype shows them (`rare-spacing-inventory.md`).

## Responsive behaviour

None. The gap is the same at every width. A Hub page that is two columns at one width and one column at another uses `Grid twoColumn`, whose stacked gap is fixed (`grid.md`), not a responsive `Stack` gap.

## RTL behaviour

Block direction does not change with `dir`, so `Stack` has nothing to mirror. `align="start"` aligns to the inline start (right in `ur`, `ps`, `prs`), because it compiles to `align-items: flex-start`, which follows writing direction.

## Basic mode

No change. Larger type in basic mode makes children taller; the gap stays.

## Accessibility

- With `as="ul"` or `as="ol"`, `Stack` resets list styling and adds `role="list"`, because Safari with VoiceOver drops list semantics from lists with `list-style: none`. Direct children must then be `li`.
- With `as="fieldset"`, the first child must be a `legend` (a field group such as building and floor).
- `Stack` never changes reading order (no `flex-direction: column-reverse`).

## Do and don't

| Do | Don't |
| --- | --- |
| `<Stack gap="label">` around a field label, control and helper text | `margin-top` on the helper text (prototype `.cvh-disabled-reason`) |
| `<Stack as="ul" gap="stack">` for a list of alert cards | Give each alert card `margin-bottom` |
| Nest stacks for two rhythms (section gap outside, label gap inside) | Insert an empty element or a `Spacer` to add room |
| Use `align="start"` for a button that should not stretch | Use `align-self` on the child with a physical value |

## Acceptance criteria

**Given** `<Stack gap="icon">` with three children
**When** rendered
**Then** the computed `row-gap` equals the computed value of `--gap-icon` (10px), and the distance between the block-end edge of one child and the block-start edge of the next is exactly that value

**Given** every allowed `gap` value
**When** a snapshot of the generated class map is taken
**Then** each maps to exactly one `var(--gap-…)` declaration, and no class contains a literal length

**Given** `<Stack as="ul">`
**When** inspected in the accessibility tree
**Then** it is exposed as a list with the correct item count

**Given** `<Stack gap={12}>`, `<Stack gap="12px">`, `<Stack gap="md">` or `<Stack className="mt-4">`
**When** `tsc --noEmit` runs
**Then** it fails (type test with `@ts-expect-error`)

**Given** a stack of three children in `en` and in `ur` at 390 px
**When** compared
**Then** every child's block position is identical, and with `align="start"` each child's inline-start edge is at the left in `en` and at the right in `ur`

**Given** `src/ui/layout/stack.css`
**When** the CI checks run
**Then** no physical property (`margin-left`, `padding-right`, `left`, `right` and similar) and no margin of any kind appears, and every `gap` value is `var(--gap-…)`

**Given** basic mode on and off
**When** the same stack is rendered
**Then** the computed `row-gap` is the same
