import { describe, expect, it } from "vitest";
import { FeedV1, entriesNewestFirst, feedPath } from "./feed";

const feed = (change: Record<string, unknown> = {}) => ({
  v: 1,
  feed_version: 7,
  server_now: "2026-10-01T15:00:00.000Z",
  threads: [],
  places: { buildings: [{ rsn: "4154146", status: "active", verified: false }], neighbourhoods: [{ id: "TP", status: "none", verified: true }] },
  ...change,
});

const ID = "0198a000-0000-7000-8000-000000000001";
const thread = {
  id: ID,
  slug: "power-4-milepost",
  types: ["power"],
  audience: { scope: "buildings", buildings: [{ rsn: "4154146", floors: null }], groups: [], types: ["power"] },
  state: "open",
  valid_until: "2026-10-02T15:00:00.000Z",
  entries: [
    {
      id: ID,
      kind: "ack",
      phase: "problem",
      verified: true,
      attribution: { role: "coordinator" },
      published_at: "2026-10-01T14:00:00.000Z",
      text: { lang: "ur", body: "x", machine: true, model: "m", status: "ok", source_hash: "h" },
      original: { lang: "en", body: "Power is out." },
    },
  ],
};

describe("FeedV1", () => {
  it("accepts a feed with no threads and a status for every place", () => {
    expect(FeedV1.parse(feed())).toMatchObject({ v: 1, feed_version: 7, threads: [] });
  });

  it("accepts a thread with its entry, text and original", () => {
    expect(FeedV1.parse(feed({ threads: [thread] })).threads).toHaveLength(1);
  });

  it.each([
    ["a version that is not 1", { v: 2 }],
    ["a negative feed_version", { feed_version: -1 }],
    ["a fractional feed_version", { feed_version: 1.5 }],
    ["a server_now that is not a time", { server_now: "now" }],
    ["a status that is not one", { places: { buildings: [{ rsn: "1", status: "unknown", verified: true }], neighbourhoods: [] } }],
    ["a building number that is not one", { places: { buildings: [{ rsn: "x", status: "none", verified: true }], neighbourhoods: [] } }],
    ["a place with no verified", { places: { buildings: [{ rsn: "1", status: "none" }], neighbourhoods: [] } }],
    ["a thread with no entries", { threads: [{ ...thread, entries: [] }] }],
    ["a field it does not know", { resident: "x" }],
  ])("rejects %s", (_name, change) => {
    expect(FeedV1.safeParse(feed(change)).success).toBe(false);
  });
});

describe("a thread with several entries (S05.01)", () => {
  const entryAt = (n: number, minute: number, kind = "update", phase: string | undefined = "in_progress") => ({
    ...thread.entries[0],
    id: `0198a000-0000-7000-8000-00000000010${n}`,
    kind,
    ...(phase === undefined ? { phase: undefined } : { phase }),
    published_at: `2026-10-01T14:${String(minute).padStart(2, "0")}:00.000Z`,
    text: { ...thread.entries[0].text, body: `entry ${n}` },
  });
  const ack = entryAt(1, 0, "ack", "problem");
  const first = entryAt(2, 20);
  const second = entryAt(3, 45);

  it("accepts entries in either order, each with its time and its phase, and keeps the earlier ones", () => {
    for (const entries of [[second, first, ack], [ack, first, second]]) {
      const parsed = FeedV1.parse(feed({ threads: [{ ...thread, entries }] }));
      expect(parsed.threads[0].entries).toHaveLength(3);
      expect(entriesNewestFirst(parsed.threads[0].entries).map((entry) => [entry.kind, entry.phase, entry.published_at])).toEqual([
        ["update", "in_progress", "2026-10-01T14:45:00.000Z"],
        ["update", "in_progress", "2026-10-01T14:20:00.000Z"],
        ["ack", "problem", "2026-10-01T14:00:00.000Z"],
      ]);
    }
  });

  it("does not fail the feed over the order: a list out of order still parses, so residents keep the whole feed", () => {
    for (const entries of [[ack, second, first], [first, second, ack]]) {
      expect(FeedV1.safeParse(feed({ threads: [{ ...thread, entries }] })).success).toBe(true);
    }
  });

  it("turns any order newest first, entries at the same instant by id, without changing the input", () => {
    const tied = { ...first, id: "0198a000-0000-7000-8000-0000000001ff", published_at: ack.published_at };
    const input = [ack, tied, second];
    expect(entriesNewestFirst(input).map((entry) => entry.id)).toEqual([second.id, tied.id, ack.id]);
    expect(input.map((entry) => entry.id)).toEqual([ack.id, tied.id, second.id]);
  });
});

describe("feedPath", () => {
  it("asks for one language and nothing else", () => {
    expect(feedPath("zh-Hant")).toBe("/api/feed?lang=zh-Hant");
  });
});
