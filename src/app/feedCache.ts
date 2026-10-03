// The feed as the app keeps it (AD-17): one read of the alerting module's `FeedV1` per language, in Next's data cache under
// FEED_TAG for FEED_EDGE_MAX_AGE_SECONDS, shared by everything that tells a resident about an alert: `/api/feed` and the alert
// pages (R-07, R-28). They read the same entry, so the feed, the alert detail and (E05) the share preview show the same state by
// construction, and an alert page costs the database nothing more than the feed does.
//
// A publisher expires the tag after its transaction commits (`revalidateTag(FEED_TAG, { expire: 0 })`, src/contracts/feed.ts), which
// makes the next read here wait for a fresh answer. Server only.
import { unstable_cache } from "next/cache";
import { FEED_EDGE_MAX_AGE_SECONDS, FEED_TAG, type FeedV1 } from "@/contracts/feed";
import type { LangCode } from "@/contracts/lang";
import { getEnv } from "@/platform/config/env";
import type { FeedThread } from "@/contracts/feed";
import { readClosedAlert, readClosedSlugs, readFeed } from "./api/feed/source";

/**
 * Whether residents are told about any alert in this deployment (RESIDENT_ALERTS_ENABLED, the launch gate: off in production until
 * E05 is released). Every resident route and API that would show an alert asks here and shows nothing when it is off.
 */
export const residentAlertsEnabled = (): boolean => getEnv().residentAlertsEnabled;

/**
 * The key of an entry: the language, the launch gate and the deployment's own address. Next's data cache outlives a deployment and is shared by
 * every process that reads the same build folder, and a stale entry is served once while a fresh one is built. So an answer made with the gate on
 * (a preview, a development run) is never what a deployment with the gate off reads, and the answer of one environment (a preview, another
 * deployment, the page tests' servers, each at an address of its own) is never taken for another's: that would show alerts that belong to
 * another database. In production the address is constant, so every instance of the deployment still shares one entry.
 */
const keyOf = (lang: LangCode): string[] => ["feed", lang, residentAlertsEnabled() ? "alerts-on" : "alerts-off", getEnv().publicBaseUrl];

/** The feed for one language, from the data cache. A failure is thrown out of the cached function, so it is never cached. */
export const readCachedFeed = (lang: LangCode): Promise<FeedV1> =>
  unstable_cache(() => readFeed(lang), keyOf(lang), { revalidate: FEED_EDGE_MAX_AGE_SECONDS, tags: [FEED_TAG] })();

const closedSlugs = (): Promise<string[]> =>
  unstable_cache(() => readClosedSlugs(), ["closed-slugs", residentAlertsEnabled() ? "alerts-on" : "alerts-off", getEnv().publicBaseUrl], { revalidate: FEED_EDGE_MAX_AGE_SECONDS, tags: [FEED_TAG] })();

/**
 * The thread with this slug that closed (S05.03), from the data cache under the feed's tag, so the approval that closes a thread expires it with the feed. The closed
 * threads' slugs are one cached read: a slug that is not among them is answered null with no further read, so a public address cannot cost the database a read per
 * guess. `serverNow` is an ISO string (the cache holds JSON).
 */
export async function readCachedClosedAlert(lang: LangCode, slug: string): Promise<{ thread: FeedThread; serverNow: string } | null> {
  if (!(await closedSlugs()).includes(slug)) return null;
  return unstable_cache(
    async () => {
      const found = await readClosedAlert(lang, slug);
      return found ? { thread: found.thread, serverNow: found.serverNow.toISOString() } : null;
    },
    ["closed-alert", lang, slug, residentAlertsEnabled() ? "alerts-on" : "alerts-off", getEnv().publicBaseUrl],
    { revalidate: FEED_EDGE_MAX_AGE_SECONDS, tags: [FEED_TAG] },
  )();
}
