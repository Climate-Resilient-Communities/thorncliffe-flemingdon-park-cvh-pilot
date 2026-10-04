// The recipient query equals the matcher (S07.07, AD-7, AR-11): the SQL in `subscriptions` (`recipientStore`) returns exactly the subscribers that
// `matches` (src/contracts/audience.ts) accepts for their profile, on thousands of generated audiences and subscriber profiles, as the app's own role against a real
// database. The generator is seeded, so a failure repeats; it covers topic opt-outs, the fire override, groups, neighbourhood and building audiences, floors, a
// building recorded twice (one row with a floor and one without), a building with no floor, and no building at all.
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { SAFETY_OVERRIDE_TYPES, matches, normaliseAudience, type Audience, type AudienceProfile } from "../../src/contracts/audience";
import { GROUPS } from "../../src/contracts/groups";
import { recipientStore } from "../../src/modules/subscriptions/adapters/recipientStore";
import { createDb, type Db } from "../../src/platform/db";
import { connect, serverUrl } from "./helpers";

const NEIGHBOURHOODS = ["TP", "FP", "QQ"];
const TYPES = ["power", "water", "elevator", "flood", "fire", "other", "heat"];
const LANGS = ["en", "ur", "ps", "tl", "prs", "gu", "ta", "el", "sk", "bn", "hi", "pa", "zh", "es", "fr"];
const STATES = ["active", "reconsent_pending", "retained"];
const BUILDINGS = ["9100001", "9100002", "9100003", "9100004", "9100005", "9100006"];
const FLOORS_PER_BUILDING = 4;
const ROUNDS = 40; // each round deletes the generated subscribers and seeds a fresh set of profiles
const SUBSCRIBERS = 60; // per round, so thousands of profiles in all
const AUDIENCES_PER_ROUND = 100;
const AUDIENCES = ROUNDS * AUDIENCES_PER_ROUND;
const SEED = 20261006;

let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
const madeNeighbourhoods: string[] = [];

/** Seeded generator (mulberry32): the same cases on every run. */
function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T>(items: readonly T[]): T => items[int(items.length)]!;
  const some = <T>(items: readonly T[], chance: number): T[] => items.filter(() => next() < chance);
  return { next, int, pick, some };
}

const floorId = (building: number, floor: number) => `00000000-0000-4000-8000-${String(building).padStart(6, "0")}${String(floor).padStart(6, "0")}`;
const FLOOR_IDS = BUILDINGS.flatMap((_, b) => Array.from({ length: FLOORS_PER_BUILDING }, (__, f) => floorId(b + 1, f + 1)));

interface Generated {
  id: string;
  profile: AudienceProfile;
}

beforeAll(async () => {
  owner = connect(serverUrl());
  await migrate({ sql: owner, log: () => {} });
  const password = randomBytes(18).toString("hex");
  await owner.unsafe(`alter role cvh_app_login password '${password}'`);
  const url = new URL(serverUrl());
  url.username = "cvh_app_login";
  url.password = password;
  appSql = postgres(url.href, { max: 4, onnotice: () => {} });
  app = createDb(url.href);
  for (const [id, fsa] of [["TP", "M4H"], ["FP", "M3C"], ["QQ", "M9Z"]]) {
    const made = await owner`insert into neighbourhood (id, name, fsa) values (${id}, ${`Fixture ${id}`}, ${fsa}) on conflict do nothing returning id`;
    if (made.length > 0) madeNeighbourhoods.push(id);
  }
  for (const [index, rsn] of BUILDINGS.entries()) {
    await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at) values (${rsn}, ${NEIGHBOURHOODS[index % 2]!}, ${`${index} Sample Road`}, 43.7, -79.34, now()) on conflict do nothing`;
    for (let f = 1; f <= FLOORS_PER_BUILDING; f += 1) {
      await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${floorId(index + 1, f)}, ${rsn}, ${String(f)}, ${f}, true) on conflict do nothing`;
    }
  }
  await owner`delete from subscriber where phone like '+1416555%'`;
});

afterAll(async () => {
  await owner`delete from subscriber where phone like '+1416555%'`;
  await owner`delete from building_floor where rsn = any(${BUILDINGS})`;
  await owner`delete from building where rsn = any(${BUILDINGS})`;
  for (const id of madeNeighbourhoods) await owner`delete from neighbourhood where id = ${id}`;
  await app.$client.end({ timeout: 5 });
  await appSql.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

async function insertSubscribers(rng: ReturnType<typeof random>): Promise<Generated[]> {
  await owner`delete from subscriber where phone like '+1416555%'`;
  const made: Generated[] = [];
  for (let i = 0; i < SUBSCRIBERS; i += 1) {
    const id = crypto.randomUUID();
    const neighbourhood = rng.pick(NEIGHBOURHOODS);
    const groups = rng.some(GROUPS, 0.3);
    const muted = rng.some(TYPES, 0.25);
    const rows: { rsn: string; floor: string | null }[] = [];
    const rowCount = rng.pick([0, 0, 1, 1, 2, 3, 4]);
    for (let r = 0; r < rowCount; r += 1) {
      const b = rng.int(BUILDINGS.length);
      rows.push({ rsn: BUILDINGS[b]!, floor: rng.next() < 0.35 ? null : floorId(b + 1, rng.int(FLOORS_PER_BUILDING) + 1) });
    }
    await owner`insert into subscriber (id, phone, lang, neighbourhood_id, groups, consent_version, started_by, retention_state)
      values (${id}, ${`+1416555${String(i).padStart(4, "0")}`}, ${rng.pick(LANGS)}, ${neighbourhood}, ${groups}, '2026-10-01.1', 'web', ${rng.pick(STATES)})`;
    for (const row of rows) await owner`insert into subscriber_place (id, subscriber_id, rsn, floor_id) values (${crypto.randomUUID()}, ${id}, ${row.rsn}, ${row.floor})`;
    for (const topic of muted) await owner`insert into subscriber_topic_optout (subscriber_id, topic) values (${id}, ${topic})`;
    // The profile as AudienceProfile describes it for SMS: one neighbourhood, a place per distinct rsn with its non-null floors.
    const places = [...new Set(rows.map((row) => row.rsn))].map((rsn) => ({
      rsn,
      floors: [...new Set(rows.filter((row) => row.rsn === rsn && row.floor !== null).map((row) => row.floor as string))],
    }));
    made.push({ id, profile: { neighbourhoodIds: [neighbourhood], places, groups, mutedTopics: muted } });
  }
  return made;
}

function audienceOf(rng: ReturnType<typeof random>): Audience {
  const types = rng.pick([["fire"], ["power"], ["power", "water"], ["fire", "other"], ["heat"], ["elevator", "flood", "other"], ["other"]]);
  const groups = rng.next() < 0.6 ? [] : rng.some(GROUPS, 0.5);
  if (rng.next() < 0.3) {
    const ids = rng.some(NEIGHBOURHOODS, 0.5);
    return normaliseAudience({ scope: "neighbourhood", neighbourhood_ids: ids.length > 0 ? ids : [rng.pick(NEIGHBOURHOODS)], groups: groups as Audience["groups"], types });
  }
  const count = rng.int(3) + 1;
  const buildings = Array.from({ length: count }, () => {
    const b = rng.int(BUILDINGS.length);
    const floors = rng.next() < 0.4 ? null : rng.some(FLOOR_IDS.filter((_, i) => Math.floor(i / FLOORS_PER_BUILDING) === b || rng.next() < 0.05), 0.4);
    return { rsn: BUILDINGS[b]!, floors: floors === null || floors.length === 0 ? null : floors };
  });
  return normaliseAudience({ scope: "buildings", buildings, groups: groups as Audience["groups"], types });
}

describe("the recipient query is the matcher", () => {
  it("returns exactly the receiving subscribers `matches` accepts, on thousands of generated audiences and profiles", async () => {
    const profileRng = random(SEED);
    const rng = random(SEED + 1);
    let matchedSomething = 0;
    let matchedNobody = 0;
    let neighbourhoodCases = 0;
    let floorCases = 0;
    let overrideCases = 0;
    let mutedSomeone = 0;
    // The shapes of profile the generator must really have produced, counted over every round.
    const shapes = { mixedFloors: 0, buildingTwice: 0, noPlaces: 0, noFloorOnly: 0, profiles: 0 };
    for (let round = 0; round < ROUNDS; round += 1) {
      const subscribers = await insertSubscribers(profileRng);
      const ownIds = new Set(subscribers.map((subscriber) => subscriber.id));
      for (const { profile } of subscribers) {
        shapes.profiles += 1;
        if (profile.places.some((place) => place.floors.length > 0) && profile.places.some((place) => place.floors.length === 0)) shapes.mixedFloors += 1;
        if (profile.places.length === 0) shapes.noPlaces += 1;
        if (profile.places.some((place) => place.floors.length === 0)) shapes.noFloorOnly += 1;
      }
      const rows = await owner<{ id: string; n: number }[]>`select subscriber_id as id, count(*)::int as n from subscriber_place where subscriber_id = any(${[...ownIds]}) group by subscriber_id, rsn having count(*) > 1`;
      shapes.buildingTwice += rows.length;
      for (let i = 0; i < AUDIENCES_PER_ROUND; i += 1) {
        const audience = audienceOf(rng);
        const expected = subscribers.filter((subscriber) => matches(audience, subscriber.profile)).map((subscriber) => subscriber.id).sort();
        const got = (await recipientStore.reached(app, audience)).map((person) => person.id).filter((id) => ownIds.has(id));
        expect(got, JSON.stringify(audience)).toEqual(expected);
        if (expected.length > 0) matchedSomething += 1;
        else matchedNobody += 1;
        if (audience.scope === "neighbourhood") neighbourhoodCases += 1;
        else if (audience.buildings.some((building) => building.floors !== null)) floorCases += 1;
        if (audience.types.some((type) => SAFETY_OVERRIDE_TYPES.includes(type))) overrideCases += 1;
        if (subscribers.some((subscriber) => subscriber.profile.mutedTopics.length > 0 && audience.types.every((type) => subscriber.profile.mutedTopics.includes(type)))) mutedSomeone += 1;
      }
      // Only this round's profiles are there.
      expect((await owner`select count(*)::int as n from subscriber where phone like '+1416555%'`)[0]!.n).toBe(SUBSCRIBERS);
    }
    // The generator really exercised the rules: both outcomes, both scopes, floors, the fire override and topic opt-outs.
    expect(matchedSomething).toBeGreaterThan(AUDIENCES * 0.3);
    expect(matchedNobody).toBeGreaterThan(5); // 60 profiles per round: an audience nobody fits is rarer than before
    expect(neighbourhoodCases).toBeGreaterThan(500);
    expect(floorCases).toBeGreaterThan(500);
    expect(overrideCases).toBeGreaterThan(500);
    expect(mutedSomeone).toBeGreaterThan(500);
    // ... and every shape of profile, thousands of profiles over.
    expect(shapes.profiles).toBe(ROUNDS * SUBSCRIBERS);
    expect(shapes.profiles).toBeGreaterThanOrEqual(2000);
    expect(shapes.mixedFloors).toBeGreaterThan(100);
    expect(shapes.buildingTwice).toBeGreaterThan(50);
    expect(shapes.noPlaces).toBeGreaterThan(100);
    expect(shapes.noFloorOnly).toBeGreaterThan(100);
  }, 900_000);

  it("locks the same people the count reads, in id order, and they are the matcher's", async () => {
    const subscribers = await owner<{ id: string }[]>`select id from subscriber where phone like '+1416555%'`;
    expect(subscribers.length).toBe(SUBSCRIBERS); // the last round's profiles
    const rng = random(SEED + 2);
    for (let i = 0; i < 60; i += 1) {
      const audience = audienceOf(rng);
      const read = await recipientStore.reached(app, audience);
      const locked = await app.transaction((tx) => recipientStore.reachedForShare(tx, audience));
      expect(locked).toEqual(read);
      expect(locked.map((person) => person.id)).toEqual([...locked.map((person) => person.id)].sort());
    }
  }, 120_000);

  it("adds the earlier entries' subscribers whatever they muted or where they live now, and only those that are still subscribers", async () => {
    const audience: Audience = { scope: "buildings", buildings: [{ rsn: BUILDINGS[0]!, floors: [floorId(1, 1)] }], groups: [], types: ["power"] };
    const [stranger] = await owner<{ id: string }[]>`select s.id from subscriber s where not exists (select 1 from subscriber_place p where p.subscriber_id = s.id) limit 1`;
    const [gone] = [crypto.randomUUID()];
    const own = (await recipientStore.reached(app, audience)).map((person) => person.id);
    expect(own).not.toContain(stranger!.id);
    const withEarlier = (await recipientStore.reached(app, audience, [stranger!.id, gone])).map((person) => person.id);
    expect(withEarlier.sort()).toEqual([...own, stranger!.id].sort());
    expect((await app.transaction((tx) => recipientStore.reachedForShare(tx, audience, [stranger!.id, gone]))).map((person) => person.id).sort()).toEqual(withEarlier);
  });
});
