import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ListingProviderSchema } from "@/contracts/directory";
import { FALLBACK_MARKER } from "@/ui";
import { isLaunchCode } from "@/i18n/languages";
import { CorrectPlace } from "@/ui/places";
import { PlacesFrame, rulesIn } from "../../frame";

// Correct a listed place (PRD §6.3; R-22). A shell like the provider's own page: the phone finds the provider in the release file it
// downloaded. Any well-formed provider id opens it (an id that is not in the release says so on the page), rendered on first request.
export const dynamicParams = true;

const ID = ListingProviderSchema.shape.id;

export async function generateMetadata({ params }: PageProps<"/[lang]/places/correct/[id]">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLaunchCode(lang)) return {};
  const t = await getTranslations({ locale: lang, namespace: "R22" });
  return { title: t("title").replace(FALLBACK_MARKER, "") };
}

export default async function CorrectPlacePage({ params }: PageProps<"/[lang]/places/correct/[id]">) {
  const { lang, id } = await params;
  if (!isLaunchCode(lang) || !ID.safeParse(id).success) notFound();
  setRequestLocale(lang);
  return (
    <PlacesFrame lang={lang}>
      <CorrectPlace lang={lang} id={id} rules={await rulesIn(lang)} />
    </PlacesFrame>
  );
}
