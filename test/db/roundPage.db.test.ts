// "My round" and its marks against a real database (S08.07, A-04; E08 definitions "Round", "Marks", "Late mark", "Closed stub", "Escalation", "Round
// tally"), as the app's own role (cvh_app_login), composed as src/app/staff/ambassador/round/load.ts composes them (the round's reads) and as the marks
// route calls checkins' `createMarks`. Every number is fictional (555-01xx).
//  - who sees what (direct requests as each person): an Ambassador the requests on the floors they cover now (number, floor, method and `round_ref`,
//    never a name, a reason or a row id), counts only for the other floors of their buildings, nothing elsewhere; a Coordinator and a Director counts
//    only; an Admin every request; a suspended Ambassador, or one with no assignment, nothing; the rows of a closed thread and of a withdrawn request never;
//    the Ambassador's home counts the requests on their floors;
//  - a mark on a live row: applied with its id, a repeated id changes nothing, a later mark replaces the earlier one, not reached and needs help make the
//    row's escalation once per status; only from an Ambassador who covers the floor now, or an Admin; an unknown `round_ref` refused and recorded;
//  - a late mark on an unexpired stub: not reached or needs help make one escalation per status with the stub's building and floor and the ambassador only,
//    whatever the mark id; a late done changes nothing; a stub older than 2 hours, or purged, is refused and nothing is recorded against the round;
//  - the tally: the latest mark is the outcome when the row leaves the round (S08.05's trigger), and a mark waiting behind a withdrawal becomes a late mark;
//  - the round's route (POST /api/staff/ambassador/round) called as each role, through its real guard: the answer each gets, no-store.
import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { CHECKIN_CONSENT_VERSION } from "../../src/contracts/checkin";
import { createRoundReads } from "../../src/app/staff/ambassador/round/load";
import { roundThreads } from "../../src/modules/alerting";
import { createCheckinRequests, createMarks, roundRowPlace, type CheckinRequests, type Marks } from "../../src/modules/checkins";
import { createAssignments as identityAssignments } from "../../src/modules/identity";
import { floorsOfBuilding } from "../../src/modules/places";
import { checkinRequestStore } from "../../src/modules/subscriptions";
import { createDb, type Db } from "../../src/platform/db";
import { deliveryFixtures } from "./deliveryFixtures";
import { deferred } from "./dispatcherSupport";
import { connect, serverUrl } from "./helpers";

/** The staff surface's session lookup and database, for the route's test: the session is the one the test gives (its guard and policy are the real ones). */
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
vi.mock("../../src/app/staff/ambassador/round/load", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/app/staff/ambassador/round/load")>();
  return { ...real, roundReads: () => real.createRoundReads(wired.db as Db) };
});

// Mark Street (Thorncliffe Park) has 1, with floors 1 to 3, and 3, with floor 1.
const RSN_A = "9807001";
const RSN_B = "9807002";
const RSNS = [RSN_A, RSN_B];
const floorId = (rsn: string, index: number) => `01900000-0000-7000-8000-${rsn.padStart(8, "0")}${String(index).padStart(4, "0")}`;
const [A1, A2, A3] = [1, 2, 3].map((i) => floorId(RSN_A, i)) as [string, string, string];
const B1 = floorId(RSN_B, 1);
const VERSION = "2026-10-02.1";
/** identity's assignments and `coversFloor`, as src/app/staff/assignments.ts composes them. */
const createAssignments = (db: Db) => identityAssignments({ db, floors: { floorsOf: floorsOfBuilding } });

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

async function person(role: Role, assigned: { rsn: string; floors: string[] | null }[] = []): Promise<Person> {
  const id = randomUUID();
  await owner`insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password)
              values (${id}, ${randomUUID()}, ${`rp${randomBytes(5).toString("hex")}`}, 'Rashid', ${role}, 'someone@example.org', ${role}, false)`;
  staffIds.push(id);
  // An assignment and its floors in one transaction (the database checks, at commit, that a list of floors has one).
  for (const assignment of assigned) {
    await owner.begin(async (tx) => {
      await tx`insert into ambassador_assignment (staff_id, rsn, all_floors, assigned_by) values (${id}, ${assignment.rsn}, ${assignment.floors === null}, ${id})`;
      for (const floor of assignment.floors ?? []) await tx`insert into ambassador_assignment_floor (staff_id, rsn, floor_id) values (${id}, ${assignment.rsn}, ${floor})`;
    });
  }
  return { staffId: id, role };
}

let phoneSerial = 180;
/** A subscriber asking for a check-in where she lives (that place saved), with a fictional number. */
async function requester(rsn: string, floor: string, method: "call" | "text" = "call"): Promise<{ id: string; phone: string }> {
  const id = randomUUID();
  const phone = `+1416555${String((phoneSerial += 1)).padStart(4, "0")}`;
  await owner`insert into subscriber (id, phone, lang, neighbourhood_id, groups, consent_version, started_by, checkin_method, checkin_consent_version, where_i_live_rsn, where_i_live_floor_id)
              values (${id}, ${phone}, 'en', 'TP', '{}', ${VERSION}, 'web', ${method}, ${CHECKIN_CONSENT_VERSION}, ${rsn}, ${floor})`;
  await owner`insert into subscriber_place (id, subscriber_id, rsn, floor_id) values (${randomUUID()}, ${id}, ${rsn}, ${floor})`;
  return { id, phone };
}

/** An open heat round (an approved update for the whole of Thorncliffe Park) with a row for each requester, made as the approval makes them. */
async function round(people: { id: string }[]): Promise<{ alertId: string; refs: string[] }> {
  const { alertId } = await fixtures.entry("approved", { types: ["heat"], kind: "update" });
  const refs: string[] = [];
  for (const subscriber of people) {
    const [request] = await owner`select where_i_live_rsn as rsn, where_i_live_floor_id as floor, checkin_method as method from subscriber where id = ${subscriber.id}`;
    const [row] = await appSql`insert into checkin (id, alert_id, subscriber_id, rsn, floor_id, method) values (${randomUUID()}, ${alertId}, ${subscriber.id}, ${request!.rsn}, ${request!.floor}, ${request!.method}) returning round_ref`;
    refs.push(row!.round_ref as string);
  }
  return { alertId, refs };
}

const rowOf = async (roundRef: string) =>
  (await owner`select subscriber_id, status, outcome, tallied_at is not null as tallied, closed_at is not null as closed, mark_ids from checkin where round_ref = ${roundRef}`)[0] ?? null;
const escalations = () => owner`select round_ref, status, alert_id, rsn, floor_id, raised_by, late from checkin_escalation order by created_at, status`;
const tallyOf = async (alertId: string) =>
  Object.fromEntries((await owner`select status, sum(n)::int as n from checkin_tally where alert_id = ${alertId} group by status`).map((row) => [row.status as string, row.n as number]));
const markRecords = () => owner`select actor_staff_id, outcome, subject_type, subject_id, meta from audit_event where id > ${auditBaseline} and action = 'checkin.marked' order by id`;
const mark = (who: Person, roundRef: string, status: "done" | "not_reached" | "needs_help", markId: string = randomUUID()) => marks.mark({ staffId: who.staffId }, { markId, roundRef, status });
const withdraw = (subscriberId: string) => app.transaction((tx) => requests.withdrawRequest(subscriberId, tx));

/**
 * The end-of-pilot campaign's deadline has passed (the owner's insert with its guard off, as if 30 days had gone by) and this subscriber never answered:
 * lapsed (E09), receiving nothing, until S09.08's purge deletes them. Their round row stays live until then.
 */
async function lapse(subscriberId: string) {
  if ((await owner`select 1 from campaign where not rehearsal`).length === 0) {
    const starter = await person("admin");
    await owner.begin(async (tx) => {
      await tx.unsafe("alter table campaign disable trigger campaign_guard");
      await tx`insert into campaign (id, rehearsal, deadline_date, deadline, terms_version, texts, started_by, started_session, started_aal, idempotency_key)
               values (${randomUUID()}, false, '2026-09-01', now() - interval '1 day', ${VERSION}, '{}'::jsonb, ${starter.staffId}, ${randomBytes(32).toString("hex")}, 'aal2', ${randomUUID()})`;
      await tx.unsafe("alter table campaign enable trigger campaign_guard");
    });
  }
  await owner`update subscriber set retention_state = 'reconsent_pending' where id = ${subscriberId}`;
}

/** An Admin removes a floor from its building (S01.13) while a round is open; every test starts with the floors back. */
async function removeFloor(floor: string) {
  await owner`delete from building_floor where id = ${floor}`;
}
async function restoreFloors() {
  for (const [rsn, floors] of [[RSN_A, 3], [RSN_B, 1]] as const) {
    for (let index = 1; index <= floors; index += 1) {
      await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${floorId(rsn, index)}, ${rsn}, ${String(index)}, ${index}, true) on conflict do nothing`;
    }
  }
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
  const coverage = createAssignments(app);
  requests = createCheckinRequests({ requests: checkinRequestStore(), threads: roundThreads, coversFloor: (rsn, floor, executor) => coverage.coversFloor(rsn, floor, executor) });
  [{ max: auditBaseline }] = await owner`select coalesce(max(id), 0)::int as max from audit_event`;
  if ((await owner`select 1 from neighbourhood where id = 'TP'`).length === 0) {
    await owner`insert into neighbourhood (id, name, fsa) values ('TP', 'Thorncliffe Park', 'M4H')`;
    madeNeighbourhoods.push("TP");
  }
  for (const [rsn, address] of [[RSN_A, "1 Mark Street"], [RSN_B, "3 Mark Street"]] as const) {
    await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at) values (${rsn}, 'TP', ${address}, 43.7, -79.34, now()) on conflict do nothing`;
  }
  await restoreFloors();
});

async function resetAll() {
  await restoreFloors();
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await tx`delete from audit_event where id > ${auditBaseline}`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
  });
  await owner`delete from checkin_escalation`;
  await owner.unsafe("truncate checkin_tally, checkin");
  await owner`delete from subscriber`;
  await owner`delete from campaign`;
  await owner`delete from ambassador_assignment where rsn in ${owner(RSNS)}`;
  for (const id of staffIds.splice(0)) await owner`delete from staff_account where id = ${id}`;
  await fixtures.cleanup();
}

beforeEach(resetAll);

afterAll(async () => {
  await resetAll();
  for (const rsn of RSNS) {
    await owner`delete from building_floor where rsn = ${rsn}`;
    await owner`delete from building where rsn = ${rsn}`;
  }
  for (const id of madeNeighbourhoods) await owner`delete from neighbourhood where id = ${id}`;
  await app.$client.end({ timeout: 5 });
  await appSql.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

describe("the tables (20261006190000_checkin_marks.sql)", () => {
  it("let the app add and read escalations, one per round_ref and status, and change none of them", async () => {
    const admin = await person("admin");
    const { alertId, refs } = await round([await requester(RSN_A, A1)]);
    const escalation = (status: string) =>
      appSql`insert into checkin_escalation (id, round_ref, status, alert_id, rsn, floor_id, raised_by, late) values (${randomUUID()}, ${refs[0]!}, ${status}, ${alertId}, ${RSN_A}, ${A1}, ${admin.staffId}, false)`;
    await escalation("needs_help");
    await expect(escalation("needs_help")).rejects.toThrow(/checkin_escalation_round_ref_status_idx/);
    await expect(escalation("done")).rejects.toThrow(/checkin_escalation_status_known/);
    expect(await appSql`select status from checkin_escalation`).toEqual([{ status: "needs_help" }]);
    await expect(appSql`update checkin_escalation set late = true`).rejects.toThrow(/permission denied/);
    await expect(appSql`delete from checkin_escalation`).rejects.toThrow(/permission denied/);
  });

  it("keep a row's mark ids with it, at most 50", async () => {
    const { refs } = await round([await requester(RSN_A, A1)]);
    await expect(appSql`update checkin set mark_ids = ${Array.from({ length: 51 }, () => randomUUID())}::uuid[] where round_ref = ${refs[0]!}`).rejects.toThrow(/checkin_mark_ids_bounded/);
  });
});

describe("the round as each person sees it (direct requests)", () => {
  async function setUp() {
    const [onA1, onA2, onA3, onB1] = [await requester(RSN_A, A1, "call"), await requester(RSN_A, A2, "text"), await requester(RSN_A, A3), await requester(RSN_B, B1)];
    const { alertId, refs } = await round([onA1, onA2, onA3, onB1]);
    return { alertId, refs, people: [onA1, onA2, onA3, onB1] };
  }
  const reads = () => createRoundReads(app);

  it("gives an Ambassador the requests on the floors they cover, with number, floor, method and round_ref, and counts only for the other floors of their building", async () => {
    const { refs, people } = await setUp();
    const rashid = await person("ambassador", [{ rsn: RSN_A, floors: [A1, A2] }]);
    const seen = await reads().load(rashid);
    expect(seen).toEqual({
      rounds: [
        {
          headline: "text",
          buildings: [
            {
              address: "1 Mark Street",
              floors: [
                { kind: "contacts", label: "1", requests: [{ round_ref: refs[0], phone: people[0]!.phone, method: "call", status: "pending" }] },
                { kind: "contacts", label: "2", requests: [{ round_ref: refs[1], phone: people[1]!.phone, method: "text", status: "pending" }] },
                { kind: "counts", label: "3", counts: { pending: 1, done: 0, not_reached: 0, needs_help: 0 } },
              ],
            },
          ],
        },
      ],
    });
    // Never a name, a subscriber's id or a row's id.
    const sent = JSON.stringify(seen);
    for (const subscriber of people) expect(sent).not.toContain(subscriber.id);
    for (const { id } of await owner`select id from checkin`) expect(sent).not.toContain(id as string);
    expect(sent).not.toContain(people[2]!.phone);
    expect(sent).not.toContain(people[3]!.phone);
  });

  it("gives an Ambassador of another building only theirs, and one with no assignment, or suspended, nothing", async () => {
    const { refs, people } = await setUp();
    const other = await person("ambassador", [{ rsn: RSN_B, floors: null }]);
    expect((await reads().load(other)).rounds[0]!.buildings).toEqual([
      { address: "3 Mark Street", floors: [{ kind: "contacts", label: "1", requests: [{ round_ref: refs[3], phone: people[3]!.phone, method: "call", status: "pending" }] }] },
    ]);
    expect(await reads().load(await person("ambassador"))).toEqual({ rounds: [] });
    await owner`update staff_account set status = 'suspended' where id = ${other.staffId}`;
    expect(await reads().load(other)).toEqual({ rounds: [] });
  });

  it("gives a Coordinator and a Director counts only, and an Admin every request", async () => {
    const { refs, people } = await setUp();
    for (const role of ["coordinator", "director"] as const) {
      const seen = await reads().load(await person(role));
      expect(seen.rounds[0]!.buildings.flatMap((building) => building.floors.map((floor) => floor.kind)), role).toEqual(["counts", "counts", "counts", "counts"]);
      for (const subscriber of people) expect(JSON.stringify(seen), role).not.toContain(subscriber.phone);
    }
    const admin = await reads().load(await person("admin"));
    expect(admin.rounds[0]!.buildings.flatMap((building) => building.floors.flatMap((floor) => (floor.kind === "contacts" ? floor.requests.map((request) => request.round_ref) : [])))).toEqual(refs);
  });

  it("leaves out a withdrawn request, and the rows of a thread that is not open; shows each request's latest mark", async () => {
    const { alertId, refs, people } = await setUp();
    const admin = await person("admin");
    expect((await mark(admin, refs[1]!, "needs_help")).ok).toBe(true);
    expect(await withdraw(people[0]!.id)).toBe("withdrawn");
    const seen = await reads().load(admin);
    const shown = seen.rounds[0]!.buildings.flatMap((building) => building.floors.flatMap((floor) => (floor.kind === "contacts" ? floor.requests : [])));
    expect(shown.map((request) => [request.round_ref, request.status])).toEqual([[refs[1], "needs_help"], [refs[2], "pending"], [refs[3], "pending"]]);
    // A thread no longer open (before S08.08's close tallies its rows): its rows are not shown.
    await owner.begin(async (tx) => {
      await tx.unsafe("alter table alert disable trigger alert_guard");
      await tx`update alert set status = 'closed', closed_reason = 'resolved', closed_at = now() where id = ${alertId}`;
      await tx.unsafe("alter table alert enable trigger alert_guard");
    });
    expect(await reads().load(admin)).toEqual({ rounds: [] });
  });

  it("neither lists nor counts the request of a subscriber lapsed at the end of the pilot: the contacts, the counts and the home's count agree", async () => {
    const [onA1, lapsedOnA1, onA3, lapsedOnA3] = [await requester(RSN_A, A1), await requester(RSN_A, A1), await requester(RSN_A, A3), await requester(RSN_A, A3)];
    const { refs } = await round([onA1, lapsedOnA1, onA3, lapsedOnA3]);
    await lapse(lapsedOnA1.id);
    await lapse(lapsedOnA3.id);
    const coverage = createAssignments(app);
    const rashid = await person("ambassador", [{ rsn: RSN_A, floors: [A1] }]);
    expect((await reads().load(rashid)).rounds[0]!.buildings[0]!.floors).toEqual([
      { kind: "contacts", label: "1", requests: [{ round_ref: refs[0], phone: onA1.phone, method: "call", status: "pending" }] },
      { kind: "counts", label: "3", counts: { pending: 1, done: 0, not_reached: 0, needs_help: 0 } },
    ]);
    expect(await reads().summary.openFor(await coverage.assignmentsOf(rashid.staffId))).toEqual({ requests: 1 });
    const coordinator = await reads().load(await person("coordinator"));
    expect(coordinator.rounds[0]!.buildings[0]!.floors.map((floor) => (floor.kind === "counts" ? [floor.label, floor.counts.pending] : null))).toEqual([
      ["1", 1],
      ["3", 1],
    ]);
    const admin = await reads().load(await person("admin"));
    expect(admin.rounds[0]!.buildings[0]!.floors.flatMap((floor) => (floor.kind === "contacts" ? floor.requests.map((request) => request.round_ref) : []))).toEqual([refs[0], refs[2]]);
  });

  it("counts a request on a floor removed from its building since as one on an uncovered floor: counts for an Ambassador of the whole building, the number for an Admin", async () => {
    const { refs, people } = await setUp();
    const whole = await person("ambassador", [{ rsn: RSN_A, floors: null }]);
    const coverage = createAssignments(app);
    expect(await reads().summary.openFor(await coverage.assignmentsOf(whole.staffId))).toEqual({ requests: 3 });
    await removeFloor(A3);
    const seen = await reads().load(whole);
    expect(seen.rounds[0]!.buildings[0]!.floors).toEqual([
      { kind: "contacts", label: "1", requests: [{ round_ref: refs[0], phone: people[0]!.phone, method: "call", status: "pending" }] },
      { kind: "contacts", label: "2", requests: [{ round_ref: refs[1], phone: people[1]!.phone, method: "text", status: "pending" }] },
      { kind: "counts", label: "", counts: { pending: 1, done: 0, not_reached: 0, needs_help: 0 } },
    ]);
    expect(JSON.stringify(seen)).not.toContain(people[2]!.phone);
    expect(await reads().summary.openFor(await coverage.assignmentsOf(whole.staffId))).toEqual({ requests: 2 });
    const admin = await reads().load(await person("admin"));
    expect(admin.rounds[0]!.buildings[0]!.floors.flatMap((floor) => (floor.kind === "contacts" ? floor.requests.map((request) => request.round_ref) : []))).toEqual([refs[0], refs[1], refs[2]]);
  });

  it("counts the requests on an Ambassador's floors for their home (A-01), and none once nothing is open there", async () => {
    await setUp();
    const coverage = createAssignments(app);
    const rashid = await person("ambassador", [{ rsn: RSN_A, floors: [A1, A2] }]);
    expect(await reads().summary.openFor(await coverage.assignmentsOf(rashid.staffId))).toEqual({ requests: 2 });
    expect(await reads().summary.openFor([{ rsn: RSN_A, floorIds: [A3] }])).toEqual({ requests: 1 });
    expect(await reads().summary.openFor([])).toBeNull();
    await owner`delete from checkin`;
    expect(await reads().summary.openFor(await coverage.assignmentsOf(rashid.staffId))).toBeNull();
  });
});

describe("a mark on a live row", () => {
  it("is applied with its id; the same id again changes nothing; a later mark replaces it; not reached and needs help tell the Hub once per status", async () => {
    const { alertId, refs } = await round([await requester(RSN_A, A1)]);
    const rashid = await person("ambassador", [{ rsn: RSN_A, floors: [A1] }]);
    const first = randomUUID();
    expect(await mark(rashid, refs[0]!, "done", first)).toEqual({ ok: true, outcome: "marked" });
    expect(await rowOf(refs[0]!)).toMatchObject({ status: "done", tallied: false, mark_ids: [first] });
    // Sent again (a lost answer, or a mark held until signal came back): nothing changes, not even after a later mark.
    expect(await mark(rashid, refs[0]!, "done", first)).toEqual({ ok: true, outcome: "already" });
    const second = randomUUID();
    expect(await mark(rashid, refs[0]!, "needs_help", second)).toEqual({ ok: true, outcome: "marked" });
    expect(await mark(rashid, refs[0]!, "done", first)).toEqual({ ok: true, outcome: "already" });
    expect(await rowOf(refs[0]!)).toMatchObject({ status: "needs_help", mark_ids: [first, second] });
    expect(await mark(rashid, refs[0]!, "needs_help")).toEqual({ ok: true, outcome: "marked" });
    expect(await mark(rashid, refs[0]!, "not_reached")).toEqual({ ok: true, outcome: "marked" });
    expect(await escalations()).toEqual([
      { round_ref: refs[0], status: "needs_help", alert_id: alertId, rsn: RSN_A, floor_id: A1, raised_by: rashid.staffId, late: false },
      { round_ref: refs[0], status: "not_reached", alert_id: alertId, rsn: RSN_A, floor_id: A1, raised_by: rashid.staffId, late: false },
    ]);
    // A mark changes no count: the latest is the outcome when the row leaves the round.
    expect(await tallyOf(alertId)).toEqual({ requested: 1 });
    // Recorded with the mark, never the round_ref, the subscriber or a number; the one sent again is not recorded.
    const records = await markRecords();
    expect(records.map((record) => record.meta)).toEqual([
      { status: "done", late: false, escalated: false },
      { status: "needs_help", late: false, escalated: true },
      { status: "needs_help", late: false, escalated: false },
      { status: "not_reached", late: false, escalated: true },
    ]);
    expect(records.every((record) => record.subject_type === "alert" && record.subject_id === alertId && record.actor_staff_id === rashid.staffId)).toBe(true);
    expect(JSON.stringify(records)).not.toContain(refs[0]!);
  });

  it("knows a mark id sent again in upper case: nothing changes, and a later mark is not undone", async () => {
    const { alertId, refs } = await round([await requester(RSN_A, A1)]);
    const rashid = await person("ambassador", [{ rsn: RSN_A, floors: [A1] }]);
    const first = randomUUID();
    expect(await mark(rashid, refs[0]!, "not_reached", first)).toEqual({ ok: true, outcome: "marked" });
    const second = randomUUID();
    expect(await mark(rashid, refs[0]!, "done", second.toUpperCase())).toEqual({ ok: true, outcome: "marked" });
    expect(await mark(rashid, refs[0]!, "not_reached", first.toUpperCase())).toEqual({ ok: true, outcome: "already" });
    expect(await mark(rashid, refs[0]!, "done", second)).toEqual({ ok: true, outcome: "already" });
    expect(await rowOf(refs[0]!)).toMatchObject({ status: "done", mark_ids: [first, second] });
    expect((await markRecords()).map((record) => record.meta)).toEqual([
      { status: "not_reached", late: false, escalated: true },
      { status: "done", late: false, escalated: false },
    ]);
    expect(await escalations()).toEqual([{ round_ref: refs[0], status: "not_reached", alert_id: alertId, rsn: RSN_A, floor_id: A1, raised_by: rashid.staffId, late: false }]);
  });

  it("on a floor removed from its building since the request: nobody covers it, so an Ambassador of the whole building is refused and an Admin may mark it", async () => {
    const { refs } = await round([await requester(RSN_A, A3)]);
    const whole = await person("ambassador", [{ rsn: RSN_A, floors: null }]);
    expect(await roundRowPlace(app, refs[0]!)).toEqual({ rsn: RSN_A, floorId: A3 });
    await removeFloor(A3);
    // The guard's facts: no floor, which the policy's `assigned_floor` never covers.
    expect(await roundRowPlace(app, refs[0]!)).toEqual({ rsn: RSN_A, floorId: null });
    expect(await mark(whole, refs[0]!, "needs_help")).toEqual({ ok: false, refusal: "out_of_scope" });
    expect(await rowOf(refs[0]!)).toMatchObject({ status: "pending", mark_ids: [] });
    expect(await escalations()).toEqual([]);
    expect(await mark(await person("admin"), refs[0]!, "needs_help")).toEqual({ ok: true, outcome: "marked" });
  });

  it("keeps the latest 50 mark ids", async () => {
    const { refs } = await round([await requester(RSN_A, A1)]);
    const admin = await person("admin");
    const ids = Array.from({ length: 52 }, () => randomUUID());
    for (const id of ids) await mark(admin, refs[0]!, "done", id);
    expect((await rowOf(refs[0]!))!.mark_ids).toEqual(ids.slice(2));
  });

  it("is taken only from an active Ambassador who covers the floor now, or an Admin; anyone else is refused and recorded, and nothing changes", async () => {
    const { alertId, refs } = await round([await requester(RSN_A, A1)]);
    const elsewhere = await person("ambassador", [{ rsn: RSN_A, floors: [A2] }]);
    const coordinator = await person("coordinator");
    const director = await person("director");
    for (const who of [elsewhere, coordinator, director]) expect(await mark(who, refs[0]!, "needs_help"), who.role).toEqual({ ok: false, refusal: "out_of_scope" });
    const rashid = await person("ambassador", [{ rsn: RSN_A, floors: null }]);
    await owner`update staff_account set status = 'suspended' where id = ${rashid.staffId}`;
    expect(await mark(rashid, refs[0]!, "needs_help")).toEqual({ ok: false, refusal: "out_of_scope" });
    expect(await rowOf(refs[0]!)).toMatchObject({ status: "pending", mark_ids: [] });
    expect(await escalations()).toEqual([]);
    expect(await tallyOf(alertId)).toEqual({ requested: 1 });
    expect((await markRecords()).map((record) => [record.outcome, record.subject_type, record.subject_id, record.meta])).toEqual(
      Array.from({ length: 4 }, () => ["refused", "checkin", null, { reason: "out_of_scope" }]),
    );
    // An Admin may mark any row.
    expect(await mark(await person("admin"), refs[0]!, "done")).toEqual({ ok: true, outcome: "marked" });
  });

  it("refuses a round_ref no row has, and records it with its reason only", async () => {
    const admin = await person("admin");
    expect(await mark(admin, "0f0e0d0c-0b0a-4908-8706-0504030201bb", "needs_help")).toEqual({ ok: false, refusal: "round_ended" });
    expect((await markRecords()).map((record) => [record.actor_staff_id, record.outcome, record.subject_id, record.meta])).toEqual([[admin.staffId, "refused", null, { reason: "round_ended" }]]);
    expect(await escalations()).toEqual([]);
  });
});

describe("a late mark on a request that has ended", () => {
  it("not reached or needs help on an unexpired stub: one escalation per status with the building, floor and ambassador only, whatever the mark id", async () => {
    const subscriber = await requester(RSN_A, A1);
    const { alertId, refs } = await round([subscriber]);
    const rashid = await person("ambassador", [{ rsn: RSN_A, floors: [A1] }]);
    expect(await withdraw(subscriber.id)).toBe("withdrawn");
    expect(await rowOf(refs[0]!)).toMatchObject({ subscriber_id: null, closed: true, outcome: "withdrawn" });
    const late = randomUUID();
    expect(await mark(rashid, refs[0]!, "not_reached", late)).toEqual({ ok: true, outcome: "hub_told" });
    expect(await mark(rashid, refs[0]!, "not_reached", late)).toEqual({ ok: true, outcome: "hub_told" });
    expect(await mark(rashid, refs[0]!, "not_reached")).toEqual({ ok: true, outcome: "hub_told" });
    expect(await escalations()).toEqual([{ round_ref: refs[0], status: "not_reached", alert_id: alertId, rsn: RSN_A, floor_id: A1, raised_by: rashid.staffId, late: true }]);
    expect(await mark(rashid, refs[0]!, "needs_help")).toEqual({ ok: true, outcome: "hub_told" });
    expect((await escalations()).map((row) => row.status)).toEqual(["not_reached", "needs_help"]);
    // The stub is as it was, and the round counted the withdrawal only.
    expect(await rowOf(refs[0]!)).toMatchObject({ subscriber_id: null, status: "pending", outcome: "withdrawn", mark_ids: [] });
    expect(await tallyOf(alertId)).toEqual({ requested: 1, withdrawn: 1 });
    expect((await markRecords()).map((record) => record.meta)).toEqual([
      { status: "not_reached", late: true, escalated: true },
      { status: "needs_help", late: true, escalated: true },
    ]);
  });

  it("done on an unexpired stub: 'This request has ended', nothing changes", async () => {
    const subscriber = await requester(RSN_A, A1);
    const { alertId, refs } = await round([subscriber]);
    const rashid = await person("ambassador", [{ rsn: RSN_A, floors: [A1] }]);
    await withdraw(subscriber.id);
    expect(await mark(rashid, refs[0]!, "done")).toEqual({ ok: true, outcome: "request_ended" });
    expect(await escalations()).toEqual([]);
    expect(await markRecords()).toEqual([]);
    expect(await tallyOf(alertId)).toEqual({ requested: 1, withdrawn: 1 });
  });

  it("a stub older than 2 hours, or purged: refused, nothing recorded against the round, the refusal recorded without resident data", async () => {
    const [first, second] = [await requester(RSN_A, A1), await requester(RSN_A, A1)];
    const { alertId, refs } = await round([first, second]);
    const rashid = await person("ambassador", [{ rsn: RSN_A, floors: [A1] }]);
    await withdraw(first.id);
    await withdraw(second.id);
    await owner.begin(async (tx) => {
      await tx.unsafe("alter table checkin disable trigger checkin_update_guard");
      await tx`update checkin set closed_at = now() - interval '2 hours 1 minute' where round_ref = ${refs[0]!}`;
      await tx.unsafe("alter table checkin enable trigger checkin_update_guard");
    });
    // The purge job (pg_cron, every 15 minutes) deletes the second as it would.
    await owner`delete from checkin where round_ref = ${refs[1]!}`;
    for (const roundRef of refs) {
      for (const status of ["done", "not_reached", "needs_help"] as const) expect(await mark(rashid, roundRef, status)).toEqual({ ok: false, refusal: "round_ended" });
    }
    expect(await escalations()).toEqual([]);
    expect(await tallyOf(alertId)).toEqual({ requested: 2, withdrawn: 2 });
    const records = await markRecords();
    expect(records).toHaveLength(6);
    for (const record of records) expect(record).toEqual({ actor_staff_id: rashid.staffId, outcome: "refused", subject_type: "checkin", subject_id: null, meta: { reason: "round_ended" } });
  });

  it("an id the row took while it was live still reads as applied after it closed", async () => {
    const subscriber = await requester(RSN_A, A1);
    const { refs } = await round([subscriber]);
    const rashid = await person("ambassador", [{ rsn: RSN_A, floors: [A1] }]);
    const id = randomUUID();
    expect(await mark(rashid, refs[0]!, "needs_help", id)).toEqual({ ok: true, outcome: "marked" });
    await withdraw(subscriber.id);
    expect(await mark(rashid, refs[0]!, "needs_help", id)).toEqual({ ok: true, outcome: "already" });
    expect(await escalations()).toHaveLength(1);
  });
});

describe("the tally (S08.05's trigger) with marks", () => {
  it("records the latest mark as the row's outcome when it leaves the round, a withdrawal or a deletion", async () => {
    const [marked, remarked, unmarked] = [await requester(RSN_A, A1), await requester(RSN_A, A2), await requester(RSN_A, A3)];
    const { alertId, refs } = await round([marked, remarked, unmarked]);
    const admin = await person("admin");
    await mark(admin, refs[0]!, "done");
    await mark(admin, refs[1]!, "done");
    await mark(admin, refs[1]!, "needs_help");
    await withdraw(marked.id);
    await withdraw(unmarked.id);
    await app.transaction(async (tx) => {
      await requests.lockRounds(remarked.id, tx);
      await requests.deleteForSubscriber(remarked.id, tx);
    });
    expect(await tallyOf(alertId)).toEqual({ requested: 3, done: 1, needs_help: 1, withdrawn: 1 });
    expect((await owner`select outcome from checkin where alert_id = ${alertId} order by created_at, id`).map((row) => row.outcome)).toEqual(["done", "needs_help", "withdrawn"]);
  });

  it("a mark waiting behind a withdrawal that holds the row becomes a late mark, without a deadlock", async () => {
    const subscriber = await requester(RSN_A, A1);
    const { alertId, refs } = await round([subscriber]);
    const rashid = await person("ambassador", [{ rsn: RSN_A, floors: [A1] }]);
    const reached = deferred();
    const hold = deferred();
    const withdrawal = app.transaction(async (tx) => {
      const answer = await requests.withdrawRequest(subscriber.id, tx);
      reached.resolve();
      await hold.promise;
      return answer;
    });
    await reached.promise;
    const marking = mark(rashid, refs[0]!, "needs_help");
    // The mark waits for the row's lock, which the withdrawal holds.
    let waited = false;
    for (let i = 0; i < 200 && !waited; i += 1) {
      waited = (await owner`select 1 from pg_stat_activity where usename = 'cvh_app_login' and wait_event_type = 'Lock'`).length > 0;
      if (!waited) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(waited, "the mark waited for the withdrawal").toBe(true);
    hold.resolve();
    expect(await withdrawal).toBe("withdrawn");
    expect(await marking).toEqual({ ok: true, outcome: "hub_told" });
    expect(await tallyOf(alertId)).toEqual({ requested: 1, withdrawn: 1 });
    expect(await escalations()).toMatchObject([{ status: "needs_help", late: true }]);
  });
});

describe("the round's route called as each person (POST /api/staff/ambassador/round, direct requests through its guard)", () => {
  /** The route answered for this person's session (at the Hub, at aal2 as an Admin and a Coordinator are there). */
  async function ask(who: Person) {
    wired.session = { staffId: who.staffId, username: "caller", firstName: "Rashid", lastName: who.role, role: who.role, gate: "hub", sessionId: randomUUID(), aal: "aal2" };
    const { POST } = await import("../../src/app/api/staff/ambassador/round/route");
    const response = await POST(
      new Request("http://localhost/api/staff/ambassador/round", { method: "POST", headers: { "content-type": "application/json", host: "localhost" }, body: JSON.stringify({ v: 1 }) }),
    );
    const body = (await response.json()) as { rounds: { buildings: { floors: { kind: string; requests?: { round_ref: string }[] }[] }[] }[] };
    return { status: response.status, cacheControl: response.headers.get("cache-control"), body };
  }
  const floorsOf = (body: Awaited<ReturnType<typeof ask>>["body"]) => body.rounds.flatMap((thread) => thread.buildings.flatMap((building) => building.floors));

  it("answers a Coordinator and a Director counts only, an Admin every request and an Ambassador their floors' requests, each no-store", async () => {
    const people = [await requester(RSN_A, A1), await requester(RSN_A, A2, "text"), await requester(RSN_A, A3), await requester(RSN_B, B1)];
    const { refs } = await round(people);
    for (const role of ["coordinator", "director"] as const) {
      const answer = await ask(await person(role));
      expect(answer.status, role).toBe(200);
      expect(answer.cacheControl, role).toContain("no-store");
      expect(floorsOf(answer.body).map((floor) => floor.kind), role).toEqual(["counts", "counts", "counts", "counts"]);
      const sent = JSON.stringify(answer.body);
      for (const subscriber of people) expect(sent, role).not.toContain(subscriber.phone);
      for (const roundRef of refs) expect(sent, role).not.toContain(roundRef);
    }
    const admin = await ask(await person("admin"));
    expect(admin).toMatchObject({ status: 200, cacheControl: expect.stringContaining("no-store") });
    expect(floorsOf(admin.body).map((floor) => floor.kind)).toEqual(["contacts", "contacts", "contacts", "contacts"]);
    expect(floorsOf(admin.body).flatMap((floor) => (floor.requests ?? []).map((request) => request.round_ref))).toEqual(refs);
    for (const subscriber of people) expect(JSON.stringify(admin.body)).toContain(subscriber.phone);
    const rashid = await ask(await person("ambassador", [{ rsn: RSN_A, floors: [A1] }]));
    expect(floorsOf(rashid.body).map((floor) => [floor.kind, (floor.requests ?? []).map((request) => request.round_ref)])).toEqual([
      ["contacts", [refs[0]]],
      ["counts", []],
      ["counts", []],
    ]);
  });
});
