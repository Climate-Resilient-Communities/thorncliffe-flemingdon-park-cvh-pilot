import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { isLaunchCode } from "@/i18n/languages";
import { PlaceStep } from "@/ui/choices";
import { ChoicesFrame, choicesMetadata } from "../../choices-frame";

export async function generateMetadata({ params }: PageProps<"/[lang]/choices/place">): Promise<Metadata> {
  return choicesMetadata((await params).lang, "R35", "title");
}

/** Changing the buildings and floors from R-34. */
export default async function ChangePlace({ params }: PageProps<"/[lang]/choices/place">) {
  const { lang } = await params;
  if (!isLaunchCode(lang)) notFound();
  setRequestLocale(lang);
  return (
    <ChoicesFrame lang={lang}>
      <PlaceStep lang={lang} mode="later" />
    </ChoicesFrame>
  );
}
