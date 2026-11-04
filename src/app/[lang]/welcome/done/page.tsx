import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { isLaunchCode } from "@/i18n/languages";
import { WelcomeDone } from "@/ui/choices";
import { ChoicesFrame, choicesMetadata } from "../../choices-frame";

export async function generateMetadata({ params }: PageProps<"/[lang]/welcome/done">): Promise<Metadata> {
  return choicesMetadata((await params).lang, "R35", "finishedTitle");
}

/** The end of the first run: R-35's finished state, what was chosen and the invitation to text alerts. */
export default async function WelcomeDonePage({ params }: PageProps<"/[lang]/welcome/done">) {
  const { lang } = await params;
  if (!isLaunchCode(lang)) notFound();
  setRequestLocale(lang);
  return (
    <ChoicesFrame lang={lang}>
      <WelcomeDone lang={lang} />
    </ChoicesFrame>
  );
}
