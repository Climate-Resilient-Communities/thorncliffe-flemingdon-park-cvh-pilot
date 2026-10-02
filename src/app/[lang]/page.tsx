import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ResidentText, Screen, Stack } from "@/ui";
import { ChoicesLink, FirstRunGate } from "@/ui/choices";
import { isLaunchCode } from "@/i18n/languages";

/**
 * Home (R-03) as far as S02.02 needs it: one screen inside the shell, in the language of the URL. The feed,
 * building status and the 911 block come with S02.11. A first visit is sent to the first-run steps (S02.03).
 */
export default async function ResidentHome({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  if (!isLaunchCode(lang)) notFound();
  setRequestLocale(lang);
  const t = await getTranslations({ locale: lang, namespace: "R03" });
  const shell = await getTranslations({ locale: lang, namespace: "shell" });

  return (
    <FirstRunGate lang={lang}>
      <Screen surface="resident">
        <Stack gap="related">
          <ResidentText as="h1">{t("nothingActive")}</ResidentText>
          <ResidentText as="p">{t("nothingActiveBody")}</ResidentText>
          <ChoicesLink href={`/${lang}/choices`}>{shell("choices")}</ChoicesLink>
        </Stack>
      </Screen>
    </FirstRunGate>
  );
}
