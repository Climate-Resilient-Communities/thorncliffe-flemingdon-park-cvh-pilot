import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { isLaunchCode } from "./i18n/languages";
import { unknownLanguageRedirect } from "./i18n/paths";
import { routing } from "./i18n/routing";

const withLocale = createMiddleware(routing);

/**
 * Resident URLs are /{lang}/… (AD-1). An unknown language code goes to the same path under /en/; a known one
 * passes through next-intl, which here sets no cookie (routing.ts). Staff and API paths are not touched.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const redirect = unknownLanguageRedirect(pathname);
  if (redirect) return NextResponse.redirect(new URL(`${redirect}${search}`, request.url));
  if (isLaunchCode(pathname.split("/")[1])) return withLocale(request);
  return NextResponse.next();
}

export const config = {
  // Not the staff surface, the API, Next's own files or anything with a file extension.
  matcher: ["/((?!(?:staff|api|_next)(?:/|$)|.*\\..*).*)"],
};
