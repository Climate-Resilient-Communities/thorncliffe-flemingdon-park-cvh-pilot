# UI/UX review — first visual direction approved

Luis approved the resident desktop/mobile screenshots in this chat on 2026-10-07.
Branch: `design/ui-ux-review`.

Approved direction: bounded desktop content, desktop navigation and filter column, left/start-aligned content and controls, English then French in language selection, staff sign-in at bottom left, display settings in the footer, and expandable directory details with a prominent phone action. RTL reading direction is preserved.

This approval covers the visual direction, not deployment. The October 7 implementation now incorporates shell dimensions into the design tokens and separates staff styles from the resident bundle. The PauseBanner/pauseBanner filename collision is resolved by naming the model pauseBannerModel.ts. Existing CI screenshot baselines have not been replaced.

## Second implementation pass

- Search uses two equal topic columns with restrained separators, one column in basic mode, and a left/start-aligned search action.
- Search and home content use a readable desktop column within the shared shell.
- Shared language ordering preserves the supplied order of all languages after English and French.
- Display settings have a bounded, scrollable expansion; mobile navigation uses smaller inline insets so short labels do not wrap unnecessarily.
- Desktop filters can scroll independently when taller than the available space.
- Empty provider status regions remain in the accessibility tree before action results arrive.

Validation: 45 focused unit tests; ESLint; dependency boundaries; spacing, layout, layers and logical CSS checks. Browser checks covered English/French switching, Urdu RTL, and basic mode at 320 px with no document horizontal overflow. Local search screenshots are presentation checks, not evidence of a successful search backend response. New footer labels use French or explicitly marked English fallback; other translations remain outstanding. Authenticated staff interactions and updated CI screenshot baselines remain outstanding.

## Completed implementation pass — October 7

- Shared resident desktop layout at 1000px: 1120px shell, 760px reading column, 260px persistent directory filters. Phone filters remain collapsible and functional.
- Consistent logical-start text and control alignment, preserving RTL. Calmer controls across resident and staff views.
- English then French across language selectors, signup/edit forms, staff approval, published summaries, sending progress and campaign display. Domain send order is unchanged.
- Staff sign-in remains in the resident footer; display settings retain basic mode without occupying the main header.
- Staff provider records use separated rows with grouped confirmation/publish actions.

Validation: production build, typecheck, ESLint (warnings only), token generation, spacing/layout/layer/logical checks and dependency boundaries passed. Full unit run: 7,586 passed, one skipped, four failures. All four failures reproduce against the original ed3fc2e4 source: migration-order path handling, dependency diagram expectation, font generator stale-file detection and Hub-number generator stale-file detection.

Visual evidence: 42 representative staff compositions captured at 390 and 1440px; all 187 exported staff fixture states checked for document overflow at 320px. Resident route-family captures include guides, alerts, sharing, building details, directory/listing, search, map fallback, signup, expired subscription, onboarding, preferences, terms and offline. Populated directory uses existing sample catalogue data in a local proxy, not production writes. Desktop directory boundaries at 999/1000px, phone filtering, first-visit skip flow, Urdu RTL, French and 320px basic mode checked in the browser.

Limits: staff screenshots are static view fixtures, not authenticated action tests. Live map tiles, successful backend search, active subscription editing, all permission combinations and CI visual baselines still require integration validation. Missing footer translations continue to use the existing English fallback. No merge or deployment performed.

## Staff entry correction after user review

The earlier sign-in pass was incomplete: it changed alignment but omitted identity, first-time guidance and visible recovery help. Staff entry now uses the Hub logo, a return to the resident app, a bounded two-column desktop composition, and form-first stacking on mobile. New staff are told how to obtain their account, the 24-hour starting-password limit, and which roles need an authenticator. “Forgot your password?” expands the Admin-managed recovery instructions; it does not pretend to send reset emails. The same branding appears in password and authenticator setup/code screens. The sign-in route and visual fixture share StaffSignInView, so the reviewed composition is the actual page component.

Checked at 1440, 390 and 320px, with the recovery disclosure open and closed. Added a render test for branding, credential autocomplete, onboarding and honest recovery wording. Typecheck, production build, ESLint (existing warnings), spacing/layout/logical checks passed. Authentication handlers and permissions are unchanged.

## Corrections after the owner's phone review — October 8

- Resident bottom navigation: four equal columns; each icon is centred above its centred label, the icons share one line and the labels the next (subgrid), and a long translation or large text wraps to balanced centred lines without changing the column width. The active colour and top border span the item. Basic mode keeps 80 px items and the larger icon. The footer under it keeps clear of the home indicator when the page is drawn edge to edge.
- Staff sign-in, authenticator code and both setup gates share one frame: the Hub logo alone in the header (it is the link back to the resident app), the title and form below it, and a quiet footer with "Terms and privacy" and "Back to the resident app" at the bottom of the viewport.
- Providers: the date field and Save date are one group of equal height with the hint below; Publish/Unpublish has its own line on a phone and joins the date's line from the Hub breakpoint.
- Hub top bar on a phone: the name and role are cut with an ellipsis when too long (the full sentence is still read aloud), sign-out keeps its one-line label, and the symbol has a fixed size, so nothing in the bar overlaps.

## Verified badge and compact Providers — October 8

- A shared verified badge (`Verified`, `src/ui/verified`): a scalloped rosette, brand blue with a white tick when confirmed and a grey outline when not, always beside its words, never icon only ([verified-badge.md](verified-badge.md)).
- Hub Providers: compact two-line rows (name with a Published / Hidden pill and a "⋯" actions menu; badge with "Confirmed Oct 2, 2026" or "Not confirmed" and Change / Confirm opening the date field), filter tabs with counts, and a search by name or code. Server actions and their validation are unchanged.
- Hub Buildings: the badge with "Floors confirmed Oct 2, 2026" or "Floors not confirmed", in the list and on a building's page.
- Resident directory card and provider page: the badge with "Checked by the Hub · {date}" (`directory.checkedByHub`, machine-translated into the 14 other languages; it replaces `directory.lastConfirmed`).

## Desktop layout — October 8

The product owner asked for two views ("on desktop it still looks like it's meant for phone; there should be 2 views"). From the resident-wide breakpoint (1000 px; tuned at 1024, 1280 and 1440) the resident app has its own layout, in one stylesheet (`src/ui/desktop.css`) over the same pages. The phone layout is unchanged.

- Shell: the logo, the four destinations and the language and Aa buttons share the header row. The navigation is drawn twice and CSS shows one: the header copy (desktop) comes before the page in the source, so the keyboard and screen readers reach it first; the bottom bar (phone) is unchanged. The page is centred within 1200 px and scrolls as a whole; the footer is a full-width band after it.
- Home: the places and the alerts in the main column (buildings and the neighbourhood as cards two to a row, the current alerts, the alerts that have ended); Every day, the 911 note and "What I have told the CVH" in a side column. Every day adds "Get text alerts" on a desktop only.
- Find help: the question box with its button beside it, results as cards two to a row; the topics, the full list link and the 911 note in the side column. Directory: the filters as an open start column that stays on screen; the cards two to a row (one with large text).
- Provider: the details as a card, and a side panel with a small still map of the whole area marking the place (the same view the map opens on, so the tiles say nothing about which provider is open; none in simpler view), the address, Call, Directions (Google Maps in a new tab, opened only by the resident) and See on the map.
- Map: the map fills the window's height beside the list of the places on screen, which follows the map; the Map / List switch is for phones. Simpler view is the list alone, as before.
- Be ready: the guides and the other destinations as grids of cards. A guide: "Jump to" as a start column that stays on screen beside its parts; the 911 block stays above. Terms: the contents as a start column that stays on screen. Building: the facts in two columns and the contact as a card beside them. Alerts, the archive, choices and sign-up keep a readable column at the start.
- Order: a side column is later in the source than the main one, and a start column (filters, "Jump to", contents) earlier, so the reading order is the order on screen. Logical properties only, so Urdu, Pashto and Dari mirror.

Tests: `e2e/resident/desktop.spec.ts` (columns side by side, the navigation in the header row and first in the tab order, no horizontal scrolling at 1024, 1280 and 1440 and at 200% zoom, in English and Urdu, with standard and large text and in simpler view).
