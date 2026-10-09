import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LANGUAGE, isLaunchCode } from "./i18n/languages";
import { unknownLanguageRedirect } from "./i18n/paths";
import { routing } from "./i18n/routing";

const withLocale = createMiddleware(routing);

// The share link (AD-17, S05.08): `/a/{slug}`, one segment after `a`, with the sharer's language in `?l=`.
const SHARED_ALERT = /^\/a\/([^/]+)\/?$/;
const SLUG = /^[a-z0-9]{6,16}$/;
const TRADITIONAL_CHINESE = /^zh-hant(?:-[a-z0-9]{2,8})*$/i;

/**
 * The share link `/a/{slug}?l={lang}` is answered by the alert page of that language, `/{lang}/a/{slug}`, behind the same address (a rewrite, not a redirect:
 * the address the recipient sees is the one that was shared, and nothing is set or sent). A missing `l`, or one that is not one of our languages, is English;
 * Traditional Chinese is a conversion of `zh` (D-5). No cookie, and nothing else is read from the request.
 */
function sharedAlertRewrite(request: NextRequest, slug: string) {
  const asked = request.nextUrl.searchParams.get("l");
  const lang = asked !== null && isLaunchCode(asked) ? asked : asked !== null && TRADITIONAL_CHINESE.test(asked) ? "zh" : DEFAULT_LANGUAGE;
  // An encoded dot segment (`%2e%2e`) would be a real one in a URL: only a slug of the alert pattern is passed on, anything else is an alert that does not exist.
  return NextResponse.rewrite(new URL(`/${lang}/a/${SLUG.test(slug) ? slug : "invalid"}`, request.url));
}

/**
 * Resident URLs are /{lang}/… (AD-1). An unknown language code goes to the same path under /en/; a known one
 * passes through next-intl, which here sets no cookie (routing.ts). Staff and API paths are not touched. The share link `/a/{slug}` is
 * answered by the alert page of its `l` language (above). The bare `/` is its own page (src/app/(site)/page.tsx). Any other path
 * with no language in it (`/nope`) is answered by the English resident page of that path behind the same address (a rewrite, so
 * a page that does not exist is the resident 404 in the shell, with status 404, not the framework's bare one; production UAT,
 * 2026-10-08); the phone then shows it in the resident's own language (SavedLanguageNotFound).
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const shared = SHARED_ALERT.exec(pathname);
  if (shared) return sharedAlertRewrite(request, shared[1]);
  const redirect = unknownLanguageRedirect(pathname);
  if (redirect) return NextResponse.redirect(new URL(`${redirect}${search}`, request.url));
  if (isLaunchCode(pathname.split("/")[1])) return withLocale(request);
  if (pathname === "/") return NextResponse.next();
  return NextResponse.rewrite(new URL(`/${DEFAULT_LANGUAGE}${pathname}${search}`, request.url));
}

export const config = {
  // Not the staff surface, the API, Next's own files or anything with a file extension.
  matcher: ["/((?!(?:staff|api|_next)(?:/|$)|.*\\..*).*)"],
};
