// The round counts against a real database (S08.09; E08 definitions "Round tally", "Closed stub", "Changed location", "Marks"), as the app's own role
// (cvh_app_login), composed as the app composes them: checkins' requests (src/app/checkins.ts: reply 3, menu 1's move, the edit page's change), E07's
// deletion (subscriptions' `createNumberDeletion`, with checkins' port), the marks (S08.07), the close through alerting's expire job (S08.08's
// `closeRound`), the handling of an escalation, the purge job's own SQL, and "Check-in rounds" (src/app/staff/rounds: its loaders, and the page itself
// called through its real guard as each person). Every number is fictional (555-01xx) and nothing reaches Twilio.
//  - the tally: a row made counts one `requested`; a mark, a mark sent again and a changed mark count nothing until the row leaves its round, which counts
//    its latest mark once (else `withdrawn` or `unmarked`): a withdrawal, a change of where the resident lives, a deletion (E07's, or a subscriber row
//    deleted outside it, through the foreign key's cascade: S08.09's trigger), a close; a kept row's handling and purge, and a stub's deletion, count
//    nothing again. Each is counted in the transaction that moves the row (rolled back, nothing is counted), and after the close, at every place,
//    `requested` is the sum of the outcomes;
//  - the live counts during the round come from the rows as they are now (the Hub's view and "My round"), not from the tally;
//  - the page, as a Coordinator, a Director and an Admin: the counts by building and floor and never a phone number; an Ambassador is refused;
//  - the pilot measures (S09.05's `checkin_round_count`): a closed round's tally by thread, building and floor, nothing of an open one, no identifier.
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { createRoundReads } from "../../src/app/staff/ambassador/round/load";
import { loadRoundProgress } from "../../src/app/staff/rounds/load";
import { CHECKIN_CONSENT_VERSION } from "../../src/contracts/checkin";
import { createAlertExpiry, roundThreads } from "../../src/modules/alerting";
import {
  closeRound,
  countsByPlace,
  createCheckinRequests,
  createEscalationHandling,
  createMarks,
  roundTallies,
  stillInRound,
  type CheckinRequests,
  type Marks,
  type PlaceCounts,
} from "../../src/modules/checkins";
import { createAssignments } from "../../src/modules/identity";
import { createDeliveryQueue } from "../../src/modules/messaging";
import { floorsOfBuilding } from "../../src/modules/places";
import { checkinRequestStore, createNumberDeletion } from "../../src/modules/subscriptions";
import { createDb, type Db, type DbExecutor } from "../../src/platform/db";
import { deliveryFixtures } from "./deliveryFixtures";
import { connect, serverUrl } from "./helpers";

/** The staff surface's session lookup and database, for the page's test: the session is the one the test gives (its guard and policy are the real ones). */
const wired = vi.hoisted(() => ({ db: null as unknown, session: null as unknown }));
vi.mock("../../src/app/staff/identity", () => ({
  identityConfigured: () => true,
  requestAuthSessions: async () => ({}),
  staffAuth: () => ({ currentSession: async () => wired.session }),
  identity: () => ({}),
}));
vi.mock("../../src/app/staff/scope", async () => {
  const { createAssignments: assignmentsOn } = await import("../../src/modules/identity");
  const { floorsOfBuilding: floorsOf } = await import("../../src/modules/places");
  return { assignmentsOf: (session: { staffId: string }) => assignmentsOn({ db: wired.db as Db, floors: { floorsOf } }).assignmentsOf(session.staffId) };
});
vi.mock("../../src/app/staff/rounds/load", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/app/staff/rounds/load")>();
  return {
    ...real,
    loadRounds: () => real.loadRounds(wired.db as Db),
    loadRoundProgress: (db?: Db, now?: Date) => real.loadRoundProgress(db ?? (wired.db as Db), now),
  };
});
// The page's 15-second reload (S06.09's AutoRefresh) asks for the router; drawn on the server here, it is never started.
vi.mock("next/navigation", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/navigation")>()), useRouter: () => ({ refresh: () => {} }) }));

// Count Street (Thorncliffe Park) has 1, with floors 1 to 3, and 3, with floor 1; an Ambassador covers both whole buildings.
const RSN = "9809001";
const RSN_B = "9809002";
const floorId = (index: number) => `01900000-0000-7000-8000-0098090${String(index).padStart(5, "0")}`;
const [F1, F2, F3, B1] = [1, 2, 3, 4].map(floorId) as [string, string, string, string];
const FLOOR_NAMES = new Map([
  [F1, "1"],
  [F2, "2"],
  [F3, "3"],
  [B1, "B1"],
]);
const VERSION = "2026-10-02.1";
const HOUR = 3_600_000;

let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
let fixtures: ReturnType<typeof deliveryFixtures>;
let marks: Marks;
let requests: CheckinRequests;
let auditBaseline = 0;
const madeNeighbourhoods: string[] = [];
const staffIds: string[] = [];

type Role = "ambassador" | "coordinator" | "director" | "admin";
interface Person {
  staffId: string;
  role: Role;
}

/** A staff account; an Ambassador covers both buildings whole. */
async function person(role: Role): Promise<Person> {
  const id = randomUUID();
  await owner`insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password, factor_enrolled_at)
              values (${id}, ${randomUUID()}, ${`rc${randomBytes(5).toString("hex")}`}, 'Amina', ${role}, 'someone@example.org', ${role}, false, ${role === "admin" ? new Date() : null})`;
  staffIds.push(id);
  if (role === "ambassador") {
    for (const rsn of [RSN, RSN_B]) await owner`insert into ambassador_assignment (staff_id, rsn, all_floors, assigned_by) values (${id}, ${rsn}, true, ${id})`;
  }
  return { staffId: id, role };
}

let phoneSerial = 110;
/** A subscriber asking for a check-in where she lives (that place saved), with a fictional number. */
async function requester(floor: string, rsn: string = floor === B1 ? RSN_B : RSN): Promise<{ id: string; phone: string }> {
  const id = randomUUID();
  const phone = `+1416555${String((phoneSerial += 1)).padStart(4, "0")}`;
  await owner`insert into subscriber (id, phone, lang, neighbourhood_id, groups, consent_version, started_by, checkin_method, checkin_consent_version, where_i_live_rsn, where_i_live_floor_id)
              values (${id}, ${phone}, 'en', 'TP', '{}', ${VERSION}, 'web', 'call', ${CHECKIN_CONSENT_VERSION}, ${rsn}, ${floor})`;
  await owner`insert into subscriber_place (id, subscriber_id, rsn, floor_id) values (${randomUUID()}, ${id}, ${rsn}, ${floor})`;
  return { id, phone };
}

/** An open heat round for the whole of Thorncliffe Park (`overdue`: past its valid-until, so the expire job closes it), each requester's row made as an approval makes it. */
async function round(people: { id: string }[], options: { overdue?: boolean } = {}): Promise<{ alertId: string; refs: string[] }> {
  const validUntil = new Date(Date.now() + (options.overdue ? -HOUR : 2 * HOUR));
  const { alertId } = await fixtures.entry("approved", { types: ["heat"], kind: "update", validUntil });
  const refs: string[] = [];
  for (const subscriber of people) refs.push(await joinRound(alertId, subscriber.id));
  return { alertId, refs };
}

/** The requester's row in the round, as an approval (or `joinActiveRounds`) makes it: its `round_ref`. */
async function joinRound(alertId: string, subscriberId: string): Promise<string> {
  const [request] = await owner`select where_i_live_rsn as rsn, where_i_live_floor_id as floor from subscriber where id = ${subscriberId}`;
  const [row] = await appSql`insert into checkin (id, alert_id, subscriber_id, rsn, floor_id, method) values (${randomUUID()}, ${alertId}, ${subscriberId}, ${request!.rsn}, ${request!.floor}, 'call') returning round_ref`;
  return row!.round_ref as string;
}

const mark = (who: Person, roundRef: string, status: "done" | "not_reached" | "needs_help", markId: string = randomUUID()) => marks.mark({ staffId: who.staffId }, { markId, roundRef, status });
const withdraw = (subscriberId: string) => app.transaction((tx) => requests.withdrawRequest(subscriberId, tx));
const expire = () => createAlertExpiry({ db: app, finalText: () => "This alert has expired without a further update." }).run();
const deletion = () => createNumberDeletion({ skipRecipientDeliveries: (tx, recipient) => createDeliveryQueue().skipRecipientDeliveries(tx, recipient), checkins: requests });
const rowOf = async (roundRef: string) =>
  (await owner`select subscriber_id, status, outcome, tallied_at is not null as tallied, closed_at is not null as closed from checkin where round_ref = ${roundRef}`)[0] ?? null;

const nonZero = (counts: PlaceCounts) => Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
/** The thread's tally by floor (checkins' own reader, as the Hub reads it), read through `executor` (a transaction reads what it counted). */
async function tallyOf(alertId: string, executor: DbExecutor = app): Promise<Record<string, Partial<PlaceCounts>>> {
  return Object.fromEntries(countsByPlace(await roundTallies(executor, [alertId])).map((place) => [FLOOR_NAMES.get(place.floorId) ?? place.floorId, nonZero(place.counts)]));
}
/** At every place of the thread, the requests that have no outcome. */
async function stillInRoundOf(alertId: string): Promise<Record<string, number>> {
  return Object.fromEntries(countsByPlace(await roundTallies(app, [alertId])).map((place) => [FLOOR_NAMES.get(place.floorId) ?? place.floorId, stillInRound(place.counts)]));
}

/** Moves a row's tally or close back in time (the row's guard, which keeps a tallied row and a stub as they are, is off for the fixture only). */
const backdate = (roundRef: string, column: "tallied_at" | "closed_at", ago: string) =>
  owner.begin(async (tx) => {
    await tx.unsafe("alter table checkin disable trigger checkin_update_guard");
    await tx.unsafe(`update checkin set ${column} = now() - interval '${ago}' where round_ref = '${roundRef}'`);
    await tx.unsafe("alter table checkin enable trigger checkin_update_guard");
  });
const purgeJob = async () => {
  const [job] = await owner`select command from cron.job where jobname = 'checkins-purge-stubs'`;
  await owner.unsafe(job!.command as string);
};

/** Runs `work` in a transaction of the app, reads the tally there, and rolls the transaction back. */
class RolledBack extends Error {}
async function inRolledBackTransaction(alertId: string, work: (tx: Parameters<Parameters<Db["transaction"]>[0]>[0]) => Promise<unknown>) {
  let seen: Record<string, Partial<PlaceCounts>> = {};
  await expect(
    app.transaction(async (tx) => {
      await work(tx);
      seen = await tallyOf(alertId, tx);
      throw new RolledBack();
    }),
  ).rejects.toBeInstanceOf(RolledBack);
  return seen;
}

beforeAll(async () => {
  owner = connect(serverUrl());
  await migrate({ sql: owner, log: () => {} });
  const password = randomBytes(18).toString("hex");
  await owner.unsafe(`alter role cvh_app_login password '${password}'`);
  const url = new URL(serverUrl());
  url.username = "cvh_app_login";
  url.password = password;
  appSql = postgres(url.href, { max: 6, onnotice: () => {} });
  app = createDb(url.href);
  wired.db = app;
  fixtures = deliveryFixtures(owner);
  marks = createMarks({ db: app });
  const coverage = createAssignments({ db: app, floors: { floorsOf: floorsOfBuilding } });
  requests = createCheckinRequests({ requests: checkinRequestStore(), threads: roundThreads, coversFloor: (rsn, floor, executor) => coverage.coversFloor(rsn, floor, executor) });
  [{ max: auditBaseline }] = await owner`select coalesce(max(id), 0)::int as max from audit_event`;
  if ((await owner`select 1 from neighbourhood where id = 'TP'`).length === 0) {
    await owner`insert into neighbourhood (id, name, fsa) values ('TP', 'Thorncliffe Park', 'M4H')`;
    madeNeighbourhoods.push("TP");
  }
  await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at) values
                (${RSN}, 'TP', '1 Count Street', 43.7, -79.34, now()), (${RSN_B}, 'TP', '3 Count Street', 43.7, -79.34, now()) on conflict do nothing`;
  for (const [index, id] of [F1, F2, F3].entries()) {
    await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${id}, ${RSN}, ${String(index + 1)}, ${index + 1}, true) on conflict do nothing`;
  }
  await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${B1}, ${RSN_B}, '1', 1, true) on conflict do nothing`;
});

async function resetAll() {
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await tx`delete from audit_event where id > ${auditBaseline}`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
  });
  await owner`delete from checkin_escalation`;
  // The expire job's system finals are no fixture's: the threads go whole, as the expiry tests clear them.
  await owner.unsafe("truncate checkin_tally, checkin, alert_submit_attempt, delivery, alert_entry_translation, alert_entry, alert");
  await owner`delete from subscriber`;
  await owner`delete from ambassador_assignment where rsn in ${owner([RSN, RSN_B])}`;
  await fixtures.cleanup();
  for (const id of staffIds.splice(0)) await owner`delete from staff_account where id = ${id}`;
}

beforeEach(resetAll);

afterAll(async () => {
  await resetAll();
  await owner`delete from building_floor where rsn in ${owner([RSN, RSN_B])}`;
  await owner`delete from building where rsn in ${owner([RSN, RSN_B])}`;
  for (const id of madeNeighbourhoods) await owner`delete from neighbourhood where id = ${id}`;
  await app.$client.end({ timeout: 5 });
  await appSql.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

describe("the round tally: each row counted once, when it leaves its round (E08 'Round tally')", () => {
  it("counts nothing for a mark, a mark sent again or a changed mark (done, then needs help); the close counts each row's latest mark once", async () => {
    const ambassador = await person("ambassador");
    const people = [await requester(F1), await requester(F1), await requester(F2)];
    const { alertId, refs } = await round(people, { overdue: true });
    expect(await tallyOf(alertId)).toEqual({ "1": { requested: 2 }, "2": { requested: 1 } });

    const resent = randomUUID();
    expect(await mark(ambassador, refs[0]!, "done", resent)).toEqual({ ok: true, outcome: "marked" });
    expect(await mark(ambassador, refs[0]!, "done", resent)).toEqual({ ok: true, outcome: "already" });
    expect(await mark(ambassador, refs[1]!, "done")).toEqual({ ok: true, outcome: "marked" });
    expect(await mark(ambassador, refs[1]!, "needs_help")).toEqual({ ok: true, outcome: "marked" });
    expect(await tallyOf(alertId)).toEqual({ "1": { requested: 2 }, "2": { requested: 1 } });

    expect(await expire()).toMatchObject({ closed: 1 });
    expect(await tallyOf(alertId)).toEqual({ "1": { requested: 2, done: 1, needs_help: 1 }, "2": { requested: 1, unmarked: 1 } });
    // The mark sent again after the close is still the same mark: nothing changes.
    expect(await mark(ambassador, refs[0]!, "done", resent)).toEqual({ ok: true, outcome: "already" });
    expect(await tallyOf(alertId)).toEqual({ "1": { requested: 2, done: 1, needs_help: 1 }, "2": { requested: 1, unmarked: 1 } });
    expect(await stillInRoundOf(alertId)).toEqual({ "1": 0, "2": 0 });
  });

  it("counts a withdrawal after a mark as the mark, and one with no mark as withdrawn, once; the close adds nothing for them", async () => {
    const ambassador = await person("ambassador");
    const [marked, unmarked] = [await requester(F1), await requester(F1)];
    const { alertId, refs } = await round([marked, unmarked], { overdue: true });
    await mark(ambassador, refs[0]!, "done");

    expect(await withdraw(marked.id)).toBe("withdrawn");
    expect(await withdraw(unmarked.id)).toBe("withdrawn");
    expect(await withdraw(unmarked.id)).toBe("none");
    expect(await rowOf(refs[0]!)).toMatchObject({ subscriber_id: null, status: "done", outcome: "done", closed: true });
    expect(await tallyOf(alertId)).toEqual({ "1": { requested: 2, done: 1, withdrawn: 1 } });

    await expire();
    expect(await tallyOf(alertId)).toEqual({ "1": { requested: 2, done: 1, withdrawn: 1 } });
    expect(await stillInRoundOf(alertId)).toEqual({ "1": 0 });
  });

  it("counts a change of where the resident lives as withdrawn where she lived, and her request asked again on her new floor as a new request there", async () => {
    await person("ambassador");
    const [byText, onThePage] = [await requester(F1), await requester(F1)];
    const { alertId } = await round([byText, onThePage], { overdue: true });

    // Menu 1: she moved to floor 2 of the same building (the places that replace her saved ones).
    expect(await app.transaction((tx) => requests.locationChanging(byText.id, [{ rsn: RSN, floorId: F2 }], tx))).toBe("withdrawn");
    // The edit page: her place is now floor 3, and she asks again there with the consent (joining the open round at once).
    await owner`insert into subscriber_place (id, subscriber_id, rsn, floor_id) values (${randomUUID()}, ${onThePage.id}, ${RSN}, ${F3})`;
    const done = await app.transaction((tx) =>
      requests.changeRequest(onThePage.id, { places: [{ rsn: RSN, floorId: F3 }], request: { rsn: RSN, floorId: F3, method: "text", consentVersion: CHECKIN_CONSENT_VERSION } }, tx),
    );
    expect(done).toEqual({ withdrawn: false, answer: "requested" });
    expect(await tallyOf(alertId)).toEqual({ "1": { requested: 2, withdrawn: 2 }, "3": { requested: 1 } });

    await expire();
    expect(await tallyOf(alertId)).toEqual({ "1": { requested: 2, withdrawn: 2 }, "3": { requested: 1, unmarked: 1 } });
    expect(await stillInRoundOf(alertId)).toEqual({ "1": 0, "3": 0 });
  });

  it("counts a deletion during the round once, as the mark or withdrawn; a subscriber row deleted outside the app's deletion counts too (S08.09)", async () => {
    const ambassador = await person("ambassador");
    const people = [await requester(F1), await requester(F2), await requester(F2), await requester(F3)];
    const { alertId, refs } = await round(people, { overdue: true });
    await mark(ambassador, refs[1]!, "not_reached");
    await mark(ambassador, refs[3]!, "needs_help");

    // STOP's deletion (E07's, with checkins' port): the rows become stubs tallied in its transaction, then the subscriber is gone.
    for (const subscriber of [people[0]!, people[1]!]) await app.transaction((tx) => deletion().deleteNumber(tx, subscriber.phone));
    expect(await rowOf(refs[0]!)).toMatchObject({ subscriber_id: null, outcome: "withdrawn", closed: true });
    expect(await rowOf(refs[1]!)).toMatchObject({ subscriber_id: null, outcome: "not_reached", closed: true });
    // The foreign key's backstop: a subscriber deleted without checkins' port (no app path does it) takes her rows with her, still counted once.
    await owner`delete from subscriber where id = ${people[2]!.id}`;
    await owner`delete from subscriber where id = ${people[3]!.id}`;
    expect(await rowOf(refs[2]!)).toBeNull();
    expect(await tallyOf(alertId)).toEqual({ "1": { requested: 1, withdrawn: 1 }, "2": { requested: 2, not_reached: 1, withdrawn: 1 }, "3": { requested: 1, needs_help: 1 } });

    await expire();
    expect(await stillInRoundOf(alertId)).toEqual({ "1": 0, "2": 0, "3": 0 });
  });

  it("counts a kept row at the close only: its handling, its purge into a stub, the stub's deletion and a deletion after the close add nothing", async () => {
    const [ambassador, admin] = [await person("ambassador"), await person("admin")];
    const people = [await requester(F1), await requester(F2), await requester(F3)];
    const { alertId, refs } = await round(people, { overdue: true });
    for (const ref of refs) await mark(ambassador, ref, "not_reached");
    await expire();
    const atClose = { "1": { requested: 1, not_reached: 1 }, "2": { requested: 1, not_reached: 1 }, "3": { requested: 1, not_reached: 1 } };
    expect(await tallyOf(alertId)).toEqual(atClose);
    for (const ref of refs) expect(await rowOf(ref)).toMatchObject({ tallied: true, closed: false });

    // Floor 1: the Hub handles it (the row becomes a stub). Floor 2: 24 hours pass (the purge job makes it a stub, then deletes it 2 hours later).
    // Floor 3: she stops texts (E07's deletion closes a kept row too).
    const [escalation] = await owner`select id from checkin_escalation where round_ref = ${refs[0]!}`;
    expect(await createEscalationHandling({ db: app }).handle({ actorStaffId: admin.staffId, escalationId: escalation!.id as string, note: "Reached her." })).toEqual({
      kind: "handled",
      rowClosed: true,
    });
    await backdate(refs[1]!, "tallied_at", "25 hours");
    await purgeJob();
    expect(await rowOf(refs[1]!)).toMatchObject({ subscriber_id: null, closed: true });
    await app.transaction((tx) => deletion().deleteNumber(tx, people[2]!.phone));
    expect(await rowOf(refs[2]!)).toMatchObject({ subscriber_id: null, closed: true });
    expect(await tallyOf(alertId)).toEqual(atClose);

    await backdate(refs[1]!, "closed_at", "2 hours 1 minute");
    await purgeJob();
    expect(await rowOf(refs[1]!)).toBeNull();
    expect(await tallyOf(alertId)).toEqual(atClose);
    expect(await stillInRoundOf(alertId)).toEqual({ "1": 0, "2": 0, "3": 0 });
  });

  it("counts each change in the transaction that makes it: rolled back, nothing is counted", async () => {
    const ambassador = await person("ambassador");
    const people = [await requester(F1), await requester(F1), await requester(F2)];
    const { alertId, refs } = await round(people.slice(0, 2));
    await mark(ambassador, refs[1]!, "needs_help");
    const before = await tallyOf(alertId);
    expect(before).toEqual({ "1": { requested: 2 } });

    // A row made (an approval's), a withdrawal, a deletion and the close: each seen counted inside its own transaction, and gone with it.
    expect(
      await inRolledBackTransaction(alertId, (tx) =>
        tx.execute(sql`insert into checkin (id, alert_id, subscriber_id, rsn, floor_id, method) values (${randomUUID()}, ${alertId}, ${people[2]!.id}, ${RSN}, ${F2}, 'call')`),
      ),
    ).toEqual({ "1": { requested: 2 }, "2": { requested: 1 } });
    expect(await inRolledBackTransaction(alertId, (tx) => requests.withdrawRequest(people[0]!.id, tx))).toEqual({ "1": { requested: 2, withdrawn: 1 } });
    expect(await inRolledBackTransaction(alertId, (tx) => deletion().deleteNumber(tx, people[1]!.phone))).toEqual({ "1": { requested: 2, needs_help: 1 } });
    expect(await inRolledBackTransaction(alertId, (tx) => closeRound(tx, alertId))).toEqual({ "1": { requested: 2, unmarked: 1, needs_help: 1 } });
    expect(await tallyOf(alertId)).toEqual(before);
    for (const ref of refs) expect(await rowOf(ref)).toMatchObject({ tallied: false, closed: false });
  });

  it("after the close, at every place, has as many outcomes as requests, whatever happened during the round", async () => {
    const ambassador = await person("ambassador");
    const people = await Promise.all([F1, F1, F1, F2, F2, F3, F3, B1, B1].map((floor) => requester(floor)));
    const { alertId, refs } = await round(people, { overdue: true });
    const resent = randomUUID();
    await mark(ambassador, refs[0]!, "done", resent);
    await mark(ambassador, refs[0]!, "done", resent);
    await mark(ambassador, refs[1]!, "done");
    await mark(ambassador, refs[1]!, "needs_help");
    await mark(ambassador, refs[3]!, "not_reached");
    await withdraw(people[3]!.id);
    await app.transaction((tx) => requests.locationChanging(people[5]!.id, [{ rsn: RSN, floorId: F1 }], tx));
    await app.transaction((tx) => deletion().deleteNumber(tx, people[7]!.phone));
    await mark(ambassador, refs[8]!, "not_reached");
    await expire();
    // Kept for the Hub (not reached on 3 Count Street), then purged 24 hours later: nothing more.
    await backdate(refs[8]!, "tallied_at", "25 hours");
    await purgeJob();

    expect(await tallyOf(alertId)).toEqual({
      "1": { requested: 3, done: 1, needs_help: 1, unmarked: 1 },
      "2": { requested: 2, not_reached: 1, unmarked: 1 },
      "3": { requested: 2, withdrawn: 1, unmarked: 1 },
      B1: { requested: 2, withdrawn: 1, not_reached: 1 },
    });
    expect(await stillInRoundOf(alertId)).toEqual({ "1": 0, "2": 0, "3": 0, B1: 0 });
  });
});

describe("the live counts during the round come from the rows as they are now, not from the tally", () => {
  it("on the Hub's view and on My round: a withdrawal leaves them, a mark moves them; the tally only counts what left; after the close the Hub reads the tally", async () => {
    const [ambassador, coordinator] = [await person("ambassador"), await person("coordinator")];
    const people = [await requester(F1), await requester(F1), await requester(F2), await requester(B1)];
    const { alertId, refs } = await round(people);
    await mark(ambassador, refs[0]!, "done");
    await mark(ambassador, refs[2]!, "needs_help");
    await withdraw(people[1]!.id);
    expect(await tallyOf(alertId)).toEqual({ "1": { requested: 2, withdrawn: 1 }, "2": { requested: 1 }, B1: { requested: 1 } });

    const live = await loadRoundProgress(app);
    expect(live.unreadable).toBe(false);
    expect(live.closed).toEqual([]);
    expect(live.open).toHaveLength(1);
    const floors = live.open[0]!.buildings.map((building) => [building.address, building.floors.map((floor) => [floor.label, Object.fromEntries(floor.counts.map((c) => [c.status, c.n]))])]);
    expect(floors).toEqual([
      [
        "1 Count Street",
        [
          ["Floor 1", { requests: 1, pending: 0, done: 1, not_reached: 0, needs_help: 0 }],
          ["Floor 2", { requests: 1, pending: 0, done: 0, not_reached: 0, needs_help: 1 }],
        ],
      ],
      ["3 Count Street", [["Floor 1", { requests: 1, pending: 1, done: 0, not_reached: 0, needs_help: 0 }]]],
    ]);
    // "My round" counts the same rows for a Coordinator (counts only).
    const mine = await createRoundReads(app).load(coordinator);
    expect(mine.rounds[0]!.buildings.flatMap((building) => building.floors.map((floor) => (floor.kind === "counts" ? floor.counts : null)))).toEqual([
      { pending: 0, done: 1, not_reached: 0, needs_help: 0 },
      { pending: 0, done: 0, not_reached: 0, needs_help: 1 },
      { pending: 1, done: 0, not_reached: 0, needs_help: 0 },
    ]);

    // The thread closes: the open round is gone from the live counts, and its tally is read in its place.
    await owner.begin(async (tx) => {
      await tx.unsafe("alter table alert_entry disable trigger alert_entry_guard");
      await tx`update alert_entry set valid_until = now() - interval '1 hour' where alert_id = ${alertId}`;
      await tx.unsafe("alter table alert_entry enable trigger alert_entry_guard");
    });
    await expire();
    const after = await loadRoundProgress(app);
    expect(after.open).toEqual([]);
    expect(after.closed.map((closed) => closed.title)).toEqual([expect.stringMatching(/^Heat: round closed /)]);
    expect(after.closed[0]!.total.map((count) => [count.status, count.n])).toEqual([
      ["requested", 4],
      ["done", 1],
      ["not_reached", 0],
      ["needs_help", 1],
      ["withdrawn", 1],
      ["unmarked", 1],
    ]);
    // Seven days later it is no longer listed (the measures keep it).
    expect((await loadRoundProgress(app, new Date(Date.now() + 8 * 24 * HOUR))).closed).toEqual([]);
  });
});

describe("the round progress view as each person (the page /staff/rounds, direct requests through its guard)", () => {
  /** The page drawn for this person's session (at the Hub, at aal2 as an Admin is there). */
  async function pageAs(who: Person): Promise<string> {
    wired.session = { staffId: who.staffId, username: "caller", firstName: "Amina", lastName: who.role, role: who.role, gate: "hub", sessionId: randomUUID(), aal: "aal2" };
    const { default: page } = await import("../../src/app/staff/rounds/page");
    return renderToStaticMarkup((await (page as unknown as (props: object) => Promise<ReactElement>)({})) as ReactElement);
  }

  it("shows a Coordinator, a Director and an Admin the counts by building and floor and never a phone number; an Ambassador is refused", async () => {
    const ambassador = await person("ambassador");
    const people = [await requester(F1), await requester(F2), await requester(B1)];
    const { refs } = await round(people);
    await mark(ambassador, refs[1]!, "needs_help");
    const closedRequester = await requester(F3);
    const closedOne = await round([closedRequester], { overdue: true });
    await expire();
    people.push(closedRequester);

    for (const role of ["coordinator", "director", "admin"] as const) {
      const html = await pageAs(await person(role));
      expect(html, role).toContain("Round progress by building and floor");
      expect(html, role).toContain("Rounds closed in the last 7 days");
      expect(html, role).toContain('data-count="needs_help" data-n="1"');
      expect(html.match(/data-testid="progress-floor"/g), role).toHaveLength(4);
      // The escalation is listed, with no number either.
      expect(html, role).toContain("<strong>Needs help</strong>: 1 Count Street, floor 2");
      for (const subscriber of people) {
        expect(html, role).not.toContain(subscriber.phone);
        expect(html, role).not.toContain(subscriber.phone.slice(2));
      }
      for (const ref of [...refs, ...closedOne.refs]) expect(html, role).not.toContain(ref);
    }
    const refused = await pageAs(ambassador);
    expect(refused).toContain("Coordinators, Directors and Admins see the check-in escalations.");
    expect(refused).not.toContain("Round progress");
    expect(refused).not.toMatch(/data-count=/);
  });
});

describe("the pilot measures: a round's counts by thread, building and floor once its thread has closed (S09.05's checkin_round_count)", () => {
  it("holds each closed, non-drill thread's tally at every place, nothing of an open round, and no identifier of anyone", async () => {
    const ambassador = await person("ambassador");
    const people = [await requester(F1), await requester(F1), await requester(B1)];
    const closed = await round(people, { overdue: true });
    await mark(ambassador, closed.refs[0]!, "done");
    await withdraw(people[2]!.id);
    const stillOpen = await round([await requester(F2)]);
    await expire();

    // Read as the export reads it: the app's own role.
    const rows = await appSql`select * from checkin_round_count where rsn in ${appSql([RSN, RSN_B])} order by alert_id, rsn, floor_order, status`;
    expect(Object.keys(rows[0]!).sort()).toEqual(["address", "alert_id", "closed_at", "floor_id", "floor_label", "floor_order", "n", "nbhd", "rsn", "status"]);
    expect(rows.map((row) => [row.alert_id, row.address, row.floor_label, row.status, row.n])).toEqual([
      [closed.alertId, "1 Count Street", "1", "done", 1],
      [closed.alertId, "1 Count Street", "1", "requested", 2],
      [closed.alertId, "1 Count Street", "1", "unmarked", 1],
      [closed.alertId, "3 Count Street", "1", "requested", 1],
      [closed.alertId, "3 Count Street", "1", "withdrawn", 1],
    ]);
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain(stillOpen.alertId);
    for (const subscriber of people) {
      expect(stored).not.toContain(subscriber.id);
      expect(stored).not.toContain(subscriber.phone.slice(2));
    }
    for (const ref of closed.refs) expect(stored).not.toContain(ref);
  });
});
