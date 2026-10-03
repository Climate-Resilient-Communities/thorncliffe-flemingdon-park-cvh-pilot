import { describe, expect, it, vi } from "vitest";
import { monthInterval } from "../domain/reconciliation";
import type { ProviderMessage } from "../domain/smsActuals";
import { listMessages, type MessagePage, type SmsMessageLister } from "./smsListing";

const interval = monthInterval("2026-10");
const sid = (n: number) => `SM${n.toString(16).padStart(32, "0")}`;
const message = (n: number): ProviderMessage => ({ sid: sid(n), direction: "outbound-api", dateSent: new Date("2026-10-15T14:00:00Z"), price: "-0.0079", priceUnit: "USD" });
const limits = { maxPages: 200, deadlineMs: 45_000 };

/** A fake Twilio listing: the pages by their next_page_uri (the first is `first`), recording every request. Never a network call. */
function fakeLister(pages: Record<string, MessagePage | Error>) {
  const requests: string[] = [];
  const lister: SmsMessageLister = {
    async first(range) {
      requests.push(`first ${range.startUtc.toISOString()} ${range.endUtc.toISOString()}`);
      const page = pages.first;
      if (page instanceof Error) throw page;
      return page;
    },
    async next(uri) {
      requests.push(`next ${uri}`);
      const page = pages[uri];
      if (page === undefined) throw new Error(`no such page ${uri}`);
      if (page instanceof Error) throw page;
      return page;
    },
  };
  return { lister, requests };
}

const clockOf = (...instants: number[]) => {
  let at = 0;
  return () => new Date(instants[Math.min(at++, instants.length - 1)] ?? 0);
};

describe("the listing of a reconciliation (S06.08)", () => {
  it("asks for the interval, follows next_page_uri page after page until it is empty, and gathers every message in order", async () => {
    const { lister, requests } = fakeLister({
      first: { messages: [message(1), message(2)], nextPageUri: "/p2" },
      "/p2": { messages: [message(3)], nextPageUri: "/p3" },
      "/p3": { messages: [message(4), message(5)], nextPageUri: null },
    });
    const listing = await listMessages(lister, interval, { now: () => new Date(0), limits });
    expect(listing.kind === "complete" && listing.messages.map((m) => m.sid)).toEqual([sid(1), sid(2), sid(3), sid(4), sid(5)]);
    expect(listing.pages).toBe(3);
    expect(requests).toEqual(["first 2026-10-01T04:00:00.000Z 2026-11-01T04:00:00.000Z", "next /p2", "next /p3"]);
  });

  it("treats an empty next_page_uri as the end", async () => {
    const { lister } = fakeLister({ first: { messages: [message(1)], nextPageUri: "" } });
    expect((await listMessages(lister, interval, { now: () => new Date(0), limits })).kind).toBe("complete");
  });

  it("is a complete listing of nothing for an interval with no messages", async () => {
    const { lister } = fakeLister({ first: { messages: [], nextPageUri: null } });
    expect(await listMessages(lister, interval, { now: () => new Date(0), limits })).toEqual({ kind: "complete", messages: [], pages: 1 });
  });

  it("is failed when the first page cannot be read, and says only the error's name", async () => {
    const failures: unknown[] = [];
    const { lister } = fakeLister({ first: Object.assign(new Error("boom, Authorization: Basic abc"), { name: "MessageListError" }) });
    const listing = await listMessages(lister, interval, { now: () => new Date(0), limits, onFailure: (what) => void failures.push(what) });
    expect(listing).toEqual({ kind: "pending", reason: "listing_failed", pages: 1 });
    expect(failures).toEqual([{ reason: "listing_failed", page: 1, error: "MessageListError" }]);
    expect(JSON.stringify(failures)).not.toContain("Authorization");
  });

  it("is failed when a later page cannot be read: what the earlier pages gave is not a listing", async () => {
    const { lister } = fakeLister({ first: { messages: [message(1)], nextPageUri: "/p2" }, "/p2": new Error("503") });
    expect(await listMessages(lister, interval, { now: () => new Date(0), limits })).toEqual({ kind: "pending", reason: "listing_failed", pages: 2 });
  });

  it("is failed when the next pages come round to one already read (it would never end)", async () => {
    const { lister, requests } = fakeLister({
      first: { messages: [message(1)], nextPageUri: "/p2" },
      "/p2": { messages: [message(2)], nextPageUri: "/p3" },
      "/p3": { messages: [message(3)], nextPageUri: "/p2" },
    });
    const listing = await listMessages(lister, interval, { now: () => new Date(0), limits });
    expect(listing).toMatchObject({ kind: "pending", reason: "listing_failed" });
    expect(requests).toEqual(["first 2026-10-01T04:00:00.000Z 2026-11-01T04:00:00.000Z", "next /p2", "next /p3"]);
  });

  it("is cut short at the page limit while the provider still names a next page", async () => {
    const { lister, requests } = fakeLister({
      first: { messages: [message(1)], nextPageUri: "/p2" },
      "/p2": { messages: [message(2)], nextPageUri: "/p3" },
      "/p3": { messages: [message(3)], nextPageUri: null },
    });
    const listing = await listMessages(lister, interval, { now: () => new Date(0), limits: { maxPages: 2, deadlineMs: 45_000 } });
    expect(listing).toEqual({ kind: "pending", reason: "cut_short", pages: 2 });
    expect(requests).toHaveLength(2);
    // Exactly at the limit with no next page is a complete listing, not a cut-short one.
    const exact = fakeLister({ first: { messages: [message(1)], nextPageUri: "/p2" }, "/p2": { messages: [message(2)], nextPageUri: null } });
    expect((await listMessages(exact.lister, interval, { now: () => new Date(0), limits: { maxPages: 2, deadlineMs: 45_000 } })).kind).toBe("complete");
  });

  it("is cut short when the run's time is used up before the next page is asked for", async () => {
    const { lister, requests } = fakeLister({
      first: { messages: [message(1)], nextPageUri: "/p2" },
      "/p2": { messages: [message(2)], nextPageUri: null },
    });
    const onFailure = vi.fn();
    // The clock reads 0 at the start and 45 seconds when the second page is about to be asked for.
    const listing = await listMessages(lister, interval, { now: clockOf(0, 45_000), limits, onFailure });
    expect(listing).toEqual({ kind: "pending", reason: "cut_short", pages: 1 });
    expect(requests).toHaveLength(1);
    expect(onFailure).toHaveBeenCalledWith({ reason: "cut_short", page: 1, error: "ListingLimit" });
  });

  it("is cut short at the run's deadline when it is given one, whatever the limits say (the time is the whole run's, not this month's)", async () => {
    const { lister, requests } = fakeLister({
      first: { messages: [message(1)], nextPageUri: "/p2" },
      "/p2": { messages: [message(2)], nextPageUri: null },
    });
    // The listing starts 40 seconds into a run whose budget ends at 45: its own limit (45 seconds) would allow 45 more, the run's deadline allows 5.
    const deadlineAt = new Date(45_000);
    const listing = await listMessages(lister, interval, { now: clockOf(40_000, 40_000, 46_000), limits, deadlineAt });
    expect(listing).toEqual({ kind: "pending", reason: "cut_short", pages: 1 });
    expect(requests).toHaveLength(1);
  });

  it("asks for nothing when the run's time is already spent: the month is cut short without a request, and says it read no page", async () => {
    const { lister, requests } = fakeLister({ first: { messages: [message(1)], nextPageUri: null } });
    const onFailure = vi.fn();
    const listing = await listMessages(lister, interval, { now: () => new Date(45_000), limits, deadlineAt: new Date(45_000), onFailure });
    expect(listing).toEqual({ kind: "pending", reason: "cut_short", pages: 0 });
    expect(requests).toEqual([]);
    expect(onFailure).toHaveBeenCalledWith({ reason: "cut_short", page: 0, error: "ListingLimit" });
  });

  it("asks for each page for no longer than the time left in the run", async () => {
    const waits: (number | undefined)[] = [];
    let at = 10_000;
    const lister: SmsMessageLister = {
      async first(_range, options) {
        waits.push(options?.timeoutMs);
        at += 12_000;
        return { messages: [message(1)], nextPageUri: "/p2" };
      },
      async next(_uri, options) {
        waits.push(options?.timeoutMs);
        return { messages: [message(2)], nextPageUri: null };
      },
    };
    // The run began at 0 with 45 seconds; this listing starts at 10 s and its first page takes 12 s.
    const listing = await listMessages(lister, interval, { now: () => new Date(at), limits, deadlineAt: new Date(45_000) });
    expect(listing.kind).toBe("complete");
    expect(waits).toEqual([35_000, 23_000]);
  });

  it("gives a page that the run's own deadline cut off as the time limit (cut short), and any other failure as a failed listing", async () => {
    let at = 0;
    const slow: SmsMessageLister = {
      async first() {
        at = 45_000;
        throw Object.assign(new Error("timed out"), { name: "MessageListError" });
      },
      async next() {
        throw new Error("unreachable");
      },
    };
    const onFailure = vi.fn();
    expect(await listMessages(slow, interval, { now: () => new Date(at), limits, onFailure })).toEqual({ kind: "pending", reason: "cut_short", pages: 1 });
    expect(onFailure).toHaveBeenCalledWith({ reason: "cut_short", page: 1, error: "MessageListError" });

    // The same error well inside the time is a failed listing.
    at = 0;
    const quick: SmsMessageLister = { first: async () => Promise.reject(new Error("503")), next: async () => Promise.reject(new Error("503")) };
    expect(await listMessages(quick, interval, { now: () => new Date(at), limits })).toEqual({ kind: "pending", reason: "listing_failed", pages: 1 });
  });
});
