# Spacing and container framework (CVH pilot)

> **Status: approved framework (2026-10-01); token values decided by the design owner on 2026-10-02 (G1–G10, `token-architecture.md` section 11).** The rules, primitives and token values here are implementation requirements for S01.16 and the stories that use them. Values come from `design/prototype/ds/cvrh/tokens.json`; rare values and where they are used are in [`rare-spacing-inventory.md`](rare-spacing-inventory.md). The plan changes were applied from the change proposal [`docs/planning/pilot/change-proposals/2026-10-01-spacing-framework.md`](../../planning/pilot/change-proposals/2026-10-01-spacing-framework.md) to `epics.md` and AD-16.

This folder sets the rules for space and layout in the CVH app: which spacing tokens exist and where their values come from, the four layout primitives that arrange content, which component owns which space, and the checks that keep it that way in right-to-left languages and in basic mode.

It is written before the app is scaffolded. Nothing here is code; the stories listed below build it.

## Contents

| File | What it answers |
| --- | --- |
| [`token-architecture.md`](token-architecture.md) | Spacing token layers (from `tokens.json` → semantic → component), CSS custom property names, the Tailwind v4 theme S01.16 generates, RTL, 44 px targets, the Hub breakpoint and the two-column container width, basic mode, light and navy themes, the automated checks, and the design owner's decisions on gaps G1–G10 (section 11) |
| [`rare-spacing-inventory.md`](rare-spacing-inventory.md) | Every spacing value in the prototype that is not on the common app scale, where it is used, and whether it is kept as an app token (decision G1) |
| [`naming-conventions.md`](naming-conventions.md) | How tokens, primitives, props, CSS classes and files are named, and every place this differs from the source framework and why |
| [`component-boundaries.md`](component-boundaries.md) | Who owns spacing: primitives, shells or content components; applied to the resident shell, Hub shell, approval view and round page |
| [`component-inventory-mapping.md`](component-inventory-mapping.md) | Every pilot screen and component (C_*, Lib_*, R-xx, O-xx, A-xx, X-xx) mapped to primitives, tokens and the story that builds it |
| [`components/screen.md`](components/screen.md) | `Screen`: gutter, block padding, section gap, maximum width, sticky actions; the staff content box is the query container for two-column Hub pages |
| [`components/stack.md`](components/stack.md) | `Stack`: vertical flow with one gap |
| [`components/inline.md`](components/inline.md) | `Inline` (with `Inline.Grow`): wrapping horizontal flow, follows writing direction |
| [`components/grid.md`](components/grid.md) | `Grid`: equal columns, or a two-column Hub page switched by a container query at 800 px of content width; collapses in basic mode |
| [`components/touch-target.md`](components/touch-target.md) | The `tap` rule: 44 px minimum (56 px in basic mode), 8 px between separate controls, and how it is tested |

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

- **AD-16 (strings and look come from the prototype).** "Design tokens are generated from `design/prototype/ds/cvrh/tokens.json`" and "Styling uses logical CSS properties only." The design owner's decisions on G1–G10 are recorded in `tokens.json` version 3; this framework names jobs (semantic tokens) on top of the generated values. Every spacing value in `src/` must trace to `tokens.json` through a `var()` chain, and the logical-CSS rule becomes a lint with a defined list of banned properties and utilities. Basic mode ("switches to the prototype's basic layouts") becomes one attribute read by the `tap` rule and `Grid`. The "one catalog 911 block" has no outer margin, so screens can place it anywhere without spacing changes.
- **AD-1 (two surfaces).** One set of primitives serves both `/[lang]/…` and `/staff/…`; `Screen` takes `surface="resident" | "staff"` so both surfaces draw from the same tokens.
- **Stack table.** Next.js 16 and React 19 (primitives are server-safe components with no client state), Tailwind 4.3.3 (CSS-first `@theme`; the default numeric spacing scale and breakpoints are removed). No Storybook: the stack does not list it, so specs are Markdown and the criteria are Vitest and Playwright tests.
- **Structural Seed.** `src/ui/` "holds tokens and components": tokens in `src/ui/tokens/`, primitives in `src/ui/layout/`, shells in `src/ui/shell/`. The generator lives in `scripts/` with the other generators.
- **Conventions.** "Accessibility: touch targets ≥ 44 px" → the `tap` rule and its test.

## Stories that implement it

| Story | What it builds from this framework |
| --- | --- |
| S01.16 — shared design tokens and layout primitives (S02.01 keeps strings only) | Generated layer 1, `semantic.css`, Tailwind theme, the four primitives, the `tap` rule, and the CI checks in `token-architecture.md` section 10 (with the proposed changes below) |
| S01.09 — phone-first Hub | Hub shell using `Screen surface="staff"` and the Hub breakpoint (side navigation); two-column pages through `Grid`'s container query |
| S02.02 — resident shell, RTL, 320/390/768 | Resident shell using `Screen surface="resident"`; the logical-CSS lint; RTL mirroring checks |
| S02.14 — basic mode and accessibility | `data-basic`, `--tap-basic`, `Grid` collapse, the touch-target test |
| All screen stories (see `component-inventory-mapping.md`) | Use the primitives; add no spacing values |

## The main finding: `tokens.json` and the prototype's CSS disagreed (decided)

`tokens.json` had seven spacing steps (4, 10, 17, 24, 29, 48, 67 px) taken from slides and documents. The prototype's stylesheet `design/prototype/cvh/cvh.css` mostly uses other values (8, 12, 6, 14, 16, 2, 20 px …), plus a 16 px gutter and 44/56 px touch targets that were not in `tokens.json`. UX-DR1 asks for tokens "matching the prototype exactly", and AD-16 says tokens come only from `tokens.json`. Both could not hold until `tokens.json` was reconciled with the approved prototype. There were also no breakpoints and no container widths in `tokens.json`.

**G1–G10 are decided** (design owner, 2026-10-02; `tokens.json` version 3; the decisions are in [`token-architecture.md`](token-architecture.md) section 11):

- The app has one spacing scale, `app-space-1` to `app-space-10` (2, 4, 6, 8, 10, 12, 14, 16, 20, 24 px), plus six rare steps kept only where a pilot component uses them (1, 3, 7, 18, 22, 28 px). Each rare value, where it is used and why, is in [`rare-spacing-inventory.md`](rare-spacing-inventory.md).
- The seven slide and document steps keep their names (`space-1` to `space-7`) because the design system's `ds/cvrh/components/bundle.css` and the prototype read them. They are not generated for the app.
- `tokens.json` now also holds the touch targets (44, 56 in basic mode), icon sizes, shell minimums, the Hub page widths (1040, with 1080 for review pages and 1140 for partner pages), the side navigation (240) and aside widths (380, 300), the screen type sets and line heights by script.
- The Hub has one viewport breakpoint, 700 px, for the shell only (side navigation shown or hidden). Two-column Hub pages switch by a container query at 800 px of content width. These are two different tokens (`component-boundaries.md` 3.2).
- Resident content is not capped in width; resident pages have no breakpoint.

Every spacing value in `src/` traces to these tokens through a `var()` chain; no code hard-codes a prototype number.

## Pilot set and what is left for the MVP

| Primitive | Pilot | Why |
| --- | --- | --- |
| `Screen` | Yes | Every screen needs one gutter, padding and section gap; the approval view and round page need a sticky actions region without negative margins |
| `Stack` | Yes | Every vertical gap |
| `Inline` (covers Row and Cluster) | Yes | Icon plus label, chips, header rows; wraps by default for long translations |
| `Grid` | Yes | Home tiles, round mark buttons, two-column Hub pages (container query), Hub side nav; basic-mode collapse |
| `tap` rule | Yes (a utility, not a component) | 44 px rule (spine, UX-DR19, S01.09, S02.14) |
| `Box` / `Inset` | MVP | No pilot region needs padding that is not already owned by `Screen`, a shell or a content component |
| `Spacer` | Not planned | Space comes from `gap`; an empty element for spacing hides intent and breaks in RTL reviews |
| `Divider` | Not a layout primitive | A hairline is a content component (prototype `.cvh-rule`) with no margin |
| Container queries other than the two-column Hub page, `cols` 5–12, `justify` around/evenly, `auto-fill` grids | MVP | No pilot screen needs them |

## What was deliberately not brought over from the source

| Source item | Reason |
| --- | --- |
| Tailwind's numeric spacing scale and five default breakpoints (`Spacing.mdx`, `Breakpoints.mdx`, `globals.css`) | They are Dilawri's values; CVH values must come from `tokens.json` (AD-16) |
| Layout-width tokens (page 1440, footer 1280, block 928/1250, carousel, auth card) and `LayoutProvider` | Dilawri page shapes; CVH has none of these regions. CVH widths were decided in G5 (`--size-page-staff` and its review and partner variants, side navigation, aside) |
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

- **O-07** (ambassador post review) is listed in UX-DR16 but no story's Traces names it. Checked against the approval stories, it is already built by S04.07, S04.10, S05.02 and S08.03; it needs an explicit trace, not a new story. See the change proposal.
- **Token generation came too late for the Hub shell (resolved).** S01.09 builds the Hub shell in E01, but tokens were generated in S02.01 in E02; the approved change moved token generation into S01.16. The change proposal moves shared token generation into an early E01 foundation story instead of making S01.09 depend on S02.01, which would reverse the epic order.

## Proposed plan changes

The plan changes are no longer listed here. They are in the change proposal [`docs/planning/pilot/change-proposals/2026-10-01-spacing-framework.md`](../../planning/pilot/change-proposals/2026-10-01-spacing-framework.md), which was approved and applied on 2026-10-01; the token decisions of 2026-10-02 are in `token-architecture.md` section 11. Its development estimate (+6 h) is also proposed, pending review.
