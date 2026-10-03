import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { VerifiedExplainer, alertView, type Translate } from "@/ui/alert";
import { isLaunchCode } from "@/i18n/languages";
import { loadAlert } from "../../source";

// What "verified" means (R-28, S04.08): opened from an alert, so it is about that alert and found the way the alert is (../../source.ts): an address
// with no alert behind it is a 404, and so is every address while the launch gate is off.
export const dynamicParams = true;
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[lang]/alerts/[slug]/verified">): Promise<Metadata> {
  const { lang, slug } = await params;
  if (!isLaunchCode(lang) || !(await loadAlert(lang, slug))) return {};
  const t = (await getTranslations({ locale: lang })) as unknown as Translate;
  return { title: t("R28.title") };
}

export default async function VerifiedPage({ params }: PageProps<"/[lang]/alerts/[slug]/verified">) {
  const { lang, slug } = await params;
  if (!isLaunchCode(lang)) notFound();
  setRequestLocale(lang);
  const loaded = await loadAlert(lang, slug);
  if (!loaded) notFound();

  const t = (await getTranslations({ locale: lang })) as unknown as Translate;
  return <VerifiedExplainer view={alertView(loaded.thread, { lang, serverNow: loaded.serverNow, t })} lang={lang} t={t} />;
}
