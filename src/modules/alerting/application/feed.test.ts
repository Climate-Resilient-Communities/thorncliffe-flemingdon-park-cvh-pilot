import { describe, expect, it } from "vitest";
import { FeedV1 } from "../../../contracts/feed";
import type { StatusThread } from "../domain/status";
import { createFeedReader, NO_ALERTS_YET, type FeedAlerts } from "./feed";

const NOW = new Date("2026-10-01T15:00:00Z");
const places = async () => ({ buildings: ["4154146", "4154159"], neighbourhoods: ["TP", "FP"] });

describe("createFeedReader", () => {
  it("before any alert is published, answers a valid FeedV1: no threads, every building and neighbourhood at none", async () => {
    const reader = createFeedReader({ places, version: async () => 0, now: () => NOW });

    const feed = await reader.read("en");

    expect(FeedV1.parse(feed)).toEqual(feed);
    expect(feed.threads).toEqual([]);
    expect([...feed.places.buildings, ...feed.places.neighbourhoods].map((place) => place.status)).toEqual(["none", "none", "none", "none"]);
    expect(feed.feed_version).toBe(0);
  });

  it("reads the version from the database when it is not given one, and says it needs the database otherwise", async () => {
    await expect(createFeedReader({ places, now: () => NOW }).read("en")).rejects.toThrow(/needs the database/);
  });

  it("asks the alerts for the language it was asked for, and uses what they answer", async () => {
    const asked: string[] = [];
    const alerts: FeedAlerts = {
      read: async (lang) => {
        asked.push(lang);
        return { threads: [], statuses: { buildings: new Map([["4154146", { status: "active" as const, verified: true }]]), neighbourhoods: new Map() } };
      },
    };

    const feed = await createFeedReader({ places, version: async () => 9, alerts, now: () => NOW }).read("ur");

    expect(asked).toEqual(["ur"]);
    expect(feed.feed_version).toBe(9);
    expect(feed.places.buildings.map((place) => place.status)).toEqual(["active", "none"]);
  });

  it("has an empty alert source until S04.08 supplies one", async () => {
    expect(await NO_ALERTS_YET.read("en")).toEqual({ threads: [] });
  });

  describe("derived status (S05.06)", () => {
    const audience = { scope: "buildings" as const, buildings: [{ rsn: "4154146", floors: null }], groups: [], types: ["power"] };
    const statusThread = (over: Partial<StatusThread> = {}): StatusThread => ({
      id: "t1",
      slug: "kbcdfghj",
      state: "open",
      closeReason: null,
      closedAt: null,
      entries: [{ id: "e1", kind: "ack", phase: "problem", verified: false, superseded: false, publishedAt: new Date("2026-10-01T14:00:00Z"), audience }],
      ...over,
    });

    it("derives every place's status at request time from the status threads, with `now` as the feed's server_now", async () => {
      const asked: Date[] = [];
      const alerts: FeedAlerts = {
        read: async () => ({ threads: [] }),
        readStatusThreads: async (now) => {
          asked.push(now);
          return [statusThread()];
        },
      };

      const feed = await createFeedReader({ places, version: async () => 1, alerts, now: () => NOW }).read("en");

      expect(asked).toEqual([NOW]);
      expect(FeedV1.parse(feed)).toEqual(feed);
      expect(feed.server_now).toBe(NOW.toISOString());
      expect(feed.places.buildings).toEqual([
        { rsn: "4154146", status: "active", verified: false },
        { rsn: "4154159", status: "none", verified: true },
      ]);
      expect(feed.places.neighbourhoods.map((place) => place.status)).toEqual(["none", "none"]);
    });

    it("gives a thread closed resolved 11 hours ago status resolved though it is not in the feed's thread list, and none a minute after the 12th hour", async () => {
      const closed = statusThread({ state: "closed", closeReason: "resolved", closedAt: new Date(NOW.getTime() - 11 * 3_600_000) });
      const alerts: FeedAlerts = { read: async () => ({ threads: [] }), readStatusThreads: async () => [closed] };

      const within = await createFeedReader({ places, version: async () => 1, alerts, now: () => NOW }).read("en");
      const after = await createFeedReader({ places, version: async () => 1, alerts, now: () => new Date(NOW.getTime() + 61 * 60_000) }).read("en");

      expect(within.threads).toEqual([]);
      expect(within.places.buildings[0]).toMatchObject({ status: "resolved" });
      expect(after.places.buildings[0]).toMatchObject({ status: "none" });
    });

    it("covers the buildings of a neighbourhood through the neighbourhoods the places say they are in", async () => {
      const wide = { scope: "neighbourhood" as const, neighbourhood_ids: ["TP"], groups: [], types: ["power"] };
      const alerts: FeedAlerts = {
        read: async () => ({ threads: [] }),
        readStatusThreads: async () => [statusThread({ entries: [{ ...statusThread().entries[0], phase: "in_progress", audience: wide }] })],
      };
      const withHoods = async () => ({ ...(await places()), neighbourhoodOf: { "4154146": "TP", "4154159": "FP" } });

      const feed = await createFeedReader({ places: withHoods, version: async () => 1, alerts, now: () => NOW }).read("en");

      expect(feed.places.buildings.map((place) => place.status)).toEqual(["in_progress", "none"]);
      expect(feed.places.neighbourhoods.map((place) => [place.id, place.status])).toEqual([["TP", "in_progress"], ["FP", "none"]]);
    });
  });
});
