// What the alert's two addresses share (S04.08, S05.08): `/{lang}/alerts/{slug}` (R-07, opened from inside the app) and `/a/{slug}?l={lang}` (the link that is shared,
// answered as `/{l}/a/{slug}` by src/proxy.ts). Both are the alert as the feed shows it now, in the language of the address, with the same metadata; the shared one
// also follows the phone's saved language once it has loaded. Server only.
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AlertDetail, FollowDeviceLanguage, alertView, guidesFor, type Translate, type When911 } from "@/ui/alert";
import { guideView } from "@/modules/directory";
import { loadResidentContent } from "../ready/source";
import { isLaunchCode } from "@/i18n/languages";
import { loadPlace } from "./place";
import { loadAlert } from "./source";

/**
 * The page's metadata: the share preview (Open Graph title and description), in the language of the address, from the thread's current state (S05.02, S05.03, S05.08).
 * It reads the alert through the feed's own cache, so it is never more than the feed's 15 seconds behind it. An address with no alert gives none.
 */
export async function alertMetadata(lang: string, slug: string): Promise<Metadata> {
  if (!isLaunchCode(lang)) return {};
  const loaded = await loadAlert(lang, slug);
  if (!loaded) return {};
  const t = (await getTranslations({ locale: lang })) as unknown as Translate;
  const place = await loadPlace(loaded.thread, lang, t);
  const { preview } = alertView(loaded.thread, { lang, serverNow: loaded.serverNow, t, place });
  return { title: preview.title, description: preview.description, openGraph: { title: preview.title, description: preview.description } };
}

/**
 * When to call 911 for an alert (session 2, #17): the reviewed "when to call 911" line of each guide the alert links to, in the page's
 * language (or English, marked, where the translation is not shown). None when the guides cannot be read: the 911 block still shows.
 */
async function when911For(types: readonly string[], lang: string): Promise<When911[]> {
  const { guides } = await loadResidentContent();
  return guidesFor(types).flatMap((id) => {
    const record = guides.find((guide) => guide.id === id);
    const view = record ? guideView(record, lang) : null;
    return view ? [{ id, text: view.when911.text, unavailable: view.when911.unavailable }] : [];
  });
}

/** The alert page for an address: a 404 with no detail for anything the feed does not carry (unknown, a drill's, no published entry, the launch gate off). */
export async function alertScreen(lang: string, slug: string, options: { followDeviceLanguage?: boolean } = {}) {
  if (!isLaunchCode(lang)) notFound();
  setRequestLocale(lang);
  const loaded = await loadAlert(lang, slug);
  if (!loaded) notFound();

  const t = (await getTranslations({ locale: lang })) as unknown as Translate;
  const place = await loadPlace(loaded.thread, lang, t);
  return (
    <>
      <AlertDetail view={alertView(loaded.thread, { lang, serverNow: loaded.serverNow, t, place })} lang={lang} t={t} when911={await when911For(loaded.thread.types, lang)} />
      {options.followDeviceLanguage === true && <FollowDeviceLanguage lang={lang} slug={slug} />}
    </>
  );
}
