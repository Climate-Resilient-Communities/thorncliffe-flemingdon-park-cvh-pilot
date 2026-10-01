# Stack

**Status:** Pilot · **File:** `src/ui/layout/stack.tsx` · **Built in:** S02.01

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
| `gap` | `'label' \| 'icon' \| 'grid' \| 'paragraph' \| 'panel'` and, once their gaps are closed, `'tight' \| 'stack' \| 'section'` | `'stack'` once G1 is closed; until then the prop is required | Maps to `--gap-{value}` |
| `align` | `'stretch' \| 'start' \| 'center' \| 'end'` | `'stretch'` | Cross-axis (inline) alignment; logical by nature |
| `as` | `'div' \| 'ul' \| 'ol' \| 'section' \| 'fieldset'` | `'div'` | Use `ul`/`ol` for lists of alerts, listings, round items |
| `testId` | `string` | none | |

Not included (deliberately): `justify` (source has it; no pilot screen distributes space vertically), `className`, `style`, numeric `gap`.

## Tokens used

| Prop value | Semantic token | Primitive | Value |
| --- | --- | --- | --- |
| `label` | `--gap-label` | `--space-1` | 4px |
| `icon` | `--gap-icon` | `--space-2` | 10px |
| `grid` | `--gap-grid` | `--space-3` | 17px |
| `paragraph` | `--gap-paragraph` | `--space-4` | 24px |
| `panel` | `--gap-panel` | `--space-4` | 24px |
| `tight` | `--gap-tight` | — | Blocked by G1 (prototype 2–6px) |
| `stack` | `--gap-stack` | — | Blocked by G1 (prototype 12px) |
| `section` | `--gap-section` | — | Blocked by G1 (prototype 16px resident, 20px Hub) |

## Responsive behaviour

None. The gap is the same at every width. A screen that needs a different rhythm at the Hub breakpoint uses `Grid` or a different `Stack`, not a responsive gap.

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
