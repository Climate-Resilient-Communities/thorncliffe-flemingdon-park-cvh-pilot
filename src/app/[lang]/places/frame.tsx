import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import type { ReactNode } from "react";
import { LAUNCH_CODES, type LaunchCode } from "@/i18n/languages";
import type { RulesTexts } from "@/ui/places";
import { PLACES_NAMESPACES } from "./namespaces";

/** Gives the place screens' client components the catalog parts they read. */
export async function PlacesFrame({ lang, children }: { lang: LaunchCode; children: ReactNode }) {
  const all = (await getMessages({ locale: lang })) as Record<string, unknown>;
  const messages = Object.fromEntries(PLACES_NAMESPACES.map((namespace) => [namespace, all[namespace]]));
  return (
    <NextIntlClientProvider locale={lang} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

/** X-03 in one language, from that language's catalog. */
export async function rulesIn(lang: LaunchCode): Promise<RulesTexts> {
  const x03 = ((await getMessages({ locale: lang })) as { x03: RulesTexts }).x03;
  return { title: x03.title, intro: x03.intro, rules: x03.rules, market: x03.market, review: x03.review };
}

/** R-18 "Read the rules in": X-03 in every launch language, so the resident can read them in another than the page's. */
export async function rulesInEveryLanguage(): Promise<Record<string, RulesTexts>> {
  return Object.fromEntries(await Promise.all(LAUNCH_CODES.map(async (code) => [code, await rulesIn(code)] as const)));
}
