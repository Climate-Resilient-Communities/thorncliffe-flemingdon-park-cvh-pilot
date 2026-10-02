// The resident building list (S02.03) against a real database, read as the app's own role (cvh_app_login): every
// building with its neighbourhood and floors in order, nothing but what a resident needs, and the list a resident's
// phone checks its choices against.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { BuildingListSchema } from "../../src/contracts/buildingList";
import { createResidentBuildings } from "../../src/modules/places";
import { createDb, type Db } from "../../src/platform/db";
import { connect, serverUrl } from "./helpers";

let owner: ReturnType<typeof connect>;
let app: Db;

async function clear() {
  await owner.unsafe("truncate building_floor, building, neighbourhood cascade");
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

async function building(rsn: string, neighbourhood: string, address: string) {
  await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at)
              values (${rsn}, ${neighbourhood}, ${address}, 43.7, -79.34, now())`;
}

async function floor(rsn: string, label: string, sortOrder: number) {
  const id = randomUUID();
  await owner`insert into building_floor (id, rsn, label, sort_order) values (${id}, ${rsn}, ${label}, ${sortOrder})`;
  return id;
}

describe("the resident building list", () => {
  it("lists every building by neighbourhood and address, each with its floors lowest first, as the app's role", async () => {
    await owner`insert into neighbourhood (id, name, fsa) values ('TP', 'Thorncliffe Park', 'M4H'), ('FP', 'Flemingdon Park', 'M3C')`;
    await building("200", "TP", "9 Beta Rd");
    await building("100", "TP", "1 Alpha Rd");
    await building("300", "FP", "5 Gamma Ave");
    const second = await floor("100", "2", 2);
    const first = await floor("100", "1", 1);
    const ground = await floor("300", "G", 1);

    const list = await createResidentBuildings({ db: app }).list();

    expect(list).toEqual([
      { rsn: "300", address: "5 Gamma Ave", neighbourhoodId: "FP", neighbourhood: "Flemingdon Park", floors: [{ id: ground, label: "G" }] },
      { rsn: "100", address: "1 Alpha Rd", neighbourhoodId: "TP", neighbourhood: "Thorncliffe Park", floors: [{ id: first, label: "1" }, { id: second, label: "2" }] },
      { rsn: "200", address: "9 Beta Rd", neighbourhoodId: "TP", neighbourhood: "Thorncliffe Park", floors: [] },
    ]);
    expect(BuildingListSchema.safeParse({ v: 1, buildings: list }).success).toBe(true);
  });

  it("exposes nothing but what a resident needs: no facts, no confirmation, no register state", async () => {
    await owner`insert into neighbourhood (id, name, fsa) values ('TP', 'Thorncliffe Park', 'M4H')`;
    await building("100", "TP", "1 Alpha Rd");
    await owner`update building set elevators = 3, emergency_power = true, not_in_register_since = now() where rsn = '100'`;

    const [listed] = await createResidentBuildings({ db: app }).list();

    expect(Object.keys(listed).sort()).toEqual(["address", "floors", "neighbourhood", "neighbourhoodId", "rsn"]);
  });

  it("is empty before the buildings are loaded", async () => {
    expect(await createResidentBuildings({ db: app }).list()).toEqual([]);
  });
});
