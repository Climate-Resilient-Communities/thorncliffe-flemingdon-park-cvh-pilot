"use client";

import { useEffect, useState } from "react";
import type { FeedV1 } from "@/contracts/feed";
import { FEED_POLL_MS, fetchFeed, isOutdated, isStale } from "./feed-poll";

export interface FeedState {
  /** The newest feed seen, or null before the first answer. */
  feed: FeedV1 | null;
  /** The last ask failed (offline, server error, unreadable answer). The newest feed seen, if any, is still in `feed`. */
  failed: boolean;
  /** When (ms since 1970, the phone's clock) `feed` was fetched; null before the first answer. */
  at: number | null;
  /** How old `feed` was, in ms, when the last ask failed; null when the last ask did not fail or there is no feed. */
  staleMs: number | null;
}

const INITIAL: FeedState = { feed: null, failed: false, at: null, staleMs: null };

// The highest feed_version seen, kept for as long as the page is open: it survives home unmounting and mounting again
// (a visit to another screen and back), so a late answer cannot roll the screen back to before an alert.
let highest = -1;

/**
 * The public feed for a language (AD-17): fetched when home opens, and again every 60 seconds while the page is
 * visible, and straight away when it becomes visible again. The highest `feed_version` seen is kept for as long as the
 * page is open, and an answer with a lower one is discarded. An ask that takes longer than FEED_TIMEOUT_MS fails, an ask
 * replaced by a newer one while still in flight counts as a failure, and an answer older than FEED_OUTDATED_MS is
 * reported as failed with its age, so old data is never shown as current. Nothing about the resident is sent.
 */
export function useFeed(lang: string): FeedState {
  // The state belongs to one language: after a language change the old language's feed is not shown as the new one's.
  const [kept, setState] = useState<{ lang: string; state: FeedState }>({ lang, state: INITIAL });
  const [now, setNow] = useState(() => Date.now());
  const raw = kept.lang === lang ? kept.state : INITIAL;
  const state: FeedState = isOutdated(raw.at, now)
    ? { ...raw, failed: true, staleMs: raw.at === null ? null : now - raw.at }
    : raw;

  useEffect(() => {
    let current = true;
    let latest = new AbortController();
    let inFlight = false;

    const load = async () => {
      // A newer ask replaces one still in flight; only the newest ask may change the screen.
      const superseded = inFlight;
      latest.abort();
      const mine = new AbortController();
      latest = mine;
      inFlight = true;
      if (superseded) markFailed();
      const feed = await fetchFeed(lang, fetch, mine.signal);
      if (!current || mine.signal.aborted) return;
      inFlight = false;
      if (feed === null) {
        markFailed();
        return;
      }
      if (isStale(highest, feed.feed_version)) return;
      highest = feed.feed_version;
      setState({ lang, state: { feed, failed: false, at: Date.now(), staleMs: null } });
    };

    // The newest answer is not here yet, or never came: the screen says so, and keeps the feed it has.
    const markFailed = () => {
      const now = Date.now();
      setNow(now);
      setState((previous) => {
        const before = previous.lang === lang ? previous.state : INITIAL;
        return { lang, state: { ...before, failed: true, staleMs: before.at === null ? null : now - before.at } };
      });
    };

    const visible = () => document.visibilityState === "visible";
    const poll = () => {
      setNow(Date.now());
      if (visible()) void load();
    };

    poll();
    const timer = setInterval(poll, FEED_POLL_MS);
    document.addEventListener("visibilitychange", poll);
    return () => {
      current = false;
      latest.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [lang]);

  return state;
}
