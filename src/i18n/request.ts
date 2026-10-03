import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";
import { markUntranslated, untranslatedKeys } from "./untranslated";

// The generated catalog of the request's language (S02.01); a key a language lacks is already English
// behind the visible "[EN]" marker in the file. In the resident page tests only (untranslated.ts), a few named keys
// are shown that way too, so the English fallback is tested on a real page whatever has been translated.
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  const messages = (await import(`./messages/${locale}.json`)).default;
  const keys = locale === routing.defaultLocale ? [] : untranslatedKeys();
  if (keys.length === 0) return { locale, messages };
  const english = (await import("./messages/en.json")).default;
  return { locale, messages: markUntranslated(messages, english, keys) };
});
