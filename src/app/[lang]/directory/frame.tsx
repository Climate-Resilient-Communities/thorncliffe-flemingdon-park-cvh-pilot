import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import type { ReactNode } from "react";
import type { LaunchCode } from "@/i18n/languages";

// The directory runs on the phone (S02.06), so its client components get just these parts of the language's catalog,
// not the whole of it: its own wording, the filters (R27, R10, filters, x11), "nothing found" (R11), a listing's facts
// (R12, status), How they can help (x14) and the 911 sentence (x01). No machine-translation or "translation unavailable"
// wording (x04): every translation is shown without a label (product-owner decision 2026-10-09, pilot).
export const DIRECTORY_NAMESPACES = ["directory", "R10", "R11", "R12", "R27", "filters", "status", "x01", "x11", "x14"] as const;

/** Gives the directory's client components the catalog parts they read. */
export async function DirectoryFrame({ lang, children }: { lang: LaunchCode; children: ReactNode }) {
  const all = (await getMessages({ locale: lang })) as Record<string, unknown>;
  const messages = Object.fromEntries(DIRECTORY_NAMESPACES.map((namespace) => [namespace, all[namespace]]));
  return (
    <NextIntlClientProvider locale={lang} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
