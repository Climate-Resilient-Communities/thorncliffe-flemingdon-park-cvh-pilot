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
