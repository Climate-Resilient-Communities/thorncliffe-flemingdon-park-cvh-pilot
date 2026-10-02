import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { isLaunchCode } from "@/i18n/languages";
import { PlaceStep } from "@/ui/choices";
import { ChoicesFrame, choicesMetadata } from "../../choices-frame";

export async function generateMetadata({ params }: PageProps<"/[lang]/welcome/place">): Promise<Metadata> {
  return choicesMetadata((await params).lang, "R35", "title");
}

/** First run, step 3: R-35, where I live. Skippable; then home. */
export default async function WelcomePlace({ params }: PageProps<"/[lang]/welcome/place">) {
  const { lang } = await params;
  if (!isLaunchCode(lang)) notFound();
  setRequestLocale(lang);
  return (
    <ChoicesFrame lang={lang}>
      <PlaceStep lang={lang} mode="first-run" />
    </ChoicesFrame>
  );
}
