// The places module against a real database (S01.13): the buildings seed run as the migrating role
// (idempotent upsert, floors only for a new building, "not in latest register", whole-import rollback,
// the seed.run audit event), and the Admin's floor editing run as the app's own role (cvh_app_login):
// label rules, rename keeping the id, removal refused for a floor with assignments (a stub, until S01.14),
// confirmation, one audit record per change, and the grants and RLS of the three tables.
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { main as seedBuildings } from "../../scripts/seed/buildings-seed";
import { record, recordRefusal, type AuditEvent } from "../../src/modules/audit";
import {
  BuildingImportRefusedError,
  createBuildingService,
  formatImportReport,
  importBuildings,
  planBuildingImport,
  readMergeFile,
  readPublicBuilding,
  readRegisterFile,
  type AssignedAmbassador,
  type BuildingService,
  type FloorAssignments,
  type ImportPlan,
  type PlacesAudit,
} from "../../src/modules/places";
import { createDb, type Db } from "../../src/platform/db";
import { ROOT, connect, serverUrl } from "./helpers";

const ADMIN = randomUUID();
// What was typed, in any of the forms the tests use; never the bare digits 555, which a random id can contain.
const PHONE_TYPED = /555[\s-]?0123/;
const REGISTER = path.join(ROOT, "data", "seed", "apartment_building_reg.geojson");

/** The audit module's writers, as the composition roots wire them into places. */
const writeAudit = vi.fn(record);
const audit: PlacesAudit = {
  record: (tx, event) => writeAudit(tx, event as AuditEvent),
  recordRefusal: (db, event) => recordRefusal(db, event as AuditEvent),
};

/** A register feature of the pilot (M4H unless told otherwise). */
function feature(rsn: number, props: Record<string, unknown> = {}) {
  const base = {
    RSN: rsn,
    PCODE: "M4H",
    SITE_ADDRESS: `${rsn}  TEST ST `,
    CONFIRMED_STOREYS: 3,
    NO_OF_ELEVATORS: 2,
    IS_THERE_EMERGENCY_POWER: "YES",
    IS_THERE_A_COOLING_ROOM: "NO",
    AIR_CONDITIONING_TYPE: "NONE",
    BARRIER_FREE_ACCESSIBILTY_ENTR: "YES",
    LONGITUDE: -79.34,
    LATITUDE: 43.7,
    ...props,
  };
  return { type: "Feature", properties: base, geometry: { type: "Point", coordinates: [base.LONGITUDE, base.LATITUDE] } };
}

const planOf = (features: unknown[], merges: Parameters<typeof planBuildingImport>[1] = []): ImportPlan => planBuildingImport(features, merges, { checkCounts: false });

let owner: ReturnType<typeof connect>;
let seedDb: Db;
let app: Db;
let assigned: AssignedAmbassador[] = [];
let service: BuildingService;

const assignments: FloorAssignments = { onFloor: async (_executor, floor) => (floor.floorId === assignedFloor ? assigned : []) };
let assignedFloor = "";

const seed = (plan: ImportPlan, extra: { now?: Date } = {}) => importBuildings(seedDb, plan, { audit, now: extra.now ? () => extra.now! : undefined });

async function clear() {
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await tx`delete from audit_event where subject_type in ('building', 'buildings')`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
    await tx.unsafe("truncate building_floor, building, neighbourhood cascade");
  });
}

beforeAll(async () => {
  owner = connect(serverUrl());
  await migrate({ sql: owner, log: () => {} });
  await owner`insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password)
              values (${ADMIN}, ${randomUUID()}, ${`bld_${randomBytes(4).toString("hex")}`}, 'Bea', 'Admin', 'bea@example.org', 'admin', false)`;
  seedDb = createDb(serverUrl());
  const password = randomBytes(18).toString("hex");
  await owner.unsafe(`alter role cvh_app_login password '${password}'`);
  const url = new URL(serverUrl());
  url.username = "cvh_app_login";
  url.password = password;
  app = createDb(url.href);
  service = createBuildingService({ db: app, audit, assignments });
});

afterAll(async () => {
  await clear();
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await tx`delete from audit_event where actor_staff_id = ${ADMIN}`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
    await tx`delete from staff_account where id = ${ADMIN}`;
  });
  await app?.$client.end({ timeout: 5 });
  await seedDb?.$client.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

beforeEach(async () => {
  writeAudit.mockClear();
  writeAudit.mockImplementation(record);
  assigned = [];
  assignedFloor = "";
  await clear();
});

const auditRows = () => owner<{ action: string; outcome: string; actor_staff_id: string | null; subject_type: string; subject_id: string | null; meta: Record<string, unknown> }[]>`
  select action, outcome, actor_staff_id, subject_type, subject_id, meta from audit_event where subject_type in ('building', 'buildings') order by id`;
const floorsOf = (rsn: string) => owner<{ id: string; label: string; sort_order: number; confirmed: boolean }[]>`select id, label, sort_order, confirmed from building_floor where rsn = ${rsn} order by sort_order, label`;
const buildingRow = async (rsn: string) => (await owner`select * from building where rsn = ${rsn}`)[0];

describe("the buildings seed, with the real City register", () => {
  const realPlan = () => planBuildingImport(readRegisterFile(REGISTER), readMergeFile(path.join(ROOT, "data", "seed", "building-merge.csv")).entries);

  it("upserts exactly the 43 buildings of M4H and M3C by rsn, with floors 1 to N unconfirmed, and audits seed.run with counts", async () => {
    const plan = realPlan();
    const result = await seed(plan);

    expect((await owner`select count(*)::int as n from building`)[0].n).toBe(43);
    expect(await owner`select neighbourhood_id, count(*)::int as n from building group by 1 order by 1`).toMatchObject([
      { neighbourhood_id: "FP", n: 11 },
      { neighbourhood_id: "TP", n: 32 },
    ]);
    expect(await owner`select id, name, fsa from neighbourhood order by id`).toMatchObject([
      { id: "FP", name: "Flemingdon Park", fsa: "M3C" },
      { id: "TP", name: "Thorncliffe Park", fsa: "M4H" },
    ]);
    expect(await buildingRow("4154146")).toMatchObject({
      rsn: "4154146",
      neighbourhood_id: "TP",
      address: "4 Milepost Pl",
      latitude: 43.702327237,
      longitude: -79.348434827,
      storeys: 6,
      elevators: 2,
      emergency_power: true,
      cooling_room: true,
      air_conditioning: "None",
      barrier_free_entrance: true,
      not_in_register_since: null,
      floors_confirmed_at: null,
      floors_confirmed_by: null,
    });

    const storeys = (await owner`select coalesce(sum(storeys), 0)::int as n from building`)[0].n as number;
    expect(result.counts).toMatchObject({ buildings_loaded: 43, buildings_inserted: 43, buildings_updated: 0, buildings_unchanged: 0, floors_created: storeys });
    expect((await owner`select count(*)::int as n from building_floor`)[0].n).toBe(storeys);
    const floors = await floorsOf("4154146");
    expect(floors.map((f) => [f.label, f.sort_order, f.confirmed])).toEqual([1, 2, 3, 4, 5, 6].map((n) => [String(n), n, false]));
    expect(new Set(floors.map((f) => f.id)).size).toBe(6);
    expect((await owner`select count(*)::int as n from building_floor where confirmed`)[0].n).toBe(0);
    expect((await floorsOf("4154159")).map((f) => f.label)).toHaveLength(43);

    // The duplicate address stays two buildings, with the warning in the report.
    expect(await owner`select rsn from building where address = '85-95 Thorncliffe Park Dr' order by rsn`).toMatchObject([{ rsn: "4154159" }, { rsn: "4237447" }]);
    expect(result.warnings).toHaveLength(1);
    expect(formatImportReport(plan, { counts: { ...result.counts }, warnings: result.warnings }).join("\n")).toContain("2 registrations share this address");

    expect(await auditRows()).toEqual([
      {
        action: "seed.run",
        outcome: "ok",
        actor_staff_id: null,
        subject_type: "buildings",
        subject_id: null,
        meta: {
          seed: "buildings",
          counts: { buildings_loaded: 43, buildings_inserted: 43, buildings_updated: 0, buildings_unchanged: 0, buildings_restored: 0, buildings_flagged: 0, buildings_merged: 0, floors_created: storeys },
          warnings: 1,
          failures: 0,
        },
      },
    ]);
  });

  it("changes nothing when run again", async () => {
    const plan = realPlan();
    await seed(plan, { now: new Date("2026-10-05T12:00:00Z") });
    const before = { buildings: await owner`select * from building order by rsn`, floors: await owner`select * from building_floor order by rsn, sort_order` };

    const second = await seed(plan, { now: new Date("2026-11-01T12:00:00Z") });

    expect(second.counts).toMatchObject({ buildings_inserted: 0, buildings_updated: 0, buildings_unchanged: 43, buildings_restored: 0, buildings_flagged: 0, floors_created: 0 });
    expect({ buildings: await owner`select * from building order by rsn`, floors: await owner`select * from building_floor order by rsn, sort_order` }).toEqual(before);
    expect((await auditRows()).map((row) => row.action)).toEqual(["seed.run", "seed.run"]);
  });
});

describe("the buildings seed, with fixture registers", () => {
  const register = (...extra: ReturnType<typeof feature>[]) => [feature(101, { SITE_ADDRESS: "1  AAA ST " }), feature(102, { SITE_ADDRESS: "2  BBB ST ", PCODE: "M3C", CONFIRMED_STOREYS: 4 }), ...extra];

  it("updates facts and their last-updated time when the register changed, and never touches the floors, confirmed or not", async () => {
    await seed(planOf(register()), { now: new Date("2026-10-05T12:00:00Z") });
    const [first, second] = [await buildingRow("101"), await buildingRow("102")];
    // An Admin confirmed building 101 and renamed its floor 2 to "G".
    const floors = await floorsOf("101");
    await owner`update building_floor set label = 'G', confirmed = true where id = ${floors[1].id}`;
    await owner`update building set floors_confirmed_at = '2026-10-06T00:00:00Z', floors_confirmed_by = ${ADMIN} where rsn = '101'`;
    const floorsBefore = await owner`select * from building_floor order by rsn, sort_order`;

    const later = new Date("2026-11-01T12:00:00Z");
    const changed = register();
    changed[0].properties.NO_OF_ELEVATORS = 5;
    changed[0].properties.CONFIRMED_STOREYS = 9;
    changed[0].properties.IS_THERE_EMERGENCY_POWER = "NO";
    changed[0].properties.SITE_ADDRESS = "1  AAA STREET ";
    const result = await seed(planOf(changed), { now: later });

    expect(result.counts).toMatchObject({ buildings_inserted: 0, buildings_updated: 1, buildings_unchanged: 1, floors_created: 0 });
    const after = await buildingRow("101");
    expect(after).toMatchObject({ elevators: 5, storeys: 9, emergency_power: false, address: "1 Aaa Street" });
    expect(after.facts_updated_at).toEqual(later);
    expect(first.facts_updated_at).toEqual(new Date("2026-10-05T12:00:00Z"));
    expect(after.floors_confirmed_at).toEqual(new Date("2026-10-06T00:00:00Z"));
    expect((await buildingRow("102")).facts_updated_at).toEqual(second.facts_updated_at);
    expect(await owner`select * from building_floor order by rsn, sort_order`).toEqual(floorsBefore);
    expect((await floorsOf("101")).map((f) => f.label)).toEqual(["1", "G", "3"]);
    expect(result.warnings.map((w) => w.message)).toEqual(["the register now says 9 storeys (it said 3); the floors were not changed: check them at /staff/buildings"]);
  });

  it("flags a building the register no longer lists, keeps it and its floors, and clears the flag when it returns", async () => {
    await seed(planOf(register()), { now: new Date("2026-10-05T12:00:00Z") });

    const gone = await seed(planOf([register()[0]]), { now: new Date("2026-11-01T12:00:00Z") });
    expect(gone.counts).toMatchObject({ buildings_flagged: 1, buildings_unchanged: 1 });
    expect(gone.notInRegister).toEqual([{ rsn: "102", address: "2 Bbb St", since: new Date("2026-11-01T12:00:00Z") }]);
    expect(gone.warnings.map((w) => w.message)).toContain("not in latest register: kept, flagged for an Admin to review at /staff/buildings");
    expect((await buildingRow("102")).not_in_register_since).toEqual(new Date("2026-11-01T12:00:00Z"));
    expect((await buildingRow("101")).not_in_register_since).toBeNull();
    expect(await floorsOf("102")).toHaveLength(4);

    // Still missing a month later: it stays flagged since the first time, and is not flagged again.
    const still = await seed(planOf([register()[0]]), { now: new Date("2026-12-01T12:00:00Z") });
    expect(still.counts.buildings_flagged).toBe(0);
    expect((await buildingRow("102")).not_in_register_since).toEqual(new Date("2026-11-01T12:00:00Z"));
    expect((await owner`select count(*)::int as n from building`)[0].n).toBe(2);

    const back = await seed(planOf(register()), { now: new Date("2027-01-01T12:00:00Z") });
    expect(back.counts).toMatchObject({ buildings_restored: 1, buildings_updated: 0, buildings_unchanged: 2 });
    expect((await buildingRow("102")).not_in_register_since).toBeNull();
    expect(await floorsOf("102")).toHaveLength(4);
  });

  it("creates floors only for a building seen for the first time, and none when the register gives no storeys", async () => {
    await seed(planOf([feature(103, { CONFIRMED_STOREYS: null })]));
    expect(await floorsOf("103")).toEqual([]);
    expect((await buildingRow("103")).storeys).toBeNull();

    const result = await seed(planOf([feature(103, { CONFIRMED_STOREYS: 5 })]));
    expect(await floorsOf("103")).toEqual([]);
    expect(result.warnings.map((w) => w.message)).toEqual(["the register now says 5 storeys and the building has no floors: add them at /staff/buildings"]);
  });

  it("rolls back the whole import and reports every failing row when any row fails, leaving what was there as it was", async () => {
    await seed(planOf(register()), { now: new Date("2026-10-05T12:00:00Z") });
    const before = { buildings: await owner`select * from building order by rsn`, floors: await owner`select * from building_floor order by rsn, sort_order`, neighbourhoods: await owner`select * from neighbourhood order by id` };
    const bad = [
      feature(101, { NO_OF_ELEVATORS: 9 }),
      feature(104, { RSN: null }),
      feature(105, { LATITUDE: 45.4, LONGITUDE: -75.7 }),
      feature(106),
      feature(106, { SITE_ADDRESS: "6  OTHER ST" }),
      feature(107, { CONFIRMED_STOREYS: 50 }),
    ];
    const plan = planOf(bad);

    const error = await seed(plan).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BuildingImportRefusedError);
    const failures = (error as BuildingImportRefusedError).failures;
    expect(failures.map((f) => [f.row, f.rsn, f.message.split(" ").slice(0, 3).join(" ")])).toEqual([
      [2, null, "missing rsn (RSN)"],
      [3, "105", "coordinates 45.4, -75.7"],
      [4, "106", "rsn 106 appears"],
      [5, "106", "rsn 106 appears"],
    ]);
    expect(formatImportReport(plan).filter((line) => line.startsWith("  - "))).toHaveLength(4);
    expect({ buildings: await owner`select * from building order by rsn`, floors: await owner`select * from building_floor order by rsn, sort_order`, neighbourhoods: await owner`select * from neighbourhood order by id` }).toEqual(before);
    const refusals = (await auditRows()).filter((row) => row.outcome === "refused");
    expect(refusals).toEqual([{ action: "seed.run", outcome: "refused", actor_staff_id: null, subject_type: "buildings", subject_id: null, meta: { seed: "buildings", warnings: 0, failures: 4 } }]);
  });

  it("rolls back the buildings, floors and neighbourhoods when the audit event cannot be recorded", async () => {
    writeAudit.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(seed(planOf(register()))).rejects.toThrow("audit unavailable");
    expect((await owner`select count(*)::int as n from building`)[0].n).toBe(0);
    expect((await owner`select count(*)::int as n from building_floor`)[0].n).toBe(0);
    expect((await owner`select count(*)::int as n from neighbourhood`)[0].n).toBe(0);
  });

  it("keeps two registrations at one address as two buildings with a warning, and loads one when the merge file maps them", async () => {
    const twins = [feature(201, { SITE_ADDRESS: "85-95  THORNCLIFFE PARK DR " }), feature(202, { SITE_ADDRESS: "85-95  THORNCLIFFE PARK DR " })];
    const apart = await seed(planOf(twins));
    expect(apart.counts.buildings_inserted).toBe(2);
    expect(apart.warnings).toHaveLength(1);

    await clear();
    const merged = await seed(planOf(twins, [{ line: 2, rsn: "202", primaryRsn: "201" }]));
    expect(merged.counts).toMatchObject({ buildings_loaded: 1, buildings_inserted: 1, buildings_merged: 1 });
    expect(merged.warnings).toEqual([]);
    expect((await owner`select rsn from building order by rsn`).map((row) => row.rsn)).toEqual(["201"]);
  });

  it("reports a building loaded before and now merged into another as merged, not as missing from the register", async () => {
    const twins = [feature(201, { SITE_ADDRESS: "85-95  THORNCLIFFE PARK DR " }), feature(202, { SITE_ADDRESS: "85-95  THORNCLIFFE PARK DR " })];
    await seed(planOf(twins));

    const merged = await seed(planOf(twins, [{ line: 2, rsn: "202", primaryRsn: "201" }]));

    expect(merged.notInRegister).toEqual([]);
    expect(merged.counts.buildings_flagged).toBe(0);
    expect(merged.warnings.map((warning) => warning.message)).toEqual([expect.stringContaining("merged into rsn 201")]);
    expect(merged.warnings.some((warning) => warning.message.includes("not in latest register"))).toBe(false);
    expect((await owner`select rsn, not_in_register_since from building order by rsn`).map((row) => [row.rsn, row.not_in_register_since])).toEqual([["201", null], ["202", null]]);
  });
});

describe("the app's role and the buildings tables", () => {
  beforeEach(async () => {
    await seed(planOf([feature(301, { CONFIRMED_STOREYS: 2 })]));
  });

  it("reads the three tables, and may only confirm a building and edit floors", async () => {
    const as = async (statement: string) => {
      try {
        await app.$client.unsafe(statement);
        return "ok";
      } catch (error) {
        return (error as { code?: string }).code ?? "error";
      }
    };
    expect(await as("select count(*) from neighbourhood")).toBe("ok");
    expect(await as("select count(*) from building")).toBe("ok");
    expect(await as("select count(*) from building_floor")).toBe("ok");
    // No building or neighbourhood is added, removed or changed by the app, but for the confirmation.
    expect(await as("insert into neighbourhood (id, name, fsa) values ('ZZ', 'Z', 'M1M')")).toBe("42501");
    expect(await as("insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at) values ('9', 'TP', 'x', 43.7, -79.3, now())")).toBe("42501");
    expect(await as("delete from building where rsn = '301'")).toBe("42501");
    expect(await as("update building set address = 'Elsewhere' where rsn = '301'")).toBe("42501");
    expect(await as("update neighbourhood set name = 'X'")).toBe("42501");
    expect(await as("update building set floors_confirmed_at = null where rsn = '301'")).toBe("ok");
    expect(await as("truncate building_floor")).toBe("42501");
  });

  it("updates only the confirm columns of building, and only label, sort_order and confirmed of building_floor", async () => {
    const as = async (statement: string) => {
      try {
        await app.$client.unsafe(statement);
        return "ok";
      } catch (error) {
        return (error as { code?: string }).code ?? "error";
      }
    };
    const [floor] = await owner`select id from building_floor where rsn = '301' order by sort_order limit 1`;
    const floorWhere = `where id = '${floor.id}'`;
    expect(await as(`update building_floor set label = 'Z1' ${floorWhere}`)).toBe("ok");
    expect(await as(`update building_floor set sort_order = 20 ${floorWhere}`)).toBe("ok");
    expect(await as(`update building_floor set confirmed = true ${floorWhere}`)).toBe("ok");
    expect(await as(`update building_floor set rsn = '9' ${floorWhere}`)).toBe("42501");
    expect(await as(`update building_floor set id = '${randomUUID()}' ${floorWhere}`)).toBe("42501");
    expect(await as(`update building_floor set created_at = now() ${floorWhere}`)).toBe("42501");
    // A generated column: refused as such (428C9) before the privilege is looked at.
    expect(await as(`update building_floor set label_key = 'x' ${floorWhere}`)).toBe("428C9");
    expect(await as("update building set rsn = '302' where rsn = '301'")).toBe("42501");
    expect(await as("update building set not_in_register_since = now() where rsn = '301'")).toBe("42501");
    expect(await as("update building set facts_updated_at = now() where rsn = '301'")).toBe("42501");
    expect(await as("update building set storeys = 3 where rsn = '301'")).toBe("42501");
    expect(await as("update building set floors_confirmed_at = null, floors_confirmed_by = null where rsn = '301'")).toBe("ok");
    // The contact (S02.08): its four columns, all or none, and nothing else of the register's.
    expect(await as("update building set contact_role = 'superintendent', contact_phone = '+14165550123', contact_owner = 'hub', contact_updated_at = now() where rsn = '301'")).toBe("ok");
    expect(await as("update building set contact_role = null, contact_phone = null, contact_owner = null, contact_updated_at = null where rsn = '301'")).toBe("ok");
  });

  it("refuses a half contact, a number or owner it does not allow, whatever the app says", async () => {
    const as = async (statement: string) => {
      try {
        await app.$client.unsafe(statement);
        return "ok";
      } catch (error) {
        return (error as { code?: string; constraint_name?: string }).constraint_name ?? "error";
      }
    };
    expect(await as("update building set contact_role = 'superintendent' where rsn = '301'")).toBe("building_contact_complete");
    const full = (role: string, phone: string, owner = "hub") =>
      `update building set contact_role = '${role}', contact_phone = '${phone}', contact_owner = '${owner}', contact_updated_at = now() where rsn = '301'`;
    expect(await as(full("property_office", "+16475550199"))).toBe("ok");
    // The number is stored as E.164: not as typed, not with a bad area code or exchange, not another country's.
    for (const phone of ["555-0123", "416-555-0123", "(416) 555-0123", "4165550123", "+1416555012", "+14165550123 ", "+11165550123", "+14161550123", "+442079460958"]) {
      expect(await as(full("superintendent", phone)), phone).toBe("building_contact_phone_valid");
    }
    expect(await as(full("superintendent", "+14165550123", "landlord"))).toBe("building_contact_owner_valid");
    // The role is one of the fixed list, as a code: not free text, not a label, not a personal name.
    for (const role of ["Superintendent", "Super", "Ahmed Khan", " superintendent", "building management", ""]) {
      expect(await as(full(role, "+14165550123")), role).toBe("building_contact_role_valid");
    }
  });

  it("is the only role besides the owner that reaches the tables: anon, authenticated and service_role have no privilege on them", async () => {
    const rows = await owner`
      select r.rolname, c.relname, has_table_privilege(r.rolname, c.oid, 'select, insert, update, delete, truncate, references, trigger') as any_privilege,
             c.relrowsecurity as rls
      from pg_roles r cross join pg_class c
      where r.rolname in ('anon', 'authenticated', 'service_role') and c.relname in ('neighbourhood', 'building', 'building_floor') and c.relkind = 'r'`;
    expect(rows).toHaveLength(9);
    for (const row of rows) {
      expect(row.any_privilege, `${row.rolname} on ${row.relname}`).toBe(false);
      expect(row.rls, row.relname).toBe(true);
    }
  });

  it("refuses a floor label the table does not allow, whatever the app says", async () => {
    const [{ id }] = await floorsOf("301");
    for (const label of ["", " ", " G", "G ", "123456789", "1.5", "é", "-", "- -", "  ", "P  1", "1  2"]) {
      await expect(owner`update building_floor set label = ${label} where id = ${id}`, JSON.stringify(label)).rejects.toThrow();
    }
    await expect(owner`insert into building_floor (id, rsn, label, sort_order) values (${randomUUID()}, '301', ' 1', 9)`).rejects.toThrow();
    await expect(owner`insert into building_floor (id, rsn, label, sort_order) values (${randomUUID()}, '301', '1', 9)`).rejects.toThrow(/building_floor_label_unique/);
    await expect(owner`insert into building_floor (id, rsn, label, sort_order) values (${randomUUID()}, '301', 'P 1', 9)`).resolves.toBeDefined();
    await expect(owner`insert into building_floor (id, rsn, label, sort_order) values (${randomUUID()}, '301', 'p1', 10)`).rejects.toThrow(/building_floor_label_unique/);
  });
});

describe("the building page's reader (S02.08)", () => {
  beforeEach(async () => {
    await seed(planOf([feature(501, { CONFIRMED_STOREYS: 9, NO_OF_ELEVATORS: 0, IS_THERE_A_COOLING_ROOM: null, IS_THERE_EMERGENCY_POWER: "NO" }), feature(502, { AIR_CONDITIONING_TYPE: null })]));
  });

  it("reads one building with the facts the story lists, and not a staff-only field", async () => {
    await service.confirmBuilding(ADMIN, { rsn: "501" });
    const building = await readPublicBuilding(app, "501");

    expect(building).toEqual({
      rsn: "501",
      address: "501 Test St",
      neighbourhoodName: "Thorncliffe Park",
      neighbourhoodId: "TP",
      storeys: 9,
      elevators: 0,
      emergencyPower: false,
      coolingRoom: null,
      airConditioning: "None",
      barrierFreeEntrance: true,
      factsUpdatedAt: expect.any(Date),
      checkingDetails: false,
      contact: null,
    });
    // The confirmation's author, the coordinates and the floors never leave the module for a resident.
    expect(Object.keys(building!).sort()).toEqual(
      ["address", "airConditioning", "barrierFreeEntrance", "checkingDetails", "contact", "coolingRoom", "elevators", "emergencyPower", "factsUpdatedAt", "neighbourhoodId", "neighbourhoodName", "rsn", "storeys"].sort(),
    );
    expect(JSON.stringify(building)).not.toContain(ADMIN);
  });

  it("keeps a missing fact null (not known) and zero elevators 0", async () => {
    expect(await readPublicBuilding(app, "502")).toMatchObject({ airConditioning: null });
    expect(await readPublicBuilding(app, "501")).toMatchObject({ elevators: 0, coolingRoom: null });
  });

  it("opens a building that the latest register no longer lists, flagged as being checked", async () => {
    await seed(planOf([feature(502)]));
    expect(await readPublicBuilding(app, "501")).toMatchObject({ rsn: "501", checkingDetails: true });
    expect(await readPublicBuilding(app, "502")).toMatchObject({ checkingDetails: false });
  });

  it("returns nothing for a building that does not exist or a number that is not one", async () => {
    expect(await readPublicBuilding(app, "999")).toBeNull();
    expect(await readPublicBuilding(app, "5; drop table building")).toBeNull();
    expect(await readPublicBuilding(app, "")).toBeNull();
  });
});

describe("the building contact (S02.08)", () => {
  beforeEach(async () => {
    await seed(planOf([feature(601), feature(602)]));
    writeAudit.mockClear();
  });

  const NOW = new Date("2026-10-01T15:00:00Z");

  it("saves the role code and the E.164 number with the Hub as owner and the date, audits building.contact_changed, and shows it to residents", async () => {
    const dated = createBuildingService({ db: app, audit, assignments, now: () => NOW });

    const saved = await dated.setContact(ADMIN, { rsn: "601", role: "superintendent", phone: "(416) 555-0123", workNumber: true });

    const contact = { role: "superintendent", phone: "+14165550123", owner: "hub", updatedAt: NOW };
    expect(saved).toEqual({ ok: true, value: { contact } });
    expect(await buildingRow("601")).toMatchObject({ contact_role: "superintendent", contact_phone: "+14165550123", contact_owner: "hub", contact_updated_at: NOW });
    expect(await buildingRow("602")).toMatchObject({ contact_role: null, contact_owner: null });
    expect((await auditRows()).at(-1)).toMatchObject({ action: "building.contact_changed", outcome: "ok", actor_staff_id: ADMIN, subject_type: "building", subject_id: "601", meta: {} });
    expect(JSON.stringify((await auditRows()).at(-1))).not.toMatch(PHONE_TYPED);
    expect((await dated.getBuilding("601"))?.contact).toEqual(contact);
    expect((await readPublicBuilding(app, "601"))?.contact).toEqual(contact);
    expect((await readPublicBuilding(app, "602"))?.contact).toBeNull();
  });

  it("changes the contact and its date, and refuses saving the same contact again so the date means last changed", async () => {
    const first = createBuildingService({ db: app, audit, assignments, now: () => NOW });
    await first.setContact(ADMIN, { rsn: "601", role: "superintendent", phone: "416 555 0123", workNumber: true });
    const later = createBuildingService({ db: app, audit, assignments, now: () => new Date("2026-10-02T09:00:00Z") });

    expect(await later.setContact(ADMIN, { rsn: "601", role: "superintendent", phone: "416-555-0123", workNumber: true })).toEqual({ ok: false, error: "no_change" });
    expect((await buildingRow("601")).contact_updated_at).toEqual(NOW);
    expect(await later.setContact(ADMIN, { rsn: "601", role: "superintendent", phone: "416 555 0199", workNumber: true })).toMatchObject({ ok: true });
    expect(await buildingRow("601")).toMatchObject({ contact_phone: "+14165550199", contact_updated_at: new Date("2026-10-02T09:00:00Z") });
  });

  it("removes the contact when both fields are empty, audited as cleared, and residents then see none", async () => {
    await service.setContact(ADMIN, { rsn: "601", role: "superintendent", phone: "416 555 0123", workNumber: true });

    expect(await service.setContact(ADMIN, { rsn: "601", role: " ", phone: "", workNumber: false })).toEqual({ ok: true, value: { contact: null } });
    expect(await buildingRow("601")).toMatchObject({ contact_role: null, contact_phone: null, contact_owner: null, contact_updated_at: null });
    expect((await auditRows()).at(-1)).toMatchObject({ action: "building.contact_changed", outcome: "ok", meta: { cleared: true } });
    expect((await readPublicBuilding(app, "601"))?.contact).toBeNull();
    // Nothing to remove: refused, not audited as a change.
    expect(await service.setContact(ADMIN, { rsn: "601", role: "", phone: "", workNumber: false })).toEqual({ ok: false, error: "no_change" });
  });

  it.each([
    [{ role: "superintendent", phone: "", workNumber: true }, "role_without_phone"],
    [{ role: "", phone: "416 555 0123", workNumber: true }, "phone_without_role"],
    [{ role: "superintendent", phone: "555-0123", workNumber: true }, "phone_invalid"],
    [{ role: "Ahmed Khan", phone: "416 555 0123", workNumber: true }, "role_invalid"],
    [{ role: "<script>", phone: "416 555 0123", workNumber: true }, "role_invalid"],
    [{ role: "superintendent", phone: "416 555 0123", workNumber: false }, "not_work_number"],
  ] as const)("refuses %j (%s), saves nothing and audits the refusal without what was typed", async (input, error) => {
    expect(await service.setContact(ADMIN, { rsn: "601", ...input })).toEqual({ ok: false, error });

    expect((await buildingRow("601")).contact_role).toBeNull();
    const last = (await auditRows()).at(-1)!;
    expect(last).toMatchObject({ action: "building.contact_changed", outcome: "refused", meta: { reason: "validation" } });
    expect(JSON.stringify(last)).not.toMatch(PHONE_TYPED);
    expect(JSON.stringify(last)).not.toContain("script");
  });

  it("refuses a building that does not exist", async () => {
    expect(await service.setContact(ADMIN, { rsn: "999", role: "superintendent", phone: "416 555 0123", workNumber: true })).toEqual({ ok: false, error: "building_not_found" });
  });

  it("rolls the contact back when its audit record cannot be written", async () => {
    writeAudit.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(service.setContact(ADMIN, { rsn: "601", role: "superintendent", phone: "416 555 0123", workNumber: true })).rejects.toThrow("audit unavailable");
    expect((await buildingRow("601")).contact_role).toBeNull();
  });

  it("is not touched by the register import: a facts update keeps the Hub's contact", async () => {
    await service.setContact(ADMIN, { rsn: "601", role: "superintendent", phone: "416 555 0123", workNumber: true });
    await seed(planOf([feature(601, { CONFIRMED_STOREYS: 5 }), feature(602)]));
    expect(await buildingRow("601")).toMatchObject({ storeys: 5, contact_role: "superintendent", contact_phone: "+14165550123" });
  });
});
