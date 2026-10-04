"use client";

import { useEffect, useReducer, useState } from "react";
import { FEED_POLL_MS, fetchFeedAnswer } from "./feed-poll";
import { FEED_RETRY_MS, feedReducer, feedView, initialModel, judgeAnswer, shouldRetry, type FeedState } from "./feed-state";

export type { FeedState } from "./feed-state";

// The highest feed_version seen, kept for as long as the page is open: it survives home unmounting and mounting again
// (a visit to another screen and back), so a late answer cannot roll the screen back to before an alert.
let highest = -1;

/**
 * The public feed for a language (AD-17): fetched when home opens, and again every 60 seconds while the page is
 * visible, and straight away when it becomes visible again or the phone gets signal back (the 60 seconds then start over,
 * so the next tick does not cancel that ask). Without signal, a copy the service worker kept is shown as last loaded. The highest `feed_version` seen is kept for as long as the page is open, and an answer with a lower
 * one is discarded and asked for again a few seconds later. An ask that takes longer than FEED_TIMEOUT_MS fails. Only
 * the newest ask may change the screen: one replaced by a newer ask is neither an answer nor a failure. An answer older
 * than FEED_OUTDATED_MS is reported as failed with its age (unless a check is running), so old data is never shown as
 * current. The rules are in feed-state.ts. Nothing about the resident is sent.
 */
export function useFeed(lang: string): FeedState {
  const [model, dispatch] = useReducer(feedReducer, lang, initialModel);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let current = true;
    let latest = new AbortController();
    let discards = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      clearTimeout(retry);
      // A newer ask replaces one still in flight; only the newest ask may change the screen.
      latest.abort();
      const mine = new AbortController();
      latest = mine;
      dispatch({ type: "ask", lang });
      const answer = await fetchFeedAnswer(lang, fetch, mine.signal);
      if (!current || mine.signal.aborted) return;
      setNow(Date.now());
      // The one rule (judgeAnswer): a copy the service worker kept is shown as last loaded, unless older than a feed already seen; the server's answer older than one
      // seen is discarded and asked for again; every other answer raises the highest version seen.
      const verdict = judgeAnswer(highest, answer);
      highest = verdict.highest;
      if (verdict.kind === "discarded") {
        dispatch({ type: "discarded", lang });
        discards += 1;
        if (shouldRetry(discards)) retry = setTimeout(() => void load(), FEED_RETRY_MS);
        return;
      }
      discards = 0;
      if (answer === null || verdict.kind === "failed") dispatch({ type: "failed", lang });
      else if (verdict.kind === "kept") dispatch({ type: "kept", lang, feed: answer.feed, at: answer.keptAt as number });
      else dispatch({ type: "answered", lang, feed: answer.feed, at: Date.now() });
    };

    const poll = () => {
      setNow(Date.now());
      if (document.visibilityState === "visible") void load();
    };

    let timer = setInterval(poll, FEED_POLL_MS);
    // Becoming visible asks at once and starts the 60 seconds over: a tick right after would replace (and cancel) this ask.
    const onVisibility = () => {
      clearInterval(timer);
      timer = setInterval(poll, FEED_POLL_MS);
      poll();
    };

    poll();
    document.addEventListener("visibilitychange", onVisibility);
    // S02.12: signal back asks at once, as becoming visible does.
    window.addEventListener("online", onVisibility);
    return () => {
      current = false;
      latest.abort();
      clearTimeout(retry);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onVisibility);
    };
  }, [lang]);

  return feedView(model, lang, now);
}
