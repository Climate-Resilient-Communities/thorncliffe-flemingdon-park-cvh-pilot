import { describe, expect, it, vi } from "vitest";
import { FEED_OUTDATED_MS, FEED_POLL_MS, FEED_TIMEOUT_MS, agoText, fetchFeed, isOutdated, isStale } from "./feed-poll";

const feed = { v: 1, feed_version: 4, server_now: "2026-10-01T15:00:00.000Z", threads: [], places: { buildings: [], neighbourhoods: [{ id: "TP", status: "none", verified: true }] } };
const answer = (body: unknown, status = 200) => vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("isStale", () => {
  it("discards an answer with a lower feed_version than the highest seen, and takes an equal or higher one", () => {
    expect(isStale(5, 4)).toBe(true);
    expect(isStale(5, 5)).toBe(false);
    expect(isStale(5, 6)).toBe(false);
  });

  it("takes the first answer, whatever its version", () => {
    expect(isStale(-1, 0)).toBe(false);
  });
});

describe("isOutdated", () => {
  it("is true once the answer is older than twice the poll interval, and never before the first answer", () => {
    expect(FEED_OUTDATED_MS).toBe(2 * FEED_POLL_MS);
    expect(isOutdated(null, 10_000_000)).toBe(false);
    expect(isOutdated(1_000, 1_000 + FEED_OUTDATED_MS)).toBe(false);
    expect(isOutdated(1_000, 1_000 + FEED_OUTDATED_MS + 1)).toBe(true);
  });
});

describe("fetchFeed", () => {
  it("asks for the feed in the page language with nothing about the resident: no credentials, no body, no header of ours", async () => {
    const fetcher = answer(feed);

    expect(await fetchFeed("ur", fetcher)).toEqual(feed);

    expect(fetcher).toHaveBeenCalledWith("/api/feed?lang=ur", { credentials: "omit", headers: { Accept: "application/json" }, signal: expect.any(AbortSignal) });
  });

  it.each([
    ["an error status", answer({ error: { code: "FEED_UNAVAILABLE", message_key: "feed.unavailable" } }, 503)],
    ["a feed of the wrong shape", answer({ ...feed, v: 2 })],
    ["something that is not JSON", answer("<html>")],
    ["a failed request", vi.fn(async () => Promise.reject(new TypeError("offline"))) as unknown as typeof fetch],
  ])("is null for %s", async (_name, fetcher) => {
    expect(await fetchFeed("en", fetcher)).toBeNull();
  });

  it("polls every 60 seconds", () => {
    expect(FEED_POLL_MS).toBe(60_000);
  });

  it("gives up on an ask that never answers, after a time below the poll interval, and reads that as a failure", async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | null | undefined;
      const hanging = vi.fn((_url: unknown, init?: RequestInit) => {
        signal = init?.signal;
        return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
      }) as unknown as typeof fetch;
      const result = fetchFeed("en", hanging, new AbortController().signal);

      await vi.advanceTimersByTimeAsync(FEED_TIMEOUT_MS - 1);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      expect(await result).toBeNull();
      expect(signal?.aborted).toBe(true);
      expect(FEED_TIMEOUT_MS).toBeLessThan(FEED_POLL_MS);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels the request when the caller's signal aborts, and never starts one for a signal already aborted", async () => {
    const caller = new AbortController();
    let seen: AbortSignal | null | undefined;
    const fetcher = vi.fn((_url: unknown, init?: RequestInit) => {
      seen = init?.signal;
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    }) as unknown as typeof fetch;
    const result = fetchFeed("en", fetcher, caller.signal);
    caller.abort();

    expect(await result).toBeNull();
    expect(seen?.aborted).toBe(true);
    const again = vi.fn() as unknown as typeof fetch;
    expect(await fetchFeed("en", again, caller.signal)).toBeNull();
    expect(again).not.toHaveBeenCalled();
  });
});

describe("agoText", () => {
  const t = (key: string, values?: Record<string, string | number>) => (values ? `${key}(${Object.entries(values).map(([k, v]) => `${k}=${v}`).join(",")})` : key);

  it.each([
    [0, "justNow"],
    [59_000, "justNow"],
    [60_000, "ago(t=minute)"],
    [5 * 60_000, "ago(t=minutes(n=5))"],
    [60 * 60_000, "ago(t=hour)"],
    [3 * 60 * 60_000, "ago(t=hours(n=3))"],
    [24 * 60 * 60_000, "ago(t=day)"],
    [3 * 24 * 60 * 60_000, "ago(t=days(n=3))"],
    [-5000, "justNow"],
  ])("%d ms is %s", (elapsed, expected) => {
    expect(agoText(elapsed, t)).toBe(expected);
  });
});
