// Choosing who an alert is for, against a real database (S04.04, AD-7): the place picker and the group picker as the
// use cases `chooseAudiencePlace` and `chooseAudienceGroups` run them as the app's own role: the Audience stored
// (floors by floor id, sorted, without repeats, ranges expanded by the building's order), what is refused and
// why, the role policy at submit and again at approval, and the database's own check of the audience's shape.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import type { Audience } from "../../src/contracts/audience";
import { createAlerting, type AlertActor, type AlertLifecycle, type EntryContent, type EntryRef, type FrozenContent } from "../../src/modules/alerting";
import { createAssignments } from "../../src/modules/identity";
import { floorsOfBuilding } from "../../src/modules/places";
import { createDb, type Db } from "../../src/platform/db";
import { connect, serverUrl } from "./helpers";
import { submitSeams } from "./alertSubmitSeams";

const NOW = new Date("2026-10-01T15:00:00Z");
const RSN = "700414601";
const OTHER_RSN = "700414602";
const sha = (tag: string) => createHash("sha256").update(tag).digest("hex");

/**
 * The floors of RSN: G, 1 .. 9, in the building's order (sort_order 0..9). The ids run the other way, so the order of the
 * ids is not the order of the floors: a range must follow `sort_order`, and a stored list must follow the ids.
 */
const LABELS = ["G", ...Array.from({ length: 9 }, (_, index) => String(index + 1))];
const floorId = (rsn: string, sortOrder: number) => `01900000-0000-7000-8000-${rsn.slice(-3).padStart(4, "0")}0000${String(99 - sortOrder).padStart(4, "0")}`;
const FLOOR = (label: string) => floorId(RSN, LABELS.indexOf(label));
const ids = (...labels: string[]) => labels.map(FLOOR).sort();

const frozen = (tag: string): FrozenContent => ({
  contentHash: sha(tag),
  smsBodies: { en: { body: `en ${tag}`, encoding: "gsm7", segments: 1 } },
  translations: [{ lang: "ur", body: `ur ${tag}`, machine: true, model: "m1", status: "translated", sourceHash: sha("source") }],
});

type Role = "ambassador" | "coordinator" | "director" | "admin";
interface Account {
  id: string;
  role: Role;
}

let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
let alerting: AlertLifecycle;
let seams: ReturnType<typeof submitSeams>;
const madeNeighbourhoods: string[] = [];
const accounts: Account[] = [];
let coordinator: Account;
let secondCoordinator: Account;
let admin: Account;
let director: Account;
let ambassador: Account;

async function account(role: Role): Promise<Account> {
  const id = randomUUID();
  await owner`insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password)
              values (${id}, ${randomUUID()}, ${`au_${randomBytes(5).toString("hex")}`}, 'Test', ${role}, 'test@example.org', ${role}, false)`;
  accounts.push({ id, role });
  return { id, role };
}

const actorOf = (who: Account): AlertActor => ({ staffId: who.id, aal: who.role === "ambassador" ? "aal1" : "aal2" });

const wholeBuilding = (rsn = RSN): Audience => ({ scope: "buildings", buildings: [{ rsn, floors: null }], groups: [], types: ["power"] });

const content = (over: Partial<EntryContent> = {}): EntryContent => ({
  text: "Power is out.",
  types: ["power"],
  audience: wholeBuilding(),
  phase: "problem",
  validUntil: new Date("2026-10-02T15:00:00Z"),
  ...over,
});

async function newDraft(by: Account = coordinator, over: Partial<EntryContent> = {}): Promise<EntryRef> {
  const created = await alerting.createAlert(actorOf(by), { kind: "ack", isDrill: false, reportedAt: new Date("2026-10-01T14:50:00Z"), content: content(over) });
  if (!created.ok) throw new Error(`createAlert refused: ${created.error}`);
  return { alertId: created.value.thread.id, entryId: created.value.entry.id };
}

const storedAudience = async (entryId: string) => (await owner<{ audience: Audience }[]>`select audience from alert_entry where id = ${entryId}`)[0].audience;

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
  for (const [id, name, fsa] of [
    ["TP", "Thorncliffe Park", "M4H"],
    ["FP", "Flemingdon Park", "M3C"],
  ]) {
    if ((await owner`select 1 from neighbourhood where id = ${id}`).length === 0) {
      await owner`insert into neighbourhood (id, name, fsa) values (${id}, ${name}, ${fsa})`;
      madeNeighbourhoods.push(id);
    }
  }
  for (const rsn of [RSN, OTHER_RSN]) {
    await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at)
                values (${rsn}, 'TP', ${`${rsn} Test Dr`}, 43.7, -79.34, '2026-10-01T12:00:00Z') on conflict do nothing`;
  }
  for (const [index, label] of LABELS.entries()) {
    await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${floorId(RSN, index)}, ${RSN}, ${label}, ${index}, true) on conflict do nothing`;
  }
  // A floor of the other building: it exists, but it is not a floor of RSN.
  await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${floorId(OTHER_RSN, 0)}, ${OTHER_RSN}, 'G', 0, true) on conflict do nothing`;
  coordinator = await account("coordinator");
  secondCoordinator = await account("coordinator");
  admin = await account("admin");
  director = await account("director");
  ambassador = await account("ambassador");
  alerting = createAlerting({ db: app, now: () => NOW });
  seams = submitSeams(owner, alerting);
});

afterAll(async () => {
  await clear();
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    for (const { id } of accounts) await tx`delete from audit_event where actor_staff_id = ${id}`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
    await tx`delete from ambassador_assignment where staff_id = ${ambassador.id}`;
    for (const { id } of accounts) await tx`delete from staff_account where id = ${id}`;
  });
  await owner`delete from building_floor where rsn in (${RSN}, ${OTHER_RSN})`;
  await owner`delete from building where rsn in (${RSN}, ${OTHER_RSN})`;
  for (const id of madeNeighbourhoods) await owner`delete from neighbourhood where id = ${id}`;
  await app?.$client.end({ timeout: 5 });
  await appSql?.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

async function clear() {
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await tx`delete from audit_event where subject_type in ('alert', 'alert_entry')`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
    await tx.unsafe("truncate alert_submit_attempt, alert_entry_translation, alert_entry, alert");
  });
}

beforeEach(async () => {
  await clear();
  await owner`delete from ambassador_assignment where staff_id = ${ambassador.id}`;
});

describe("the place picker (O-03)", () => {
  it("stores a neighbourhood audience: the neighbourhoods sorted, the groups and types kept", async () => {
    const ref = await newDraft();
    const result = await alerting.chooseAudiencePlace(actorOf(coordinator), ref, { scope: "neighbourhood", neighbourhoodIds: ["TP", "FP", "TP"] });
    expect(result).toMatchObject({ ok: true });
    expect(await storedAudience(ref.entryId)).toEqual({ scope: "neighbourhood", neighbourhood_ids: ["FP", "TP"], groups: [], types: ["power"] });
  });

  it("stores floors by floor id, sorted and without repeats: ticked floors and a range together, a range expanded by the building's order", async () => {
    const ref = await newDraft();
    // "floors 4 to 9" is a range, and 2 is ticked, and 5 is both: the stored list is these floors' ids, sorted, once each.
    const result = await alerting.chooseAudiencePlace(actorOf(coordinator), ref, {
      scope: "buildings",
      buildings: [{ rsn: RSN, floors: { ids: [FLOOR("5"), FLOOR("2"), FLOOR("2")], ranges: [{ from: FLOOR("4"), to: FLOOR("9") }] } }],
    });
    expect(result).toMatchObject({ ok: true });
    const stored = await storedAudience(ref.entryId);
    expect(stored).toEqual({ scope: "buildings", buildings: [{ rsn: RSN, floors: ids("2", "4", "5", "6", "7", "8", "9") }], groups: [], types: ["power"] });
    // Floor 3, which the range does not reach, is not in it; and the ids are sorted as text, not in the building's order.
    expect(stored).not.toMatchObject({ buildings: [{ floors: expect.arrayContaining([FLOOR("3")]) }] });
    const floors = (stored as Extract<Audience, { scope: "buildings" }>).buildings[0].floors!;
    expect(floors).toEqual([...floors].sort());
  });

  it("a range from the ground floor follows the building's order, whatever the labels look like", async () => {
    const ref = await newDraft();
    expect(
      await alerting.chooseAudiencePlace(actorOf(coordinator), ref, { scope: "buildings", buildings: [{ rsn: RSN, floors: { ids: [], ranges: [{ from: FLOOR("G"), to: FLOOR("2") }] } }] }),
    ).toMatchObject({ ok: true });
    expect(((await storedAudience(ref.entryId)) as Extract<Audience, { scope: "buildings" }>).buildings[0].floors).toEqual(ids("G", "1", "2"));
  });

  it("stores the whole building as null, and several buildings in rsn order", async () => {
    const ref = await newDraft();
    expect(
      await alerting.chooseAudiencePlace(actorOf(coordinator), ref, {
        scope: "buildings",
        buildings: [
          { rsn: OTHER_RSN, floors: null },
          { rsn: RSN, floors: null },
        ],
      }),
    ).toMatchObject({ ok: true });
    expect(await storedAudience(ref.entryId)).toEqual({
      scope: "buildings",
      buildings: [
        { rsn: RSN, floors: null },
        { rsn: OTHER_RSN, floors: null },
      ],
      groups: [],
      types: ["power"],
    });
  });

  it("refuses, with the reason and changing nothing: a floor not in the building, an empty selection, a reversed range", async () => {
    const ref = await newDraft();
    const before = await storedAudience(ref.entryId);
    const choose = async (floors: { ids: string[]; ranges: { from: string; to: string }[] } | null, rsn = RSN) => {
      const result = await alerting.chooseAudiencePlace(actorOf(coordinator), ref, { scope: "buildings", buildings: [{ rsn, floors }] });
      return result.ok ? "ok" : result.error;
    };

    expect(await choose({ ids: [floorId(OTHER_RSN, 0)], ranges: [] })).toBe("FLOOR_NOT_IN_BUILDING");
    expect(await choose({ ids: [randomUUID()], ranges: [] })).toBe("FLOOR_NOT_IN_BUILDING");
    expect(await choose({ ids: [], ranges: [{ from: FLOOR("2"), to: floorId(OTHER_RSN, 0) }] })).toBe("FLOOR_NOT_IN_BUILDING");
    expect(await choose({ ids: [], ranges: [] })).toBe("AUDIENCE_EMPTY");
    expect(await choose({ ids: [], ranges: [{ from: FLOOR("9"), to: FLOOR("4") }] })).toBe("FLOOR_RANGE_REVERSED");
    expect(await choose({ ids: [FLOOR("1")], ranges: [{ from: FLOOR("6"), to: FLOOR("3") }] })).toBe("FLOOR_RANGE_REVERSED");
    expect(await choose({ ids: [], ranges: [{ from: FLOOR("4"), to: "" }] })).toBe("FLOOR_RANGE_INCOMPLETE");
    expect(await choose(null, "700999999")).toBe("BUILDING_NOT_FOUND");
    expect(await alerting.chooseAudiencePlace(actorOf(coordinator), ref, { scope: "buildings", buildings: [] })).toEqual({ ok: false, error: "AUDIENCE_EMPTY" });
    expect(await alerting.chooseAudiencePlace(actorOf(coordinator), ref, { scope: "neighbourhood", neighbourhoodIds: [] })).toEqual({ ok: false, error: "AUDIENCE_EMPTY" });
    expect(await alerting.chooseAudiencePlace(actorOf(coordinator), ref, { scope: "neighbourhood", neighbourhoodIds: ["ZZ"] })).toEqual({ ok: false, error: "NEIGHBOURHOOD_NOT_FOUND" });

    expect(await storedAudience(ref.entryId)).toEqual(before);
  });

  it("a range of a single floor is that floor; the same end twice is not reversed", async () => {
    const ref = await newDraft();
    expect(
      await alerting.chooseAudiencePlace(actorOf(coordinator), ref, { scope: "buildings", buildings: [{ rsn: RSN, floors: { ids: [], ranges: [{ from: FLOOR("3"), to: FLOOR("3") }] } }] }),
    ).toMatchObject({ ok: true });
    expect(((await storedAudience(ref.entryId)) as Extract<Audience, { scope: "buildings" }>).buildings[0].floors).toEqual([FLOOR("3")]);
  });

  it("only a draft can be aimed: a pending entry is refused", async () => {
    const ref = await newDraft();
    expect(await seams.freeze(actorOf(coordinator), ref, frozen("v1"))).toMatchObject({ ok: true });
    expect(await alerting.chooseAudiencePlace(actorOf(coordinator), ref, { scope: "neighbourhood", neighbourhoodIds: ["TP"] })).toEqual({ ok: false, error: "ILLEGAL_TRANSITION" });
    expect(await alerting.chooseAudienceGroups(actorOf(coordinator), ref, ["seniors"])).toEqual({ ok: false, error: "ILLEGAL_TRANSITION" });
  });

  it("makes whoever saves it an editor, so they cannot then approve it", async () => {
    const ref = await newDraft(coordinator);
    expect(await alerting.chooseAudiencePlace(actorOf(secondCoordinator), ref, { scope: "neighbourhood", neighbourhoodIds: ["FP"] })).toMatchObject({ ok: true });
    expect((await alerting.getEntry(ref))?.editorIds).toEqual([coordinator.id, secondCoordinator.id]);
  });
});

describe("the group picker (O-04)", () => {
  it("stores the groups on the audience, sorted and once each, keeping the place; none is no narrowing", async () => {
    const ref = await newDraft();
    expect(await alerting.chooseAudienceGroups(actorOf(coordinator), ref, ["seniors", "families", "seniors"])).toMatchObject({ ok: true });
    expect(await storedAudience(ref.entryId)).toEqual({ ...wholeBuilding(), groups: ["families", "seniors"] });
    // Choosing the place again keeps the groups.
    expect(await alerting.chooseAudiencePlace(actorOf(coordinator), ref, { scope: "neighbourhood", neighbourhoodIds: ["TP"] })).toMatchObject({ ok: true });
    expect(await storedAudience(ref.entryId)).toEqual({ scope: "neighbourhood", neighbourhood_ids: ["TP"], groups: ["families", "seniors"], types: ["power"] });
    expect(await alerting.chooseAudienceGroups(actorOf(coordinator), ref, [])).toMatchObject({ ok: true });
    expect(((await storedAudience(ref.entryId)) as Audience).groups).toEqual([]);
  });

  it("refuses a group nobody offers, changing nothing", async () => {
    const ref = await newDraft();
    expect(await alerting.chooseAudienceGroups(actorOf(coordinator), ref, ["seniors", "pensioners"])).toEqual({ ok: false, error: "GROUP_UNKNOWN" });
    expect(((await storedAudience(ref.entryId)) as Audience).groups).toEqual([]);
  });
});

describe("heat, smoke and winter storm, and who may author what (the policy check, on the server)", () => {
  it("refuses a buildings audience for a neighbourhood-only type, and a neighbourhood audience from anyone but a Coordinator or Admin", async () => {
    const heat = await newDraft(coordinator, { types: ["heat"], audience: { scope: "neighbourhood", neighbourhood_ids: ["TP"], groups: [], types: ["heat"] } });
    expect(await alerting.chooseAudiencePlace(actorOf(coordinator), heat, { scope: "buildings", buildings: [{ rsn: RSN, floors: null }] })).toEqual({ ok: false, error: "NEIGHBOURHOOD_ONLY_TYPE" });
    expect(await alerting.chooseAudiencePlace(actorOf(admin), heat, { scope: "neighbourhood", neighbourhoodIds: ["FP"] })).toMatchObject({ ok: true });
    // A Director never authors; an Ambassador is not allowed the neighbourhood scope or a neighbourhood-only type.
    expect(await alerting.chooseAudiencePlace(actorOf(director), heat, { scope: "neighbourhood", neighbourhoodIds: ["TP"] })).toEqual({ ok: false, error: "NOT_ALLOWED" });
    expect(await alerting.chooseAudiencePlace(actorOf(ambassador), heat, { scope: "neighbourhood", neighbourhoodIds: ["TP"] })).toEqual({ ok: false, error: "NOT_ALLOWED" });
    expect(await alerting.chooseAudienceGroups(actorOf(director), heat, ["seniors"])).toEqual({ ok: false, error: "NOT_ALLOWED" });
    expect(((await storedAudience(heat.entryId)) as Audience).groups).toEqual([]);
  });

  it("an Ambassador's choice of a building they are not assigned to is refused at the pick, at submit, and again at approval", async () => {
    const assignments = createAssignments({ db: app, floors: { floorsOf: floorsOfBuilding } });
    expect(await assignments.assign(admin.id, { staffId: ambassador.id, rsn: RSN, floorIds: null })).toMatchObject({ ok: true });
    const ref = await newDraft(ambassador);

    // The pick: another building is out of scope; their own is fine (any floor of it).
    expect(await alerting.chooseAudiencePlace(actorOf(ambassador), ref, { scope: "buildings", buildings: [{ rsn: OTHER_RSN, floors: null }] })).toEqual({ ok: false, error: "OUT_OF_SCOPE" });
    expect(await alerting.chooseAudiencePlace(actorOf(ambassador), ref, { scope: "buildings", buildings: [{ rsn: RSN, floors: { ids: [FLOOR("3")], ranges: [] } }] })).toMatchObject({ ok: true });
    expect(await alerting.chooseAudiencePlace(actorOf(ambassador), ref, { scope: "neighbourhood", neighbourhoodIds: ["TP"] })).toEqual({ ok: false, error: "NOT_ALLOWED" });

    // Submit, after the assignment is gone: refused with the building named by the draft.
    expect(await assignments.remove(admin.id, { staffId: ambassador.id, rsn: RSN })).toMatchObject({ ok: true });
    expect(await seams.freeze(actorOf(ambassador), ref, frozen("v1"))).toEqual({ ok: false, error: "OUT_OF_SCOPE" });

    // Approval, against their current assignments: assigned at submit, removed before approval.
    expect(await assignments.assign(admin.id, { staffId: ambassador.id, rsn: RSN, floorIds: null })).toMatchObject({ ok: true });
    expect(await seams.freeze(actorOf(ambassador), ref, frozen("v2"))).toMatchObject({ ok: true });
    expect(await assignments.remove(admin.id, { staffId: ambassador.id, rsn: RSN })).toMatchObject({ ok: true });
    expect(await alerting.approveEntry(actorOf(coordinator), ref, { version: 1, contentHash: sha("v2") })).toEqual({ ok: false, error: "AUTHOR_NOT_ALLOWED" });
  });
});

describe("re-aiming a draft is authoring it, for the draft as it is and as it will be", () => {
  const assigned = async (rsn = RSN) => {
    const assignments = createAssignments({ db: app, floors: { floorsOf: floorsOfBuilding } });
    expect(await assignments.assign(admin.id, { staffId: ambassador.id, rsn, floorIds: null })).toMatchObject({ ok: true });
  };

  it("an Ambassador cannot take over a Coordinator's draft by aiming it at their own building", async () => {
    await assigned();
    // A Coordinator's neighbourhood draft, which an Ambassador may not author, and one for a building they are not assigned to.
    const wide = await newDraft(coordinator, { audience: { scope: "neighbourhood", neighbourhood_ids: ["TP"], groups: [], types: ["power"] } });
    const elsewhere = await newDraft(coordinator, { audience: wholeBuilding(OTHER_RSN) });
    const own = { scope: "buildings" as const, buildings: [{ rsn: RSN, floors: null }] };

    expect(await alerting.chooseAudiencePlace(actorOf(ambassador), wide, own)).toEqual({ ok: false, error: "NOT_ALLOWED" });
    expect(await alerting.chooseAudiencePlace(actorOf(ambassador), elsewhere, own)).toEqual({ ok: false, error: "OUT_OF_SCOPE" });
    // The same through a plain save of the draft's content.
    expect(await alerting.saveDraft(actorOf(ambassador), wide, content({ audience: wholeBuilding() }))).toEqual({ ok: false, error: "NOT_ALLOWED" });
    expect(await alerting.saveDraft(actorOf(ambassador), elsewhere, content({ audience: wholeBuilding() }))).toEqual({ ok: false, error: "OUT_OF_SCOPE" });

    // Nothing changed, and the Ambassador is not an editor of either.
    expect(((await storedAudience(wide.entryId)) as Audience).scope).toBe("neighbourhood");
    expect(await storedAudience(elsewhere.entryId)).toEqual(wholeBuilding(OTHER_RSN));
    expect((await alerting.getEntry(wide))?.editorIds).toEqual([coordinator.id]);
    expect((await alerting.getEntry(elsewhere))?.editorIds).toEqual([coordinator.id]);
  });

  it("an Ambassador can still aim their own draft at another building they are assigned to", async () => {
    await assigned();
    await assigned(OTHER_RSN);
    const ref = await newDraft(ambassador);
    expect(await alerting.chooseAudiencePlace(actorOf(ambassador), ref, { scope: "buildings", buildings: [{ rsn: OTHER_RSN, floors: null }] })).toMatchObject({ ok: true });
    expect(await storedAudience(ref.entryId)).toEqual(wholeBuilding(OTHER_RSN));
  });

  it("the role and the policy are asked before any place is looked up: no one learns from a refusal which buildings exist", async () => {
    await assigned();
    const draft = await newDraft(coordinator);
    const own = await newDraft(ambassador);
    const nowhere = { scope: "buildings" as const, buildings: [{ rsn: "700999999", floors: null }] };
    const wrongFloor = { scope: "buildings" as const, buildings: [{ rsn: OTHER_RSN, floors: { ids: [randomUUID()], ranges: [] } }] };

    // A Director never authors: not allowed, not "no such building".
    expect(await alerting.chooseAudiencePlace(actorOf(director), draft, nowhere)).toEqual({ ok: false, error: "NOT_ALLOWED" });
    expect(await alerting.chooseAudiencePlace(actorOf(director), draft, { scope: "neighbourhood", neighbourhoodIds: ["ZZ"] })).toEqual({ ok: false, error: "NOT_ALLOWED" });
    // An Ambassador asks for a building that is not theirs, existing or not, with or without a bad floor: out of scope in every case.
    expect(await alerting.chooseAudiencePlace(actorOf(ambassador), own, nowhere)).toEqual({ ok: false, error: "OUT_OF_SCOPE" });
    expect(await alerting.chooseAudiencePlace(actorOf(ambassador), own, wrongFloor)).toEqual({ ok: false, error: "OUT_OF_SCOPE" });
    expect(await alerting.chooseAudiencePlace(actorOf(ambassador), own, { scope: "neighbourhood", neighbourhoodIds: ["ZZ"] })).toEqual({ ok: false, error: "NOT_ALLOWED" });
    // Someone who may author it still hears about the place.
    expect(await alerting.chooseAudiencePlace(actorOf(coordinator), draft, nowhere)).toEqual({ ok: false, error: "BUILDING_NOT_FOUND" });
  });
});

describe("a draft that was approved", () => {
  it("is no draft any more: neither its place nor its groups can be chosen, and nothing changes", async () => {
    const ref = await newDraft(coordinator);
    expect(await seams.freeze(actorOf(coordinator), ref, frozen("v1"))).toMatchObject({ ok: true });
    expect(await alerting.approveEntry(actorOf(secondCoordinator), ref, { version: 1, contentHash: sha("v1") })).toMatchObject({ ok: true, value: { status: "approved" } });
    const approved = await storedAudience(ref.entryId);

    expect(await alerting.chooseAudiencePlace(actorOf(coordinator), ref, { scope: "neighbourhood", neighbourhoodIds: ["FP"] })).toEqual({ ok: false, error: "ILLEGAL_TRANSITION" });
    expect(await alerting.chooseAudiencePlace(actorOf(secondCoordinator), ref, { scope: "buildings", buildings: [{ rsn: OTHER_RSN, floors: null }] })).toEqual({ ok: false, error: "ILLEGAL_TRANSITION" });
    expect(await alerting.chooseAudienceGroups(actorOf(coordinator), ref, ["seniors"])).toEqual({ ok: false, error: "ILLEGAL_TRANSITION" });
    expect(await storedAudience(ref.entryId)).toEqual(approved);
    expect((await alerting.getEntry(ref))?.status).toBe("approved");
  });
});

describe("a floor removed after it was chosen", () => {
  it("is caught at submit: the draft names a floor that is no longer there", async () => {
    const ref = await newDraft();
    expect(await alerting.chooseAudiencePlace(actorOf(coordinator), ref, { scope: "buildings", buildings: [{ rsn: RSN, floors: { ids: [FLOOR("7")], ranges: [] } }] })).toMatchObject({ ok: true });
    await owner`delete from building_floor where id = ${FLOOR("7")}`;
    try {
      expect(await seams.freeze(actorOf(coordinator), ref, frozen("v1"))).toEqual({ ok: false, error: "FLOOR_NOT_IN_BUILDING" });
      expect((await alerting.getEntry(ref))?.status).toBe("draft");
    } finally {
      await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${FLOOR("7")}, ${RSN}, '7', 7, true)`;
    }
  });

  it("is caught at approval too: a floor removed while the entry waited is not a floor to text", async () => {
    const ref = await newDraft();
    expect(await alerting.chooseAudiencePlace(actorOf(coordinator), ref, { scope: "buildings", buildings: [{ rsn: RSN, floors: { ids: [FLOOR("7")], ranges: [] } }] })).toMatchObject({ ok: true });
    expect(await seams.freeze(actorOf(coordinator), ref, frozen("v1"))).toMatchObject({ ok: true });
    await owner`delete from building_floor where id = ${FLOOR("7")}`;
    try {
      expect(await alerting.approveEntry(actorOf(secondCoordinator), ref, { version: 1, contentHash: sha("v1") })).toEqual({ ok: false, error: "FLOOR_NOT_IN_BUILDING" });
      expect((await alerting.getEntry(ref))?.status).toBe("pending_approval");
    } finally {
      await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${FLOOR("7")}, ${RSN}, '7', 7, true)`;
    }
  });

  it("waits for a floor edit in progress on the building (its row is locked FOR SHARE), then sees the floor gone", async () => {
    const ref = await newDraft();
    const floors = { scope: "buildings" as const, buildings: [{ rsn: RSN, floors: { ids: [FLOOR("8")], ranges: [] } }] };
    expect(await alerting.chooseAudiencePlace(actorOf(coordinator), ref, floors)).toMatchObject({ ok: true });

    // A floor edit under way: it holds the building's row FOR UPDATE (the lock every floor edit takes) and will remove floor 8.
    let editing!: () => void;
    const locked = new Promise<void>((resolve) => (editing = resolve));
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => (finish = resolve));
    const edit = owner.begin(async (tx) => {
      await tx`select rsn from building where rsn = ${RSN} for update`;
      editing();
      await gate;
      await tx`delete from building_floor where id = ${FLOOR("8")}`;
    });
    try {
      await locked;
      let settled = false;
      const saving = alerting.chooseAudiencePlace(actorOf(coordinator), ref, floors).finally(() => (settled = true));
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(settled, "the save waits for the floor edit instead of reading the floors around it").toBe(false);
      finish();
      await edit;
      expect(await saving).toEqual({ ok: false, error: "FLOOR_NOT_IN_BUILDING" });
    } finally {
      finish();
      await edit.catch(() => {});
      await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${FLOOR("8")}, ${RSN}, '8', 8, true) on conflict do nothing`;
    }
  });
});

describe("the database's own check of the audience's shape", () => {
  const withActor = <T,>(actor: string, run: (tx: postgres.TransactionSql) => PromiseLike<T>) =>
    appSql.begin(async (tx) => {
      await tx`select set_config('cvh.actor_id', ${actor}, true)`;
      return run(tx);
    });

  it("refuses an audience with no groups or types, an empty selection, or a buildings audience with no list, whoever writes it", async () => {
    const ref = await newDraft();
    const attempt = (audience: unknown) => withActor(coordinator.id, (tx) => tx`update alert_entry set audience = ${tx.json(audience as never)} where id = ${ref.entryId}`);
    await expect(attempt({ scope: "neighbourhood", neighbourhood_ids: ["TP"] })).rejects.toThrow(/alert_entry_audience_shape/);
    await expect(attempt({ scope: "neighbourhood", neighbourhood_ids: [], groups: [], types: ["power"] })).rejects.toThrow(/alert_entry_audience_shape/);
    await expect(attempt({ scope: "buildings", groups: [], types: ["power"] })).rejects.toThrow(/alert_entry_audience_shape/);
    await expect(attempt({ scope: "buildings", buildings: [], groups: [], types: ["power"] })).rejects.toThrow(/alert_entry_audience_shape/);
    await expect(attempt({ scope: "buildings", buildings: [{ rsn: RSN, floors: null }], groups: [], types: [] })).rejects.toThrow(/alert_entry_audience_shape/);
    await expect(attempt({ scope: "buildings", buildings: [{ rsn: RSN, floors: null }], groups: [], types: ["power"] })).resolves.toBeDefined();
  });

  it("refuses an audience whose types are not the entry's own types, either way round", async () => {
    const ref = await newDraft();
    const attempt = (audience: unknown) => withActor(coordinator.id, (tx) => tx`update alert_entry set audience = ${tx.json(audience as never)} where id = ${ref.entryId}`);
    const building = { scope: "buildings", buildings: [{ rsn: RSN, floors: null }], groups: [] };
    // The entry's types are ["power"].
    await expect(attempt({ ...building, types: ["water"] })).rejects.toThrow(/alert_entry_audience_shape/);
    await expect(attempt({ ...building, types: ["power", "water"] })).rejects.toThrow(/alert_entry_audience_shape/);
    await expect(attempt({ ...building, types: ["power"] })).resolves.toBeDefined();
  });

  it("refuses a floors list that is empty or holds anything but strings, and ids and groups that are not strings", async () => {
    const ref = await newDraft();
    const attempt = (audience: unknown) => withActor(coordinator.id, (tx) => tx`update alert_entry set audience = ${tx.json(audience as never)} where id = ${ref.entryId}`);
    const buildings = (floors: unknown, extra: object = {}) => ({ scope: "buildings", buildings: [{ rsn: RSN, ...extra, floors }], groups: [], types: ["power"] });
    await expect(attempt(buildings([]))).rejects.toThrow(/alert_entry_audience_shape/);
    await expect(attempt(buildings([1]))).rejects.toThrow(/alert_entry_audience_shape/);
    await expect(attempt(buildings([FLOOR("1"), null]))).rejects.toThrow(/alert_entry_audience_shape/);
    await expect(attempt(buildings(FLOOR("1")))).rejects.toThrow(/alert_entry_audience_shape/);
    await expect(attempt({ scope: "buildings", buildings: [{ rsn: RSN }], groups: [], types: ["power"] })).rejects.toThrow(/alert_entry_audience_shape/);
    await expect(attempt({ ...buildings(null), groups: [1] })).rejects.toThrow(/alert_entry_audience_shape/);
    await expect(attempt({ scope: "neighbourhood", neighbourhood_ids: [7], groups: [], types: ["power"] })).rejects.toThrow(/alert_entry_audience_shape/);
    await expect(attempt({ scope: "neighbourhood", neighbourhood_ids: ["TP", 7], groups: [], types: ["power"] })).rejects.toThrow(/alert_entry_audience_shape/);
    await expect(attempt(buildings([FLOOR("1"), FLOOR("2")]))).resolves.toBeDefined();
    await expect(attempt(buildings(null))).resolves.toBeDefined();
  });
});
