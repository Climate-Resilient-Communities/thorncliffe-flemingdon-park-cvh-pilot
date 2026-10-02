import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { ResidentShell, type NavItem } from "@/ui/shell";
import { isLaunchCode, LAUNCH_CODES, LAUNCH_LANGUAGES, languageOf } from "@/i18n/languages";
import "../globals.css";
import { fontStack } from "./fonts";

// AD-1: the resident surface is /[lang]/…, prerendered for each launch language. A first segment that is not
// one is a 404 below; an unknown language code never gets this far, because proxy.ts sends it to /en/.
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

  const language = languageOf(lang);
  const shell = await getTranslations({ locale: lang, namespace: "shell" });
  const r02 = await getTranslations({ locale: lang, namespace: "R02" });
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
          {children}
        </ResidentShell>
      </body>
    </html>
  );
}
