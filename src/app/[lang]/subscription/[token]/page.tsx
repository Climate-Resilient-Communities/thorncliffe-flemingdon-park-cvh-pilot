import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { isLaunchCode } from "@/i18n/languages";
import { HUB_PHONE_E164 } from "@/contracts/hubNumber.generated";
import { displayPhone } from "@/contracts/phone";
import { FALLBACK_MARKER } from "@/ui";
import { SubscriptionEdit } from "@/ui/subscription";
import { STEP_LANGUAGES } from "../../choices-frame";

// The one-time web link's page (S07.06), `/{lang}/subscription/{token}`. Rendered for each request and never stored (next.config.ts: no-store
// and no referrer for every page here; the service worker passes these paths to the network). The server neither reads the token nor
// touches the database: every link gets the same shell, with nothing about anyone in it, so a link-preview fetch sees nothing and uses
// nothing. The page reads the token from its address in the browser and asks /api/subscription/view for the choices. No cookie is read or set.
export const dynamicParams = true;
export const dynamic = "force-dynamic";

// The parts of the catalog the page reads (it runs on the phone).
const NAMESPACES = ["R05", "R34", "R35", "groups", "x13", "subscriptionEdit"] as const;

/** The pilot's two neighbourhoods, in R-05's order. */
const NEIGHBOURHOOD_IDS = ["TP", "FP"] as const;

export async function generateMetadata({ params }: PageProps<"/[lang]/subscription/[token]">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLaunchCode(lang)) return {};
  const t = await getTranslations({ locale: lang, namespace: "subscriptionEdit" });
  // Not something to find in search results, and the address (it holds the token) is never sent on as a referrer.
  return { title: t("title").replace(FALLBACK_MARKER, ""), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export default async function SubscriptionEditPage({ params }: PageProps<"/[lang]/subscription/[token]">) {
  const { lang } = await params;
  if (!isLaunchCode(lang)) notFound();
  setRequestLocale(lang);

  const all = (await getMessages({ locale: lang })) as Record<string, unknown>;
  const messages = Object.fromEntries(NAMESPACES.map((namespace) => [namespace, all[namespace]]));
  const names = all.neighbourhoods as Record<string, string>;
  const neighbourhoods = NEIGHBOURHOOD_IDS.map((id) => ({ id, name: names[id] ?? id }));

  return (
    <NextIntlClientProvider locale={lang} messages={messages}>
      <SubscriptionEdit lang={lang} languages={STEP_LANGUAGES} neighbourhoods={neighbourhoods} hub={displayPhone(HUB_PHONE_E164)} />
    </NextIntlClientProvider>
  );
}
