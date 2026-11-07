import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { isLaunchCode } from "@/i18n/languages";
import { CheckinExplainer } from "./explainer";

// "Ask for a check-in" (R-33, S08.05) explains, the same for every visitor: it reads nothing about anyone and no database, so it is
// prerendered for every launch language (the layout's static params) and may be kept by any cache and by the service worker like the other
// resident pages. The request itself is made on the sign-up form, the staff-assisted sign-up or the edit page, whose answers are POSTs that
// are never kept (E08 "Personalised check-in responses").

export async function generateMetadata({ params }: PageProps<"/[lang]/ready/check-in">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLaunchCode(lang)) return {};
  const t = await getTranslations({ locale: lang, namespace: "R33" });
  return { title: t("title") };
}

/** R-33 from Be ready and from R-34 (explainer.tsx). */
export default async function CheckinPage({ params }: PageProps<"/[lang]/ready/check-in">) {
  const { lang } = await params;
  if (!isLaunchCode(lang)) notFound();
  setRequestLocale(lang);
  return await CheckinExplainer({ lang });
}
