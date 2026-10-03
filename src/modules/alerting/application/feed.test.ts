import { describe, expect, it } from "vitest";
import { FeedV1 } from "../../../contracts/feed";
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
    expect(await NO_ALERTS_YET.read("en")).toEqual({ threads: [], statuses: { buildings: new Map(), neighbourhoods: new Map() } });
  });
});
