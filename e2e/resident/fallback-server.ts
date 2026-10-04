// The second server of the resident page tests (playwright.resident.config.ts): the same production build, started with
// CVH_FAKE_UNTRANSLATED_KEYS (src/i18n/untranslated.ts) so that every language but English shows these keys as English
// behind the "[EN] " marker, as a key a catalog lacks does. fallback.spec.ts measures the English fallback there, on the
// essential-numbers page (rendered on request, so the seam reaches it), whatever the catalogs have translated.
// Plain constants only: the Playwright config imports this file.

/** The numbers page's heading, its lead (which ends in a full stop) and its dated "checked" line. */
export const FALLBACK_KEYS = ["R31.title", "R31.lead", "R31.checked"] as const;

/** One port above the main server's (E2E_PORT, 3000 in CI). */
export const FALLBACK_PORT = String(Number(process.env.E2E_PORT ?? "3000") + 1);
export const FALLBACK_URL = `http://localhost:${FALLBACK_PORT}`;
