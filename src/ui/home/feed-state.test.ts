import { describe, expect, it } from "vitest";
import type { FeedV1 } from "@/contracts/feed";
import { FEED_OUTDATED_MS } from "./feed-poll";
import { FEED_MAX_RETRIES, feedReducer, feedView, initialModel, judgeAnswer, shouldRetry, type FeedEvent, type FeedModel } from "./feed-state";

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
    expect(feedView(answered, "ur", T0)).toEqual({ feed: null, failed: false, at: null, staleMs: null, checking: false, now: T0 });
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

describe("a copy the service worker kept (S02.12)", () => {
  it("is shown as last loaded at the time it was kept, never as current", () => {
    const model = run([{ type: "ask", lang: "en" }, { type: "kept", lang: "en", feed: feed(4), at: T0 }]);

    expect(model).toEqual({ lang: "en", feed: feed(4), at: T0, failed: true, checking: false });
    expect(feedView(model, "en", T0 + 5_000)).toMatchObject({ feed: feed(4), failed: true, staleMs: 5_000 });
  });

  it("does not replace a feed the screen already has from later", () => {
    const model = run([{ type: "answered", lang: "en", feed: feed(5), at: T0 + 10 }, { type: "ask", lang: "en" }, { type: "kept", lang: "en", feed: feed(4), at: T0 }]);

    expect(model).toMatchObject({ feed: feed(5), at: T0 + 10, failed: true });
  });

  it("gives way to the server's answer as soon as there is one", () => {
    const model = run([{ type: "kept", lang: "en", feed: feed(4), at: T0 }, { type: "ask", lang: "en" }, { type: "answered", lang: "en", feed: feed(6), at: T0 + 99 }]);

    expect(model).toEqual({ lang: "en", feed: feed(6), at: T0 + 99, failed: false, checking: false });
  });
});

describe("feed_version never goes down on a phone (S05.07)", () => {
  const server = (version: number) => ({ feed: feed(version), keptAt: null });
  const kept = (version: number, at = T0) => ({ feed: feed(version), keptAt: at });

  it("judges the server's answers served out of order: the lower ones are discarded, equal and higher ones taken", () => {
    let highest = -1;
    const seen: string[] = [];
    for (const version of [5, 4, 5, 7, 6, 3, 8]) {
      const verdict = judgeAnswer(highest, server(version));
      highest = verdict.highest;
      seen.push(`${version}:${verdict.kind}`);
    }

    expect(seen).toEqual(["5:answered", "4:discarded", "5:answered", "7:answered", "6:discarded", "3:discarded", "8:answered"]);
    expect(highest).toBe(8);
  });

  it("never lets a kept copy older than a feed seen stand in for it, and shows a newer or equal one as last loaded", () => {
    expect(judgeAnswer(9, kept(8))).toEqual({ kind: "failed", highest: 9 });
    expect(judgeAnswer(9, kept(9))).toEqual({ kind: "kept", highest: 9 });
    expect(judgeAnswer(9, kept(10))).toEqual({ kind: "kept", highest: 9 });
    // A copy shown is never what raises the highest: only the server's answer does.
    expect(judgeAnswer(-1, kept(4))).toEqual({ kind: "kept", highest: -1 });
  });

  it("reads no answer as a failure and keeps the highest", () => {
    expect(judgeAnswer(6, null)).toEqual({ kind: "failed", highest: 6 });
  });

  it("keeps the feed on screen when an answer or a kept copy with a lower version reaches the reducer, whatever asked", () => {
    const on = run([{ type: "answered", lang: "en", feed: feed(9), at: T0 }, { type: "ask", lang: "en" }]);

    expect(feedReducer(on, { type: "answered", lang: "en", feed: feed(8), at: T0 + 50 })).toEqual({ lang: "en", feed: feed(9), at: T0, failed: false, checking: false });
    expect(feedReducer(on, { type: "kept", lang: "en", feed: feed(8), at: T0 + 50 })).toMatchObject({ feed: feed(9), at: T0, failed: true, checking: false });
    expect(feedReducer(on, { type: "answered", lang: "en", feed: feed(9), at: T0 + 50 })).toMatchObject({ feed: feed(9), at: T0 + 50 });
  });
});
