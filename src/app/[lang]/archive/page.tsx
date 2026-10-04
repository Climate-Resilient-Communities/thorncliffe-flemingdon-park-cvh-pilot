import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { readCachedArchive } from "@/app/feedCache";
import { isLaunchCode } from "@/i18n/languages";
import { ArchiveScreen } from "@/ui/archive";

// The archive (R-08, S05.07) is public and the same for every visitor: the alerts that have ended, read from the same cached answer as /api/feed/archive (src/app/feedCache.ts),
// the first page with the page itself so a copy kept for reading without signal has the alerts in it. It is rendered on request, never at build: the alerts come from the
// database, which a build does not reach. With the launch gate off it lists none.
export const dynamicParams = true;
export const dynamic = "force-dynamic";

// The screen asks for the next page on the phone, so it gets just these parts of the language's catalog, as home does: the screen's own words (R08, R03.readAlert), and what an
// alert card reads (the types x13, the origin and verification x02, the machine-translation notes x04, the kinds of entry and guide names R07 and hazards, the day words R29 and
// time, the statuses, the Hub's attribution R04.fromHub) and the 911 notice (x01).
const NAMESPACES = ["R03", "R07", "R08", "R29", "status", "time", "hazards", "x01", "x02", "x04", "x13"] as const;

export async function generateMetadata({ params }: PageProps<"/[lang]/archive">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLaunchCode(lang)) return {};
  const t = await getTranslations({ locale: lang, namespace: "R08" });
  return { title: t("title") };
}

export default async function ArchivePage({ params }: PageProps<"/[lang]/archive">) {
  const { lang } = await params;
  if (!isLaunchCode(lang)) notFound();
  setRequestLocale(lang);
  const all = (await getMessages({ locale: lang })) as Record<string, Record<string, unknown>>;
  const messages = {
    ...Object.fromEntries(NAMESPACES.map((namespace) => [namespace, all[namespace]])),
    R04: { fromHub: all.R04.fromHub },
    shell: { back: all.shell.back },
  };
  // A database failure leaves the screen with its failure note and a button to ask again, not the generic error page (the API answers the same failure with a 503).
  const initial = await readCachedArchive(lang, 1).catch(() => null);
  return (
    <NextIntlClientProvider locale={lang} messages={messages}>
      <ArchiveScreen lang={lang} initial={initial} />
    </NextIntlClientProvider>
  );
}
