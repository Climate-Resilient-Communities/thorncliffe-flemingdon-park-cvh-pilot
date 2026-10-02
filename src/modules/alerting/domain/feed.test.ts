import { describe, expect, it } from "vitest";
import { FeedV1 } from "../../../contracts/feed";
import { buildFeed, type PlaceState } from "./feed";

const NOW = new Date("2026-10-01T15:00:00Z");
const none = { buildings: new Map<string, PlaceState>(), neighbourhoods: new Map<string, PlaceState>() };

describe("buildFeed", () => {
  it("with no threads, lists every building and neighbourhood at status none and is a valid FeedV1", () => {
    const feed = buildFeed({ feedVersion: 0, now: NOW, threads: [], places: { buildings: ["4154146", "4154159"], neighbourhoods: ["TP", "FP"] }, statuses: none });

    expect(FeedV1.parse(feed)).toEqual(feed);
    expect(feed).toMatchObject({ v: 1, feed_version: 0, server_now: "2026-10-01T15:00:00.000Z", threads: [] });
    expect(feed.places.buildings).toEqual([
      { rsn: "4154146", status: "none", verified: true },
      { rsn: "4154159", status: "none", verified: true },
    ]);
    expect(feed.places.neighbourhoods.map(({ id, status }) => [id, status])).toEqual([["TP", "none"], ["FP", "none"]]);
  });

  it("carries the version it was given, so a phone can tell a newer answer from an older one", () => {
    expect(buildFeed({ feedVersion: 41, now: NOW, threads: [], places: { buildings: [], neighbourhoods: [] }, statuses: none }).feed_version).toBe(41);
  });

  it("uses the status it is given for a place and none for every other", () => {
    const feed = buildFeed({
      feedVersion: 3,
      now: NOW,
      threads: [],
      places: { buildings: ["1", "2"], neighbourhoods: ["TP"] },
      statuses: { buildings: new Map([["2", { status: "active", verified: false }]]), neighbourhoods: new Map() },
    });

    expect(feed.places.buildings).toEqual([
      { rsn: "1", status: "none", verified: true },
      { rsn: "2", status: "active", verified: false },
    ]);
  });
});
