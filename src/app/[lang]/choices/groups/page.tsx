import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { isLaunchCode } from "@/i18n/languages";
import { GroupsStep } from "@/ui/choices";
import { ChoicesFrame, choicesMetadata } from "../../choices-frame";

export async function generateMetadata({ params }: PageProps<"/[lang]/choices/groups">): Promise<Metadata> {
  return choicesMetadata((await params).lang, "R26", "title");
}

/** Changing the groups from R-34. */
export default async function ChangeGroups({ params }: PageProps<"/[lang]/choices/groups">) {
  const { lang } = await params;
  if (!isLaunchCode(lang)) notFound();
  setRequestLocale(lang);
  return (
    <ChoicesFrame lang={lang}>
      <GroupsStep lang={lang} mode="later" />
    </ChoicesFrame>
  );
}
