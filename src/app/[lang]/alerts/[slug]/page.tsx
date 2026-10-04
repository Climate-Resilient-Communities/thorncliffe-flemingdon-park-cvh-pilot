import type { Metadata } from "next";
import { alertMetadata, alertScreen } from "../alertPage";

// An alert (R-07, S04.08) is public and the same for every visitor, read from the feed (../source.ts): never built ahead, because the alerts come
// from the database, which a build does not reach, and never kept as a page, because it must show the state the feed shows (a correction, an
// update, the end of the alert) within the feed's own 15 seconds. An address nobody has an alert at is a 404 inside the shell, which a shared
// cache must not keep (the default for a dynamic page, no-store, applies to it).
export const dynamicParams = true;
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[lang]/alerts/[slug]">): Promise<Metadata> {
  const { lang, slug } = await params;
  return alertMetadata(lang, slug);
}

/**
 * The alert (R-07): its types, its words in the resident's language (or the English with the note that says so), who sent it and whether the Hub
 * checked it, when it was posted and how long it is valid, the 911 block, the guide that matches opened at "During", and the whole thread.
 */
export default async function AlertPage({ params }: PageProps<"/[lang]/alerts/[slug]">) {
  const { lang, slug } = await params;
  return alertScreen(lang, slug);
}
