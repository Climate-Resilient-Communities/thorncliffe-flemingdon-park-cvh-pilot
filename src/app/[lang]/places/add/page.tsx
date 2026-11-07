import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { FALLBACK_MARKER } from "@/ui";
import { isLaunchCode } from "@/i18n/languages";
import { AddPlaceFlow } from "@/ui/places";
import { pageMapTiles } from "../../map/tiles";
import { PlacesFrame, rulesInEveryLanguage } from "../frame";

// Add a place, or choose one to correct (PRD §6.3; R-17 to R-21). The same for every visitor and reads nothing on the server: a shell,
// prerendered for each launch language, with the map's tile settings for R-20's pin and the rules in every language for R-18.
export async function generateMetadata({ params }: PageProps<"/[lang]/places/add">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLaunchCode(lang)) return {};
  const t = await getTranslations({ locale: lang, namespace: "R17" });
  return { title: t("title").replace(FALLBACK_MARKER, "") };
}

export default async function AddPlacePage({ params }: PageProps<"/[lang]/places/add">) {
  const { lang } = await params;
  if (!isLaunchCode(lang)) notFound();
  setRequestLocale(lang);
  return (
    <PlacesFrame lang={lang}>
      <AddPlaceFlow lang={lang} tiles={pageMapTiles()} rules={await rulesInEveryLanguage()} />
    </PlacesFrame>
  );
}
