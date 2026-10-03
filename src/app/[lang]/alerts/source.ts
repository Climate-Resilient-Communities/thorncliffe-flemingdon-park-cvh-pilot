// Where the alert pages (R-07, R-28) get their alert (AD-2, AD-17, S04.08). Server only.
//
// An alert page shows what the feed shows, because it reads the feed: the same cached answer for the language (src/app/feedCache.ts), so the
// feed, the alert detail and (E05) the share preview are one state, and nothing the feed would not tell a resident can be read here. The
// feed is built from the resident views only, so a drill is never found; with the launch gate off (RESIDENT_ALERTS_ENABLED, production until
// E05) the feed has no thread and no alert page opens. An unknown address, a drill's, a closed thread's and a gate-off request are all the
// same answer: not found, with no detail.
import { cache } from "react";
import { residentAlertsEnabled, readCachedFeed } from "@/app/feedCache";
import type { FeedThread } from "@/contracts/feed";
import type { LaunchCode } from "@/i18n/languages";

/** The shape of a thread's public slug (`alert_slug_valid`): lowercase letters and digits, 6 to 16. Anything else is not looked for. */
export const SLUG = /^[a-z0-9]{6,16}$/;

export interface LoadedAlert {
  thread: FeedThread;
  /** The feed's own clock, for every "ago" and the comparison with the valid-until. */
  serverNow: Date;
}

/**
 * The open thread with this slug in this language, or null. Called by a page and by its metadata in one request: the answer is shared
 * (`cache`), so a render reads once. A feed that cannot be read throws, and the language's error page answers.
 */
export const loadAlert = cache(async (lang: LaunchCode, slug: string): Promise<LoadedAlert | null> => {
  if (!residentAlertsEnabled() || !SLUG.test(slug)) return null;
  const feed = await readCachedFeed(lang);
  const thread = feed.threads.find((candidate) => candidate.slug === slug);
  return thread ? { thread, serverNow: new Date(feed.server_now) } : null;
});
