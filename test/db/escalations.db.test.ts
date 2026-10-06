// The Hub hears at once about anyone not reached or needing help, against a real database (S08.08; E08 definitions "Escalation", "On-duty Admin", "Closed
// stub", "Round tally"), as the app's own role (cvh_app_login), composed as the app composes it: the marks with src/app/escalations.ts' text, the close
// through alerting's expire job (`closeAlert`), the handling, the Hub's list and an escalation's page (src/app/staff/rounds/load.ts), the on-duty roster
// (ops, with identity's check), the approval view's warning and the purge job's own SQL. Every number is fictional (555-01xx) and nothing reaches Twilio.
//  - the tables: an escalation is handled once with a one-line note and nothing else of it changes; an on-duty entry is an active Admin's with an
//    authenticator, one at a time, and nothing but an entry's role and account changes;
//  - a not reached or needs help mark puts the escalation on the Hub's list and queues, in the same transaction, one text to the on-duty Admin (every
//    on-call number when none is set, or the one set can no longer be), with the building, floor and staff link and never the resident's number; the text
//    goes during a pause, after a fire alert; a repeated mark texts no one again; an outbox that refuses rolls the mark back;
//  - a close tallies every row: pending and done rows become stubs, a not reached or needs help row the Hub has not handled is kept with its subscriber,
//    which a late mark escalates; a mark waiting behind a close becomes a late mark;
//  - handling: an Admin's, once, audited without the note or the number; a kept row whose every escalation is handled becomes a stub;
//  - the purge job: a kept row becomes a stub 24 hours after the close, without being counted again, and is deleted 2 hours after that;
//  - who sees the resident's number (direct requests): an Admin at aal2 only, while the row names her and the escalation is not a late mark's.
import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { escalationLink, escalationTexts } from "../../src/app/escalations";
import { onDutyNoticeFor } from "../../src/app/staff/onDutyNotice";
import { createRoundReads } from "../../src/app/staff/ambassador/round/load";
import { loadEscalation, loadRounds } from "../../src/app/staff/rounds/load";
import type { EscalationScreen } from "../../src/app/staff/rounds/view";
import { record, recordRefusal } from "../../src/modules/audit";
import { createAlertExpiry } from "../../src/modules/alerting";
import { closeRound, createEscalationHandling, createEscalationTexts, createMarks, escalationList, subscriberCheckinRows, type Marks } from "../../src/modules/checkins";
import { CHECKIN_CONSENT_VERSION } from "../../src/contracts/checkin";
import { isOnDutyAdmin } from "../../src/modules/identity";
import { createContactResolver, createDeliveryQueue, renderEscalationText } from "../../src/modules/messaging";
import { createOncallRoster, oncallNumberSource, onDutyStateOf } from "../../src/modules/ops";
import { roundTypes } from "../../src/modules/places";
import { createDb, type Db } from "../../src/platform/db";
import { deferred, dispatcherWorld, type DispatcherWorld } from "./dispatcherSupport";
import { connect, serverUrl } from "./helpers";

// Escalation Street (Thorncliffe Park) has 1, with floors 1 to 3.
const RSN = "9808001";
const floorId = (index: number) => `01900000-0000-7000-8000-0098080${String(index).padStart(5, "0")}`;
const [F1, F2, F3] = [1, 2, 3].map(floorId) as [string, string, string];
const VERSION = "2026-10-02.1";
const BASE = "https://hub.example.org";
const ENV = { publicBaseUrl: BASE, smsPricePerSegmentCents: 1.5 };
const HOUR = 3_600_000;

let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
let world: DispatcherWorld;
let marks: Marks;
let auditBaseline = 0;
const madeNeighbourhoods: string[] = [];
const staffIds: string[] = [];

type Role = "ambassador" | "coordinator" | "director" | "admin";
interface Person {
  staffId: string;
  role: Role;
}

/** A staff account; an Admin has an authenticator and their own password unless told otherwise. An Ambassador covers the whole building. */
async function person(role: Role, options: { authenticator?: boolean } = {}): Promise<Person> {
  const id = randomUUID();
  const factor = options.authenticator ?? role === "admin";
  await owner`insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password, factor_enrolled_at)
              values (${id}, ${randomUUID()}, ${`es${randomBytes(5).toString("hex")}`}, 'Rashid', ${role}, 'someone@example.org', ${role}, false, ${factor ? new Date() : null})`;
  staffIds.push(id);
  if (role === "ambassador") await owner`insert into ambassador_assignment (staff_id, rsn, all_floors, assigned_by) values (${id}, ${RSN}, true, ${id})`;
  return { staffId: id, role };
}

let phoneSerial = 140;
/** A subscriber asking for a check-in where she lives, with a fictional number. */
async function requester(floor: string, method: "call" | "text" = "call"): Promise<{ id: string; phone: string }> {
  const id = randomUUID();
  const phone = `+1416555${String((phoneSerial += 1)).padStart(4, "0")}`;
  await owner`insert into subscriber (id, phone, lang, neighbourhood_id, groups, consent_version, started_by, checkin_method, checkin_consent_version, where_i_live_rsn, where_i_live_floor_id)
              values (${id}, ${phone}, 'en', 'TP', '{}', ${VERSION}, 'web', ${method}, ${CHECKIN_CONSENT_VERSION}, ${RSN}, ${floor})`;
  await owner`insert into subscriber_place (id, subscriber_id, rsn, floor_id) values (${randomUUID()}, ${id}, ${RSN}, ${floor})`;
  return { id, phone };
}

/** An open heat round (an approved update; `overdue`: past its valid-until, so the expire job closes it) with a row for each requester. */
async function round(people: { id: string }[], options: { overdue?: boolean } = {}): Promise<{ alertId: string; refs: string[] }> {
  const validUntil = new Date(Date.now() + (options.overdue ? -HOUR : 2 * HOUR));
  const { alertId } = await world.fx.entry("approved", { types: ["heat"], kind: "update", validUntil });
  const refs: string[] = [];
  for (const subscriber of people) {
    const [request] = await owner`select where_i_live_floor_id as floor, checkin_method as method from subscriber where id = ${subscriber.id}`;
    const [row] = await appSql`insert into checkin (id, alert_id, subscriber_id, rsn, floor_id, method) values (${randomUUID()}, ${alertId}, ${subscriber.id}, ${RSN}, ${request!.floor}, ${request!.method}) returning round_ref`;
    refs.push(row!.round_ref as string);
  }
  return { alertId, refs };
}

let rosterSerial = 10;
/** A number on the on-call roster (as the owner writes it); `onDutyFor` makes it the on-duty entry of that Admin. */
async function oncallEntry(label: string, options: { onDutyFor?: string } = {}): Promise<string> {
  const id = randomUUID();
  const adder = staffIds[0] ?? (await person("admin")).staffId;
  const phone = `+1647555${String((rosterSerial += 1)).padStart(4, "0")}`;
  await owner`insert into oncall_roster (id, label, phone, added_by, role, staff_id) values (${id}, ${label}, ${phone}, ${adder}, ${options.onDutyFor ? "on_duty" : "oncall"}, ${options.onDutyFor ?? null})`;
  return id;
}

const mark = (who: Person, roundRef: string, status: "done" | "not_reached" | "needs_help", markId: string = randomUUID()) => marks.mark({ staffId: who.staffId }, { markId, roundRef, status });
const rowOf = async (roundRef: string) =>
  (await owner`select subscriber_id, method, status, outcome, tallied_at is not null as tallied, closed_at is not null as closed from checkin where round_ref = ${roundRef}`)[0] ?? null;
const escalationTexts_ = () =>
  owner`select kind, purpose, created_by_module, recipient_kind, recipient_id, claim_rank, lang, body, segments, cost_estimate_cents, idempotency_key, state from delivery where purpose = 'escalation' order by created_at, id`;
const escalationRows = () => owner`select id, round_ref, status, late, handled_at is not null as handled, handled_by, handled_note from checkin_escalation order by created_at, status`;
const tallyOf = async (alertId: string) =>
  Object.fromEntries((await owner`select status, sum(n)::int as n from checkin_tally where alert_id = ${alertId} group by status`).map((row) => [row.status as string, row.n as number]));
const auditOf = (action: string) => owner`select actor_staff_id, outcome, subject_type, subject_id, meta from audit_event where id > ${auditBaseline} and action = ${action} order by id`;
const expire = () => createAlertExpiry({ db: app, finalText: () => "This alert has expired without a further update." }).run();
const handling = () => createEscalationHandling({ db: app });
const roster = () =>
  createOncallRoster({
    db: app,
    audit: { record: (tx, event) => record(tx, event), recordRefusal: (db, event) => recordRefusal(db, event) },
    skipRecipientDeliveries: (tx, recipient) => createDeliveryQueue().skipRecipientDeliveries(tx, recipient),
    onDutyAdmin: (executor, staffId) => isOnDutyAdmin(executor, staffId),
  });

/** Moves a row's tally or close back in time (the row's guard, which keeps a tallied row and a stub as they are, is off for the fixture only). */
const backdate = (roundRef: string, column: "tallied_at" | "closed_at", ago: string) =>
  owner.begin(async (tx) => {
    await tx.unsafe("alter table checkin disable trigger checkin_update_guard");
    await tx.unsafe(`update checkin set ${column} = now() - interval '${ago}' where round_ref = '${roundRef}'`);
    await tx.unsafe("alter table checkin enable trigger checkin_update_guard");
  });

/** Suspends an account as an Admin's recovery would (the two-Admin guard lets it through only then: these tests make few Admins). */
const suspend = (staffId: string) =>
  owner.begin(async (tx) => {
    await tx`select set_config('cvh.admin_recovery', 'on', true)`;
    await tx`update staff_account set status = 'suspended' where id = ${staffId}`;
  });

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
  world = dispatcherWorld(owner, appSql, app);
  marks = createMarks({ db: app, escalations: escalationTexts(ENV) });
  [{ max: auditBaseline }] = await owner`select coalesce(max(id), 0)::int as max from audit_event`;
  if ((await owner`select 1 from neighbourhood where id = 'TP'`).length === 0) {
    await owner`insert into neighbourhood (id, name, fsa) values ('TP', 'Thorncliffe Park', 'M4H')`;
    madeNeighbourhoods.push("TP");
  }
  await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at) values (${RSN}, 'TP', '1 Escalation Street', 43.7, -79.34, now()) on conflict do nothing`;
  for (const [index, id] of [F1, F2, F3].entries()) {
    await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${id}, ${RSN}, ${String(index + 1)}, ${index + 1}, true) on conflict do nothing`;
  }
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
  await owner`delete from oncall_roster`;
  await owner`delete from subscriber`;
  await owner`delete from ambassador_assignment where rsn = ${RSN}`;
  for (const id of staffIds.splice(0)) await owner`delete from staff_account where id = ${id}`;
  await world.reset();
}

beforeEach(resetAll);

afterAll(async () => {
  await resetAll();
  await owner`delete from building_floor where rsn = ${RSN}`;
  await owner`delete from building where rsn = ${RSN}`;
  for (const id of madeNeighbourhoods) await owner`delete from neighbourhood where id = ${id}`;
  await app.$client.end({ timeout: 5 });
  await appSql.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

describe("the tables (20261006210000_escalations.sql)", () => {
  it("let the app mark an escalation handled once, with a one-line note, and change nothing else of it", async () => {
    const admin = await person("admin");
    const { alertId, refs } = await round([await requester(F1)]);
    const id = randomUUID();
    await appSql`insert into checkin_escalation (id, round_ref, status, alert_id, rsn, floor_id, raised_by, late) values (${id}, ${refs[0]!}, 'needs_help', ${alertId}, ${RSN}, ${F1}, ${admin.staffId}, false)`;
    const handle = (note: string | null) => appSql`update checkin_escalation set handled_at = now(), handled_by = ${admin.staffId}, handled_note = ${note} where id = ${id}`;
    await expect(handle(null)).rejects.toThrow(/checkin_escalation_handled_whole/);
    await expect(handle("Called.\nAll fine.")).rejects.toThrow(/checkin_escalation_note_format/);
    await expect(handle("x".repeat(301))).rejects.toThrow(/checkin_escalation_note_format/);
    await handle("Called her, all fine.");
    await expect(handle("Again.")).rejects.toThrow(/handled once/);
    await expect(appSql`update checkin_escalation set late = true where id = ${id}`).rejects.toThrow(/permission denied/);
    await expect(owner`update checkin_escalation set status = 'not_reached' where id = ${id}`).rejects.toThrow(/never changes/);
    await expect(appSql`delete from checkin_escalation`).rejects.toThrow(/permission denied/);
  });

  it("make an on-duty entry only for an active Admin with an authenticator, one at a time, and change nothing else of an entry", async () => {
    const [admin, other, noFactor, coordinator] = [await person("admin"), await person("admin"), await person("admin", { authenticator: false }), await person("coordinator", { authenticator: true })];
    const [a, b] = [await oncallEntry("IT lead"), await oncallEntry("Hub lead")];
    const onDuty = (id: string, staffId: string | null) => appSql`update oncall_roster set role = 'on_duty', staff_id = ${staffId} where id = ${id}`;
    await expect(onDuty(a, null)).rejects.toThrow(/oncall_roster_on_duty_linked|an active Admin/);
    await expect(onDuty(a, coordinator.staffId)).rejects.toThrow(/an active Admin account's with an authenticator/);
    await expect(onDuty(a, noFactor.staffId)).rejects.toThrow(/an active Admin account's with an authenticator/);
    await onDuty(a, admin.staffId);
    await expect(onDuty(b, other.staffId)).rejects.toThrow(/oncall_roster_one_on_duty_idx/);
    await expect(appSql`update oncall_roster set label = 'Renamed' where id = ${a}`).rejects.toThrow(/permission denied/);
    await expect(owner`update oncall_roster set phone = '+16475550199' where id = ${a}`).rejects.toThrow(/only an entry's role and account change/);
    await expect(appSql`update oncall_roster set role = 'oncall', staff_id = null where id = ${a}`).resolves.toBeDefined();
  });
});

describe("an escalation texts the on-duty Admin, in the mark's transaction (E08 'Escalation')", () => {
  it("puts it on the Hub's list at once and queues one text to the on-duty Admin, with the building, floor and link and never the resident's number", async () => {
    const [ambassador, admin] = [await person("ambassador"), await person("admin")];
    const onDuty = await oncallEntry("Priya, on duty", { onDutyFor: admin.staffId });
    await oncallEntry("IT lead");
    const her = await requester(F2);
    const { refs } = await round([her]);

    expect(await mark(ambassador, refs[0]!, "needs_help")).toEqual({ ok: true, outcome: "marked" });

    const [escalation] = await escalationList(app, new Date());
    expect(escalation).toMatchObject({ status: "needs_help", rsn: RSN, floorId: F2, raisedBy: ambassador.staffId, late: false, handledAt: null });
    const body = `CVH: Needs help: 1 Escalation Street, floor 2. Open: ${BASE}/staff/rounds/escalation?id=${escalation!.id}`;
    expect(body).toBe(renderEscalationText({ status: "needs_help", building: "1 Escalation Street", floor: "2", link: escalationLink(BASE, escalation!.id) }).body);
    expect(await escalationTexts_()).toEqual([
      {
        kind: "transactional",
        purpose: "escalation",
        created_by_module: "checkins",
        recipient_kind: "oncall",
        recipient_id: onDuty,
        claim_rank: 1,
        lang: "en",
        body,
        segments: 1,
        cost_estimate_cents: 2,
        idempotency_key: `transactional:${escalation!.id}:escalation:${onDuty}`,
        state: "queued",
      },
    ]);
    const stored = JSON.stringify(await owner`select * from delivery`);
    expect(stored).not.toContain(her.phone.slice(2));
    expect(stored).not.toContain(her.id);
  });

  it("goes to every on-call number when nobody is on duty, and when the one on duty is no longer an active Admin with an authenticator", async () => {
    const [ambassador, admin] = [await person("ambassador"), await person("admin")];
    const numbers = [await oncallEntry("IT lead"), await oncallEntry("Hub lead")];
    const { refs } = await round([await requester(F1), await requester(F1)]);

    await mark(ambassador, refs[0]!, "not_reached");
    expect((await escalationTexts_()).map((row) => row.recipient_id).sort()).toEqual([...numbers].sort());
    expect((await escalationTexts_())[0]!.body).toMatch(/^CVH: Not reached: 1 Escalation Street, floor 1\. Open: /);

    // An on-duty entry whose Admin was suspended since: nobody is on duty for the escalation.
    await owner`update oncall_roster set role = 'on_duty', staff_id = ${admin.staffId} where id = ${numbers[1]!}`;
    await suspend(admin.staffId);
    expect(await onDutyStateOf(app, isOnDutyAdmin)).toMatchObject({ kind: "stale", entryId: numbers[1] });
    await owner`delete from delivery`;
    await mark(ambassador, refs[1]!, "needs_help");
    expect((await escalationTexts_()).map((row) => row.recipient_id).sort()).toEqual([...numbers].sort());
  });

  it("texts no one again for a mark sent again or a second mark of the same status, and nobody with an empty roster (the list still shows it)", async () => {
    const [ambassador, admin] = [await person("ambassador"), await person("admin")];
    const { refs } = await round([await requester(F1), await requester(F3)]);
    await mark(ambassador, refs[0]!, "needs_help");
    expect(await escalationTexts_()).toEqual([]);
    expect(await escalationRows()).toHaveLength(1);

    await oncallEntry("On duty", { onDutyFor: admin.staffId });
    const markId = randomUUID();
    await mark(ambassador, refs[1]!, "not_reached", markId);
    await mark(ambassador, refs[1]!, "not_reached", markId);
    await mark(ambassador, refs[1]!, "done");
    await mark(ambassador, refs[1]!, "not_reached");
    expect(await escalationTexts_()).toHaveLength(1);
  });

  it("rolls the mark back with its escalation when the outbox refuses the text", async () => {
    const [ambassador, admin] = [await person("ambassador"), await person("admin")];
    await oncallEntry("On duty", { onDutyFor: admin.staffId });
    const { refs } = await round([await requester(F1)]);
    const broken = createMarks({
      db: app,
      escalations: createEscalationTexts({
        recipients: async () => ({ ids: [randomUUID()], onDuty: true }),
        place: async () => ({ building: "1 Escalation Street", floor: "1" }),
        render: (input) => renderEscalationText(input),
        link: (id) => escalationLink(BASE, id),
        enqueue: async () => ({ ok: false, error: "RECIPIENT_NOT_ALLOWED" }),
        pricePerSegmentCents: () => 1.5,
      }),
    });
    await expect(broken.mark({ staffId: ambassador.staffId }, { markId: randomUUID(), roundRef: refs[0]!, status: "needs_help" })).rejects.toThrow(/refused an escalation's text/);
    expect(await escalationRows()).toEqual([]);
    expect(await rowOf(refs[0]!)).toMatchObject({ status: "pending" });
  });

  it("is sent while texts are paused, claimed after a fire alert and before other texts, to the on-duty Admin's number", async () => {
    const [ambassador, admin] = [await person("ambassador"), await person("admin")];
    const onDuty = await oncallEntry("On duty", { onDutyFor: admin.staffId });
    const fire = (await world.seedAlert({ types: ["fire"], scope: "buildings" })).ids[0]!;
    await world.seedTransactional(1);
    const { refs } = await round([await requester(F1)]);
    await mark(ambassador, refs[0]!, "needs_help");
    const ranks = await owner`select coalesce(purpose, kind) as what, claim_rank from delivery where state = 'queued' order by claim_rank, created_at, id`;
    expect(ranks[0]).toMatchObject({ claim_rank: 0 });
    expect(ranks[1]).toMatchObject({ what: "escalation", claim_rank: 1 });
    expect(ranks.slice(2).every((row) => (row.claim_rank as number) > 1)).toBe(true);

    await owner`update dispatcher_lease set renewed_at = now() where id = 1`;
    await world.setPause(true);
    world.useResolver({ resolver: createContactResolver({ sources: { oncall: oncallNumberSource }, log: world.log }), asked: [], gone: new Set() });
    await world.dispatcher().run();

    const [phone] = await owner`select phone from oncall_roster where id = ${onDuty}`;
    expect(world.provider.calls.map((call) => call.to)).toEqual([phone!.phone]);
    expect(world.provider.calls[0]!.body).toMatch(/^CVH: Needs help: 1 Escalation Street, floor 1\. Open: /);
    expect(await world.stateOf(fire)).toBe("queued");
  });
});

describe("the round ends with its thread (closeAlert, E08 'Closed stub', 'Round tally')", () => {
  it("tallies every row at the close: pending and done become stubs, an open not reached is kept, a handled needs help is not", async () => {
    const [ambassador, admin] = [await person("ambassador"), await person("admin")];
    const people = [await requester(F1), await requester(F1), await requester(F2), await requester(F3)];
    const { alertId, refs } = await round(people, { overdue: true });
    await mark(ambassador, refs[1]!, "done");
    await mark(ambassador, refs[2]!, "not_reached");
    await mark(ambassador, refs[3]!, "needs_help");
    const [, help] = await escalationRows();
    expect(await handling().handle({ actorStaffId: admin.staffId, escalationId: help!.id, note: "An ambulance came." })).toEqual({ kind: "handled", rowClosed: false });

    expect(await expire()).toMatchObject({ closed: 1 });

    expect(await rowOf(refs[0]!)).toMatchObject({ subscriber_id: null, method: null, outcome: "unmarked", closed: true });
    expect(await rowOf(refs[1]!)).toMatchObject({ subscriber_id: null, outcome: "done", closed: true });
    expect(await rowOf(refs[2]!)).toMatchObject({ subscriber_id: people[2]!.id, method: "call", outcome: "not_reached", tallied: true, closed: false });
    expect(await rowOf(refs[3]!)).toMatchObject({ subscriber_id: null, outcome: "needs_help", closed: true });
    expect(await tallyOf(alertId)).toEqual({ requested: 4, unmarked: 1, done: 1, not_reached: 1, needs_help: 1 });
    // The round page lists no row of a closed thread; the resident's access request reads the kept row with what the Hub was told.
    expect((await createRoundReads(app).load(admin)).rounds).toEqual([]);
    expect(await subscriberCheckinRows(app, people[2]!.id)).toMatchObject([{ alertId, outcome: "not_reached", escalations: [{ status: "not_reached", handledAt: null, handledNote: null }] }]);
  });

  it("takes a late not reached or needs help on a kept row as an escalation, and a late done changes nothing", async () => {
    const [ambassador, admin] = [await person("ambassador"), await person("admin")];
    await oncallEntry("On duty", { onDutyFor: admin.staffId });
    const { refs } = await round([await requester(F1)], { overdue: true });
    await mark(ambassador, refs[0]!, "not_reached");
    await expire();
    expect(await mark(ambassador, refs[0]!, "needs_help")).toEqual({ ok: true, outcome: "hub_told" });
    expect(await mark(ambassador, refs[0]!, "done")).toEqual({ ok: true, outcome: "request_ended" });
    expect((await escalationRows()).map((row) => [row.status, row.late])).toEqual([
      ["not_reached", false],
      ["needs_help", true],
    ]);
    expect(await escalationTexts_()).toHaveLength(2);
    expect(await rowOf(refs[0]!)).toMatchObject({ status: "not_reached", outcome: "not_reached", closed: false });
  });

  it("makes a mark that waits behind a close a late mark (the row's lock serialises them)", async () => {
    const ambassador = await person("ambassador");
    const { alertId, refs } = await round([await requester(F1)]);
    const hold = deferred();
    const locked = deferred();
    const closing = app.transaction(async (tx) => {
      await closeRound(tx, alertId);
      locked.resolve();
      await hold.promise;
    });
    await locked.promise;
    const marking = mark(ambassador, refs[0]!, "not_reached");
    await world.untilSomeoneWaitsForALock();
    hold.resolve();
    await closing;
    expect(await marking).toEqual({ ok: true, outcome: "hub_told" });
    expect(await rowOf(refs[0]!)).toMatchObject({ subscriber_id: null, status: "pending", outcome: "unmarked", closed: true });
    expect((await escalationRows()).map((row) => row.late)).toEqual([true]);
  });
});

describe("an Admin marks an escalation handled", () => {
  it("once, with a note; a kept row whose every escalation is handled becomes a stub, counted once; audited without the note or a number", async () => {
    const [ambassador, admin] = [await person("ambassador"), await person("admin")];
    const her = await requester(F2);
    const { alertId, refs } = await round([her], { overdue: true });
    await mark(ambassador, refs[0]!, "not_reached");
    await mark(ambassador, refs[0]!, "needs_help");
    await expire();
    const [first, second] = await escalationRows();
    const tally = await tallyOf(alertId);

    expect(await handling().handle({ actorStaffId: admin.staffId, escalationId: first!.id, note: "  Called her\nback.  " })).toEqual({ kind: "handled", rowClosed: false });
    expect(await rowOf(refs[0]!)).toMatchObject({ subscriber_id: her.id, closed: false });
    expect(await handling().handle({ actorStaffId: admin.staffId, escalationId: second!.id, note: "Her son is with her." })).toEqual({ kind: "handled", rowClosed: true });
    expect(await rowOf(refs[0]!)).toMatchObject({ subscriber_id: null, method: null, outcome: "needs_help", closed: true });
    expect(await tallyOf(alertId)).toEqual(tally);
    expect((await escalationRows()).map((row) => [row.handled, row.handled_by, row.handled_note])).toEqual([
      [true, admin.staffId, "Called her back."],
      [true, admin.staffId, "Her son is with her."],
    ]);

    const records = await auditOf("checkin.escalation_handled");
    expect(records).toEqual([
      { actor_staff_id: admin.staffId, outcome: "ok", subject_type: "checkin_escalation", subject_id: first!.id, meta: { status: "not_reached", late: false, row_closed: false } },
      { actor_staff_id: admin.staffId, outcome: "ok", subject_type: "checkin_escalation", subject_id: second!.id, meta: { status: "needs_help", late: false, row_closed: true } },
    ]);
    expect(JSON.stringify(records)).not.toMatch(/Called|son|555/);
  });

  it("refuses a second handling, a note with no words, and anyone but an active Admin, each audited with its reason only", async () => {
    const [ambassador, admin, coordinator] = [await person("ambassador"), await person("admin"), await person("coordinator")];
    const { refs } = await round([await requester(F1)]);
    await mark(ambassador, refs[0]!, "needs_help");
    const [escalation] = await escalationRows();
    expect(await handling().handle({ actorStaffId: coordinator.staffId, escalationId: escalation!.id, note: "Called." })).toEqual({ kind: "refused", problem: "not_admin" });
    expect(await handling().handle({ actorStaffId: admin.staffId, escalationId: escalation!.id, note: " \n " })).toEqual({ kind: "refused", problem: "note_missing" });
    expect(await handling().handle({ actorStaffId: admin.staffId, escalationId: randomUUID(), note: "Called." })).toEqual({ kind: "refused", problem: "not_found" });
    expect(await handling().handle({ actorStaffId: admin.staffId, escalationId: escalation!.id, note: "Called." })).toEqual({ kind: "handled", rowClosed: false });
    expect(await handling().handle({ actorStaffId: admin.staffId, escalationId: escalation!.id, note: "Called twice." })).toEqual({ kind: "refused", problem: "already_handled" });
    // Handled during its round: the row stays live, and its close makes it a stub at once.
    expect(await rowOf(refs[0]!)).toMatchObject({ status: "needs_help", tallied: false, closed: false });
    expect((await auditOf("checkin.escalation_handled")).map((row) => [row.outcome, row.meta])).toEqual([
      ["refused", { reason: "forbidden" }],
      ["refused", { reason: "validation" }],
      ["refused", { reason: "not_found" }],
      ["ok", { status: "needs_help", late: false, row_closed: false }],
      ["refused", { reason: "conflict" }],
    ]);
  });
});

describe("the purge job (E08 'Closed stub')", () => {
  it("makes a kept row a stub 24 hours after the close without counting it again, and deletes it 2 hours after that", async () => {
    const ambassador = await person("ambassador");
    const people = [await requester(F1), await requester(F2)];
    const { alertId, refs } = await round(people, { overdue: true });
    await mark(ambassador, refs[0]!, "not_reached");
    await mark(ambassador, refs[1]!, "needs_help");
    await expire();
    const tally = await tallyOf(alertId);
    await backdate(refs[0]!, "tallied_at", "25 hours");
    await backdate(refs[1]!, "tallied_at", "23 hours");
    const [job] = await owner`select command from cron.job where jobname = 'checkins-purge-stubs'`;

    await owner.unsafe(job!.command as string);

    expect(await owner`select closed_at > now() - interval '1 minute' as made_now from checkin where round_ref = ${refs[0]!}`).toEqual([{ made_now: true }]);
    expect(await rowOf(refs[0]!)).toMatchObject({ subscriber_id: null, method: null, outcome: "not_reached", closed: true });
    expect(await rowOf(refs[1]!)).toMatchObject({ subscriber_id: people[1]!.id, closed: false });
    expect(await tallyOf(alertId)).toEqual(tally);

    // The stub is deleted 2 hours after it was made (not after the close): an hour later it is still there, two hours later it is gone.
    await backdate(refs[0]!, "closed_at", "1 hour");
    await owner.unsafe(job!.command as string);
    expect(await rowOf(refs[0]!)).not.toBeNull();
    await backdate(refs[0]!, "closed_at", "2 hours 1 minute");
    await owner.unsafe(job!.command as string);
    expect(await rowOf(refs[0]!)).toBeNull();
    expect(await tallyOf(alertId)).toEqual(tally);
  });
});

describe("who sees what on the Hub's list and an escalation's page (direct requests)", () => {
  it("shows an Admin at aal2 the resident's number, floor and method; an Admin below aal2, a Coordinator and a Director see no number", async () => {
    const [ambassador] = [await person("ambassador")];
    const her = await requester(F3, "text");
    const { refs } = await round([her]);
    await mark(ambassador, refs[0]!, "needs_help");
    const [escalation] = await escalationRows();
    const open = async (viewer: { followUp: boolean; aal2: boolean }) => (await loadEscalation(escalation!.id, viewer, app)) as EscalationScreen;

    expect((await open({ followUp: true, aal2: true })).resident).toEqual({
      kind: "shown",
      phone: her.phone,
      telHref: `tel:${her.phone}`,
      callLabel: `Call ${her.phone}`,
      floor: "3",
      method: "a text",
      note: expect.stringContaining("Only Admins see this.") as unknown as string,
    });
    for (const viewer of [
      { followUp: true, aal2: false },
      { followUp: false, aal2: false },
    ]) {
      const screen = await open(viewer);
      expect(JSON.stringify(screen)).not.toContain(her.phone.slice(2));
      expect(screen.resident?.kind).toBe(viewer.followUp ? "aal2" : "admin_only");
    }
    // The list: open first, with no number for anyone.
    const list = await loadRounds(app, new Date());
    expect(list.open.map((item) => [item.statusLabel, item.where, item.from])).toEqual([["Needs help", "1 Escalation Street, floor 3", "From Rashid ambassador, floor ambassador"]]);
    expect(JSON.stringify(list)).not.toContain(her.phone.slice(2));
    // An escalation that is not there is the page's own "not there".
    expect(await loadEscalation(randomUUID(), { followUp: true, aal2: true }, app)).toMatchObject({ kind: "missing" });
    expect(await loadEscalation("not-an-id", { followUp: true, aal2: true }, app)).toMatchObject({ kind: "missing" });
  });

  it("shows a late mark's escalation with the building, floor and ambassador only, and a handled one with no number once its row is a stub", async () => {
    const [ambassador, admin] = [await person("ambassador"), await person("admin")];
    const people = [await requester(F1), await requester(F2)];
    const { refs } = await round(people, { overdue: true });
    await mark(ambassador, refs[1]!, "not_reached");
    await expire();
    await mark(ambassador, refs[0]!, "needs_help");
    const rows = await escalationRows();
    const late = rows.find((row) => row.late)!;
    const kept = rows.find((row) => !row.late)!;
    const adminView = { followUp: true, aal2: true };

    const lateScreen = (await loadEscalation(late.id, adminView, app)) as EscalationScreen;
    expect(lateScreen.resident).toBeNull();
    expect(lateScreen.late).toMatch(/Call the ambassador to follow up/);
    expect(JSON.stringify(lateScreen)).not.toContain(people[0]!.phone.slice(2));

    expect(((await loadEscalation(kept.id, adminView, app)) as EscalationScreen).resident).toMatchObject({ kind: "shown", phone: people[1]!.phone });
    await handling().handle({ actorStaffId: admin.staffId, escalationId: kept.id, note: "Reached her." });
    const handled = (await loadEscalation(kept.id, adminView, app)) as EscalationScreen;
    expect(handled.resident).toMatchObject({ kind: "gone" });
    expect(handled.handled?.note).toBe("What the Hub did: Reached her.");
    expect(handled.form).toBeNull();
  });
});

describe("the on-duty roster (ops, with identity's check)", () => {
  it("sets an entry on duty for an active Admin with an authenticator only, moves it, ends it, and audits each without the number", async () => {
    const [admin, other, noFactor, coordinator] = [await person("admin"), await person("admin"), await person("admin", { authenticator: false }), await person("coordinator", { authenticator: true })];
    const [a, b] = [await oncallEntry("IT lead"), await oncallEntry("Hub lead")];

    expect(await roster().setOnDuty({ actorStaffId: admin.staffId, id: a, staffId: coordinator.staffId })).toEqual({ kind: "refused", problem: "not_admin" });
    expect(await roster().setOnDuty({ actorStaffId: admin.staffId, id: a, staffId: noFactor.staffId })).toEqual({ kind: "refused", problem: "not_admin" });
    expect(await roster().setOnDuty({ actorStaffId: admin.staffId, id: randomUUID(), staffId: admin.staffId })).toEqual({ kind: "refused", problem: "not_found" });
    expect(await roster().onDutyState()).toEqual({ kind: "none" });

    expect(await roster().setOnDuty({ actorStaffId: admin.staffId, id: a, staffId: admin.staffId })).toEqual({ kind: "set", label: "IT lead" });
    expect(await roster().setOnDuty({ actorStaffId: admin.staffId, id: b, staffId: other.staffId })).toEqual({ kind: "set", label: "Hub lead" });
    expect((await roster().list()).map((entry) => [entry.label, entry.onDuty, entry.staffId])).toEqual([
      ["IT lead", false, null],
      ["Hub lead", true, other.staffId],
    ]);
    expect(await roster().onDutyState()).toEqual({ kind: "set", entryId: b, staffId: other.staffId });
    expect(await roster().clearOnDuty({ actorStaffId: admin.staffId })).toEqual({ kind: "cleared", label: "Hub lead" });
    expect(await roster().clearOnDuty({ actorStaffId: admin.staffId })).toEqual({ kind: "refused", problem: "not_on_duty" });

    // Removing the on-duty entry ends it.
    await roster().setOnDuty({ actorStaffId: admin.staffId, id: a, staffId: admin.staffId });
    await roster().remove({ actorStaffId: admin.staffId, id: a });
    expect(await roster().onDutyState()).toEqual({ kind: "none" });

    const records = await owner`select action, outcome, subject_id, meta from audit_event where id > ${auditBaseline} and action like 'oncall.on_duty_%' order by id`;
    expect(records.map((row) => [row.action, row.outcome, row.meta])).toEqual([
      ["oncall.on_duty_set", "refused", { reason: "validation" }],
      ["oncall.on_duty_set", "refused", { reason: "validation" }],
      ["oncall.on_duty_set", "refused", { reason: "not_found" }],
      ["oncall.on_duty_set", "ok", { staff_id: admin.staffId }],
      ["oncall.on_duty_set", "ok", { staff_id: other.staffId }],
      ["oncall.on_duty_cleared", "ok", {}],
      ["oncall.on_duty_cleared", "refused", { reason: "not_found" }],
      ["oncall.on_duty_set", "ok", { staff_id: admin.staffId }],
    ]);
    expect(JSON.stringify(records)).not.toContain("555");
  });

  it("warns the approver of a round type's entry while nobody is on duty, and not once an Admin is", async () => {
    const admin = await person("admin");
    const deps = { roundTypes: () => roundTypes(app), onDuty: () => onDutyStateOf(app, isOnDutyAdmin) };
    const heat = { kind: "update", types: ["heat"], isDrill: false };
    expect(await onDutyNoticeFor(heat, deps)).toMatch(/^Nobody is on duty for check-ins\./);
    expect(await onDutyNoticeFor({ ...heat, types: ["elevator"] }, deps)).toBeNull();
    await oncallEntry("On duty", { onDutyFor: admin.staffId });
    expect(await onDutyNoticeFor(heat, deps)).toBeNull();
  });
});
