import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import type { ReactNode } from "react";
import type { LaunchCode } from "@/i18n/languages";
import { DIRECTORY_NAMESPACES } from "../directory/frame";

// The ask screen runs on the phone (S03.06), so its client components get just these parts of the language's catalog: the
// directory's (a result is the directory's own card, with its facts, labels and the 911 sentence) and the ask screen's
// own wording (R09, with R10 and R11 already among the directory's).
export const SEARCH_NAMESPACES = [...DIRECTORY_NAMESPACES, "R09"] as const;

/** Gives the ask screen's client components the catalog parts they read. */
export async function SearchFrame({ lang, children }: { lang: LaunchCode; children: ReactNode }) {
  const all = (await getMessages({ locale: lang })) as Record<string, unknown>;
  // And the one "Call 911" of the numbers page (R31.call911), for the call under the 911 block that comes first (S03.06).
  const messages = { ...Object.fromEntries(SEARCH_NAMESPACES.map((namespace) => [namespace, all[namespace]])), R31: { call911: (all.R31 as Record<string, unknown>).call911 } };
  return (
    <NextIntlClientProvider locale={lang} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
