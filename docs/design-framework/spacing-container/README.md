# Spacing and container framework (CVH pilot)

This folder sets the rules for space and layout in the CVH app: which spacing tokens exist and where their values come from, the four layout primitives that arrange content, which component owns which space, and the checks that keep it that way in right-to-left languages and in basic mode.

It is written before the app is scaffolded. Nothing here is code; the stories listed below build it.

## Contents

| File | What it answers |
| --- | --- |
| [`token-architecture.md`](token-architecture.md) | Spacing token layers (from `tokens.json` → semantic → component), CSS custom property names, the Tailwind v4 theme S02.01 generates, RTL, 44 px targets, breakpoints, basic mode, light and navy themes, the automated checks, and the **gaps** in `tokens.json` |
| [`naming-conventions.md`](naming-conventions.md) | How tokens, primitives, props, CSS classes and files are named, and every place this differs from the source framework and why |
| [`component-boundaries.md`](component-boundaries.md) | Who owns spacing: primitives, shells or content components; applied to the resident shell, Hub shell, approval view and round page |
| [`component-inventory-mapping.md`](component-inventory-mapping.md) | Every pilot screen and component (C_*, Lib_*, R-xx, O-xx, A-xx, X-xx) mapped to primitives, tokens and the story that builds it |
| [`components/screen.md`](components/screen.md) | `Screen`: gutter, block padding, section gap, maximum width, sticky actions |
| [`components/stack.md`](components/stack.md) | `Stack`: vertical flow with one gap |
| [`components/inline.md`](components/inline.md) | `Inline` (with `Inline.Grow`): wrapping horizontal flow, follows writing direction |
| [`components/grid.md`](components/grid.md) | `Grid`: equal columns or main plus aside; collapses in basic mode and on narrow Hub |
| [`components/touch-target.md`](components/touch-target.md) | The `tap` rule: 44 px minimum (larger in basic mode), and how it is tested |

## Where it came from

The structure and rules are adapted from a separate spacing and container framework (a read-only copy at `/home/user/personal-website/design-framework/spacing-container-framework/`, extracted from the Dilawri web project). The parts used:

| Source path (under that folder) | Used for |
| --- | --- |
| `_bmad/wds/data/design-system/token-architecture.md` | Three token layers; "use level 2 or 3 in components, never level 1" |
| `dilawriweb/packages/ui/THEMING.md` | Two-layer theming; no component references a primitive directly |
| `_bmad/wds/data/design-system/component-boundaries.md` | Container + content pattern; decision checklist; "start simple" |
| `_bmad/wds/data/design-system/naming-conventions.md` | Token, variant and file naming formats |
| `dilawriweb/packages/ui/src/components/layout/LayoutPrimitives.tsx` | `Row`, `Stack`, `Grid` (props `gap`, `align`, `justify`, `cols`) → CVH `Inline`, `Stack`, `Grid` |
| `dilawriweb/packages/ui/src/components/layout/BlockLayout.tsx` | Section wrapper with gutter, vertical padding and max width → CVH `Screen` |
| `dilawriweb/packages/ui/src/stories/Spacing.mdx`, `Breakpoints.mdx` | Documentation structure (scale table, layout tokens, usage); breakpoint token → CSS variable → Tailwind mapping |
| `docs/component-inventory/component-inventory-mapping.md` | One-row-per-inventory-item mapping with a resolution and note |
| `design-process/D-Design-System/00-design-system.md` | Spacing is relational; optical adjustments only as annotated token math; foundation first, no speculative components |
| `dilawriweb/packages/ui/src/lib/design-system/audit-css-custom-properties.js` | The "no undeclared custom property" check |
| `README.md` ("Known drift") | The habit of recording where documentation and code disagree; CVH has the same kind of drift (below) |

The source framework's own MDX docs are not per-primitive; the per-primitive spec format used in `components/` (purpose, anatomy, props, tokens used, responsive, RTL, basic mode, accessibility, do and don't, acceptance criteria) follows the section order the source's Storybook docs use for tokens, extended with RTL, basic mode and testable criteria.

## How it fits the CVH spine

- **AD-16 (strings and look come from the prototype).** "Design tokens are generated from `design/prototype/ds/cvrh/tokens.json`" and "Styling uses logical CSS properties only." This framework adds nothing to `tokens.json`; it names jobs (semantic tokens) on top of the generated values and lists what is missing. Every spacing value in `src/` must trace to `tokens.json` through a `var()` chain, and the logical-CSS rule becomes a lint with a defined list of banned properties and utilities. Basic mode ("switches to the prototype's basic layouts") becomes one attribute read by the `tap` rule and `Grid`. The "one catalog 911 block" has no outer margin, so screens can place it anywhere without spacing changes.
- **AD-1 (two surfaces).** One set of primitives serves both `/[lang]/…` and `/staff/…`; `Screen` takes `surface="resident" | "staff"` so both surfaces draw from the same tokens.
- **Stack table.** Next.js 16 and React 19 (primitives are server-safe components with no client state), Tailwind 4.3.3 (CSS-first `@theme`; the default numeric spacing scale and breakpoints are removed). No Storybook: the stack does not list it, so specs are Markdown and the criteria are Vitest and Playwright tests.
- **Structural Seed.** `src/ui/` "holds tokens and components": tokens in `src/ui/tokens/`, primitives in `src/ui/layout/`, shells in `src/ui/shell/`. The generator lives in `scripts/` with the other generators.
- **Conventions.** "Accessibility: touch targets ≥ 44 px" → the `tap` rule and its test.

## Stories that implement it

| Story | What it builds from this framework |
| --- | --- |
| S02.01 — tokens and strings from the prototype | Generated layer 1, `semantic.css`, Tailwind theme, the four primitives, the `tap` rule, and the CI checks in `token-architecture.md` section 10 (with the proposed changes below) |
| S01.09 — phone-first Hub | Hub shell using `Screen surface="staff"`, `Grid` and the Hub breakpoint |
| S02.02 — resident shell, RTL, 320/390/768 | Resident shell using `Screen surface="resident"`; the logical-CSS lint; RTL mirroring checks |
| S02.14 — basic mode and accessibility | `data-basic`, `--tap-basic`, `Grid` collapse, the touch-target test |
| All screen stories (see `component-inventory-mapping.md`) | Use the primitives; add no spacing values |

## The main finding: `tokens.json` and the prototype's CSS disagree

`tokens.json` has seven spacing steps (4, 10, 17, 24, 29, 48, 67 px) taken from slides and documents. The prototype's stylesheet `design/prototype/cvh/cvh.css` mostly uses other values (8, 12, 6, 14, 16, 2, 20 px …), plus a 16 px gutter and 44/56 px touch targets that are not in `tokens.json`. UX-DR1 asks for tokens "matching the prototype exactly", and AD-16 says tokens come only from `tokens.json`. Both cannot hold until the design owner adds the missing values to `tokens.json` (or deliberately moves the prototype onto the seven steps). There are also no breakpoints and no container widths in `tokens.json`.

The full list (G1–G10), with the evidence for each, is in `token-architecture.md` section 11. Until a gap is closed, the related token is reserved with no value, and no code may hard-code the prototype's number.

## Pilot set and what is left for the MVP

| Primitive | Pilot | Why |
| --- | --- | --- |
| `Screen` | Yes | Every screen needs one gutter, padding and section gap; the approval view and round page need a sticky actions region without negative margins |
| `Stack` | Yes | Every vertical gap |
| `Inline` (covers Row and Cluster) | Yes | Icon plus label, chips, header rows; wraps by default for long translations |
| `Grid` | Yes | Home tiles, round mark buttons, Hub main plus aside, Hub side nav; basic-mode collapse |
| `tap` rule | Yes (a utility, not a component) | 44 px rule (spine, UX-DR19, S01.09, S02.14) |
| `Box` / `Inset` | MVP | No pilot region needs padding that is not already owned by `Screen`, a shell or a content component |
| `Spacer` | Not planned | Space comes from `gap`; an empty element for spacing hides intent and breaks in RTL reviews |
| `Divider` | Not a layout primitive | A hairline is a content component (prototype `.cvh-rule`) with no margin |
| Container queries, `cols` 5–12, `justify` around/evenly, `auto-fill` grids | MVP | No pilot screen needs them |

## What was deliberately not brought over from the source

| Source item | Reason |
| --- | --- |
| Tailwind's numeric spacing scale and five default breakpoints (`Spacing.mdx`, `Breakpoints.mdx`, `globals.css`) | They are Dilawri's values; CVH values must come from `tokens.json` (AD-16) |
| Layout-width tokens (page 1440, footer 1280, block 928/1250, carousel, auth card) and `LayoutProvider` | Dilawri page shapes; CVH has none of these regions. CVH widths are gaps G5 |
| `BlockLayout`'s background colours, `data-theme` switch per block, CMS block special cases (`isKpiBlock`, `isDashboardHero`), `blockHiddenOn` | Mixes colour and CMS logic into a layout primitive; CVH primitives draw nothing and are not CMS-driven |
| `Spacer` and `Divider` | See the table above |
| Free-form props (`gap?: number \| string`, `...props`, `className`) | Would let any value bypass `tokens.json`; also builds class names at run time, which Tailwind cannot see |
| WDS T-shirt scale (`space-3xs` … `space-3xl`) and "patterns organized by spacing value" catalogue | CVH already has one numbered scale; a second vocabulary was the source's own documented problem. The inventory mapping does the catalogue's job for the pilot |
| Figma component structure and Auto Layout guidance | CVH has no Figma file; the HTML prototype is the design source |
| WDS component ids (`btn-001`, `dsc-a-*`) and Area Labels as `aria-label` | CVH keeps prototype ids; accessible names must be translated catalog strings |
| Storybook MDX pages | Storybook is not in the CVH stack; specs are Markdown, behaviour is proven by tests (AD-24) |
| Epic K brand genericization (swap the brand by replacing one primitive block) | CVH has one brand and a generated token file; the two-layer rule is kept, the brand-swap workflow is not needed |
| `state-management.md`, `validation-patterns.md`, `contrast.ts` | Not about spacing. Contrast on token pairs is already in S02.14 |

## Open plan items found while mapping

- **O-07** (ambassador post review) is listed in UX-DR16 but no story's Traces names it. The plan should state which E08 story builds it.
- **S01.09 runs before S02.01** in the current plan (it depends only on S01.07), so the Hub shell could be built before tokens and primitives exist. See the proposed dependency below.

## Proposed plan changes (not applied)

These are recommendations for `docs/planning/pilot/epics.md`. They have **not** been made; the epics, spine and prototype are unchanged.

### Before S02.01 (launch-readiness item, no development time)

The design owner closes gaps G1–G5 in `tokens.json` (screen spacing values, resident gutter, touch target sizes and target spacing, one Hub breakpoint, Hub page and column widths) and states a decision on G6–G10. Without this, S02.01 can generate only the seven existing steps and the primitives cannot use the tokens they need. Estimate: design owner time only, about 2 hours, outside the development estimate.

### S02.01 — Developer generates the look and every interface string from the prototype

Add these acceptance criteria:

> **Given** `tokens.json`
> **When** `npm run gen:tokens` runs
> **Then** spacing and radius are written once on `:root`, colour is written for light on `:root` and for navy under `[data-theme="dark"]`, and a test fails if any `--space-*` or `--radius-*` property appears inside a `[data-theme]` block
>
> **Given** `src/ui/tokens/semantic.css` and every component token file
> **When** CI runs
> **Then** every declaration's value is a single `var()` of a declared token, `var(--space-` appears in no file other than `semantic.css`, and every `var(--x)` in `src/` has a matching declaration
>
> **Given** the Tailwind theme in `src/ui/tokens/theme.css`
> **When** a fixture using `p-4`, `gap-2`, `md:flex` and `p-[13px]` is built
> **Then** none of them produces CSS, and `gap-icon`, `p-card` and `ps-*`/`pe-*` utilities compile to `var()` of semantic tokens
>
> **Given** any CSS, TSX or inline style in `src/`
> **When** the spacing lint runs
> **Then** it fails on a literal length other than `0` in `padding*`, `margin*`, `gap`, `row-gap`, `column-gap` or `inset*`, on a negative margin, on an arbitrary Tailwind spacing value, and on spacing classes passed to a layout primitive
>
> **Given** the layout primitives `Screen`, `Stack`, `Inline`, `Grid` and the `tap` utility in `src/ui/layout/`
> **When** their unit, type and Playwright tests run
> **Then** the acceptance criteria in `docs/design-framework/spacing-container/components/*.md` pass
>
> **Given** a token that a primitive needs and that `tokens.json` does not yet define
> **When** `npm run gen:tokens` runs
> **Then** the generator writes no default value, fails, and names the missing token and its gap number

Estimate impact: **+3.5 h** (6 h → 9.5 h). If that is too large for an M story, split the primitives, the `tap` rule and the lints into a new story "S02.01a — Developer has layout primitives and spacing checks" (S, 3.5 h, depends on S02.01), and make S01.09 and S02.02 depend on it.

### S01.09 — Staff use a phone-first Hub

Add **Depends on:** S02.01 (or S02.01a), so the shell is built on generated tokens and primitives.

Add these acceptance criteria:

> **Given** the Hub shell
> **When** rendered at 390 px and 1280 px
> **Then** screen content sits in `Screen surface="staff"`, the switch between the two layouts uses only the Hub breakpoint token, and the shell's CSS contains no other breakpoint, no literal width and no `[dir]` selector
>
> **Given** the top bar at 390 px
> **When** the signed-in person, role and sign-out wrap
> **Then** they stay reachable without horizontal scrolling, and the active side-nav item is marked with `border-inline-start` (not an inset shadow)

Estimate impact: **+0.5 h** (4 h → 4.5 h).

### S02.02 — Resident sees the CVH in their language, right to left where needed

Replace the lint clause "(a lint rule fails on `left`, `right`, `margin-left` and similar physical properties in `src/`)" with the full list, and add mirroring and theme checks:

> **Given** `src/`
> **When** the logical-CSS lint runs
> **Then** it fails on `left`, `right`, `margin-left`, `margin-right`, `padding-left`, `padding-right`, `border-left*`, `border-right*`, `float: left|right`, `text-align: left|right`, 3- and 4-value `margin`/`padding` shorthands, the Tailwind utilities `pl-* pr-* ml-* mr-* left-* right-* border-l border-r rounded-l-* rounded-r-* space-x-*`, and any `[dir=…]` selector other than the icon-mirroring rule
>
> **Given** the resident shell and one screen in `en` and `ur`
> **When** rendered at 320, 390 and 768 px
> **Then** the header, `Screen` and nav insets equal `--gutter-resident`, and each element's left edge in `ur` equals the viewport width minus its right edge in `en` (±1 px)
>
> **Given** the light and navy themes
> **When** the resident shell is rendered at 390 px in each
> **Then** every element's box is identical; only colours differ

Estimate impact: **+1 h** (7 h → 8 h).

### S02.14 — Resident switches to basic mode and uses the CVH with a screen reader

Add these acceptance criteria:

> **Given** basic mode saved in device choices
> **When** any resident page loads
> **Then** `<html data-basic="true">` is set before first paint, every grid with `collapseInBasic` shows one column, and the computed gaps and insets equal those in normal mode
>
> **Given** basic mode on, at 320 px, in `en`, `ur` and `ta`
> **When** the touch-target test runs
> **Then** every interactive element is at least `--tap-basic` in both dimensions, and adjacent targets are at least `--gap-target` apart

Estimate impact: **+1 h** (6 h → 7 h).

### Total

**+6 h** of development (E01 +0.5 h; E02 +5.5 h, epic estimate 87 h → 92.5 h), plus about 2 h of design-owner time to close the `tokens.json` gaps before S02.01. The checks added here replace manual review of spacing and RTL on every later screen story, which is where the time is recovered.
