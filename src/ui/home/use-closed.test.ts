import { describe, expect, it } from "vitest";
import type { ArchiveV1, FeedV1 } from "@/contracts/feed";
import { anyResolved, archiveLacksResolved } from "./use-closed";

const feed = (status: string): FeedV1 =>
  ({ places: { buildings: [{ rsn: "4154146", status, verified: true }], neighbourhoods: [{ id: "TP", status: "none", verified: true }] } }) as unknown as FeedV1;
const page = (closedAt: string | null, reason = "resolved"): ArchiveV1 =>
  ({ server_now: "2026-10-04T12:00:00.000Z", page: 1, has_more: false, threads: closedAt ? [{ close_reason: reason, closed_at: closedAt }] : [] }) as unknown as ArchiveV1;

describe("anyResolved", () => {
  it("is true only when the feed lists a resolved place", () => {
    expect(anyResolved(null)).toBe(false);
    expect(anyResolved(feed("active"))).toBe(false);
    expect(anyResolved(feed("resolved"))).toBe(true);
  });
});

describe("archiveLacksResolved: an edge copy from before the close", () => {
  it("is true when the feed shows resolved and the page has no recently resolved thread", () => {
    expect(archiveLacksResolved(feed("resolved"), page(null))).toBe(true);
    expect(archiveLacksResolved(feed("resolved"), page("2026-10-03T12:00:00.000Z"))).toBe(true);
    expect(archiveLacksResolved(feed("resolved"), page("2026-10-04T11:30:00.000Z", "expired"))).toBe(true);
  });

  it("is false once the page holds the thread, and when nothing is resolved", () => {
    expect(archiveLacksResolved(feed("resolved"), page("2026-10-04T11:30:00.000Z"))).toBe(false);
    expect(archiveLacksResolved(feed("active"), page(null))).toBe(false);
  });
});
