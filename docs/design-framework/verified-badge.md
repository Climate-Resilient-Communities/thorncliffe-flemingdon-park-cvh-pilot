# Verified badge

Approved by the product owner on 2026-10-08 (the "confirmed" design after the phone review of #166).

`Verified` (`src/ui/verified/verified.tsx`, styles in `verified.css`, exported from `@/ui`) is a small scalloped rosette beside the words that say whether something was confirmed. It is our own inline SVG: a 12-lobed wavy circle, `r(θ) = 10.3 + 0.8·cos(12θ)` in a 24 × 24 box. No outside image is used or copied.

| State | Drawing | Words (examples) |
| --- | --- | --- |
| Confirmed | Filled in the brand blue (`--tpch-blue`), white tick (`--on-deep`) | "Confirmed Oct 2, 2026", "Floors confirmed Oct 2, 2026", "Checked by the Hub · October 2, 2026" |
| Not confirmed | Grey outline (`--text-muted`), no tick; the words are muted too | "Not confirmed", "Floors not confirmed" |

## When to use it

- For a date on which the Hub confirmed something: a provider (Hub Providers rows, the resident directory card and provider page) and a building's floors (Hub Buildings list and building page).
- Not for alerts. An alert's "verified" (`src/ui/alert/verified-explainer.tsx`) means something else and keeps its own wording.
- Residents only ever see confirmed providers, so the resident line always shows the confirmed badge.

## Rules

- **Never icon only.** The component needs its words (`children`), and the badge is `aria-hidden` and not focusable. A screen reader reads the words and nothing else. Colour and shape only add to the words.
- Sizes: 16 px beside small or caption text (Hub rows), 20 px beside resident caption or body text. They are the SVG's own `width` and `height`, so the drawing stays crisp.
- The badge sits at the start of the first line of its words (`block-size: 1lh`, centred), so it stays on the first line when the words wrap and mirrors with the page in Urdu, Pashto and Dari. The tick is not mirrored, like a check box.
- Forced colours (Windows high contrast): the rosette uses `CanvasText` and the tick `Canvas`.
- An English fallback line (the `[EN]` marker) puts `lang="en" dir="ltr"` on the whole line, badge included.

## The Providers screen that uses it

Compact rows: the name and a status pill ("Published", "Hidden", or "Not in catalogue") with a "⋯" actions menu (Publish or Unpublish). Under them, the code, categories and street in small muted text. Then the badge line with "Change" (or "Confirm"), which opens the date field and Save date. "Today or earlier." appears only with a refusal. Above the list are the filter tabs "All · To confirm · Hidden", each with its count, and a search by name or code.

The date field and the menu are `<details>`, the app's disclosure pattern, and the tabs and search are a query of the page (`?filter=&q=`), so all of them work without scripts. With scripts, Escape closes the menu and returns focus to "⋯". A press outside the menu, or focus moving out of it, also closes it.
