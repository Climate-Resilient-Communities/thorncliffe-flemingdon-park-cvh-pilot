// The feed's alerts (S04.08, the FeedAlerts port of S02.11) as the module's public interface wires them: the launch gate
// (RESIDENT_ALERTS_ENABLED) in front of everything, and the local fixture file that stands in for the database in the page tests.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FeedV1, type FeedThread } from "../../contracts/feed";
import { createFeed, readFeedFixtureFile, type FeedAlerts } from "./index";

const ID = "0198a000-0000-7000-8000-000000000001";
const places = async () => ({ buildings: ["4154146"], neighbourhoods: ["TP"] });
const NOW = new Date("2026-10-01T15:00:00Z");

const thread: FeedThread = {
  id: ID,
  slug: "kbcdfghj",
  types: ["power"],
  audience: { scope: "neighbourhood", neighbourhood_ids: ["TP"], groups: [], types: ["power"] },
  state: "open",
  valid_until: "2026-10-02T15:00:00.000Z",
  entries: [
    {
      id: ID,
      kind: "ack",
      phase: "problem",
      verified: true,
      attribution: { role: "hub" },
      published_at: "2026-10-01T14:00:00.000Z",
      text: { lang: "en", body: "Power is out.", machine: false, model: null, status: "source", source_hash: "h" },
      original: { lang: "en", body: "Power is out." },
    },
  ],
};
const alerts: FeedAlerts = { read: async () => ({ threads: [thread], statuses: { buildings: new Map(), neighbourhoods: new Map() } }) };

const feed = (wiring: Partial<Parameters<typeof createFeed>[0]>) => createFeed({ places, version: async () => 4, now: () => NOW, ...wiring }).read("en");

describe("the launch gate in front of the feed's alerts", () => {
  it("tells residents about the alerts it is given when RESIDENT_ALERTS_ENABLED is on", async () => {
    const answer = await feed({ alerts, alertsEnabled: true });

    expect(answer.threads).toEqual([thread]);
    expect(FeedV1.parse(answer)).toEqual(answer);
  });

  it("tells them nothing when it is off, whatever alerts are wired, and still answers a whole feed (the version, the places)", async () => {
    const answer = await feed({ alerts, alertsEnabled: false });

    expect(answer.threads).toEqual([]);
    expect(answer.feed_version).toBe(4);
    expect(answer.places.buildings).toEqual([{ rsn: "4154146", status: "none", verified: true }]);
    expect(FeedV1.parse(answer)).toEqual(answer);
  });

  it("is off when nobody says it is on: a feed wired without the gate fails closed", async () => {
    expect((await feed({ alerts })).threads).toEqual([]);
    expect((await feed({ alerts, alertsEnabled: undefined })).threads).toEqual([]);
  });

  it("never reads the alerts while the gate is off, not even to throw them away", async () => {
    let reads = 0;
    const counting: FeedAlerts = { read: async (lang) => (reads++, alerts.read(lang)) };

    await feed({ alerts: counting, alertsEnabled: false });

    expect(reads).toBe(0);
    await feed({ alerts: counting, alertsEnabled: true });
    expect(reads).toBe(1);
  });

  it("with the gate on and nothing wired (no database, no fixture) lists no thread rather than failing", async () => {
    expect((await feed({ alertsEnabled: true })).threads).toEqual([]);
  });
});

describe("the fixture file of the page tests (CVH_FAKE_FEED_FILE)", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  const file = (content: unknown) => {
    dir = mkdtempSync(path.join(tmpdir(), "feed-fixture-"));
    const target = path.join(dir, "feed.json");
    writeFileSync(target, JSON.stringify(content));
    return target;
  };

  const sourceHash = "a".repeat(64);
  const fixture = (version = 5) => ({
    feed_version: version,
    server_now: "2026-10-01T15:30:00.000Z",
    threads: [
      {
        id: ID,
        slug: "kbcdfghj",
        entries: [
          {
            id: ID,
            kind: "ack",
            phase: "problem",
            types: ["power"],
            audience: thread.audience,
            valid_until: "2026-10-02T15:00:00.000Z",
            original_text: "Power is out.",
            published_at: "2026-10-01T14:00:00.000Z",
            verified: true,
            translations: {
              ur: { body: "بجلی بند ہے۔", machine: true, model: "m1", status: "translated", source_hash: sourceHash },
              ps: { body: "Power is out.", machine: false, model: null, status: "fallback_en", source_hash: sourceHash },
            },
          },
        ],
      },
    ],
  });

  it("serves its threads through the same assembly as the database's rows: each language's text, the fallback, the English original", async () => {
    const { alerts: fake, version } = readFeedFixtureFile(file(fixture()));

    expect(version()).toBe(5);
    expect(readFeedFixtureFile(file(fixture())).now()).toEqual(new Date("2026-10-01T15:30:00.000Z"));
    const [ur] = (await fake.read("ur")).threads;
    expect(ur.entries[0].text).toEqual({ lang: "ur", body: "بجلی بند ہے۔", machine: true, model: "m1", status: "ok", source_hash: sourceHash });
    const [ps] = (await fake.read("ps")).threads;
    expect(ps.entries[0].text).toMatchObject({ lang: "ps", body: "Power is out.", status: "fallback_en", machine: false });
    const [en] = (await fake.read("en")).threads;
    expect(en.entries[0].text).toMatchObject({ lang: "en", status: "source" });
    expect(en.entries[0].original).toEqual({ lang: "en", body: "Power is out." });
    // A language the fixture has no text for is a fallback, as in the database.
    expect((await fake.read("ta")).threads[0].entries[0].text.status).toBe("fallback_en");
  });

  it("is read again on every call, so a test that rewrites the file changes the next answer", async () => {
    const target = file(fixture(5));
    const fake = readFeedFixtureFile(target);
    expect(fake.version()).toBe(5);

    writeFileSync(target, JSON.stringify(fixture(6)));

    expect(fake.version()).toBe(6);
  });

  it("refuses a file that is not a fixture rather than showing half of it", async () => {
    const fake = readFeedFixtureFile(file({ feed_version: -1, threads: [] }));

    await expect(fake.alerts.read("en")).rejects.toThrow();
    expect(() => fake.version()).toThrow();
  });
});
