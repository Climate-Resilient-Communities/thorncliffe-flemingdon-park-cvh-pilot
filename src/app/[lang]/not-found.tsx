import { getLocale, getTranslations } from "next-intl/server";
import { ResidentText, Screen, Stack } from "@/ui";
import { isLaunchCode } from "@/i18n/languages";
import { SavedLanguageNotFound } from "@/ui/choices";

/**
 * A page that does not exist, drawn inside the resident shell (the [lang] layout) so the language, direction,
 * header and navigation stay. The status is 404. A string a language lacks shows in English behind "[EN]". An address with no
 * language in it (`/nope`) is answered by the English one (src/proxy.ts); the phone then shows it in the resident's own language.
 */
export default async function ResidentNotFound() {
  const locale = await getLocale();
  const lang = isLaunchCode(locale) ? locale : "en";
  const shell = await getTranslations({ locale: lang, namespace: "shell" });

  return (
    <Screen surface="resident">
      <Stack gap="related">
        <ResidentText as="h1">{shell("pageNotFound")}</ResidentText>
        <ResidentText as="p">{shell("pageNotFoundBody")}</ResidentText>
      </Stack>
      <SavedLanguageNotFound />
    </Screen>
  );
}
