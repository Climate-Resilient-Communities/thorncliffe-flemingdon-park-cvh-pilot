import { describe, expect, it } from "vitest";
import type { Audience } from "@/contracts/audience";
import type { BuildingList } from "@/contracts/buildingList";
import type { FeedThread, FeedV1 } from "@/contracts/feed";
import { homeRows, threadsBehind } from "./home-view";

// The links home and the building page show under a status (S05.06): the open threads of the feed that give it.

const list: BuildingList = {
  v: 1,
  generated_at: "2026-10-01T12:00:00.000Z",
  buildings: [
    { rsn: "100", address: "1 Test St", neighbourhoodId: "TP", neighbourhood: "Thorncliffe Park", floors: [] },
    { rsn: "200", address: "2 Test St", neighbourhoodId: "FP", neighbourhood: "Flemingdon Park", floors: [] },
  ],
};

const id = (n: number) => `0198a000-0000-7000-8000-0000000004${String(n).padStart(2, "0")}`;
const entry = (n: number, over: Partial<FeedThread["entries"][number]> = {}): FeedThread["entries"][number] => ({
  id: id(n),
  kind: "ack",
  phase: "problem",
  verified: true,
  attribution: { role: "hub" },
  published_at: `2026-10-01T1${n}:00:00.000Z`,
  text: { lang: "en", body: "Power is out.", machine: false, model: null, status: "source", source_hash: "a".repeat(64) },
  original: { lang: "en", body: "Power is out." },
  ...over,
});
const buildings = (types: string[], ...rsns: string[]): Audience => ({ scope: "buildings", buildings: rsns.map((rsn) => ({ rsn, floors: null })), groups: [], types });
const hood = (types: string[], ...ids: string[]): Audience => ({ scope: "neighbourhood", neighbourhood_ids: ids, groups: [], types });
const thread = (slug: string, audience: Audience, entries: FeedThread["entries"]): FeedThread => ({
  id: id(50 + slug.charCodeAt(0) - 96),
  slug,
  types: audience.types,
  audience,
  state: "open",
  valid_until: "2026-10-02T15:00:00.000Z",
  entries,
});
const place = { kind: "building" as const, rsn: "100", neighbourhoodId: "TP" };

describe("threadsBehind", () => {
  it("names the open threads that cover the place and whose covering phase gives its status", () => {
    const threads = [
      thread("aaaa", buildings(["power"], "100"), [entry(1)]),
      thread("bbbb", hood(["power", "water"], "TP"), [entry(2)]),
      thread("cccc", buildings(["power"], "200"), [entry(3)]),
      thread("dddd", buildings(["power"], "100"), [entry(4, { phase: "in_progress" })]),
    ];

    expect(threadsBehind(place, "active", threads)).toEqual([
      { slug: "aaaa", types: ["power"] },
      { slug: "bbbb", types: ["power", "water"] },
    ]);
    expect(threadsBehind(place, "in_progress", threads)).toEqual([{ slug: "dddd", types: ["power"] }]);
  });

  it("follows the covering entry: a correction's phase replaces the entry it corrected", () => {
    const corrected = thread("aaaa", buildings(["power"], "100"), [entry(1), entry(2, { kind: "correction", phase: "in_progress", supersedes_id: id(1) })]);

    expect(threadsBehind(place, "active", [corrected])).toEqual([]);
    expect(threadsBehind(place, "in_progress", [corrected])).toHaveLength(1);
  });

  it("names none for resolved or none: the feed holds no closed thread", () => {
    const threads = [thread("aaaa", buildings(["power"], "100"), [entry(1)])];

    expect(threadsBehind(place, "resolved", threads)).toEqual([]);
    expect(threadsBehind(place, "none", threads)).toEqual([]);
  });

  it("covers a neighbourhood only through a neighbourhood audience", () => {
    const threads = [thread("aaaa", buildings(["power"], "100"), [entry(1)]), thread("bbbb", hood(["power"], "TP"), [entry(2)])];

    expect(threadsBehind({ kind: "neighbourhood", id: "TP" }, "active", threads).map((t) => t.slug)).toEqual(["bbbb"]);
  });
});

describe("homeRows with threads behind", () => {
  it("puts them on the rows of the chosen buildings and their neighbourhoods", () => {
    const feed: FeedV1 = {
      v: 1,
      feed_version: 1,
      server_now: "2026-10-01T15:00:00.000Z",
      threads: [thread("bbbb", hood(["power"], "FP"), [entry(2)])],
      places: { buildings: [{ rsn: "200", status: "active", verified: true }], neighbourhoods: [{ id: "FP", status: "active", verified: true }] },
    };

    const rows = homeRows({ chosen: ["200"], list, view: { feed, failed: false } });

    expect(rows.buildings[0].behind.map((t) => t.slug)).toEqual(["bbbb"]);
    expect(rows.neighbourhoods.map((row) => [row.id, row.behind.map((t) => t.slug)])).toEqual([["FP", ["bbbb"]]]);
  });

  it("has none while the feed has not answered", () => {
    const rows = homeRows({ chosen: ["200"], list, view: { feed: null, failed: false } });

    expect(rows.buildings[0].behind).toEqual([]);
  });
});
