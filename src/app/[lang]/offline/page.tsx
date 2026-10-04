import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { HUB_PHONE_E164 } from "@/contracts/hubNumber.generated";
import { displayPhone } from "@/contracts/phone";
import { ResidentText, Screen, Stack } from "@/ui";
import { Not911 } from "@/ui/emergency";
import { KeptPages } from "@/ui/offline";
import { withIsolated } from "@/ui/text/isolated";
import { isLaunchCode } from "@/i18n/languages";
import "../ready/ready.css";

// The offline page (S02.12): what the service worker shows, without signal, for a page of the CVH this phone has never
// kept. It is stored with home and the numbers page when the worker installs, so it is always there. It needs nothing
// from the database, so it is built once per language; the list of what can be read without signal is read on the phone.

export async function generateMetadata({ params }: PageProps<"/[lang]/offline">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLaunchCode(lang)) return {};
  const t = await getTranslations({ locale: lang, namespace: "offline" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

/**
 * Without signal, a page this phone has not kept: it says so, leads to the numbers page (always kept) and the Hub's
 * number, lists the pages that can be read without signal, and ends with the 911 block.
 */
export default async function OfflinePage({ params }: PageProps<"/[lang]/offline">) {
  const { lang } = await params;
  if (!isLaunchCode(lang)) notFound();
  setRequestLocale(lang);
  const t = await getTranslations({ locale: lang });
  const x01 = (key: "text" | "call" | "short") => t(`x01.${key}`);
  const hub = displayPhone(HUB_PHONE_E164);

  return (
    <Screen surface="resident" testId="offline-page">
      <Stack gap="section-resident">
        <Stack gap="related">
          <ResidentText as="h1">{t("offline.title")}</ResidentText>
          <ResidentText as="p">{t("offline.body")}</ResidentText>
        </Stack>

        <Stack gap="related">
          {/* Plain links: Next's would ask the server for the page's data, which fails without signal. */}
          <a className="ready-btn ready-btn--primary ready-btn--large tap" href={`/${lang}/ready/numbers`} data-testid="offline-numbers">
            <span className="shell-ico shell-ico--phone" aria-hidden="true" />
            <ResidentText>{t("R31.title")}</ResidentText>
          </a>
          <a className="ready-btn ready-btn--secondary tap" href={`tel:${HUB_PHONE_E164}`} data-testid="offline-hub">
            {withIsolated((phone) => t("R11.call", { phone }), hub)}
          </a>
        </Stack>

        <section data-testid="offline-available">
          <Stack gap="related">
            <ResidentText as="h2">{t("offline.available")}</ResidentText>
            <KeptPages lang={lang} none={t("offline.none")} />
          </Stack>
        </section>

        <Not911 t={x01} />
      </Stack>
    </Screen>
  );
}
