import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { FALLBACK_MARKER } from "@/ui";
import { MapScreen } from "@/ui/map";
import { isLaunchCode } from "@/i18n/languages";
import { pageMapTiles } from "./tiles";

// The map (S02.07, R-14 with R-15 and R-16) is the same for every visitor and reads nothing on the server: the page is a
// shell, prerendered for each launch language, with the tile provider's settings (MAP_TILE_*, read at build). The phone
// downloads the directory's release file and the building list and draws them itself (AD-11, AD-3).

/** The catalog parts the map's client components read: the map screens, its own wording and the directory's few it shares. */
const MAP_NAMESPACES = ["R14", "R15", "R16", "map", "directory"] as const;

export async function generateMetadata({ params }: PageProps<"/[lang]/map">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLaunchCode(lang)) return {};
  const t = await getTranslations({ locale: lang, namespace: "R14" });
  return { title: t("title").replace(FALLBACK_MARKER, "") };
}

export default async function MapPage({ params }: PageProps<"/[lang]/map">) {
  const { lang } = await params;
  if (!isLaunchCode(lang)) notFound();
  setRequestLocale(lang);
  const tiles = pageMapTiles();
  const all = (await getMessages({ locale: lang })) as Record<string, unknown>;
  const messages = Object.fromEntries(MAP_NAMESPACES.map((namespace) => [namespace, all[namespace]]));
  return (
    <NextIntlClientProvider locale={lang} messages={messages}>
      <MapScreen lang={lang} tiles={tiles} />
    </NextIntlClientProvider>
  );
}
