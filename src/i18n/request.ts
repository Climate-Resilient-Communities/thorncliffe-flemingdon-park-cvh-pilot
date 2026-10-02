import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

// The generated catalog of the request's language (S02.01); a key a language lacks is already English
// behind the visible "[EN]" marker in the file.
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return { locale, messages: (await import(`./messages/${locale}.json`)).default };
});
