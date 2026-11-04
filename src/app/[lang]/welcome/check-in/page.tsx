import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { isLaunchCode } from "@/i18n/languages";
import { CheckinExplainer } from "../../ready/check-in/explainer";

export async function generateMetadata({ params }: PageProps<"/[lang]/welcome/check-in">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLaunchCode(lang)) return {};
  const t = await getTranslations({ locale: lang, namespace: "R33" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

/** First run, after R-35 when the resident asked for a check-in on R-26: R-33, then the finished step. */
export default async function WelcomeCheckin({ params }: PageProps<"/[lang]/welcome/check-in">) {
  const { lang } = await params;
  if (!isLaunchCode(lang)) notFound();
  setRequestLocale(lang);
  return await CheckinExplainer({ lang, firstRun: true });
}
