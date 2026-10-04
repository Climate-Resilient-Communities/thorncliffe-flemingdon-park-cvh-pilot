import { FeedV1, feedPath } from "@/contracts/feed";
import { CACHED_AT_HEADER, FALLBACK_HEADER } from "../offline/protocol";

/** Home asks for the feed again this often while it is visible (AD-17). */
export const FEED_POLL_MS = 60_000;

/** One ask is given up after this long (below the poll interval, so a hanging network is a failure, not a wait). */
export const FEED_TIMEOUT_MS = 20_000;

/** An answer older than this is shown with the "last loaded" note even when no ask has failed. */
export const FEED_OUTDATED_MS = 2 * FEED_POLL_MS;

/** Whether the answer fetched at `at` (ms since 1970) is too old to be shown as current at `now`. */
export function isOutdated(at: number | null, now: number): boolean {
  return at !== null && now - at > FEED_OUTDATED_MS;
}

/**
 * Whether an answer is newer than what the phone has seen. The phone keeps the highest `feed_version` it has seen and
 * discards a lower one (a late answer from a slower edge copy must not roll the screen back to before an alert). An
 * equal version is accepted: it is the same state, and it refreshes the time the screen was last checked.
 */
export function isStale(highestSeen: number, incoming: number): boolean {
  return incoming < highestSeen;
}

/**
 * An answer to an ask: the feed, and `keptAt` when it is not the server's answer but the copy the service worker kept
 * (S02.12: no signal, or the network was too slow), with when that copy was stored. A kept copy is never current.
 */
export type FeedAnswer = { feed: FeedV1; keptAt: number | null };

/**
 * Asks for the feed: `GET /api/feed?lang=` and nothing else, with no credentials, no body and no header of ours, so every
 * resident makes the same request (AD-3). Resolves to the answer, or null when the answer is a failure, not a FeedV1, or
 * has not finished within `timeoutMs` (the request is then cancelled). When `signal` aborts, the request is cancelled too
 * and the result is null; the caller tells that from a failure by checking its own signal.
 */
export async function fetchFeedAnswer(lang: string, fetcher: typeof fetch = fetch, signal?: AbortSignal, timeoutMs = FEED_TIMEOUT_MS): Promise<FeedAnswer | null> {
  const own = new AbortController();
  const cancel = () => own.abort();
  if (signal?.aborted) return null;
  signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, timeoutMs);
  try {
    const response = await fetcher(feedPath(lang), { credentials: "omit", headers: { Accept: "application/json" }, signal: own.signal });
    // The body is always read, so a refusal does not leave the request open.
    const text = await response.text();
    if (!response.ok) return null;
    const parsed = FeedV1.safeParse(JSON.parse(text));
    if (!parsed.success) return null;
    if (response.headers.get(FALLBACK_HEADER) === null) return { feed: parsed.data, keptAt: null };
    const keptAt = Number(response.headers.get(CACHED_AT_HEADER));
    return Number.isFinite(keptAt) && keptAt > 0 ? { feed: parsed.data, keptAt } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

/** The server's feed (fetchFeedAnswer), or null for a failure and for a copy the service worker kept. */
export async function fetchFeed(lang: string, fetcher: typeof fetch = fetch, signal?: AbortSignal, timeoutMs = FEED_TIMEOUT_MS): Promise<FeedV1 | null> {
  const answer = await fetchFeedAnswer(lang, fetcher, signal, timeoutMs);
  return answer && answer.keptAt === null ? answer.feed : null;
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
