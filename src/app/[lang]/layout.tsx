import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { preload } from "react-dom";
import type { CSSProperties } from "react";
import { BASIC_BOOT_SCRIPT, BasicSync } from "@/ui/basic";
import { ResidentShell, type NavItem } from "@/ui/shell";
import { OfflineSupport } from "@/ui/offline";
import { InstallCount } from "@/ui/usage";
import { isLaunchCode, LAUNCH_CODES, LAUNCH_LANGUAGES, languageOf } from "@/i18n/languages";
import "../globals.css";
import "./fonts.generated.css";
import { fontStack, PUBLIC_SANS_LATIN } from "./fonts";
import { lightColour } from "./manifest.webmanifest/manifest";

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
  // S02.12: installable from the browser. Each language links its own manifest (named in the language, opening on its
  // home); iOS reads the apple-* tags instead and needs an icon without transparency.
  return {
    title: t("cvhName"),
    manifest: `/${lang}/manifest.webmanifest`,
    icons: { icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }], apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }] },
    appleWebApp: { capable: true, title: "CVH", statusBarStyle: "default" },
  };
}

/** The browser's bar in the header's colour (`surface-raised`), as the installed app's theme colour. */
export const viewport: Viewport = { themeColor: lightColour("surface-raised") };

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
  const x07 = await getTranslations({ locale: lang, namespace: "x07" });
  // The parts of the catalog the layout's client components read: the 911 block of error.tsx, which must be able to draw
  // itself in the page's language when a render fails, and the offline note below. Nothing else is sent to the browser.
  const { x01, shell: shellMessages, time } = (await getMessages({ locale: lang })) as {
    x01: Record<"text" | "call" | "short", string>;
    shell: Record<string, unknown>;
    time: Record<string, unknown>;
  };
  // The offline note (S02.12): "You are offline. Showing what was last loaded {t}", with the time words it needs.
  const clientMessages = { x01: { text: x01.text, call: x01.call, short: x01.short }, shell: { offline: shellMessages.offline }, time };
  // The prototype's destinations: home (R-03), find help (R-09), map (R-14), be ready (R-24). "Find help" opens the ask screen
  // (R-09, /search, S03.06), which links to the directory (S02.06). It is marked as the current item on both. An alert (R-07) and what
  // "verified" means (R-28) belong to Now, as in the prototype.
  const nav: NavItem[] = [
    { id: "now", icon: "now", label: shell("nav.now"), href: `/${lang}`, alsoCurrentOn: [`/${lang}/alerts`] },
    { id: "help", icon: "search", label: shell("nav.help"), href: `/${lang}/search`, alsoCurrentOn: [`/${lang}/directory`] },
    { id: "map", icon: "map", label: shell("nav.map"), href: `/${lang}/map` },
    { id: "ready", icon: "ready", label: shell("nav.ready"), href: `/${lang}/ready` },
  ];

  return (
    <html
      lang={language.bcp47}
      dir={language.dir}
      data-script={language.font}
      // The boot script below sets data-basic before React hydrates, so the attribute is expected to differ from the server's.
      suppressHydrationWarning
      style={{ "--font-script": fontStack(language.font) } as CSSProperties}
    >
      <head>
        {/* Basic mode (X-07, S02.14): before the first paint, from cvh.choices, so the page never shows in normal size first. */}
        <script dangerouslySetInnerHTML={{ __html: BASIC_BOOT_SCRIPT }} />
      </head>
      <body>
        <BasicSync />
        <ResidentShell
          header={{
            logoAlt: shell("hubLogoAlt"),
            basic: { label: x07("label"), on: x07("on"), off: x07("off") },
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
            <OfflineSupport />
            <InstallCount lang={lang} />
            {children}
          </NextIntlClientProvider>
        </ResidentShell>
      </body>
    </html>
  );
}
