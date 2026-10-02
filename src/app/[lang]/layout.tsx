import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { preload } from "react-dom";
import type { CSSProperties } from "react";
import { ResidentShell, type NavItem } from "@/ui/shell";
import { isLaunchCode, LAUNCH_CODES, LAUNCH_LANGUAGES, languageOf } from "@/i18n/languages";
import "../globals.css";
import "./fonts.generated.css";
import { fontStack, PUBLIC_SANS_LATIN } from "./fonts";

// AD-1: the resident surface is /[lang]/…, prerendered for each launch language. dynamicParams = false makes any
// other first segment a plain 404 that is rendered for the request, not a page cached for a year (a language-shaped
// unknown code never gets this far, because proxy.ts sends it to /en/).
export const dynamicParams = false;

export function generateStaticParams() {
  return LAUNCH_CODES.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: LayoutProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLaunchCode(lang)) return {};
  const t = await getTranslations({ locale: lang, namespace: "shell" });
  return { title: t("cvhName") };
}

/**
 * The root layout of the resident surface: <html lang dir> for the language in the URL, that language's font,
 * and the resident shell (header, scrolling main, navigation). Nothing here reads a cookie or a header.
 */
export default async function ResidentLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!isLaunchCode(lang)) notFound();
  setRequestLocale(lang);
  // The one font file every resident page needs (Latin text in any language), preloaded from here (the staff layout
  // preloads its own copy of the file), so the site pages preload nothing. The language's own Noto slices follow their text.
  preload(PUBLIC_SANS_LATIN, { as: "font", type: "font/woff2", crossOrigin: "anonymous" });

  const language = languageOf(lang);
  const shell = await getTranslations({ locale: lang, namespace: "shell" });
  const r02 = await getTranslations({ locale: lang, namespace: "R02" });
  // The only part of the catalog a client component of the resident surface reads: the 911 block of error.tsx, which must
  // be able to draw itself in the page's language when a render fails. Nothing else is sent to the browser.
  const { x01 } = (await getMessages({ locale: lang })) as { x01: Record<"text" | "call" | "short", string> };
  const clientMessages = { x01: { text: x01.text, call: x01.call, short: x01.short } };
  // The prototype's destinations: home (R-03), find help (R-09), map (R-14), be ready (R-24).
  const nav: NavItem[] = [
    { id: "now", icon: "now", label: shell("nav.now"), href: `/${lang}` },
    { id: "help", icon: "search", label: shell("nav.help"), href: `/${lang}/search` },
    { id: "map", icon: "map", label: shell("nav.map"), href: `/${lang}/map` },
    { id: "ready", icon: "ready", label: shell("nav.ready"), href: `/${lang}/ready` },
  ];

  return (
    <html
      lang={language.bcp47}
      dir={language.dir}
      data-script={language.font}
      style={{ "--font-script": fontStack(language.font) } as CSSProperties}
    >
      <body>
        <ResidentShell
          header={{
            logoAlt: shell("hubLogoAlt"),
            current: lang,
            languages: LAUNCH_LANGUAGES,
            labels: {
              open: shell("changeLanguage"),
              title: r02("title"),
              close: shell("close"),
              note: shell("languageReturn"),
            },
          }}
          nav={{ label: shell("navLabel"), items: nav }}
        >
          <NextIntlClientProvider locale={lang} messages={clientMessages}>
            {children}
          </NextIntlClientProvider>
        </ResidentShell>
      </body>
    </html>
  );
}
