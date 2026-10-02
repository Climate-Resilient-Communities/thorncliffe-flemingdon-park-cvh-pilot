import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ListingProviderSchema } from "@/contracts/directory";
import { FALLBACK_MARKER } from "@/ui";
import { isLaunchCode } from "@/i18n/languages";
import { ProviderPage } from "@/ui/directory";
import { DirectoryFrame } from "../frame";

// A provider's page is a shell too: the phone finds the provider in the release file it downloaded. Any well-formed
// provider id opens the shell (an id that is not in the release says so on the page), rendered on first request.
export const dynamicParams = true;

const ID = ListingProviderSchema.shape.id;

export async function generateMetadata({ params }: PageProps<"/[lang]/directory/[id]">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLaunchCode(lang)) return {};
  const t = await getTranslations({ locale: lang, namespace: "directory" });
  return { title: t("title").replace(FALLBACK_MARKER, "") };
}

/** One provider (R-12 listing, R-13 organisation). */
export default async function ProviderRoute({ params }: PageProps<"/[lang]/directory/[id]">) {
  const { lang, id } = await params;
  if (!isLaunchCode(lang) || !ID.safeParse(id).success) notFound();
  setRequestLocale(lang);
  return (
    <DirectoryFrame lang={lang}>
      <ProviderPage lang={lang} id={id} />
    </DirectoryFrame>
  );
}
