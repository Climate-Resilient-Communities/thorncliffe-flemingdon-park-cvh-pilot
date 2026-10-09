import { LAUNCH_LANGUAGES } from "@/i18n/languages";
import { RootEntry } from "@/ui/choices";

/**
 * The bare address `/` (production UAT, 2026-10-08: it showed only the name). Resident pages are `/{lang}/…` (AD-1) and the
 * language is chosen on the phone, never read from a cookie or a header (AD-3), so this page is the same for everyone and may be
 * cached anywhere: once loaded, the phone sends the resident on to the language they chose, or to English, whose home sends a
 * first visit to the language choice (R-01). Without scripts, the languages are links.
 */
export default function Home() {
  return (
    <main data-testid="root-entry">
      <h1>Community Virtual Hub</h1>
      <RootEntry />
      <noscript>
        <ul data-testid="root-languages">
          {LAUNCH_LANGUAGES.map(({ code, bcp47, dir, native }) => (
            <li key={code}>
              <a href={`/${code}`} lang={bcp47} dir={dir}>
                {native}
              </a>
            </li>
          ))}
        </ul>
      </noscript>
    </main>
  );
}
