// The "See the essential numbers" link of the screens that say the directory could not load (S02.06).
//
// The essential numbers page is S02.10's (/{lang}/ready/numbers); had the route not existed, a link to
// it would open a 404 in the one place a resident who cannot reach the directory has to turn. The link is shown only when
// this says the page exists. src/ui/directory/numbers-route.test.ts compares it with the route's files on disk and fails
// when they disagree, so the story that adds the page cannot forget to turn the link on.
export const NUMBERS_PAGE_EXISTS = true;

/** The page the link opens. */
export const numbersHref = (lang: string): string => `/${lang}/ready/numbers`;
