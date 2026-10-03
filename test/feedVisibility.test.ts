// The visibility budget of an approved alert (S04.08, AD-17): a resident with the page open, visible and online, whose polls succeed, sees an
// approved alert within 75 seconds of its approval: the edge keeps an answer for at most 15 seconds and the phone asks every 60. This keeps
// the three constants in step and sweeps the worst case over every phase of the approval against the poll, as a model with a virtual clock;
// e2e/staff/feed-visibility.spec.ts measures the same thing end to end against the real server with the browser's clock controlled.
// A proposed engineering budget, not a service guarantee.
import { describe, expect, it } from "vitest";
import { FEED_EDGE_MAX_AGE_SECONDS, FEED_VISIBILITY_BUDGET_MS } from "@/contracts/feed";
import { FEED_POLL_MS } from "@/ui/home/feed-poll";

const EDGE_MS = FEED_EDGE_MAX_AGE_SECONDS * 1000;

describe("the visibility budget", () => {
  it("is the edge's 15 seconds plus the phone's 60-second poll, 75 seconds", () => {
    expect(FEED_EDGE_MAX_AGE_SECONDS).toBe(15);
    expect(FEED_POLL_MS).toBe(60_000);
    expect(FEED_VISIBILITY_BUDGET_MS).toBe(75_000);
    expect(EDGE_MS + FEED_POLL_MS).toBeLessThanOrEqual(FEED_VISIBILITY_BUDGET_MS);
  });

  /**
   * When a resident that polls at `pollAt + k * FEED_POLL_MS` first sees an alert approved at `approvedAt`, with the edge refreshing its copy
   * from the origin at the instants `edgeFetches` (a copy is served until it is EDGE_MS old; the origin has the alert from `approvedAt` on,
   * because approval expires the feed's tag before the next read).
   */
  function firstSeen(approvedAt: number, pollAt: number, edgeFetches: readonly number[]): number {
    let copy: { at: number; hasAlert: boolean } | undefined;
    const fetches = [...edgeFetches].sort((a, b) => a - b);
    for (let poll = pollAt; poll < approvedAt + 10 * FEED_POLL_MS; poll += FEED_POLL_MS) {
      // Another visitor's request may have refreshed the edge before this poll.
      for (const at of fetches.filter((candidate) => candidate <= poll && (copy === undefined || candidate > copy.at))) copy = { at, hasAlert: at >= approvedAt };
      if (copy === undefined || poll - copy.at >= EDGE_MS) copy = { at: poll, hasAlert: poll >= approvedAt };
      if (copy.hasAlert) return poll;
    }
    throw new Error("never seen");
  }

  it("holds for every phase of the approval against the poll, with the edge refreshed just before the approval (the worst case)", () => {
    let worst = 0;
    for (let approvedAt = 0; approvedAt < 2 * FEED_POLL_MS; approvedAt += 500) {
      for (const pollAt of [0, 7_000, 23_000, 41_000, 59_999]) {
        // The edge copy was made at its latest possible moment before the approval: nothing in it yet, and it lives 15 seconds after.
        const seen = firstSeen(approvedAt, pollAt, [approvedAt - 1]);
        worst = Math.max(worst, seen - approvedAt);
        expect(seen - approvedAt, `approved at ${approvedAt}, polling from ${pollAt}`).toBeLessThanOrEqual(FEED_VISIBILITY_BUDGET_MS);
      }
    }
    // The bound is tight: some phase takes nearly all of it, so the 75 seconds is the real worst case, not a loose one.
    expect(worst).toBeGreaterThan(FEED_VISIBILITY_BUDGET_MS - 2_000);
  });
});
