import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { FALLBACK_MARKER } from "@/ui";
import { isLaunchCode } from "@/i18n/languages";
import { DirectoryBrowser } from "@/ui/directory";
import { DirectoryFrame } from "./frame";

// The directory is the same for every visitor and reads nothing on the server: the page is a shell, prerendered for each
// launch language, and the phone downloads the published release file and filters it itself (S02.06, AD-11).
export async function generateMetadata({ params }: PageProps<"/[lang]/directory">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLaunchCode(lang)) return {};
  const t = await getTranslations({ locale: lang, namespace: "directory" });
  return { title: t("title").replace(FALLBACK_MARKER, "") };
}

/** The directory (R-10 as the pilot has it, with the filters R-27 and the applied-filter bar X-11). */
export default async function DirectoryPage({ params }: PageProps<"/[lang]/directory">) {
  const { lang } = await params;
  if (!isLaunchCode(lang)) notFound();
  setRequestLocale(lang);
  return (
    <DirectoryFrame lang={lang}>
      <DirectoryBrowser lang={lang} />
    </DirectoryFrame>
  );
}
