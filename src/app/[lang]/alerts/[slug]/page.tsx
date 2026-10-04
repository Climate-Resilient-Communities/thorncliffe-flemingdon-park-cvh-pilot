import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AlertDetail, alertView, type Translate } from "@/ui/alert";
import { isLaunchCode } from "@/i18n/languages";
import { loadAlert } from "../source";

// An alert (R-07, S04.08) is public and the same for every visitor, read from the feed (../source.ts): never built ahead, because the alerts come
// from the database, which a build does not reach. The server's answer is shown whenever there is signal, within the feed's own 15 seconds (a
// correction, an update, the end of the alert); a copy kept by the phone's worker (S02.12) is shown only without signal or after its 6 s timeout,
// always with the note that says so and since when. An address nobody has an alert at is a 404 inside the shell, which a shared
// cache must not keep (the default for a dynamic page, no-store, applies to it).
export const dynamicParams = true;
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[lang]/alerts/[slug]">): Promise<Metadata> {
  const { lang, slug } = await params;
  if (!isLaunchCode(lang)) return {};
  const loaded = await loadAlert(lang, slug);
  if (!loaded) return {};
  const t = (await getTranslations({ locale: lang })) as unknown as Translate;
  // The share preview says what the alert says now (S05.02): its description is the words of the entry that stands (a correction's, never the wording it replaced).
  const { preview } = alertView(loaded.thread, { lang, serverNow: loaded.serverNow, t });
  return { title: preview.title, description: preview.description, openGraph: { title: preview.title, description: preview.description } };
}

/**
 * The alert (R-07): its types, its words in the resident's language (or the English with the note that says so), who sent it and whether the Hub
 * checked it, when it was posted and how long it is valid, the 911 block, the guide that matches opened at "During", and the whole thread.
 */
export default async function AlertPage({ params }: PageProps<"/[lang]/alerts/[slug]">) {
  const { lang, slug } = await params;
  if (!isLaunchCode(lang)) notFound();
  setRequestLocale(lang);
  const loaded = await loadAlert(lang, slug);
  if (!loaded) notFound();

  const t = (await getTranslations({ locale: lang })) as unknown as Translate;
  return <AlertDetail view={alertView(loaded.thread, { lang, serverNow: loaded.serverNow, t })} lang={lang} t={t} />;
}
