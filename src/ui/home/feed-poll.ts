import { FeedV1, feedPath } from "@/contracts/feed";

/** Home asks for the feed again this often while it is visible (AD-17). */
export const FEED_POLL_MS = 60_000;

/**
 * Whether an answer is newer than what the phone has seen. The phone keeps the highest `feed_version` it has seen and
 * discards a lower one (a late answer from a slower edge copy must not roll the screen back to before an alert). An
 * equal version is accepted: it is the same state, and it refreshes the time the screen was last checked.
 */
export function isStale(highestSeen: number, incoming: number): boolean {
  return incoming < highestSeen;
}

/**
 * Asks for the feed: `GET /api/feed?lang=` and nothing else, with no credentials, no body and no header of ours, so every
 * resident makes the same request (AD-3). Resolves to the feed, or null when the answer is a failure or not a FeedV1.
 */
export async function fetchFeed(lang: string, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<FeedV1 | null> {
  try {
    const response = await fetcher(feedPath(lang), { credentials: "omit", headers: { Accept: "application/json" }, signal });
    // The body is always read, so a refusal does not leave the request open.
    const text = await response.text();
    if (!response.ok) return null;
    const parsed = FeedV1.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** "just now", "3 minutes ago", "2 hours ago", "1 day ago" in the page language, from the catalog's `time` strings. */
export function agoText(elapsedMs: number, t: Translate): string {
  const minutes = Math.floor(Math.max(0, elapsedMs) / 60_000);
  if (minutes < 1) return t("justNow");
  const unit = (one: string, many: string, n: number) => (n === 1 ? t(one) : t(many, { n }));
  if (minutes < 60) return t("ago", { t: unit("minute", "minutes", minutes) });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("ago", { t: unit("hour", "hours", hours) });
  const days = Math.floor(hours / 24);
  return t("ago", { t: unit("day", "days", days) });
}
