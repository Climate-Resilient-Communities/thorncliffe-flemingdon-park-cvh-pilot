import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ChoicesLink, FirstRunGate } from "@/ui/choices";
import { HomeNow } from "@/ui/home";
import { isLaunchCode } from "@/i18n/languages";

// Home's client component runs on the phone, so it gets just these parts of the language's catalog, not the whole of it.
// The alert cards (S04.08) read the words of an alert's view: the types (x13), the kinds of entry and the guide names (R07, hazards), the
// valid-until's day words (R29, time) and the Hub's attribution (R04.fromHub, one string of that group).
const NAMESPACES = ["R03", "R07", "R29", "status", "neighbourhoods", "time", "hazards", "x01", "x02", "x04", "x13"] as const;

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
  const messages = {
    ...Object.fromEntries(NAMESPACES.map((namespace) => [namespace, all[namespace]])),
    R04: { fromHub: all.R04.fromHub },
    R34: { buildingByRsn: all.R34.buildingByRsn },
  };

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
