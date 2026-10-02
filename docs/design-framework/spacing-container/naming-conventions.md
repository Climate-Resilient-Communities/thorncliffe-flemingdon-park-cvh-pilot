# Naming conventions

> **Status: approved framework (2026-10-01); token values decided by the design owner on 2026-10-02 (G1–G10, `token-architecture.md` section 11).** The rules, primitives and token values here are implementation requirements for S01.16 and the stories that use them. Values come from `design/prototype/ds/cvrh/tokens.json`; rare values and where they are used are in [`rare-spacing-inventory.md`](rare-spacing-inventory.md). The plan changes were applied from the change proposal [`docs/planning/pilot/change-proposals/2026-10-01-spacing-framework.md`](../../planning/pilot/change-proposals/2026-10-01-spacing-framework.md) to `epics.md` and AD-16.

Naming rules for spacing tokens, layout primitives, their props and files. Adapted from the source framework's `_bmad/wds/data/design-system/naming-conventions.md` and `dilawriweb/packages/ui/THEMING.md`, and reconciled with the CVH spine's "Naming" convention (modules lowercase nouns, `src/ui/` holds tokens and components, generated catalogs and tokens are never edited by hand).

Every place where CVH differs from the source is marked **Differs** with the reason.

## 1. Tokens

### 1.1 Primitive tokens (layer 1)

| Rule | Example |
| --- | --- |
| The CSS custom property is the `tokens.json` name with `--` in front, unchanged | `app-space-5` → `--app-space-5`; `app-tap` → `--app-tap`; `radius-card` → `--radius-card`; `surface-raised` → `--surface-raised` |
| The app spacing scale (`spacing.app` in `tokens.json`) is `app-space-{n}`, numbered by step from 2 px | `--app-space-1` = 2 px, `--app-space-4` = 8 px, `--app-space-8` = 16 px, `--app-space-10` = 24 px |
| A rare step is `app-space-{value}px`, named by its value, and flagged `rare` with its `locations` in `tokens.json` | `--app-space-1px`, `--app-space-3px`, `--app-space-7px`, `--app-space-18px`, `--app-space-22px`, `--app-space-28px` (where each is used: `rare-spacing-inventory.md`) |
| Other app primitives start with `app-` and name what they size | `--app-tap`, `--app-tap-basic`; `--app-icon`, `--app-icon-basic`, `--app-icon-staff`; `--app-min-header-resident`, `--app-min-topbar-hub`, `--app-min-nav-item-resident`, `--app-min-nav-item-resident-basic`; `--app-page-staff`, `--app-page-staff-review`, `--app-page-staff-partner`; `--app-side-nav`; `--app-aside-staff`, `--app-aside-staff-compact` |
| Build-time values are named the same way but are not generated as custom properties; the generator writes them into Tailwind's `@theme` as literals (section 1.4) | `app-breakpoint-hub` (700 px), `app-container-hub-two-column-min` (800 px) |
| The slides and documents set keeps its names and is not generated for the app | `space-1` … `space-7` (4, 10, 17, 24, 29, 48, 67 px): the design system's `ds/cvrh/components/bundle.css` and the prototype read `--space-1` … `--space-7` with these values, so they are not renamed. The app still has exactly one spacing scale |
| No brand prefix is added | `--tpch-orange` stays as is because that is its name in `tokens.json` |
| Theme variants keep the same name; the theme is a selector, not part of the name | `--surface` under `:root` and under `[data-theme="dark"]` |

**Differs from source.**
- Source names spacing `--spacing-{n}` (`--spacing-4`) and its primitives carry a brand prefix (`--dilawri-*`) so that layer 1 is visible in the name. CVH keeps the `tokens.json` names (`--app-space-{n}`, no brand prefix) because AD-16 says tokens are generated from `tokens.json`, and S01.16 requires a snapshot test against that file. Renaming would break the one-to-one check. The `app-` part comes from `tokens.json` and separates the app's values from the slides and documents set; it does not mark the layer. Layer 1 is told apart by file (`tokens.generated.css`), and the CI check "no primitives outside layer 2" enforces the boundary instead of a prefix.
- Source numbers its scale by multiplier (`spacing-4` = 16 px, 4 × 4 px). CVH numbers the app scale by step from 2 px (`app-space-4` = 8 px, the fourth step; `app-space-8` = 16 px), and names rare steps by value (`app-space-18px`) so that a value kept for one component does not renumber the scale. Developers used to Tailwind will expect `4` to mean 16 px. For this reason primitives are not exposed as Tailwind utilities at all (see `token-architecture.md` section 9).

### 1.2 Semantic tokens (layer 2)

Format: `--{role}-{scope}`, kebab-case, general to specific.

| Role word | Meaning | Examples |
| --- | --- | --- |
| `gap` | Space between siblings, set on the parent | `--gap-icon`, `--gap-grid`, `--gap-section-resident`, `--gap-section-hub` |
| `inset` | Padding inside a region | `--inset-card`, `--inset-page-staff`, `--inset-button-large-inline` |
| `gutter` | Inline inset of a whole surface, shared by its regions | `--gutter-resident` |
| `offset` | A small optical shift that aligns one part with another, set inside a content component | `--offset-align-hairline` (1 px), `--offset-align-icon` (3 px) |
| `size` | An inline or block size, or a size limit; minimums carry `-min` after the part they size | `--size-page-staff`, `--size-side-nav`, `--size-aside-staff`; icons `--size-icon`, `--size-icon-basic`, `--size-icon-staff`; shell minimums `--size-header-resident-min`, `--size-topbar-hub-min`, `--size-nav-item-resident-min` |
| `tap` | Minimum touch target | `--tap`, `--tap-basic` |

There are no `rule` or `bar` tokens in the app: rule and bar thickness and length are slide and document decorations, no pilot screen uses them, and the prototype's `.cvh-rule` is a 1 px border, not spacing.

Rules:

- Name by job, not by value or look: `--gap-icon`, never `--gap-10` or `--gap-small`.
- Never use a direction in a name: `--inset-inline-start-x` is fine if ever needed, `--padding-left` is not. Names describe logical axes only (`inline`, `block`, `start`, `end`).
- A semantic token's value is always one `var()` of a primitive.

**Differs from source.** The source WDS default scale uses T-shirt names (`space-3xs` … `space-3xl`, around `space-md`) and its Storybook docs use numeric names (`4`, `6`); the source README records that the two vocabularies were never mapped ("Two parallel spacing vocabularies … with no mapping between them"). CVH has one vocabulary: numbered primitives from `tokens.json`, named-by-job semantic tokens on top. T-shirt names are not used because the app steps are uneven (2, 4, 6, 8, 10, 12, 14, 16, 20, 24 px, with rare steps such as 18 and 22 px between them) and a T-shirt label would suggest a regular progression that is not there.

### 1.3 Component tokens (layer 3)

Format: `--{component}-{property}[-{variant}]`, where `{component}` is the component's file name.

| Example | Meaning |
| --- | --- |
| `--screen-inset-inline` | Inline inset of the `Screen` primitive |
| `--screen-gap` | Gap between `Screen` sections |
| `--not-911-block-inset` | Padding inside the 911 block |
| `--resident-nav-item-min-block-size` | Minimum block size of a resident nav item |

This follows the source format (`--{component}-{property}-{variant}`, e.g. `--button-padding-primary`) with the logical property word (`inset-inline`, `min-block-size`) in place of physical ones (`padding-x`, `height`).

### 1.4 Tailwind theme names

| Tailwind namespace | CVH entries | Resulting utilities |
| --- | --- | --- |
| `--spacing-*` | Semantic names only, without the role word, for example `label`, `icon`, `grid`, `stack`, `section-resident`, `section-hub`, `panel`, `paragraph`, `card`, `page-staff` (full list in `token-architecture.md` section 9) | `gap-icon`, `p-card`, `gap-section-hub` |
| `--radius-*` | `card`, `disc` (and `header` if used) | `rounded-card`, `rounded-disc` |
| `--color-*` | One per colour token | `bg-surface-raised`, `text-ink` |
| `--breakpoint-*` | `--breakpoint-hub: 700px`, from `app-breakpoint-hub` | Variant `hub:` (`@media (width >= 700px)`). **Hub shell only**: side navigation shown at or above it, hidden below it, and the page inset that switches with it |
| `--container-*` | `--container-hub-two-column: 800px`, from `app-container-hub-two-column-min` | Variant `@hub-two-column:` (`@container (width >= 800px)`), measured on the `hub-page` query container (the `Screen` staff content box). **Two-column Hub pages only** (`Grid twoColumn`) |

The generator writes both values into `@theme` as literals, because CSS cannot read a custom property inside `@media` or `@container`. They are two different tokens and are never used for each other's job: page columns never use `hub:`, and the shell never uses `@hub-two-column:`. No other file in `src/` may contain 700 or 800 as a layout literal.

**Differs from source.** The source keeps Tailwind's numeric scale (`py-8`, `gap-6`, `px-3 md:px-6 lg:px-8` in `BlockLayout.tsx`) and its 5 default breakpoints. CVH removes both, because numeric utilities would let any Tailwind number into the app and bypass `tokens.json` (AD-16).

## 2. Layout primitives

| Rule | CVH | Source |
| --- | --- | --- |
| Component name | PascalCase noun for what it arranges: `Screen`, `Stack`, `Inline`, `Grid` | PascalCase: `Row`, `Stack`, `Grid`, `Spacer`, `Divider`, `BlockLayout` |
| File name | kebab-case, one primitive per file: `src/ui/layout/stack.tsx`, `stack.css`, `stack.test.tsx` | PascalCase, several primitives per file: `LayoutPrimitives.tsx` |
| Folder | `src/ui/layout/` | `packages/ui/src/components/layout/` |
| Import surface | `src/ui/index.ts` re-exports the primitives; app code imports from `@/ui`, never from a file path inside `src/ui/layout/` | Package export |

**Differs from source.**
- `Inline` instead of `Row`: the CVH name uses the CSS logical axis word, so the name itself says the primitive follows writing direction. "Row" also means a table row and a list row in the Hub screens (moderation, round lists).
- `Screen` instead of `BlockLayout` / `Page`: "screen" is the unit the prototype and inventory use (`.cvh-screen`, `inventory.js` → `screens`), and `Page` would collide with Next.js `page.tsx` default exports under `src/app/`.
- kebab-case files: the spine names modules as lowercase nouns and its folders are lowercase (`src/ui/`, `src/i18n/`). kebab-case files keep `src/ui/` consistent with that and avoid case-only rename problems on macOS developer machines. Exported component names stay PascalCase as React requires.
- One primitive per file, so each has its own test and spec, and the dependency-cruiser rules (AD-2) can see which primitive a screen uses.

## 3. Props

| Rule | Example |
| --- | --- |
| Props that take spacing accept only token names from a TypeScript union, never numbers or strings with units | `gap: 'label' \| 'icon' \| 'stack' \| 'section-resident' \| 'panel'` |
| Token names in props drop the role word (the prop says the role) | `<Stack gap="icon">` uses `--gap-icon`; `<Screen inset="page-staff">` uses `--inset-page-staff` |
| Alignment props use logical values | `align: 'start' \| 'center' \| 'end' \| 'stretch' \| 'baseline'`; `justify: 'start' \| 'center' \| 'end' \| 'between'` |
| Boolean props are adjectives or `is`-free verbs | `wrap`, `collapseInBasic` |
| No `className` or `style` pass-through for spacing | Primitives accept `className` only for non-spacing hooks (e.g. a test id is a prop `testId`); a lint rule rejects spacing utilities in `className` on a primitive |
| Element choice | `as` prop limited to semantic elements: `'div' \| 'section' \| 'ul' \| 'ol' \| 'nav' \| 'header' \| 'footer' \| 'main'` |

**Differs from source.**
- Source `gap?: number | string` builds a class at run time (`` `gap-${gap}` ``). That accepts any value and, with Tailwind's static class scanning, a run-time class name is not guaranteed to be generated. CVH uses a fixed map from token name to a static class.
- Source `justify` also offers `around` and `evenly`. No pilot screen uses them; they are left out (lean).
- Source primitives spread `...props` and accept `className`, so any spacing can be added at the call site. CVH closes that route; the spacing check would otherwise be bypassed.

## 4. CSS class names inside `src/ui/`

Primitives and components that need their own CSS use plain classes named after the file, with `data-*` attributes for variants:

```css
.stack { display: flex; flex-direction: column; }
.stack[data-gap="icon"] { gap: var(--gap-icon); }
.grid[data-collapse-in-basic="true"] { … }
:root[data-basic="true"] .grid[data-collapse-in-basic="true"] { grid-template-columns: minmax(0, 1fr); }
```

**Differs from prototype.** The prototype uses BEM with a `cvh-` prefix (`.cvh-rhead__top`, `.cvh-btn--primary`) and a root class for basic mode (`.cvh-basic`). Prototype class names are not carried into `src/`: they are a reference for behaviour only. Basic mode becomes `data-basic` on `<html>` so that it is set before paint from device choices.

## 5. Identifiers for prototype parts

| Kind | Convention | Example |
| --- | --- | --- |
| Screens and shared parts | Keep the prototype id in docs, specs, tests and story text | `R-03`, `O-05`, `A-04`, `X-01`, `C_ResidentHeader` |
| Test ids | `data-testid="{screen-id}-{region}"`, lowercase | `data-testid="o-05-actions"` |
| Accessible names | Always from the generated catalog (AD-16), never from an id | `aria-label={t('shell.navLabel')}` |

**Differs from source.**
- The source WDS assigns component ids (`btn-001`, `dsc-a-button`). CVH does not create a second id scheme; the prototype ids already link inventory, epics (UX-DR list) and specs.
- The source "Area Labels" (`{page}-{section}-{element}`) become both `id` and `aria-label`. CVH does not reuse them as `aria-label`, because accessible names must be translated strings in 15 languages. They become `data-testid` only.

## 6. Files and folders in this framework and in code

| What | Location and name |
| --- | --- |
| This framework's docs | `docs/design-framework/spacing-container/*.md`, kebab-case, no number prefix |
| Primitive specs | `docs/design-framework/spacing-container/components/{primitive}.md` (`stack.md`) |
| Generated tokens | `src/ui/tokens/tokens.generated.css` (the `.generated.` part marks a file CI regenerates and compares, the same rule S01.16 and S02.01 set for generated files such as `src/i18n/` catalogs) |
| Semantic layer | `src/ui/tokens/semantic.css` |
| Tailwind theme | `src/ui/tokens/theme.css` |
| Layout primitives | `src/ui/layout/{primitive}.tsx`, `.css`, `.test.tsx` |
| Shells | `src/ui/shell/resident-shell.tsx`, `src/ui/shell/hub-shell.tsx` |
| Content components | `src/ui/{area}/{component}.tsx`, for example `src/ui/alerting/not-911-block.tsx`; `{area}` is a lowercase noun, matching module naming |
| Generator | `scripts/gen-tokens.ts` (the spine puts token generators in `scripts/`) |

**Differs from source.** The source WDS numbers design-system documents (`01-design-tokens.md`, `02-button.md`). CVH does not: the set is small and fixed, and numbers would need renaming whenever a primitive is added or moved to MVP.
