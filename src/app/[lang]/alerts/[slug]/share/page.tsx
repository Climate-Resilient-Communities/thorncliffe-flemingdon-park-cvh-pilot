import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ShareScreen, alertView, shareLink, shareMessage, type Translate } from "@/ui/alert";
import { isLaunchCode } from "@/i18n/languages";
import { getEnv } from "@/platform/config/env";
import { loadPlace } from "../../place";
import { loadAlert } from "../../source";

// Share an alert (R-29, S05.08): opened from an alert, so it is about that alert and found the way the alert is (../../source.ts): an address with no alert behind it
// is a 404 with no detail, and so is every address while the launch gate is off. The message is composed here, once, from the same view as the alert and the
// link's preview, and handed to the share control as text: sharing itself asks the server for nothing.
export const dynamicParams = true;
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[lang]/alerts/[slug]/share">): Promise<Metadata> {
  const { lang, slug } = await params;
  if (!isLaunchCode(lang) || !(await loadAlert(lang, slug))) return {};
  const t = (await getTranslations({ locale: lang })) as unknown as Translate;
  return { title: t("R29.title") };
}

export default async function SharePage({ params }: PageProps<"/[lang]/alerts/[slug]/share">) {
  const { lang, slug } = await params;
  if (!isLaunchCode(lang)) notFound();
  setRequestLocale(lang);
  const loaded = await loadAlert(lang, slug);
  if (!loaded) notFound();

  const t = (await getTranslations({ locale: lang })) as unknown as Translate;
  const place = await loadPlace(loaded.thread, lang, t);
  const view = alertView(loaded.thread, { lang, serverNow: loaded.serverNow, t, place });
  const message = shareMessage(view, { lang, serverNow: loaded.serverNow, t, link: shareLink(getEnv().publicBaseUrl, view.slug, lang) });
  return <ShareScreen view={view} message={message} lang={lang} t={t} />;
}
