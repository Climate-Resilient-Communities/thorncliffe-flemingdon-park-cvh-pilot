import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { isLaunchCode } from "@/i18n/languages";
import { GroupsStep } from "@/ui/choices";
import { ChoicesFrame, choicesMetadata } from "../../choices-frame";

export async function generateMetadata({ params }: PageProps<"/[lang]/welcome/groups">): Promise<Metadata> {
  return choicesMetadata((await params).lang, "R26", "title");
}

/** First run, step 2: R-26, which groups I belong to. Skippable. */
export default async function WelcomeGroups({ params }: PageProps<"/[lang]/welcome/groups">) {
  const { lang } = await params;
  if (!isLaunchCode(lang)) notFound();
  setRequestLocale(lang);
  return (
    <ChoicesFrame lang={lang}>
      <GroupsStep lang={lang} mode="first-run" />
    </ChoicesFrame>
  );
}
