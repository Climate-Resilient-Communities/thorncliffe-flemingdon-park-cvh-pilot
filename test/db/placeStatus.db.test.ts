// The status of each building and neighbourhood (S05.06, AD-19) against a real database, read as the app's own role (cvh_app_login) from the resident views: the feed
// derives it at request time from the status threads, which include threads closed `resolved` in the last 12 hours although they are not in the feed's thread list.
// A drill's thread is inserted DIRECTLY and must give no status; nothing is stored (the `building` table holds facts only).
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { FeedV1 } from "../../src/contracts/feed";
import { createFeed } from "../../src/modules/alerting";
import { createDb, type Db } from "../../src/platform/db";
import { connect, serverUrl } from "./helpers";

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const NOW = new Date("2026-10-03T15:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const TP_RSN = "4154401";
const TP_OTHER = "4154402";
const FP_RSN = "4154403";

const building = (...rsns: string[]) => ({ scope: "buildings", buildings: rsns.map((rsn) => ({ rsn, floors: null })), groups: [], types: ["power"] });
const hood = (...ids: string[]) => ({ scope: "neighbourhood", neighbourhood_ids: ids, groups: [], types: ["power"] });

let owner: ReturnType<typeof connect>;
let app: Db;
let author: string;
let approver: string;
const madeNeighbourhoods: string[] = [];

interface SeedEntry {
  kind?: string;
  phase?: string;
  audience?: object;
  publishedAt?: Date;
  status?: "approved" | "superseded";
  /** The index of the earlier entry this one replaces (a correction). */
  supersedes?: number;
}

async function seedThread(opts: { drill?: boolean; closed?: { reason: string; at: Date }; slug: string; entries: SeedEntry[] }) {
  const alertId = randomUUID();
  await owner.begin(async (tx) => {
    await tx`select set_config('cvh.actor_id', ${author}, true)`;
    await tx`insert into alert (id, is_drill, reported_at, created_by, slug) values (${alertId}, ${opts.drill ?? false}, ${hoursAgo(30)}, ${author}, ${opts.slug})`;
  });
  const ids: string[] = [];
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table alert_entry disable trigger alert_entry_guard");
    for (const [index, entry] of opts.entries.entries()) {
      const id = randomUUID();
      ids.push(id);
      const hash = sha(id);
      const published = entry.publishedAt ?? new Date(hoursAgo(20).getTime() + index * 60_000);
      await tx`insert into alert_entry (id, alert_id, kind, status, author_id, editor_ids, original_text, types, audience, phase, valid_until,
                                         version, content_hash, sms_bodies, submitted_at, approved_by, approved_at, approved_version, approved_hash, web_published_at, supersedes_id)
               values (${id}, ${alertId}, ${entry.kind ?? "ack"}, ${entry.status ?? "approved"}, ${author}, ${[author]}, 'Power is out.', ${["power"]}, ${tx.json((entry.audience ?? building(TP_RSN)) as never)},
                       ${entry.phase ?? "problem"}, ${new Date("2026-10-05T15:00:00Z")}, 1, ${hash}, ${tx.json({ en: { body: "x", encoding: "gsm7", segments: 1 } })},
                       ${published}, ${approver}, ${published}, 1, ${hash}, ${published}, ${entry.supersedes === undefined ? null : ids[entry.supersedes]})`;
    }
    await tx.unsafe("alter table alert_entry enable trigger alert_entry_guard");
  });
  if (opts.closed) {
    // The database stamps `closed_at` with its own clock whatever the caller says (S05.03), so a thread closed in the past is set up with that guard off, as the owner would.
    await owner.begin(async (tx) => {
      await tx.unsafe("alter table alert disable trigger alert_guard");
      await tx`update alert set status = 'closed', closed_reason = ${opts.closed!.reason}, closed_at = ${opts.closed!.at} where id = ${alertId}`;
      await tx.unsafe("alter table alert enable trigger alert_guard");
    });
  }
  return alertId;
}

async function clear() {
  await owner.begin(async (tx) => {
    await tx.unsafe("truncate alert_submit_attempt, delivery, alert_entry_translation, alert_entry, alert");
  });
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
  for (const role of ["author", "approver"]) {
    const id = randomUUID();
    await owner`insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password)
                values (${id}, ${randomUUID()}, ${`ps_${randomBytes(5).toString("hex")}`}, 'Test', ${role}, 'test@example.org', 'coordinator', false)`;
    if (role === "author") author = id;
    else approver = id;
  }
  for (const [id, name, fsa] of [["TP", "Thorncliffe Park", "M4H"], ["FP", "Flemingdon Park", "M3C"]]) {
    if ((await owner`select 1 from neighbourhood where id = ${id}`).length === 0) {
      await owner`insert into neighbourhood (id, name, fsa) values (${id}, ${name}, ${fsa})`;
      madeNeighbourhoods.push(id);
    }
  }
  for (const [rsn, nbhd] of [[TP_RSN, "TP"], [TP_OTHER, "TP"], [FP_RSN, "FP"]]) {
    await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at) values (${rsn}, ${nbhd}, ${`${rsn} Test Dr`}, 43.7, -79.34, now())`;
  }
});

afterAll(async () => {
  await clear();
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    for (const id of [author, approver]) await tx`delete from audit_event where actor_staff_id = ${id}`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
    for (const id of [author, approver]) await tx`delete from staff_account where id = ${id}`;
  });
  for (const rsn of [TP_RSN, TP_OTHER, FP_RSN]) await owner`delete from building where rsn = ${rsn}`;
  for (const id of madeNeighbourhoods) await owner`delete from neighbourhood where id = ${id}`;
  await app?.$client.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

beforeEach(clear);

const read = async (at: Date = NOW) => {
  const answer = await createFeed({ db: app, alertsEnabled: true, now: () => at }).read("en");
  expect(FeedV1.parse(answer)).toEqual(answer);
  const rsn = (id: string) => answer.places.buildings.find((place) => place.rsn === id);
  const nbhd = (id: string) => answer.places.neighbourhoods.find((place) => place.id === id);
  return { answer, rsn, nbhd };
};

describe("the feed's derived place status, read as the app's role", () => {
  it("is none everywhere with no thread", async () => {
    const { answer } = await read();
    expect([...answer.places.buildings, ...answer.places.neighbourhoods].every((place) => place.status === "none" && place.verified)).toBe(true);
  });

  it("gives a building its open thread's phase, and a neighbourhood thread every building and the neighbourhood", async () => {
    await seedThread({ slug: "bldgslug1", entries: [{ audience: building(TP_RSN) }] });
    await seedThread({ slug: "nbhdslug1", entries: [{ audience: hood("FP"), phase: "in_progress" }] });

    const { rsn, nbhd } = await read();

    expect(rsn(TP_RSN)).toEqual({ rsn: TP_RSN, status: "active", verified: true });
    expect(rsn(TP_OTHER)).toMatchObject({ status: "none" });
    expect(rsn(FP_RSN)).toMatchObject({ status: "in_progress" });
    expect(nbhd("FP")).toMatchObject({ status: "in_progress" });
    expect(nbhd("TP")).toMatchObject({ status: "none" });
  });

  it("follows the covering entry: a narrowing update stops the thread covering the building it dropped", async () => {
    await seedThread({
      slug: "narrowslg",
      entries: [{ audience: building(TP_RSN, TP_OTHER) }, { kind: "update", audience: building(TP_RSN), publishedAt: hoursAgo(10) }],
    });

    const { rsn } = await read();

    expect(rsn(TP_RSN)).toMatchObject({ status: "active" });
    expect(rsn(TP_OTHER)).toMatchObject({ status: "none" });
  });

  it("includes a thread closed resolved in the last 12 hours although the feed's thread list does not hold it, and drops it after 12 hours from closing", async () => {
    await seedThread({ slug: "resolvslg", closed: { reason: "resolved", at: hoursAgo(11) }, entries: [{}, { kind: "final", publishedAt: hoursAgo(11) }] });

    const within = await read();
    expect(within.answer.threads).toEqual([]);
    expect(within.rsn(TP_RSN)).toMatchObject({ status: "resolved", verified: true });

    const after = await read(new Date(hoursAgo(11).getTime() + 12 * 3_600_000));
    expect(after.rsn(TP_RSN)).toMatchObject({ status: "none" });
  });

  it("counts the 12 hours from closing time, not from the thread's age", async () => {
    await seedThread({ slug: "oldthread", closed: { reason: "resolved", at: hoursAgo(1) }, entries: [{ publishedAt: hoursAgo(29) }, { kind: "final", publishedAt: hoursAgo(1) }] });
    expect((await read()).rsn(TP_RSN)).toMatchObject({ status: "resolved" });
  });

  it("gives expired and withdrawn threads none, and an open thread beats a resolved one", async () => {
    await seedThread({ slug: "expiredsl", closed: { reason: "expired", at: hoursAgo(1) }, entries: [{ audience: building(TP_OTHER) }] });
    await seedThread({ slug: "withdrwsl", closed: { reason: "withdrawn", at: hoursAgo(1) }, entries: [{ audience: building(TP_OTHER) }] });
    await seedThread({ slug: "resolvslg", closed: { reason: "resolved", at: hoursAgo(1) }, entries: [{}, { kind: "final", publishedAt: hoursAgo(1) }] });
    await seedThread({ slug: "stillopen", entries: [{ phase: "in_progress", publishedAt: hoursAgo(5) }] });

    const { rsn } = await read();

    expect(rsn(TP_OTHER)).toMatchObject({ status: "none" });
    expect(rsn(TP_RSN)).toMatchObject({ status: "in_progress" });
  });

  it("ignores a superseded entry", async () => {
    await seedThread({ slug: "supersede", entries: [{ status: "superseded", phase: "problem" }, { kind: "correction", phase: "in_progress", publishedAt: hoursAgo(10), supersedes: 0 }] });
    expect((await read()).rsn(TP_RSN)).toMatchObject({ status: "in_progress" });
  });

  it("ignores a drill, open or closed resolved, inserted directly", async () => {
    await seedThread({ slug: "drillopen", drill: true, entries: [{}] });
    await seedThread({ slug: "drillshut", drill: true, closed: { reason: "resolved", at: hoursAgo(1) }, entries: [{}, { kind: "final", publishedAt: hoursAgo(1) }] });

    const { rsn } = await read();

    expect(rsn(TP_RSN)).toMatchObject({ status: "none", verified: true });
  });

  it("stores no status: the building table has no status column", async () => {
    const columns = await owner`select column_name from information_schema.columns where table_name = 'building' and column_name ilike '%status%'`;
    expect(columns).toEqual([]);
  });
});
