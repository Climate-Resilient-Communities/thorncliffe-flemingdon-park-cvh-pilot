// The public feed (S02.11, AD-17) against a real database, read as the app's own role (cvh_app_login): FeedV1 from the
// feed_version row and the places there are, with every building and neighbourhood at status none while no alert has
// been published (S04.08 supplies the alerts), the same whoever asks.
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { FeedV1 } from "../../src/contracts/feed";
import { createFeed } from "../../src/modules/alerting";
import { createDb, type Db } from "../../src/platform/db";
import { connect, serverUrl } from "./helpers";

let owner: ReturnType<typeof connect>;
let app: Db;

async function clear() {
  await owner.unsafe("truncate building_floor, building, neighbourhood cascade");
  await owner`update feed_version set version = 0 where id = 1`;
}

beforeAll(async () => {
  owner = connect(serverUrl());
  await migrate({ sql: owner, log: () => {} });
  const password = randomBytes(18).toString("hex");
  await owner.unsafe(`alter role cvh_app_login password '${password}'`);
  const url = new URL(serverUrl());
  url.username = "cvh_app_login";
  url.password = password;
  app = createDb(url.href);
});

afterAll(async () => {
  await clear();
  await app?.$client.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

beforeEach(clear);

async function seed() {
  await owner`insert into neighbourhood (id, name, fsa) values ('TP', 'Thorncliffe Park', 'M4H'), ('FP', 'Flemingdon Park', 'M3C')`;
  for (const [rsn, nbhd, address] of [["200", "TP", "9 Beta Rd"], ["100", "TP", "1 Alpha Rd"], ["300", "FP", "5 Gamma Ave"]]) {
    await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at) values (${rsn}, ${nbhd}, ${address}, 43.7, -79.34, now())`;
  }
}

describe("the public feed", () => {
  it("before any alert is published: no threads, and every building and neighbourhood at status none, as the app's role", async () => {
    await seed();

    const feed = await createFeed({ db: app, now: () => new Date("2026-10-01T15:00:00Z") }).read("en");

    expect(FeedV1.parse(feed)).toEqual(feed);
    expect(feed.threads).toEqual([]);
    expect(feed.places.buildings).toEqual([
      { rsn: "100", status: "none", verified: true },
      { rsn: "200", status: "none", verified: true },
      { rsn: "300", status: "none", verified: true },
    ]);
    expect(feed.places.neighbourhoods).toEqual([
      { id: "FP", status: "none", verified: true },
      { id: "TP", status: "none", verified: true },
    ]);
  });

  it("carries the feed_version the database holds, and a later answer carries a higher one after a web-visible change", async () => {
    await seed();
    const feed = createFeed({ db: app });

    expect((await feed.read("en")).feed_version).toBe(0);
    await owner`update feed_version set version = version + 1 where id = 1`;
    expect((await feed.read("en")).feed_version).toBe(1);
  });

  it("is the same for every language, bar nothing a language changes while there are no threads", async () => {
    await seed();
    const feed = createFeed({ db: app, now: () => new Date("2026-10-01T15:00:00Z") });

    expect(await feed.read("ur")).toEqual(await feed.read("en"));
  });

  it("is a valid feed with no buildings at all, before the register is loaded", async () => {
    const feed = await createFeed({ db: app }).read("en");

    expect(FeedV1.parse(feed).places).toEqual({ buildings: [], neighbourhoods: [] });
  });
});
