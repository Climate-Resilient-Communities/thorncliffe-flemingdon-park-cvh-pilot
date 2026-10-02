import { defineRouting } from "next-intl/routing";
import { DEFAULT_LANGUAGE, LAUNCH_CODES } from "./languages";

// AD-3: resident routes set no cookies. The language is the URL segment, never a cookie or a header sniffed
// from the visitor, so the cookie, the detection and the alternate-language Link header are all off.
export const routing = defineRouting({
  locales: LAUNCH_CODES,
  defaultLocale: DEFAULT_LANGUAGE,
  localePrefix: "always",
  localeCookie: false,
  localeDetection: false,
  alternateLinks: false,
});
