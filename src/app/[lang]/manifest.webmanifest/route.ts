import { getTranslations } from "next-intl/server";
import { isLaunchCode, LAUNCH_CODES, languageOf } from "@/i18n/languages";
import { webAppManifest } from "./manifest";

// The web app manifest of each language (S02.12, FR-M1): what a phone's browser needs to offer "Install" or "Add to Home
// screen", with no app store. One per language, so the installed app is named in the resident's language and opens in it;
// the layout links the page's own. Built once per language at build time; nothing in it depends on who asks.
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return LAUNCH_CODES.map((lang) => ({ lang }));
}

export async function GET(_request: Request, context: { params: Promise<{ lang: string }> }) {
  const { lang } = await context.params;
  if (!isLaunchCode(lang)) return new Response(null, { status: 404 });
  const shell = await getTranslations({ locale: lang, namespace: "shell" });
  const body = webAppManifest(languageOf(lang), shell("cvhName"));
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/manifest+json; charset=utf-8" } });
}
