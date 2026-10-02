// Ambassador assignments and coverage against a real database (S01.14): the Admin's assign and remove run as
// the app's own role (cvh_app_login), the audit trail, `coversFloor` (whole building, listed floors, reassignment,
// removal, a suspended or locked Ambassador, a renamed floor, an unknown building), the floor-removal refusal that
// lists the assignments through places' port, and the database's own guards (the foreign key that refuses to delete
// a listed floor, the shape of an assignment, who can be assigned, the grants).
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { record, recordRefusal, type AuditEvent } from "../../src/modules/audit";
import { createAssignments, type AssignmentService } from "../../src/modules/identity";
import { createBuildingService, floorsOfBuilding, type BuildingService } from "../../src/modules/places";
import { createDb, type Db } from "../../src/platform/db";
import { uuidv7 } from "../../src/platform/ids";
import { connect, serverUrl } from "./helpers";

const RSN_A = "7101";
const RSN_B = "7102";

let owner: ReturnType<typeof connect>;
let app: Db;
let assignments: AssignmentService;
let buildings: BuildingService;
const created: string[] = [];

/** The audit module's writers, as the composition roots wire them into places. */
const placesAudit = {
  record: (tx: Parameters<typeof record>[0], event: unknown) => record(tx, event as AuditEvent),
  recordRefusal: (db: Db, event: unknown) => recordRefusal(db, event as AuditEvent),
};

beforeAll(async () => {
  owner = connect(serverUrl());
  await migrate({ sql: owner, log: () => {} });
  const password = randomBytes(18).toString("hex");
  await owner.unsafe(`alter role cvh_app_login password '${password}'`);
  const url = new URL(serverUrl());
  url.username = "cvh_app_login";
  url.password = password;
  app = createDb(url.href);
  assignments = createAssignments({ db: app, floors: { floorsOf: floorsOfBuilding } });
  buildings = createBuildingService({ db: app, audit: placesAudit, assignments: { onFloor: (executor, floor) => assignments.onFloor(executor, floor) } });
});

async function clear() {
  // Apart from the truncate: a delete leaves deferred constraint events that a truncate in the same transaction refuses.
  await owner`delete from ambassador_assignment`;
  await owner.unsafe("truncate building_floor, building, neighbourhood cascade");
  const accounts = created.splice(0);
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await tx`delete from audit_event where subject_type = 'building' and subject_id in (${RSN_A}, ${RSN_B}, '7999')`;
    if (accounts.length > 0) {
      await tx`delete from audit_event where actor_staff_id in ${tx(accounts)}`;
      await tx`delete from staff_account where id in ${tx(accounts)}`;
    }
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
  });
}

afterAll(async () => {
  await clear();
  await app?.$client.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

type Person = { id: string; first: string; last: string };

async function person(role: "admin" | "coordinator" | "director" | "ambassador", options: { status?: string; first?: string; last?: string } = {}): Promise<Person> {
  const id = uuidv7();
  const first = options.first ?? "Nia";
  const last = options.last ?? "Mensah";
  await owner`
    insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, status, must_change_password)
    values (${id}, ${randomUUID()}, ${`as${randomBytes(4).toString("hex")}`}, ${first}, ${last}, 'someone@example.org', ${role}, ${options.status ?? "active"}, false)`;
  created.push(id);
  return { id, first, last };
}

/** A building with floors G, M, 2, 3 whose sort order is not the label order (G lowest), and one with floors 1 and 2. */
const floorIds: Record<string, string> = {};
let admin: Person;

beforeEach(async () => {
  await clear();
  admin = await person("admin", { first: "Bea", last: "Admin" });
  await owner`insert into neighbourhood (id, name, fsa) values ('TP', 'Thorncliffe Park', 'M4H')`;
  for (const rsn of [RSN_A, RSN_B]) {
    await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at) values (${rsn}, 'TP', ${`${rsn} Test Dr`}, 43.7, -79.34, '2026-10-01T12:00:00Z')`;
  }
  const plan: [string, string, number][] = [
    [RSN_A, "G", 0],
    [RSN_A, "M", 5],
    [RSN_A, "2", 10],
    [RSN_A, "3", 15],
    [RSN_B, "1", 1],
    [RSN_B, "2", 2],
  ];
  for (const [rsn, label, sortOrder] of plan) {
    const id = uuidv7();
    floorIds[`${rsn}:${label}`] = id;
    await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${id}, ${rsn}, ${label}, ${sortOrder}, true)`;
  }
});

const floor = (rsn: string, label: string) => floorIds[`${rsn}:${label}`];
const auditRows = () =>
  owner<{ action: string; outcome: string; actor_staff_id: string | null; subject_type: string; subject_id: string | null; meta: Record<string, unknown> }[]>`
    select action, outcome, actor_staff_id, subject_type, subject_id, meta from audit_event where action like 'assignment.%' and actor_staff_id = ${admin.id} order by id`;
const rowsOf = (staffId: string) => owner<{ rsn: string; all_floors: boolean; assigned_by: string }[]>`select rsn, all_floors, assigned_by from ambassador_assignment where staff_id = ${staffId} order by rsn`;
const listedOf = (staffId: string, rsn: string) => owner<{ floor_id: string }[]>`select floor_id from ambassador_assignment_floor where staff_id = ${staffId} and rsn = ${rsn}`;

describe("assigning an Ambassador (the Admin's change, as the app's role)", () => {
  it("saves a whole-building assignment, with no floor rows, and audits it with the Ambassador, the building and floor_ids null", async () => {
    const nia = await person("ambassador");

    const result = await assignments.assign(admin.id, { staffId: nia.id, rsn: RSN_A, floorIds: null });

    expect(result).toEqual({ ok: true, value: { staffId: nia.id, rsn: RSN_A, floorIds: null } });
    expect(await rowsOf(nia.id)).toEqual([{ rsn: RSN_A, all_floors: true, assigned_by: admin.id }]);
    expect(await listedOf(nia.id, RSN_A)).toEqual([]);
    expect(await auditRows()).toEqual([
      { action: "assignment.saved", outcome: "ok", actor_staff_id: admin.id, subject_type: "building", subject_id: RSN_A, meta: { staff_id: nia.id, rsn: RSN_A, floor_ids: null } },
    ]);
  });

  it("saves listed floors by id, in the building's order, and saving again replaces them", async () => {
    const nia = await person("ambassador");
    await assignments.assign(admin.id, { staffId: nia.id, rsn: RSN_A, floorIds: [floor(RSN_A, "3"), floor(RSN_A, "G"), floor(RSN_A, "G")] });
    expect((await listedOf(nia.id, RSN_A)).map((row) => row.floor_id).sort()).toEqual([floor(RSN_A, "3"), floor(RSN_A, "G")].sort());

    const again = await assignments.assign(admin.id, { staffId: nia.id, rsn: RSN_A, floorIds: [floor(RSN_A, "2")] });

    expect(again).toEqual({ ok: true, value: { staffId: nia.id, rsn: RSN_A, floorIds: [floor(RSN_A, "2")] } });
    expect((await listedOf(nia.id, RSN_A)).map((row) => row.floor_id)).toEqual([floor(RSN_A, "2")]);
    expect(await rowsOf(nia.id)).toEqual([{ rsn: RSN_A, all_floors: false, assigned_by: admin.id }]);

    const whole = await assignments.assign(admin.id, { staffId: nia.id, rsn: RSN_A, floorIds: null });
    expect(whole.ok).toBe(true);
    expect(await listedOf(nia.id, RSN_A)).toEqual([]);
    expect((await auditRows()).map((row) => [row.action, row.outcome, row.meta.floor_ids])).toEqual([
      ["assignment.saved", "ok", [floor(RSN_A, "G"), floor(RSN_A, "3")]],
      ["assignment.saved", "ok", [floor(RSN_A, "2")]],
      ["assignment.saved", "ok", null],
    ]);
  });

  it("expands a range of floors by sort_order, whichever end is named first, and adds it to the floors ticked", async () => {
    const nia = await person("ambassador");

    const forward = await assignments.assign(admin.id, { staffId: nia.id, rsn: RSN_A, floorIds: [], range: { from: floor(RSN_A, "G"), to: floor(RSN_A, "2") } });
    expect(forward).toEqual({ ok: true, value: { staffId: nia.id, rsn: RSN_A, floorIds: [floor(RSN_A, "G"), floor(RSN_A, "M"), floor(RSN_A, "2")] } });

    const backward = await assignments.assign(admin.id, { staffId: nia.id, rsn: RSN_A, floorIds: [floor(RSN_A, "G")], range: { from: floor(RSN_A, "3"), to: floor(RSN_A, "M") } });
    expect(backward).toEqual({ ok: true, value: { staffId: nia.id, rsn: RSN_A, floorIds: [floor(RSN_A, "G"), floor(RSN_A, "M"), floor(RSN_A, "2"), floor(RSN_A, "3")] } });
  });

  it("assigns one Ambassador to several buildings", async () => {
    const nia = await person("ambassador");
    await assignments.assign(admin.id, { staffId: nia.id, rsn: RSN_A, floorIds: null });
    await assignments.assign(admin.id, { staffId: nia.id, rsn: RSN_B, floorIds: [floor(RSN_B, "1")] });
    expect((await rowsOf(nia.id)).map((row) => row.rsn)).toEqual([RSN_A, RSN_B]);
    expect(await assignments.assignmentsOf(nia.id)).toEqual([
      { rsn: RSN_A, floorIds: null },
      { rsn: RSN_B, floorIds: [floor(RSN_B, "1")] },
    ]);
  });

  const refusals: [string, () => Promise<{ staffId: string; rsn: string; floorIds: string[] | null; range?: { from: string; to: string } }>, string, string][] = [
    ["a floor of another building", async () => ({ staffId: (await person("ambassador")).id, rsn: RSN_A, floorIds: [floor(RSN_B, "1")] }), "floor_not_in_building", "validation"],
    ["a floor id that is not a floor at all", async () => ({ staffId: (await person("ambassador")).id, rsn: RSN_A, floorIds: [uuidv7()] }), "floor_not_in_building", "validation"],
    ["a floor that is no uuid", async () => ({ staffId: (await person("ambassador")).id, rsn: RSN_A, floorIds: ["3"] }), "floor_not_in_building", "validation"],
    ["an empty list of floors", async () => ({ staffId: (await person("ambassador")).id, rsn: RSN_A, floorIds: [] }), "no_floors", "validation"],
    ["a range with one end", async () => ({ staffId: (await person("ambassador")).id, rsn: RSN_A, floorIds: [], range: { from: floor(RSN_A, "G"), to: "" } }), "range_incomplete", "validation"],
    ["a range ending at a floor of another building", async () => ({ staffId: (await person("ambassador")).id, rsn: RSN_A, floorIds: [], range: { from: floor(RSN_A, "G"), to: floor(RSN_B, "2") } }), "floor_not_in_building", "validation"],
    ["a Coordinator", async () => ({ staffId: (await person("coordinator")).id, rsn: RSN_A, floorIds: null }), "not_ambassador", "validation"],
    ["an Admin", async () => ({ staffId: admin.id, rsn: RSN_A, floorIds: null }), "not_ambassador", "validation"],
    ["a Director", async () => ({ staffId: (await person("director")).id, rsn: RSN_A, floorIds: null }), "not_ambassador", "validation"],
    ["a suspended Ambassador", async () => ({ staffId: (await person("ambassador", { status: "suspended" })).id, rsn: RSN_A, floorIds: null }), "account_not_active", "validation"],
    ["a locked Ambassador", async () => ({ staffId: (await person("ambassador", { status: "locked_pending_reissue" })).id, rsn: RSN_A, floorIds: null }), "account_not_active", "validation"],
    ["a removed Ambassador", async () => ({ staffId: (await person("ambassador", { status: "removed" })).id, rsn: RSN_A, floorIds: null }), "account_not_active", "validation"],
    ["an account that does not exist", async () => ({ staffId: uuidv7(), rsn: RSN_A, floorIds: null }), "account_not_found", "not_found"],
    ["an account id that is no uuid", async () => ({ staffId: "nia", rsn: RSN_A, floorIds: null }), "account_not_found", "not_found"],
    ["a building that does not exist", async () => ({ staffId: (await person("ambassador")).id, rsn: "7999", floorIds: null }), "building_not_found", "not_found"],
    ["a building number that is no rsn", async () => ({ staffId: (await person("ambassador")).id, rsn: "12 Main St", floorIds: null }), "building_not_found", "not_found"],
  ];

  it.each(refusals)("refuses %s, saves nothing and audits the refusal with its reason", async (_name, make, error, reason) => {
    const input = await make();

    expect(await assignments.assign(admin.id, input)).toEqual({ ok: false, error });

    expect((await owner`select count(*)::int as n from ambassador_assignment`)[0].n).toBe(0);
    expect((await owner`select count(*)::int as n from ambassador_assignment_floor`)[0].n).toBe(0);
    const [row, ...rest] = await auditRows();
    expect(rest).toEqual([]);
    expect(row).toMatchObject({ action: "assignment.saved", outcome: "refused", actor_staff_id: admin.id, subject_type: "building", meta: { reason } });
    // The meta holds ids and codes only: never a name, an email address or a phone number.
    for (const key of Object.keys(row.meta)) expect(["reason", "staff_id", "rsn", "floor_ids"]).toContain(key);
  });

  it("rolls the assignment back when its audit record cannot be written", async () => {
    const nia = await person("ambassador");
    const failing = createAssignments({
      db: app,
      floors: { floorsOf: floorsOfBuilding },
      audit: { record: async () => Promise.reject(new Error("audit unavailable")), recordRefusal: (db, event) => recordRefusal(db, event) },
    });
    await expect(failing.assign(admin.id, { staffId: nia.id, rsn: RSN_A, floorIds: [floor(RSN_A, "G")] })).rejects.toThrow("audit unavailable");
    expect(await rowsOf(nia.id)).toEqual([]);
    expect(await listedOf(nia.id, RSN_A)).toEqual([]);
  });
});

describe("removing an assignment", () => {
  it("removes it with its floor rows and audits it; the Ambassador stays", async () => {
    const nia = await person("ambassador");
    await assignments.assign(admin.id, { staffId: nia.id, rsn: RSN_A, floorIds: [floor(RSN_A, "G"), floor(RSN_A, "2")] });

    expect(await assignments.remove(admin.id, { staffId: nia.id, rsn: RSN_A })).toEqual({ ok: true, value: { staffId: nia.id, rsn: RSN_A } });

    expect(await rowsOf(nia.id)).toEqual([]);
    expect(await listedOf(nia.id, RSN_A)).toEqual([]);
    expect((await owner`select status from staff_account where id = ${nia.id}`)[0].status).toBe("active");
    expect((await auditRows()).at(-1)).toEqual({ action: "assignment.removed", outcome: "ok", actor_staff_id: admin.id, subject_type: "building", subject_id: RSN_A, meta: { staff_id: nia.id, rsn: RSN_A } });
  });

  it("removes only that building's assignment", async () => {
    const nia = await person("ambassador");
    await assignments.assign(admin.id, { staffId: nia.id, rsn: RSN_A, floorIds: null });
    await assignments.assign(admin.id, { staffId: nia.id, rsn: RSN_B, floorIds: null });
    await assignments.remove(admin.id, { staffId: nia.id, rsn: RSN_A });
    expect((await rowsOf(nia.id)).map((row) => row.rsn)).toEqual([RSN_B]);
  });

  it("can remove the assignment of a suspended or removed account, which no longer covers anything", async () => {
    const nia = await person("ambassador");
    await assignments.assign(admin.id, { staffId: nia.id, rsn: RSN_A, floorIds: [floor(RSN_A, "G")] });
    await owner`update staff_account set status = 'removed' where id = ${nia.id}`;
    expect((await assignments.remove(admin.id, { staffId: nia.id, rsn: RSN_A })).ok).toBe(true);
  });

  it.each([
    ["an account that is not assigned there", async () => ({ staffId: (await person("ambassador")).id, rsn: RSN_A }), "not_assigned"],
    ["a building that does not exist", async () => ({ staffId: (await person("ambassador")).id, rsn: "7999" }), "building_not_found"],
    ["an id that is no uuid", async () => ({ staffId: "x", rsn: RSN_A }), "account_not_found"],
  ])("refuses %s and audits the refusal", async (_name, make, error) => {
    expect(await assignments.remove(admin.id, await make())).toEqual({ ok: false, error });
    expect(await auditRows()).toMatchObject([{ action: "assignment.removed", outcome: "refused", meta: { reason: "not_found" } }]);
  });
});

describe("identity.coversFloor(rsn, floorId)", () => {
  it("covers every floor of a whole-building assignment, a floor added later too", async () => {
    const nia = await person("ambassador");
    await assignments.assign(admin.id, { staffId: nia.id, rsn: RSN_A, floorIds: null });
    for (const label of ["G", "M", "2", "3"]) expect(await assignments.coversFloor(RSN_A, floor(RSN_A, label)), label).toBe(true);

    const added = await buildings.addFloor(admin.id, { rsn: RSN_A, label: "PH" });
    expect(added.ok && (await assignments.coversFloor(RSN_A, added.value.id))).toBe(true);
    // ... but not the other building.
    expect(await assignments.coversFloor(RSN_B, floor(RSN_B, "1"))).toBe(false);
  });

  it("covers only the listed floors of a listed assignment", async () => {
    const nia = await person("ambassador");
    await assignments.assign(admin.id, { staffId: nia.id, rsn: RSN_A, floorIds: [floor(RSN_A, "G"), floor(RSN_A, "2")] });
    expect(await assignments.coversFloor(RSN_A, floor(RSN_A, "G"))).toBe(true);
    expect(await assignments.coversFloor(RSN_A, floor(RSN_A, "2"))).toBe(true);
    expect(await assignments.coversFloor(RSN_A, floor(RSN_A, "M"))).toBe(false);
    expect(await assignments.coversFloor(RSN_A, floor(RSN_A, "3"))).toBe(false);
  });

  it("follows a reassignment to another building: the first stops covering, the second starts", async () => {
    const nia = await person("ambassador");
    await assignments.assign(admin.id, { staffId: nia.id, rsn: RSN_A, floorIds: null });
    expect(await assignments.coversFloor(RSN_A, floor(RSN_A, "3"))).toBe(true);

    await assignments.remove(admin.id, { staffId: nia.id, rsn: RSN_A });
    await assignments.assign(admin.id, { staffId: nia.id, rsn: RSN_B, floorIds: null });

    expect(await assignments.coversFloor(RSN_A, floor(RSN_A, "3"))).toBe(false);
    expect(await assignments.coversFloor(RSN_B, floor(RSN_B, "1"))).toBe(true);
  });

  it("stops covering when the assignment is removed", async () => {
    const nia = await person("ambassador");
    await assignments.assign(admin.id, { staffId: nia.id, rsn: RSN_A, floorIds: [floor(RSN_A, "G")] });
    expect(await assignments.coversFloor(RSN_A, floor(RSN_A, "G"))).toBe(true);
    await assignments.remove(admin.id, { staffId: nia.id, rsn: RSN_A });
    expect(await assignments.coversFloor(RSN_A, floor(RSN_A, "G"))).toBe(false);
  });

  it.each(["suspended", "locked_pending_reissue", "removed"])("does not count a %s Ambassador, and counts them again once active", async (status) => {
    const nia = await person("ambassador");
    await assignments.assign(admin.id, { staffId: nia.id, rsn: RSN_A, floorIds: [floor(RSN_A, "G")] });
    await assignments.assign(admin.id, { staffId: nia.id, rsn: RSN_B, floorIds: null });
    await owner`update staff_account set status = ${status} where id = ${nia.id}`;
    expect(await assignments.coversFloor(RSN_A, floor(RSN_A, "G"))).toBe(false);
    expect(await assignments.coversFloor(RSN_B, floor(RSN_B, "1"))).toBe(false);

    await owner`update staff_account set status = 'active' where id = ${nia.id}`;
    expect(await assignments.coversFloor(RSN_A, floor(RSN_A, "G"))).toBe(true);
    expect(await assignments.coversFloor(RSN_B, floor(RSN_B, "1"))).toBe(true);
  });

  it("does not count an account that is no longer an Ambassador", async () => {
    const nia = await person("ambassador");
    await assignments.assign(admin.id, { staffId: nia.id, rsn: RSN_A, floorIds: null });
    await owner`update staff_account set role = 'coordinator' where id = ${nia.id}`;
    expect(await assignments.coversFloor(RSN_A, floor(RSN_A, "G"))).toBe(false);
  });

  it("counts a floor by its id, so a renamed label is still covered, and the floor is not found by its old label", async () => {
    const nia = await person("ambassador");
    await assignments.assign(admin.id, { staffId: nia.id, rsn: RSN_A, floorIds: [floor(RSN_A, "3")] });

    const renamed = await buildings.renameFloor(admin.id, { rsn: RSN_A, floorId: floor(RSN_A, "3"), label: "3A" });

    expect(renamed.ok).toBe(true);
    expect(await assignments.coversFloor(RSN_A, floor(RSN_A, "3"))).toBe(true);
    expect((await listedOf(nia.id, RSN_A)).map((row) => row.floor_id)).toEqual([floor(RSN_A, "3")]);
  });

  it("is false for an unknown building, a floor of another building, a floor that does not exist and ids that are not ids", async () => {
    const nia = await person("ambassador");
    await assignments.assign(admin.id, { staffId: nia.id, rsn: RSN_A, floorIds: null });
    expect(await assignments.coversFloor("7999", floor(RSN_A, "G"))).toBe(false);
    expect(await assignments.coversFloor(RSN_A, floor(RSN_B, "1"))).toBe(false);
    expect(await assignments.coversFloor(RSN_A, uuidv7())).toBe(false);
    expect(await assignments.coversFloor(RSN_A, "G")).toBe(false);
    expect(await assignments.coversFloor("not a number", floor(RSN_A, "G"))).toBe(false);
  });

  it("is false for a building nobody is assigned to, and one covering Ambassador is enough", async () => {
    expect(await assignments.coversFloor(RSN_A, floor(RSN_A, "G"))).toBe(false);
    const suspended = await person("ambassador", { status: "suspended" });
    await owner`update staff_account set status = 'active' where id = ${suspended.id}`;
    await assignments.assign(admin.id, { staffId: suspended.id, rsn: RSN_A, floorIds: null });
    await owner`update staff_account set status = 'suspended' where id = ${suspended.id}`;
    const covering = await person("ambassador", { first: "Omar", last: "Farouk" });
    await assignments.assign(admin.id, { staffId: covering.id, rsn: RSN_A, floorIds: [floor(RSN_A, "G")] });
    expect(await assignments.coversFloor(RSN_A, floor(RSN_A, "G"))).toBe(true);
    expect(await assignments.coversFloor(RSN_A, floor(RSN_A, "M"))).toBe(false);
  });

  it("reads through the caller's transaction when it is given one, seeing what the transaction wrote", async () => {
    const nia = await person("ambassador");
    await app.transaction(async (tx) => {
      expect(await assignments.coversFloor(RSN_A, floor(RSN_A, "G"), tx)).toBe(false);
      await tx.execute(sql`insert into ambassador_assignment (staff_id, rsn, all_floors, assigned_by) values (${nia.id}, ${RSN_A}, true, ${admin.id})`);
      expect(await assignments.coversFloor(RSN_A, floor(RSN_A, "G"), tx)).toBe(true);
      throw new Error("roll back");
    }).catch((error: unknown) => expect((error as Error).message).toBe("roll back"));
    expect(await assignments.coversFloor(RSN_A, floor(RSN_A, "G"))).toBe(false);
  });
});

describe("the readers behind the screens", () => {
  it("lists every assignment with the person and whether they cover now, and the active Ambassadors to assign", async () => {
    const nia = await person("ambassador", { first: "Nia", last: "Mensah" });
    const omar = await person("ambassador", { first: "Omar", last: "Farouk" });
    await person("ambassador", { first: "Sam", last: "Suspended", status: "suspended" });
    await person("coordinator", { first: "Carla", last: "Coord" });
    await assignments.assign(admin.id, { staffId: nia.id, rsn: RSN_A, floorIds: [floor(RSN_A, "G")] });
    await assignments.assign(admin.id, { staffId: omar.id, rsn: RSN_B, floorIds: null });
    await owner`update staff_account set status = 'suspended' where id = ${omar.id}`;

    expect(await assignments.allAssignments()).toMatchObject([
      { staffId: omar.id, firstName: "Omar", lastName: "Farouk", status: "suspended", rsn: RSN_B, floorIds: null, covering: false },
      { staffId: nia.id, firstName: "Nia", lastName: "Mensah", status: "active", rsn: RSN_A, floorIds: [floor(RSN_A, "G")], covering: true },
    ]);
    expect((await assignments.ambassadors()).map((option) => `${option.firstName} ${option.lastName}`)).toEqual(["Nia Mensah"]);
  });
});

describe("removing a floor that has assignments (places' guard, through identity's reader)", () => {
  it("refuses, lists the Ambassadors by name, audits the refusal, and keeps the floor, the assignment and the coverage", async () => {
    const nia = await person("ambassador", { first: "Nia", last: "Mensah" });
    const omar = await person("ambassador", { first: "Omar", last: "Farouk" });
    await assignments.assign(admin.id, { staffId: nia.id, rsn: RSN_A, floorIds: [floor(RSN_A, "2"), floor(RSN_A, "3")] });
    await assignments.assign(admin.id, { staffId: omar.id, rsn: RSN_A, floorIds: [floor(RSN_A, "2")] });

    const refused = await buildings.removeFloor(admin.id, { rsn: RSN_A, floorId: floor(RSN_A, "2") });

    expect(refused).toMatchObject({ ok: false, error: "floor_has_assignments" });
    expect(!refused.ok && refused.ambassadors).toEqual([
      { staffId: omar.id, name: "Omar Farouk" },
      { staffId: nia.id, name: "Nia Mensah" },
    ]);
    expect((await owner`select count(*)::int as n from building_floor where id = ${floor(RSN_A, "2")}`)[0].n).toBe(1);
    expect(await assignments.coversFloor(RSN_A, floor(RSN_A, "2"))).toBe(true);
    expect(await owner`select action, outcome, meta from audit_event where action = 'building.floor_removed' and actor_staff_id = ${admin.id}`).toEqual([
      { action: "building.floor_removed", outcome: "refused", meta: { reason: "floor_has_assignments", floor_id: floor(RSN_A, "2"), label: "2", assignments: 2 } },
    ]);
  });

  it("still lists a suspended Ambassador, whose assignment the database would also refuse to orphan", async () => {
    const nia = await person("ambassador", { first: "Nia", last: "Mensah" });
    await assignments.assign(admin.id, { staffId: nia.id, rsn: RSN_A, floorIds: [floor(RSN_A, "G")] });
    await owner`update staff_account set status = 'suspended' where id = ${nia.id}`;
    const refused = await buildings.removeFloor(admin.id, { rsn: RSN_A, floorId: floor(RSN_A, "G") });
    expect(!refused.ok && refused.ambassadors?.map((ambassador) => ambassador.name)).toEqual(["Nia Mensah"]);
  });

  it("removes the floor once the assignment is gone, and a whole-building assignment does not block it", async () => {
    const nia = await person("ambassador");
    const omar = await person("ambassador");
    await assignments.assign(admin.id, { staffId: omar.id, rsn: RSN_A, floorIds: null });
    await assignments.assign(admin.id, { staffId: nia.id, rsn: RSN_A, floorIds: [floor(RSN_A, "M")] });
    expect((await buildings.removeFloor(admin.id, { rsn: RSN_A, floorId: floor(RSN_A, "M") })).ok).toBe(false);

    await assignments.remove(admin.id, { staffId: nia.id, rsn: RSN_A });
    expect((await buildings.removeFloor(admin.id, { rsn: RSN_A, floorId: floor(RSN_A, "M") })).ok).toBe(true);
    expect(await assignments.coversFloor(RSN_A, floor(RSN_A, "G"))).toBe(true);
  });

  it("never lets an assignment and the removal of its floor both succeed when they race", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await owner`delete from ambassador_assignment`;
      const target = uuidv7();
      await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${target}, ${RSN_A}, ${`R${attempt}`}, ${100 + attempt}, true)`;
      const nia = await person("ambassador");

      const [assigned, removed] = await Promise.all([
        assignments.assign(admin.id, { staffId: nia.id, rsn: RSN_A, floorIds: [target] }),
        buildings.removeFloor(admin.id, { rsn: RSN_A, floorId: target }),
      ]);

      expect(assigned.ok && removed.ok, `attempt ${attempt}: both succeeded`).toBe(false);
      const still = (await owner`select count(*)::int as n from building_floor where id = ${target}`)[0].n;
      const listed = (await owner`select count(*)::int as n from ambassador_assignment_floor where floor_id = ${target}`)[0].n;
      // Either the floor is gone and nobody lists it, or it is there (and listed when the assignment won).
      expect(still === 0 ? listed === 0 : true).toBe(true);
      expect(assigned.ok).toBe(still === 1 && listed === 1);
    }
  });
});

describe("the database's own guards", () => {
  it("refuses to delete a floor an assignment lists, whoever runs the delete, with a foreign key violation", async () => {
    const nia = await person("ambassador");
    await assignments.assign(admin.id, { staffId: nia.id, rsn: RSN_A, floorIds: [floor(RSN_A, "G")] });

    const asApp = app.$client`delete from building_floor where id = ${floor(RSN_A, "G")}`;
    await expect(asApp).rejects.toMatchObject({ code: "23503", constraint_name: "ambassador_assignment_floor_floor_fk" });
    await expect(owner`delete from building_floor where id = ${floor(RSN_A, "G")}`).rejects.toMatchObject({ code: "23503", constraint_name: "ambassador_assignment_floor_floor_fk" });
    expect((await owner`select count(*)::int as n from building_floor where id = ${floor(RSN_A, "G")}`)[0].n).toBe(1);

    // An unlisted floor, and a floor a whole-building assignment covers, delete freely.
    await expect(owner`delete from building_floor where id = ${floor(RSN_A, "3")}`).resolves.toBeDefined();
  });

  it("refuses to delete a building that has assignments", async () => {
    const nia = await person("ambassador");
    await assignments.assign(admin.id, { staffId: nia.id, rsn: RSN_B, floorIds: null });
    await expect(owner`delete from building where rsn = ${RSN_B}`).rejects.toMatchObject({ code: "23503" });
  });

  it("refuses a listed floor of another building (a trigger on insert)", async () => {
    const nia = await person("ambassador");
    await expect(
      owner.begin(async (tx) => {
        await tx`insert into ambassador_assignment (staff_id, rsn, all_floors, assigned_by) values (${nia.id}, ${RSN_A}, false, ${admin.id})`;
        await tx`insert into ambassador_assignment_floor (staff_id, rsn, floor_id) values (${nia.id}, ${RSN_A}, ${floor(RSN_B, "1")})`;
      }),
    ).rejects.toMatchObject({ code: "23503", constraint_name: "ambassador_assignment_floor_same_building" });
  });

  it("refuses, when the transaction ends, an assignment that is both every floor and a list, or neither", async () => {
    const nia = await person("ambassador");
    await expect(
      owner.begin(async (tx) => {
        await tx`insert into ambassador_assignment (staff_id, rsn, all_floors, assigned_by) values (${nia.id}, ${RSN_A}, true, ${admin.id})`;
        await tx`insert into ambassador_assignment_floor (staff_id, rsn, floor_id) values (${nia.id}, ${RSN_A}, ${floor(RSN_A, "G")})`;
      }),
    ).rejects.toMatchObject({ code: "23514", constraint_name: "ambassador_assignment_floors_shape" });
    await expect(
      owner.begin(async (tx) => {
        await tx`insert into ambassador_assignment (staff_id, rsn, all_floors, assigned_by) values (${nia.id}, ${RSN_A}, false, ${admin.id})`;
      }),
    ).rejects.toMatchObject({ code: "23514", constraint_name: "ambassador_assignment_floors_shape" });
    expect((await owner`select count(*)::int as n from ambassador_assignment`)[0].n).toBe(0);

    // The app's own replace (delete the floor rows, insert the new ones) passes at the end of its transaction.
    await assignments.assign(admin.id, { staffId: nia.id, rsn: RSN_A, floorIds: [floor(RSN_A, "G")] });
    await expect(owner`delete from ambassador_assignment_floor where staff_id = ${nia.id}`).rejects.toMatchObject({ constraint_name: "ambassador_assignment_floors_shape" });
    await expect(owner`update ambassador_assignment set all_floors = true where staff_id = ${nia.id}`).rejects.toMatchObject({ constraint_name: "ambassador_assignment_floors_shape" });
  });

  it("assigns only an Ambassador, whoever inserts the row", async () => {
    const coordinator = await person("coordinator");
    await expect(owner`insert into ambassador_assignment (staff_id, rsn, all_floors, assigned_by) values (${coordinator.id}, ${RSN_A}, true, ${admin.id})`).rejects.toMatchObject({
      code: "23514",
      constraint_name: "ambassador_assignment_ambassadors_only",
    });
  });

  it("gives the app's role its columns and no more: it never changes who or where, and no other role reaches the tables", async () => {
    const nia = await person("ambassador");
    await assignments.assign(admin.id, { staffId: nia.id, rsn: RSN_A, floorIds: null });
    const columns = (privilege: string, table: string) =>
      owner<{ column_name: string }[]>`
        select column_name from information_schema.columns
         where table_schema = 'public' and table_name = ${table}
           and has_column_privilege('cvh_app', format('public.%I', ${table}::text), column_name, ${privilege})
         order by column_name`;
    expect((await columns("UPDATE", "ambassador_assignment")).map((row) => row.column_name)).toEqual(["all_floors", "assigned_at", "assigned_by"]);
    expect((await columns("UPDATE", "ambassador_assignment_floor")).map((row) => row.column_name)).toEqual([]);
    await expect(app.$client`update ambassador_assignment set staff_id = ${admin.id} where staff_id = ${nia.id}`).rejects.toMatchObject({ code: "42501" });
    await expect(app.$client`update ambassador_assignment set rsn = ${RSN_B} where staff_id = ${nia.id}`).rejects.toMatchObject({ code: "42501" });
    for (const table of ["ambassador_assignment", "ambassador_assignment_floor"]) {
      const [row] = await owner`
        select c.relrowsecurity as rls,
               has_table_privilege('anon', format('public.%I', ${table}::text), 'select') as anon,
               has_table_privilege('authenticated', format('public.%I', ${table}::text), 'select') as authenticated,
               has_table_privilege('service_role', format('public.%I', ${table}::text), 'select') as service_role,
               has_table_privilege('cvh_app', format('public.%I', ${table}::text), 'truncate') as truncate
          from pg_class c where c.oid = format('public.%I', ${table}::text)::regclass`;
      expect(row).toEqual({ rls: true, anon: false, authenticated: false, service_role: false, truncate: false });
    }
  });
});
