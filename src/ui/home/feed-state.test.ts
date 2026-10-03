import { describe, expect, it } from "vitest";
import type { FeedV1 } from "@/contracts/feed";
import { FEED_OUTDATED_MS } from "./feed-poll";
import { FEED_MAX_RETRIES, feedReducer, feedView, initialModel, shouldRetry, type FeedEvent, type FeedModel } from "./feed-state";

const feed = (version: number): FeedV1 => ({ v: 1, feed_version: version, server_now: "2026-10-01T15:00:00.000Z", threads: [], places: { buildings: [], neighbourhoods: [] } });
const run = (events: FeedEvent[], from: FeedModel = initialModel("en")) => events.reduce(feedReducer, from);
const T0 = 1_000_000;

describe("feedReducer", () => {
  it("starts with nothing known, no failure and no ask", () => {
    expect(initialModel("en")).toEqual({ lang: "en", feed: null, at: null, failed: false, checking: false });
  });

  it("an ask marks the check as running without failing anything", () => {
    expect(run([{ type: "ask", lang: "en" }])).toMatchObject({ checking: true, failed: false });
  });

  it("an answer replaces the feed, clears a failure and ends the check", () => {
    const model = run([{ type: "ask", lang: "en" }, { type: "failed", lang: "en" }, { type: "ask", lang: "en" }, { type: "answered", lang: "en", feed: feed(3), at: T0 }]);

    expect(model).toEqual({ lang: "en", feed: feed(3), at: T0, failed: false, checking: false });
  });

  it("a failure of the latest ask keeps the feed it has and ends the check", () => {
    const model = run([{ type: "answered", lang: "en", feed: feed(3), at: T0 }, { type: "ask", lang: "en" }, { type: "failed", lang: "en" }]);

    expect(model).toMatchObject({ feed: feed(3), at: T0, failed: true, checking: false });
  });

  it("a newer ask replacing one in flight is not a failure: the page only says it is checking", () => {
    const model = run([{ type: "answered", lang: "en", feed: feed(3), at: T0 }, { type: "ask", lang: "en" }, { type: "ask", lang: "en" }]);

    expect(model).toMatchObject({ failed: false, checking: true });
    expect(feedView(model, "en", T0 + 1000).failed).toBe(false);
  });

  it("a discarded older answer changes nothing but ending the check, and is not a failure", () => {
    const before = run([{ type: "answered", lang: "en", feed: feed(5), at: T0 }, { type: "ask", lang: "en" }]);

    expect(feedReducer(before, { type: "discarded", lang: "en" })).toEqual({ ...before, checking: false });
  });

  it("a language change starts again: the old language's feed is not the new one's", () => {
    const model = run([{ type: "answered", lang: "en", feed: feed(3), at: T0 }, { type: "ask", lang: "ur" }]);

    expect(model).toEqual({ lang: "ur", feed: null, at: null, failed: false, checking: true });
  });
});

describe("feedView", () => {
  const answered = run([{ type: "answered", lang: "en", feed: feed(3), at: T0 }]);

  it("is not failed while the answer is recent", () => {
    expect(feedView(answered, "en", T0 + FEED_OUTDATED_MS)).toMatchObject({ failed: false, staleMs: null });
  });

  it("reports an answer older than the limit as failed, with its age", () => {
    expect(feedView(answered, "en", T0 + FEED_OUTDATED_MS + 1)).toMatchObject({ failed: true, staleMs: FEED_OUTDATED_MS + 1, checking: false });
  });

  it("does not call the feed outdated while a check is running (returning to the tab)", () => {
    const checking = feedReducer(answered, { type: "ask", lang: "en" });

    expect(feedView(checking, "en", T0 + 10 * FEED_OUTDATED_MS)).toMatchObject({ failed: false, staleMs: null, checking: true });
  });

  it("reports the outdated feed as failed again if that check fails, and clears it if the check answers", () => {
    const later = T0 + 10 * FEED_OUTDATED_MS;
    const asked = feedReducer(answered, { type: "ask", lang: "en" });

    expect(feedView(feedReducer(asked, { type: "failed", lang: "en" }), "en", later)).toMatchObject({ failed: true, staleMs: later - T0 });
    expect(feedView(feedReducer(asked, { type: "answered", lang: "en", feed: feed(4), at: later }), "en", later)).toMatchObject({ failed: false, staleMs: null });
  });

  it("keeps a failure on screen, with no age, when there is no feed to be old", () => {
    const failed = run([{ type: "ask", lang: "en" }, { type: "failed", lang: "en" }]);

    expect(feedView(failed, "en", T0)).toMatchObject({ feed: null, failed: true, staleMs: null });
  });

  it("shows nothing of another language's state", () => {
    expect(feedView(answered, "ur", T0)).toEqual({ feed: null, failed: false, at: null, staleMs: null, checking: false });
  });
});

describe("shouldRetry", () => {
  it("asks again after a discarded answer, a few times in a row, then waits for the next poll", () => {
    expect(shouldRetry(0)).toBe(false);
    expect(shouldRetry(1)).toBe(true);
    expect(shouldRetry(FEED_MAX_RETRIES)).toBe(true);
    expect(shouldRetry(FEED_MAX_RETRIES + 1)).toBe(false);
  });
});
