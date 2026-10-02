import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { isLaunchCode } from "@/i18n/languages";
import { MyChoices } from "@/ui/choices";
import { ChoicesFrame, STEP_LANGUAGES, choicesMetadata } from "../choices-frame";

export async function generateMetadata({ params }: PageProps<"/[lang]/choices">): Promise<Metadata> {
  return choicesMetadata((await params).lang, "R34", "title");
}

/** R-34, what I have told the CVH: every choice kept on this phone, each changed or removed here. */
export default async function MyChoicesPage({ params }: PageProps<"/[lang]/choices">) {
  const { lang } = await params;
  if (!isLaunchCode(lang)) notFound();
  setRequestLocale(lang);
  return (
    <ChoicesFrame lang={lang}>
      <MyChoices lang={lang} languages={STEP_LANGUAGES} />
    </ChoicesFrame>
  );
}
