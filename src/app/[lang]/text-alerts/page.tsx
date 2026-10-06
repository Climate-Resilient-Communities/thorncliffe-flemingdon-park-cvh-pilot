import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { HUB_PHONE_E164 } from "@/contracts/hubNumber.generated";
import { displayPhone } from "@/contracts/phone";
import { isLaunchCode } from "@/i18n/languages";
import { FALLBACK_MARKER } from "@/ui";
import { TextSignup } from "@/ui/signup";
import { termsPageView } from "@/modules/subscriptions";
import { getEnv } from "@/platform/config/env";
import { currentSignupConsentVersion } from "../../signup";
import { STEP_LANGUAGES } from "../choices-frame";

// Rendered for each request: the number residents text START to is read from the environment, which the build does not have. The page
// reads no cookie and sets none, and holds nothing about the visitor: the form is filled on the phone from its own choices.
export const dynamic = "force-dynamic";

// The parts of the catalog the form reads (it runs on the phone); S08.05's check-in request reads R33, checkin and the 911 block (x01).
const NAMESPACES = ["R05", "R33", "R34", "R35", "checkin", "groups", "shell", "signup", "terms", "x01"] as const;

/** The pilot's two neighbourhoods, in R-05's order. */
const NEIGHBOURHOOD_IDS = ["TP", "FP"] as const;

export async function generateMetadata({ params }: PageProps<"/[lang]/text-alerts">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLaunchCode(lang)) return {};
  const t = await getTranslations({ locale: lang, namespace: "R05" });
  // A form, not something to find in search results.
  return { title: t("title").replace(FALLBACK_MARKER, ""), robots: { index: false, follow: false } };
}

/**
 * R-05 "Get text alerts" (S07.02), with R-06 shown once it is sent. Open only while there are terms a sign-up may record (published terms;
 * outside production, the draft, marked as one): in production with unpublished terms the page is a 404, as the terms page is.
 */
export default async function TextAlertsPage({ params }: PageProps<"/[lang]/text-alerts">) {
  const { lang } = await params;
  if (!isLaunchCode(lang)) notFound();
  setRequestLocale(lang);

  const consentVersion = currentSignupConsentVersion();
  if (consentVersion === null) notFound();
  const termsDraft = termsPageView(lang).status !== "published";

  const all = (await getMessages({ locale: lang })) as Record<string, unknown>;
  const messages = Object.fromEntries(NAMESPACES.map((namespace) => [namespace, all[namespace]]));
  const names = all.neighbourhoods as Record<string, string>;
  const neighbourhoods = NEIGHBOURHOOD_IDS.map((id) => ({ id, name: names[id] ?? id }));

  return (
    <NextIntlClientProvider locale={lang} messages={messages}>
      <TextSignup
        lang={lang}
        languages={STEP_LANGUAGES}
        neighbourhoods={neighbourhoods}
        consentVersion={consentVersion}
        termsDraft={termsDraft}
        textNumber={getEnv().twilio?.fromNumber ?? null}
        hub={displayPhone(HUB_PHONE_E164)}
      />
    </NextIntlClientProvider>
  );
}
