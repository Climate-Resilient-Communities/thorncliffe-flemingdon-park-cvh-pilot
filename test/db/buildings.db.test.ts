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
    for (const label of ["", " ", " G", "G ", "123456789", "1.5", "é"]) {
      await expect(owner`update building_floor set label = ${label} where id = ${id}`, JSON.stringify(label)).rejects.toThrow();
    }
    await expect(owner`insert into building_floor (id, rsn, label, sort_order) values (${randomUUID()}, '301', ' 1', 9)`).rejects.toThrow();
    await expect(owner`insert into building_floor (id, rsn, label, sort_order) values (${randomUUID()}, '301', '1', 9)`).rejects.toThrow(/building_floor_label_unique/);
    await expect(owner`insert into building_floor (id, rsn, label, sort_order) values (${randomUUID()}, '301', 'P 1', 9)`).resolves.toBeDefined();
    await expect(owner`insert into building_floor (id, rsn, label, sort_order) values (${randomUUID()}, '301', 'p1', 10)`).rejects.toThrow(/building_floor_label_unique/);
  });
});

describe("editing floors as an Admin", () => {
  beforeEach(async () => {
    await seed(planOf([feature(401, { CONFIRMED_STOREYS: 14 }), feature(402, { CONFIRMED_STOREYS: 2 })]));
    writeAudit.mockClear();
  });

  const labels = async (rsn = "401") => (await floorsOf(rsn)).map((f) => f.label);
  const denied = async (since?: number) => (await auditRows()).filter((row) => row.outcome === "refused").slice(since ?? 0);

  it("lists the buildings by neighbourhood and one building with its facts and floors", async () => {
    const list = await service.listBuildings();
    expect(list.map((b) => [b.rsn, b.neighbourhoodName, b.floorCount, b.storeys, b.confirmedAt])).toEqual([
      ["401", "Thorncliffe Park", 14, 14, null],
      ["402", "Thorncliffe Park", 2, 2, null],
    ]);
    const detail = await service.getBuilding("401");
    expect(detail).toMatchObject({ rsn: "401", address: "401 Test St", neighbourhoodName: "Thorncliffe Park", facts: { elevators: 2, emergencyPower: true, coolingRoom: false, airConditioning: "None", barrierFreeEntrance: true } });
    expect(detail?.floors.map((f) => f.label)).toEqual(Array.from({ length: 14 }, (_, i) => String(i + 1)));
    expect(await service.getBuilding("999")).toBeNull();
    expect(await service.getBuilding("not-a-number")).toBeNull();
  });

  it("removes floor 13, adds G and L at the bottom, and audits each change", async () => {
    const floors = await floorsOf("401");
    const thirteen = floors.find((f) => f.label === "13")!;

    const removed = await service.removeFloor(ADMIN, { rsn: "401", floorId: thirteen.id });
    const g = await service.addFloor(ADMIN, { rsn: "401", label: " G ", place: "bottom" });
    const l = await service.addFloor(ADMIN, { rsn: "401", label: "L", place: "bottom" });

    expect(removed).toMatchObject({ ok: true, value: { id: thirteen.id, label: "13" } });
    expect(g.ok && g.value.label).toBe("G");
    expect(await labels()).toEqual(["L", "G", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "14"]);
    expect((await auditRows()).filter((row) => row.subject_type === "building").map((row) => [row.action, row.outcome, row.actor_staff_id, row.subject_type, row.subject_id, row.meta])).toEqual([
      ["building.floor_removed", "ok", ADMIN, "building", "401", { floor_id: thirteen.id, label: "13", assignments: 0 }],
      ["building.floor_added", "ok", ADMIN, "building", "401", { floor_id: g.ok ? g.value.id : "", label: "G" }],
      ["building.floor_added", "ok", ADMIN, "building", "401", { floor_id: l.ok ? l.value.id : "", label: "L" }],
    ]);
  });

  it("adds a floor above the top floor by default", async () => {
    await service.addFloor(ADMIN, { rsn: "402", label: "R" });
    expect(await labels("402")).toEqual(["1", "2", "R"]);
    await service.addFloor(ADMIN, { rsn: "402", label: "PH", place: "top" });
    expect(await labels("402")).toEqual(["1", "2", "R", "PH"]);
  });

  it("adds a floor to a building that has none", async () => {
    await owner`delete from building_floor where rsn = '402'`;
    const added = await service.addFloor(ADMIN, { rsn: "402", label: "1", place: "bottom" });
    expect(added.ok).toBe(true);
    expect(await labels("402")).toEqual(["1"]);
  });

  it("renames a floor keeping its id, its place and its assignments", async () => {
    const floors = await floorsOf("401");
    const target = floors.find((f) => f.label === "3")!;
    assignedFloor = target.id;
    assigned = [{ staffId: randomUUID(), name: "Nia Mensah" }];

    const renamed = await service.renameFloor(ADMIN, { rsn: "401", floorId: target.id, label: "3A" });

    expect(renamed).toMatchObject({ ok: true, value: { id: target.id, label: "3A", previousLabel: "3" } });
    const after = await floorsOf("401");
    expect(after.find((f) => f.id === target.id)).toMatchObject({ label: "3A", sort_order: target.sort_order });
    expect(after.map((f) => f.id)).toEqual(floors.map((f) => f.id));
    // The floor is still the one the assignments name.
    expect((await auditRows()).at(-1)).toMatchObject({ action: "building.floor_renamed", outcome: "ok", meta: { floor_id: target.id, from: "3", to: "3A" } });
    // And it may be renamed only to a different label.
    expect(await service.renameFloor(ADMIN, { rsn: "401", floorId: target.id, label: " 3A " })).toEqual({ ok: false, error: "no_change" });
    // A change of capitals alone is a rename.
    expect((await service.renameFloor(ADMIN, { rsn: "401", floorId: target.id, label: "3a" })).ok).toBe(true);
  });

  it.each([
    ["is empty", "", "label_empty"],
    ["is only spaces", "   ", "label_empty"],
    ["is longer than 8 characters", "123456789", "label_too_long"],
    ["has a character that is not a letter, digit, space or hyphen", "1.5", "label_characters"],
    ["has an accent", "Étage", "label_characters"],
    ["duplicates another label", "7", "label_duplicate"],
    ["duplicates another label ignoring case and spaces", " 1 ", "label_duplicate"],
  ] as const)("refuses a label that %s, saving nothing and auditing the refusal", async (_name, label, error) => {
    const floors = await floorsOf("401");
    const target = floors.find((f) => f.label === "3")!;
    const before = await owner`select * from building_floor order by rsn, sort_order`;

    const renamed = await service.renameFloor(ADMIN, { rsn: "401", floorId: target.id, label });
    const added = await service.addFloor(ADMIN, { rsn: "401", label });

    expect(renamed).toEqual({ ok: false, error });
    expect(added).toEqual({ ok: false, error });
    expect(await owner`select * from building_floor order by rsn, sort_order`).toEqual(before);
    const reason = error === "label_duplicate" ? "duplicate" : "validation";
    expect(await denied()).toEqual([
      { action: "building.floor_renamed", outcome: "refused", actor_staff_id: ADMIN, subject_type: "building", subject_id: "401", meta: { reason, floor_id: target.id } },
      { action: "building.floor_added", outcome: "refused", actor_staff_id: ADMIN, subject_type: "building", subject_id: "401", meta: { reason } },
    ]);
  });

  it("treats the same label as free in another building, and a floor's own label as free to it", async () => {
    expect((await service.addFloor(ADMIN, { rsn: "402", label: "14" })).ok).toBe(true);
    const own = (await floorsOf("401")).find((f) => f.label === "4")!;
    expect(await service.renameFloor(ADMIN, { rsn: "401", floorId: own.id, label: "4 " })).toEqual({ ok: false, error: "no_change" });
  });

  it("refuses to remove a floor with assignments, listing the ambassadors, and removes it once they are gone", async () => {
    const target = (await floorsOf("401")).find((f) => f.label === "5")!;
    assignedFloor = target.id;
    assigned = [
      { staffId: randomUUID(), name: "Nia Mensah" },
      { staffId: randomUUID(), name: "Omar Farouk" },
    ];

    const refused = await service.removeFloor(ADMIN, { rsn: "401", floorId: target.id });

    expect(refused).toEqual({ ok: false, error: "floor_has_assignments", ambassadors: assigned });
    expect(await labels()).toContain("5");
    expect(await denied()).toEqual([
      { action: "building.floor_removed", outcome: "refused", actor_staff_id: ADMIN, subject_type: "building", subject_id: "401", meta: { reason: "floor_has_assignments", floor_id: target.id, label: "5", assignments: 2 } },
    ]);

    assigned = [];
    expect((await service.removeFloor(ADMIN, { rsn: "401", floorId: target.id })).ok).toBe(true);
    expect(await labels()).not.toContain("5");
  });

  it("refuses a floor or building that does not exist, or that belongs to another building", async () => {
    const other = (await floorsOf("402"))[0];
    expect(await service.removeFloor(ADMIN, { rsn: "401", floorId: other.id })).toEqual({ ok: false, error: "floor_not_found" });
    expect(await service.renameFloor(ADMIN, { rsn: "401", floorId: other.id, label: "Z" })).toEqual({ ok: false, error: "floor_not_found" });
    expect(await service.renameFloor(ADMIN, { rsn: "401", floorId: "not-a-uuid", label: "Z" })).toEqual({ ok: false, error: "floor_not_found" });
    expect(await service.addFloor(ADMIN, { rsn: "999", label: "Z" })).toEqual({ ok: false, error: "building_not_found" });
    expect(await service.addFloor(ADMIN, { rsn: "'; drop table building; --", label: "Z" })).toEqual({ ok: false, error: "building_not_found" });
    expect(await service.confirmBuilding(ADMIN, { rsn: "999" })).toEqual({ ok: false, error: "building_not_found" });
    expect((await denied()).every((row) => row.meta.reason === "not_found")).toBe(true);
    expect((await denied()).at(-2)?.subject_id).toBeNull();
    expect(await labels("402")).toEqual(["1", "2"]);
  });

  it("confirms a building: the building and every floor, once, audited with the number of floors", async () => {
    const confirmed = await service.confirmBuilding(ADMIN, { rsn: "402" });

    expect(confirmed).toMatchObject({ ok: true, value: { floors: 2 } });
    expect(await buildingRow("402")).toMatchObject({ floors_confirmed_by: ADMIN });
    expect((await buildingRow("402")).floors_confirmed_at).toBeInstanceOf(Date);
    expect((await floorsOf("402")).map((f) => f.confirmed)).toEqual([true, true]);
    expect((await floorsOf("401")).some((f) => f.confirmed)).toBe(false);
    expect((await auditRows()).at(-1)).toMatchObject({ action: "building.confirmed", outcome: "ok", actor_staff_id: ADMIN, subject_id: "402", meta: { floors: 2 } });

    expect(await service.confirmBuilding(ADMIN, { rsn: "402" })).toEqual({ ok: false, error: "already_confirmed" });
    expect((await denied()).at(-1)).toMatchObject({ action: "building.confirmed", meta: { reason: "conflict" } });
    // A floor added to a confirmed building is confirmed: an Admin named it.
    const added = await service.addFloor(ADMIN, { rsn: "402", label: "G", place: "bottom" });
    expect(added).toMatchObject({ ok: true, value: { confirmed: true } });
    expect((await service.getBuilding("402"))?.confirmedAt).toBeInstanceOf(Date);
  });

  it("does not confirm a building with no floors", async () => {
    await owner`delete from building_floor where rsn = '402'`;
    expect(await service.confirmBuilding(ADMIN, { rsn: "402" })).toEqual({ ok: false, error: "no_floors" });
    expect((await buildingRow("402")).floors_confirmed_at).toBeNull();
  });

  it("serialises two edits of one building: the same label added twice is added once", async () => {
    const results = await Promise.all([service.addFloor(ADMIN, { rsn: "402", label: "PH" }), service.addFloor(ADMIN, { rsn: "402", label: "ph" })]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "label_duplicate" }]);
    expect(await labels("402")).toHaveLength(3);
  });

  it("rolls the change back when its audit record cannot be written", async () => {
    writeAudit.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(service.addFloor(ADMIN, { rsn: "402", label: "PH" })).rejects.toThrow("audit unavailable");
    expect(await labels("402")).toEqual(["1", "2"]);
  });
});

describe("npm run seed:buildings (the command line, against the database)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cvh-buildings-db-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const run = async (register: unknown) => {
    const file = path.join(dir, "register.geojson");
    writeFileSync(file, JSON.stringify(register));
    const out: string[] = [];
    const err: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...args) => void out.push(args.join(" ")));
    const error = vi.spyOn(console, "error").mockImplementation((...args) => void err.push(args.join(" ")));
    try {
      return { code: await seedBuildings(["--file", file, "--merge", path.join(dir, "none.csv")], { SEED_DATABASE_URL: serverUrl() } as unknown as NodeJS.ProcessEnv, ROOT), out, err };
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  };
  const collection = (...features: ReturnType<typeof feature>[]) => ({ type: "FeatureCollection", features });

  it("loads the register as the migrating role, prints the report and exits 0; again, it changes nothing", async () => {
    const first = await run(collection(feature(501), feature(502, { PCODE: "M3C" })));
    expect(first.code).toBe(0);
    expect(first.out).toContain("Loaded: 2 buildings.");
    expect(first.out).toContain("Buildings: 2 added, 0 with changed facts, 0 unchanged, 0 back in the register.");
    expect((await owner`select count(*)::int as n from building`)[0].n).toBe(2);

    const second = await run(collection(feature(501), feature(502, { PCODE: "M3C" })));
    expect(second.code).toBe(0);
    expect(second.out).toContain("Buildings: 0 added, 0 with changed facts, 2 unchanged, 0 back in the register.");
  });

  it("exits 1 with every failing row and changes nothing when a row fails", async () => {
    await run(collection(feature(501)));
    const before = await owner`select * from building order by rsn`;

    const bad = await run(collection(feature(501, { NO_OF_ELEVATORS: 7 }), feature(503, { RSN: null }), feature(504, { LATITUDE: 1 })));

    expect(bad.code).toBe(1);
    expect(bad.err.filter((line) => line.startsWith("  - "))).toHaveLength(2);
    expect(bad.err).toContain("Nothing was changed.");
    expect(await owner`select * from building order by rsn`).toEqual(before);
    expect((await auditRows()).filter((row) => row.outcome === "refused")).toHaveLength(1);
  });
});
