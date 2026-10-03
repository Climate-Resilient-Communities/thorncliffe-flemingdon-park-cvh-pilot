import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { FALLBACK_MARKER } from "@/ui";
import { isLaunchCode } from "@/i18n/languages";
import { AskScreen } from "@/ui/search";
import { SearchFrame } from "./frame";

// The ask screen is the same for every visitor and reads nothing on the server: the page is a shell, prerendered for each
// launch language. The phone reads the manifest and the listing file, and asks /api/search itself (S03.06, AD-11).
export async function generateMetadata({ params }: PageProps<"/[lang]/search">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLaunchCode(lang)) return {};
  const t = await getTranslations({ locale: lang, namespace: "R09" });
  return { title: t("title").replace(FALLBACK_MARKER, "") };
}

/** Find help (R-09): the question box and the topics, and below them what the question found (R-10, R-11). */
export default async function SearchPage({ params }: PageProps<"/[lang]/search">) {
  const { lang } = await params;
  if (!isLaunchCode(lang)) notFound();
  setRequestLocale(lang);
  return (
    <SearchFrame lang={lang}>
      <AskScreen lang={lang} />
    </SearchFrame>
  );
}
