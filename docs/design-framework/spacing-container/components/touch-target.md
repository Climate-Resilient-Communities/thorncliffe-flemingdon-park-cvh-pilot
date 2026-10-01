# Touch target (`tap` rule)

> **Status: draft, not approved.** This framework is a proposal. It is not yet an implementation requirement. Token values marked **unresolved** have no approved value, and nothing may hard-code them. The plan changes it implies are in the separate change proposal [`docs/planning/pilot/change-proposals/2026-10-01-spacing-framework.md`](../../../planning/pilot/change-proposals/2026-10-01-spacing-framework.md) and are **proposed only**; `epics.md` and the spine are unchanged.

**Status:** Pilot · **Files:** `src/ui/tokens/semantic.css` (tokens), `src/ui/tokens/theme.css` (`@utility tap`), `e2e/touch-targets.spec.ts` (check) · **Built in:** S02.01 (rule), checked in S02.14

## Purpose

Makes every interactive element at least 44 by 44 px, and at least the basic-mode size when basic mode is on. The 44 px minimum is a spine convention ("touch targets ≥ 44 px"), UX-DR19, and an acceptance criterion of S01.09 and S02.14. `Lib_Foundations.dc.html` adds "56 in bigger-text mode" and "8px between targets".

This is a **CSS rule and a test, not a wrapper component.** A `<TouchTarget>` wrapper would add a DOM element around buttons and links, which either breaks their semantics (a clickable `div` around a `button`) or adds an inert layer that still has to be sized. The prototype applies `min-height: var(--tap); min-width: var(--tap)` on each interactive component (`.cvh-btn`, `.cvh-iconbtn`, `.cvh-chip`, `.cvh-switch`, `.cvh-verify`, `.cvh-langbtn`, `.cvh-toolbtn`, `.cvh-mt__report`, map pins). CVH does the same through one utility.

The source framework has no equivalent; it is added because of the 44 px rule.

## Anatomy

```text
:root                     --tap-current: var(--tap)
:root[data-basic="true"]  --tap-current: var(--tap-basic)

@utility tap {            min-block-size: var(--tap-current); min-inline-size: var(--tap-current); }
```

Interactive content components (button, icon button, chip, switch, nav item, language button, link styled as a control, map pin, mark button) include `tap` on their root. Nothing else does.

## Props

None. The rule has no options. Components never pass a size to it.

## Tokens used

| Token | Layer | Value |
| --- | --- | --- |
| `--tap` | 2 | Blocked by G3. Required value 44px (spine, UX-DR19); not yet in `tokens.json` |
| `--tap-basic` | 2 | Blocked by G3. Prototype 56px |
| `--gap-target` | 2 | Blocked by G3. Prototype "8px between targets" |
| `--tap-current` | 3 (of the rule) | `var(--tap)` or `var(--tap-basic)` |

The value 44 is a requirement, not a design choice, so S02.01 may treat it as settled once it is added to `tokens.json`; the generator must still read it from there (AD-16).

## Responsive behaviour

Same minimum at every width and on both surfaces. Hub screens use 44 px on phone and desktop (S01.09 asks for 44 px at 390 px; the prototype's Hub side items are also 44 px high at 1280 px).

## RTL behaviour

Uses only `min-block-size` and `min-inline-size`. No direction dependence.

## Basic mode

`--tap-current` switches to `--tap-basic`. Nothing else in the rule changes. Resident nav items in basic mode are taller than `--tap-basic` in the prototype (80 px); that is a shell token (G8), not this rule.

## Accessibility

- Meets the spine's 44 px convention. For reference: under WCAG 2.1 AA (the spine's level) target size is not a requirement; 44 px is WCAG 2.1 success criterion 2.5.5 (AAA). The CVH rule is stricter than AA by choice.
- The visible focus ring (2px, offset 2px, `--focus-ring`) sits outside the target; the rule does not clip it.
- The rule sets a minimum only. Content may make a target larger; it may never make it smaller (`max-block-size` on an interactive element fails the check).

## Do and don't

| Do | Don't |
| --- | --- |
| Put `tap` on the root of every interactive content component | Wrap a button in a `div` to make it bigger |
| Keep icon-only buttons square at `--tap` | Rely on padding alone to reach 44 px; padding changes with type size |
| Space adjacent targets with `gap="target"` | Place two 44 px targets edge to edge in a wrapping row |
| Make "Report", "Show English" and similar controls full targets (the prototype makes them 44 px high) | Leave a 20 px-high text button inside a sentence |

## Decision needed (proposed: allow the inline-link exception)

- **Links inside running text.** The change proposal recommends allowing an exception for links inside a sentence or block of text (for example in guide body text), marked by `data-tap-exempt="inline-text"` on the text container, while every other interactive element keeps the 44 px minimum (56 px in basic mode). This matches the inline exception in WCAG's target-size criteria (2.5.5 in WCAG 2.1, 2.5.8 in WCAG 2.2). It still has to be checked against the pilot's own accessibility requirements: NFR-N2 targets WCAG 2.1 AA, and UX-DR19 says "44 px touch targets" without listing exceptions. Until the product owner confirms that UX-DR19 means controls rather than inline text, the strict rule applies.

## Acceptance criteria

**Given** each resident screen in the epic and each Hub screen in the pilot, in `en` and `ur`
**When** a Playwright test at 320 px (resident) and 390 px (Hub) collects every element matching `a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=switch], [role=checkbox], [role=radio], [role=tab], [tabindex]:not([tabindex="-1"])` that is visible
**Then** each element's bounding box is at least 44 by 44 px, and the test lists any failure with its selector and size

**Given** basic mode on (`<html data-basic="true">`) on each resident screen
**When** the same test runs at 320 px
**Then** each element is at least `--tap-basic` in both dimensions

**Given** two adjacent interactive elements in the same `Inline` or `Grid`
**When** measured
**Then** the distance between their boxes is at least `--gap-target`, or their boxes do not overlap and each is at least `--tap`

**Given** the CSS of interactive content components in `src/ui/`
**When** the CI checks run
**Then** each root class includes the `tap` utility (or `min-block-size: var(--tap-current)` and `min-inline-size: var(--tap-current)`), and no interactive element sets `max-block-size`, `max-inline-size`, `height` or `width` below `var(--tap-current)`

**Given** `tokens.generated.css`
**When** generated from `tokens.json`
**Then** `--tap` resolves to 44px and the snapshot test passes; if `--tap` is missing from `tokens.json`, the generator fails with a message naming gap G3 rather than writing a default
