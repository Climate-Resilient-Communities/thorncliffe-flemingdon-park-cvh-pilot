import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { isLaunchCode } from "@/i18n/languages";
import { LanguageStep } from "@/ui/choices";
import { ChoicesFrame, STEP_LANGUAGES, choicesMetadata } from "../../choices-frame";

export async function generateMetadata({ params }: PageProps<"/[lang]/choices/language">): Promise<Metadata> {
  return choicesMetadata((await params).lang, "R01", "title");
}

/** Changing the language from R-34. */
export default async function ChangeLanguage({ params }: PageProps<"/[lang]/choices/language">) {
  const { lang } = await params;
  if (!isLaunchCode(lang)) notFound();
  setRequestLocale(lang);
  return (
    <ChoicesFrame lang={lang}>
      <LanguageStep lang={lang} mode="later" languages={STEP_LANGUAGES} />
    </ChoicesFrame>
  );
}
