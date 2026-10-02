import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ChoicesLink, FirstRunGate } from "@/ui/choices";
import { HomeNow } from "@/ui/home";
import { isLaunchCode } from "@/i18n/languages";

// Home's client component runs on the phone, so it gets just these parts of the language's catalog, not the whole of it.
const NAMESPACES = ["R03", "status", "neighbourhoods", "time", "x02", "x04"] as const;

/**
 * Home (R-03, S02.11): the resident's buildings with their status, the neighbourhood, and the current alerts, from the
 * public feed. The page itself is the same for everyone (prerendered); the phone's choices are applied in HomeNow, and
 * nothing about them is sent. A first visit is sent to the first-run steps (S02.03).
 */
export default async function ResidentHome({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  if (!isLaunchCode(lang)) notFound();
  setRequestLocale(lang);
  const shell = await getTranslations({ locale: lang, namespace: "shell" });
  const all = (await getMessages({ locale: lang })) as Record<string, Record<string, unknown>>;
  const messages = { ...Object.fromEntries(NAMESPACES.map((namespace) => [namespace, all[namespace]])), R34: { buildingByRsn: all.R34.buildingByRsn } };

  return (
    <FirstRunGate lang={lang}>
      <NextIntlClientProvider locale={lang} messages={messages}>
        <HomeNow lang={lang}>
          <ChoicesLink href={`/${lang}/choices`}>{shell("choices")}</ChoicesLink>
        </HomeNow>
      </NextIntlClientProvider>
    </FirstRunGate>
  );
}
