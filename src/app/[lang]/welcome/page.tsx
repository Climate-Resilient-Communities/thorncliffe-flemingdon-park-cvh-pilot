import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { isLaunchCode } from "@/i18n/languages";
import { LanguageStep } from "@/ui/choices";
import { ChoicesFrame, STEP_LANGUAGES, choicesMetadata } from "../choices-frame";

export async function generateMetadata({ params }: PageProps<"/[lang]/welcome">): Promise<Metadata> {
  return choicesMetadata((await params).lang, "R01", "title");
}

/** First run, step 1: R-01, choose the language. The steps after it (groups, where I live) can be skipped. */
export default async function WelcomeLanguage({ params }: PageProps<"/[lang]/welcome">) {
  const { lang } = await params;
  if (!isLaunchCode(lang)) notFound();
  setRequestLocale(lang);
  return (
    <ChoicesFrame lang={lang}>
      <LanguageStep lang={lang} mode="first-run" languages={STEP_LANGUAGES} />
    </ChoicesFrame>
  );
}
