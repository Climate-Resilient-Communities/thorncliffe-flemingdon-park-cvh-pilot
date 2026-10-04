import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { FALLBACK_MARKER } from "@/ui";
import { LAUNCH_LANGUAGES, isLaunchCode, type LaunchCode } from "@/i18n/languages";
import type { StepLanguage } from "@/ui/choices";

// The first-run steps and R-34 (S02.03) run on the phone, so their client components get just these parts of the
// language's catalog, not the whole of it.
const NAMESPACES = ["R01", "R26", "R34", "R35", "groups", "shell", "x07"] as const;

/** The 15 launch languages as the language step lists them, each in its own name. */
export const STEP_LANGUAGES: readonly StepLanguage[] = LAUNCH_LANGUAGES.map(({ code, bcp47, dir, native }) => ({ code, bcp47, dir, native }));

/** Gives a screen's client components the catalog parts they read. */
export async function ChoicesFrame({ lang, children }: { lang: LaunchCode; children: ReactNode }) {
  const all = (await getMessages({ locale: lang })) as Record<string, unknown>;
  const messages = Object.fromEntries(NAMESPACES.map((namespace) => [namespace, all[namespace]]));
  return (
    <NextIntlClientProvider locale={lang} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

/** The tab title and page head of one of these screens: its heading, and kept out of search results (a resident's own settings). */
export async function choicesMetadata(langParam: string, namespace: (typeof NAMESPACES)[number], key: string): Promise<Metadata> {
  if (!isLaunchCode(langParam)) return {};
  const t = await getTranslations({ locale: langParam, namespace });
  return { title: t(key).replace(FALLBACK_MARKER, ""), robots: { index: false, follow: false } };
}
