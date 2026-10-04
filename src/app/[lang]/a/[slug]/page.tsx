import type { Metadata } from "next";
import { alertMetadata, alertScreen } from "../../alerts/alertPage";

// The share landing (A11, S05.08): what `/a/{slug}?l={lang}` answers. src/proxy.ts rewrites that address to this page of the language `l` (English when `l` is missing
// or not ours), so the address in the phone stays the one that was shared and no cookie is set. It is the alert as the feed shows it now (the live alert with any
// correction above the original, or a thread's closed state), never a tailored version, with the Open Graph title and description of the same state in that language. Once it
// has loaded, a phone with a saved language moves to the alert in it. A drill, an unknown address and a thread with no web-published entry are the same 404 as R-07's.
export const dynamicParams = true;
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[lang]/a/[slug]">): Promise<Metadata> {
  const { lang, slug } = await params;
  return alertMetadata(lang, slug);
}

export default async function SharedAlertPage({ params }: PageProps<"/[lang]/a/[slug]">) {
  const { lang, slug } = await params;
  return alertScreen(lang, slug, { followDeviceLanguage: true });
}
