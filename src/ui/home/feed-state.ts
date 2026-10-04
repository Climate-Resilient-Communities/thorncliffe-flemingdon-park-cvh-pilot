import type { FeedV1 } from "@/contracts/feed";
import { isOutdated } from "./feed-poll";

// What home knows about the feed, as a pure state machine (S02.11): `useFeed` turns the network into these events and
// draws `feedView`. Kept free of React and of the clock so the rules below are unit-tested (feed-state.test.ts).

export interface FeedModel {
  /** The state belongs to one language: after a language change the old language's feed is not shown as the new one's. */
  lang: string;
  /** The newest feed seen, or null before the first answer. */
  feed: FeedV1 | null;
  /** When (ms since 1970, the phone's clock) `feed` was fetched; null before the first answer. */
  at: number | null;
  /** The LATEST ask failed (offline, server error, unreadable answer, no answer in time). */
  failed: boolean;
  /** An ask is in flight. */
  checking: boolean;
}

export interface FeedState {
  /** The newest feed seen, or null before the first answer. */
  feed: FeedV1 | null;
  /** The newest answer is not here: the latest ask failed, or the feed on screen is too old and no ask is running. */
  failed: boolean;
  /** When (ms since 1970, the phone's clock) `feed` was fetched; null before the first answer. */
  at: number | null;
  /** How old `feed` is, in ms, while `failed`; null when not failed or there is no feed. */
  staleMs: number | null;
  /** An ask is running now. */
  checking: boolean;
}

export type FeedEvent =
  | { type: "ask"; lang: string }
  /** The latest ask failed. An ask replaced by a newer one is not reported: only the newest ask may change the screen. */
  | { type: "failed"; lang: string }
  | { type: "answered"; lang: string; feed: FeedV1; at: number }
  /** The latest ask was answered with a feed older than one already seen: nothing changes but that the ask is over. */
  | { type: "discarded"; lang: string }
  /**
   * The latest ask failed, but the service worker had kept a copy of the feed, stored at `at` (S02.12). It is shown as what
   * was last loaded, never as current, and only if it is newer than what the screen already has.
   */
  | { type: "kept"; lang: string; feed: FeedV1; at: number };

export const initialModel = (lang: string): FeedModel => ({ lang, feed: null, at: null, failed: false, checking: false });

export function feedReducer(state: FeedModel, event: FeedEvent): FeedModel {
  const model = state.lang === event.lang ? state : initialModel(event.lang);
  switch (event.type) {
    case "ask":
      return model.checking ? model : { ...model, checking: true };
    case "failed":
      return { ...model, failed: true, checking: false };
    case "answered":
      return { ...model, feed: event.feed, at: event.at, failed: false, checking: false };
    case "discarded":
      return { ...model, checking: false };
    case "kept":
      if (model.at !== null && model.at >= event.at) return { ...model, failed: true, checking: false };
      return { ...model, feed: event.feed, at: event.at, failed: true, checking: false };
  }
}

/**
 * What the screen shows at `now`. An answer older than FEED_OUTDATED_MS counts as failed so old data is never shown as
 * current, but not while an ask is running: a resident returning to the tab sees the check, not a failure that may not happen.
 */
export function feedView(model: FeedModel, lang: string, now: number): FeedState {
  const raw = model.lang === lang ? model : initialModel(lang);
  const failed = raw.failed || (isOutdated(raw.at, now) && !raw.checking);
  return { feed: raw.feed, failed, at: raw.at, staleMs: failed && raw.at !== null ? now - raw.at : null, checking: raw.checking };
}

/** After an answer is discarded for being older than one seen, ask again after this long (the next edge copy may be newer). */
export const FEED_RETRY_MS = 5_000;
/** At most this many asks in a row are retried after a discard; then the screen waits for the next 60 second poll. */
export const FEED_MAX_RETRIES = 3;

/** Whether to ask again soon after `discards` answers in a row were discarded. */
export const shouldRetry = (discards: number): boolean => discards >= 1 && discards <= FEED_MAX_RETRIES;
