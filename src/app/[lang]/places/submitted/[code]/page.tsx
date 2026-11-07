import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { normaliseRef } from "@/contracts/placeSubmission";
import { FALLBACK_MARKER } from "@/ui";
import { isLaunchCode } from "@/i18n/languages";
import { SubmissionStatusPage } from "@/ui/places";
import { PlacesFrame } from "../../frame";

// What the Hub decided about a suggestion, by its reference code (PRD §6.3; R-23). A shell: the phone asks GET /api/places/submissions/{code}
// itself, so the page reads nothing on the server and keeps nothing; a code that cannot be one is a 404 before anything is asked.
export const dynamicParams = true;

export async function generateMetadata({ params }: PageProps<"/[lang]/places/submitted/[code]">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLaunchCode(lang)) return {};
  const t = await getTranslations({ locale: lang, namespace: "places" });
  return { title: t("checkStatus").replace(FALLBACK_MARKER, "") };
}

export default async function SubmittedPage({ params }: PageProps<"/[lang]/places/submitted/[code]">) {
  const { lang, code } = await params;
  const ref = normaliseRef(decodeURIComponent(code));
  if (!isLaunchCode(lang) || !ref) notFound();
  setRequestLocale(lang);
  return (
    <PlacesFrame lang={lang}>
      <SubmissionStatusPage lang={lang} code={ref} />
    </PlacesFrame>
  );
}
