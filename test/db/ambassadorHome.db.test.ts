// An Ambassador's home against a real database (S08.01, A-01), read as the app's own role (cvh_app_login): the open alerts about the buildings they are assigned
// to, as residents read them (drills, unpublished entries and closed threads never), their own posts with each one's state (other people's never), a removed
// assignment taking its building and posts off at once, a suspended or locked account seeing nothing, and the round the check-ins module reports. The composition
// under test is the page's own (src/app/staff/ambassador/home.ts) with the staff composition roots pointed at this test's connection.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { createAssignments, type AssignmentService } from "../../src/modules/identity";
import { createBuildingService, floorsOfBuilding, type BuildingService } from "../../src/modules/places";
import { createDb, type Db } from "../../src/platform/db";
import { uuidv7 } from "../../src/platform/ids";
import { connect, serverUrl } from "./helpers";

const wired = vi.hoisted(() => ({ db: null as unknown, assignments: null as unknown, places: null as unknown }));
vi.mock("../../src/app/staff/assignments", () => ({ assignments: () => wired.assignments }));
vi.mock("../../src/app/staff/places", () => ({ buildings: () => wired.places }));
vi.mock("../../src/platform/db", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../src/platform/db")>()), getDb: () => wired.db }));

const { loadAmbassadorHome, resetAmbassadorHomeComposition } = await import("../../src/app/staff/ambassador/home");

const RSN_A = "7301";
const RSN_B = "7302";
const RSN_FP = "7303";
// The database stamps created_at with its own clock and refuses a thread reported after it, so the times here are counted from the real now.
const NOW = new Date();
const VALID_UNTIL = new Date(NOW.getTime() + 86_400_000);

let owner: ReturnType<typeof connect>;
let app: Db;
let assignments: AssignmentService;
let admin: string;
let approver: string;
let ambassador: string;
let other: string;
let coordinator: string;
const created: string[] = [];
const floors: Record<string, string> = {};
const madeNeighbourhoods: string[] = [];

const buildingsAudience = (...rsns: string[]) => ({ scope: "buildings", buildings: rsns.map((rsn) => ({ rsn, floors: null })), groups: [], types: ["power"] });
const hoodAudience = (id: string) => ({ scope: "neighbourhood", neighbourhood_ids: [id], groups: [], types: ["heat"] });

async function account(role: "admin" | "coordinator" | "ambassador", options: { status?: string; last?: string } = {}): Promise<string> {
  const id = uuidv7();
  await owner`insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, status, must_change_password)
              values (${id}, ${randomUUID()}, ${`ah${randomBytes(5).toString("hex")}`}, 'Ola', ${options.last ?? role}, 'someone@example.org', ${role}, ${options.status ?? "active"}, false)`;
  created.push(id);
  return id;
}

interface SeedEntry {
  author: string;
  status?: "draft" | "pending_approval" | "approved" | "superseded" | "discarded";
  kind?: string;
  text?: string;
  audience?: object;
  types?: string[];
  /** Null: not web-published. Default: published at approval for an approved entry, none otherwise. */
  publishedAt?: Date | null;
  approvedAt?: Date | null;
  submitted?: boolean;
  returnedFor?: "return" | "edit" | null;
  note?: string;
  supersedes?: number;
  /** Why a discarded entry was discarded (S08.02); a discarded entry defaults to `declined`. Null is an entry discarded before the reason was recorded. */
  discardReason?: "by_author" | "declined" | "by_close" | null;
}

/** An alert thread with entries inserted directly (as a migration owner would: the lifecycle's triggers off), the way residentAlerts.db.test.ts does. */
async function seedThread(opts: { slug: string; drill?: boolean; closed?: boolean; reportedAt?: Date; entries: SeedEntry[] }): Promise<{ alertId: string; entryIds: string[] }> {
  const alertId = randomUUID();
  await owner.begin(async (tx) => {
    await tx`select set_config('cvh.actor_id', ${coordinator}, true)`;
    await tx`insert into alert (id, is_drill, reported_at, created_by, slug) values (${alertId}, ${opts.drill ?? false}, ${opts.reportedAt ?? new Date(NOW.getTime() - 3_600_000)}, ${coordinator}, ${opts.slug})`;
  });
  const entryIds: string[] = [];
  // An entry discarded before S08.02 recorded why (no reason) is as production holds them: made with the check that requires a reason off, which is put back
  // NOT VALID as its migration made it (20261005230000_alert_entry_discard_checks.sql).
  const beforeTheCheck = opts.entries.some((entry) => entry.status === "discarded" && entry.discardReason === null);
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table alert_entry disable trigger alert_entry_guard");
    if (beforeTheCheck) await tx.unsafe("alter table alert_entry drop constraint alert_entry_discard_reason_status");
    for (const [index, entry] of opts.entries.entries()) {
      const id = randomUUID();
      entryIds.push(id);
      const status = entry.status ?? "approved";
      const approved = status === "approved" || status === "superseded";
      const submitted = entry.submitted ?? (status !== "draft");
      const frozen = status === "pending_approval" || status === "approved" || status === "superseded";
      const approvedAt = approved ? (entry.approvedAt ?? new Date(NOW.getTime() - 60_000 * (10 - index))) : null;
      const published = entry.publishedAt === undefined ? approvedAt : entry.publishedAt;
      const hash = randomBytes(32).toString("hex");
      await tx`insert into alert_entry (id, alert_id, kind, status, author_id, editor_ids, original_text, types, audience, phase, valid_until, version, content_hash, sms_bodies,
                                         submitted_at, approved_by, approved_at, approved_version, approved_hash, web_published_at, returned_for, returned_note, supersedes_id, withdrawal_reason, discard_reason)
               values (${id}, ${alertId}, ${entry.kind ?? "ack"}, ${status}, ${entry.author}, ${[entry.author]}, ${entry.text ?? "Power is out."}, ${entry.types ?? ["power"]},
                       ${tx.json((entry.audience ?? buildingsAudience(RSN_A)) as never)}, 'problem', ${VALID_UNTIL}, ${frozen ? 1 : 0}, ${frozen ? hash : null},
                       ${frozen ? tx.json({ en: { body: "x", encoding: "gsm7", segments: 1 } }) : null}, ${submitted ? new Date(NOW.getTime() - 3_600_000 + index * 1000) : null},
                       ${approved ? approver : null}, ${approvedAt}, ${approved ? 1 : null}, ${approved ? hash : null}, ${published},
                       ${entry.returnedFor ?? null}, ${entry.returnedFor === "return" ? (entry.note ?? "Which floors?") : null},
                       ${entry.supersedes === undefined ? null : entryIds[entry.supersedes]}, ${entry.kind === "withdrawal" ? "wrong_place" : null},
                       ${status === "discarded" ? (entry.discardReason === undefined ? "declined" : entry.discardReason) : null})`;
    }
    if (beforeTheCheck) {
      await tx.unsafe("alter table alert_entry add constraint alert_entry_discard_reason_status check ((status = 'discarded') = (discard_reason is not null)) not valid");
    }
    await tx.unsafe("alter table alert_entry enable trigger alert_entry_guard");
  });
  if (opts.closed) await owner`update alert set status = 'closed', closed_reason = 'resolved', closed_at = now() where id = ${alertId}`;
  return { alertId, entryIds };
}

async function clear() {
  await owner`delete from ambassador_assignment`;
  // The alert tables, with delivery (E06's foreign key to the entries).
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
  wired.db = app;
  assignments = createAssignments({ db: app, floors: { floorsOf: floorsOfBuilding } });
  wired.assignments = assignments;
  wired.places = createBuildingService({
    db: app,
    audit: { record: async () => {}, recordRefusal: async () => {} },
    assignments: { onFloor: (executor, floor) => assignments.onFloor(executor, floor) },
  }) as BuildingService;
  admin = await account("admin");
  approver = await account("coordinator", { last: "approver" });
  coordinator = await account("coordinator", { last: "author" });
  for (const [id, name, fsa] of [["TP", "Thorncliffe Park", "M4H"], ["FP", "Flemingdon Park", "M3C"]]) {
    if ((await owner`select 1 from neighbourhood where id = ${id}`).length === 0) {
      await owner`insert into neighbourhood (id, name, fsa) values (${id}, ${name}, ${fsa})`;
      madeNeighbourhoods.push(id);
    }
  }
  for (const [rsn, hood, address] of [[RSN_A, "TP", "41 Home Test Dr"], [RSN_B, "TP", "43 Home Test Dr"], [RSN_FP, "FP", "9 Flem Test Dr"]]) {
    await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at) values (${rsn}, ${hood}, ${address}, 43.7, -79.34, now())`;
  }
  for (const [rsn, label, order] of [[RSN_A, "G", 0], [RSN_A, "2", 1], [RSN_A, "3", 2], [RSN_A, "4", 3], [RSN_B, "1", 0], [RSN_FP, "1", 0]] as const) {
    const id = uuidv7();
    floors[`${rsn}:${label}`] = id;
    await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${id}, ${rsn}, ${label}, ${order}, true)`;
  }
});

afterAll(async () => {
  await clear();
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await tx`delete from audit_event where actor_staff_id in ${tx(created)}`;
    await tx`delete from audit_event where subject_type = 'building' and subject_id in (${RSN_A}, ${RSN_B}, ${RSN_FP})`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
    await tx`delete from staff_account where id in ${tx(created)}`;
  });
  await owner`delete from building_floor where rsn in (${RSN_A}, ${RSN_B}, ${RSN_FP})`;
  await owner`delete from building where rsn in (${RSN_A}, ${RSN_B}, ${RSN_FP})`;
  for (const id of madeNeighbourhoods) await owner`delete from neighbourhood where id = ${id}`;
  await app?.$client.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

beforeEach(async () => {
  await clear();
  resetAmbassadorHomeComposition();
  ambassador = await account("ambassador", { last: "mine" });
  other = await account("ambassador", { last: "other" });
});

const home = (staffId = ambassador) => loadAmbassadorHome({ staffId });
const assign = async (staffId: string, rsn: string, floorIds: string[] | null = null) => {
  const result = await assignments.assign(admin, { staffId, rsn, floorIds });
  expect(result.ok, JSON.stringify(result)).toBe(true);
};

describe("the open alerts about an Ambassador's buildings", () => {
  it("lists the open thread for an assigned building with what residents read, whether it is verified and when it ends, and none for a building they are not assigned to", async () => {
    await assign(ambassador, RSN_A);
    const mine = await seedThread({ slug: "minebldg1", entries: [{ author: coordinator, text: "Power is out at 41 Home Test Dr.", audience: buildingsAudience(RSN_A) }] });
    await seedThread({ slug: "otherbld1", entries: [{ author: coordinator, text: "Water is off at 43 Home Test Dr.", types: ["water"], audience: { ...buildingsAudience(RSN_B), types: ["water"] } }] });

    const data = await home();

    expect(data.buildings).toEqual([{ rsn: RSN_A, address: "41 Home Test Dr", floorLabels: null }]);
    expect(data.alerts).toEqual([
      {
        alertId: mine.alertId,
        slug: "minebldg1",
        types: ["power"],
        headline: "Power is out at 41 Home Test Dr.",
        verified: true,
        fromAmbassador: false,
        publishedAt: expect.any(Date),
        validUntil: VALID_UNTIL,
        buildings: [RSN_A],
      },
    ]);
  });

  it("lists a neighbourhood alert for the neighbourhood of an assigned building, and not one for the other neighbourhood", async () => {
    await assign(ambassador, RSN_A);
    const tp = await seedThread({ slug: "heattpark1", entries: [{ author: coordinator, kind: "ack", types: ["heat"], audience: hoodAudience("TP") }] });
    await seedThread({ slug: "heatflem1", entries: [{ author: coordinator, kind: "ack", types: ["heat"], audience: hoodAudience("FP") }] });

    expect((await home()).alerts.map((alert) => alert.alertId)).toEqual([tp.alertId]);
    expect((await home()).alerts[0].buildings).toEqual([RSN_A]);
  });

  it("never lists a drill, a thread that is closed, or an entry residents cannot read yet (a draft, or a pending one that is not web-published)", async () => {
    await assign(ambassador, RSN_A);
    await seedThread({ slug: "drillbld01", drill: true, entries: [{ author: coordinator, text: "EXERCISE: power is out" }] });
    await seedThread({ slug: "closedbld1", closed: true, entries: [{ author: coordinator }] });
    await seedThread({ slug: "pendingbl1", entries: [{ author: coordinator, status: "pending_approval", publishedAt: null }] });
    await seedThread({ slug: "draftbld01", entries: [{ author: coordinator, status: "draft" }] });

    const data = await home();
    expect(data.alerts).toEqual([]);
    // A drill is never among the alerts or the posts; S08.02 lists the open drills about their buildings apart, where a practice post goes.
    expect(JSON.stringify({ alerts: data.alerts, posts: data.posts })).not.toMatch(/EXERCISE/);
    expect(data.drills).toEqual([expect.objectContaining({ headline: "EXERCISE: power is out", types: ["power"], buildings: [RSN_A] })]);
  });

  it("lists the open drills newest reported first, whatever order they were made in", async () => {
    await assign(ambassador, RSN_A);
    const middle = await seedThread({ slug: "drillmid01", drill: true, reportedAt: new Date(NOW.getTime() - 2 * 3_600_000), entries: [{ author: coordinator, text: "EXERCISE: middle" }] });
    const oldest = await seedThread({ slug: "drillold01", drill: true, reportedAt: new Date(NOW.getTime() - 3 * 3_600_000), entries: [{ author: coordinator, text: "EXERCISE: oldest" }] });
    const newest = await seedThread({ slug: "drillnew01", drill: true, reportedAt: new Date(NOW.getTime() - 3_600_000), entries: [{ author: coordinator, text: "EXERCISE: newest" }] });

    expect(((await home()).drills ?? []).map((drill) => drill.alertId)).toEqual([newest.alertId, middle.alertId, oldest.alertId]);
  });

  it("lists a pending entry that was web-published at submit (a D-1 post) as not yet verified, then as verified once the Hub approves it", async () => {
    await assign(ambassador, RSN_A);
    const { entryIds } = await seedThread({ slug: "dpostbld01", entries: [{ author: ambassador, status: "pending_approval", publishedAt: new Date(NOW.getTime() - 120_000), audience: buildingsAudience(RSN_A) }] });

    const live = await home();
    expect(live.alerts).toHaveLength(1);
    expect(live.alerts[0].verified).toBe(false);
    expect(live.posts).toEqual([expect.objectContaining({ entryId: entryIds[0], state: "live", buildings: [RSN_A] })]);

    await owner.begin(async (tx) => {
      await tx.unsafe("alter table alert_entry disable trigger alert_entry_guard");
      await tx`update alert_entry set status = 'approved', approved_by = ${approver}, approved_at = ${NOW}, approved_version = 1, approved_hash = content_hash where id = ${entryIds[0]}`;
      await tx.unsafe("alter table alert_entry enable trigger alert_entry_guard");
    });
    const verified = await home();
    expect(verified.alerts[0].verified).toBe(true);
    expect(verified.posts[0].state).toBe("verified");
  });

  it("shows the entry that covers the thread now: an update's text after an acknowledgement's, and a correction's in place of what it replaced", async () => {
    await assign(ambassador, RSN_A);
    await seedThread({
      slug: "coverbld01",
      entries: [
        { author: coordinator, kind: "ack", text: "We know about the outage." },
        { author: coordinator, kind: "update", text: "Crews are on site." },
        { author: coordinator, kind: "correction", text: "Crews are on site. Back by 6 pm.", supersedes: 1 },
      ],
    });

    expect((await home()).alerts.map((alert) => alert.headline)).toEqual(["Crews are on site. Back by 6 pm."]);
  });

  it("lists an alert once for a person assigned to two buildings it names, with both buildings", async () => {
    await assign(ambassador, RSN_A);
    await assign(ambassador, RSN_B);
    await seedThread({ slug: "bothbldg01", entries: [{ author: coordinator, audience: buildingsAudience(RSN_A, RSN_B) }] });

    const data = await home();
    expect(data.alerts).toHaveLength(1);
    expect([...data.alerts[0].buildings].sort()).toEqual([RSN_A, RSN_B]);
    expect(data.buildings.map((building) => building.address)).toEqual(["41 Home Test Dr", "43 Home Test Dr"]);
  });

  it("writes the floors of an assignment by the labels the building has now, in the building's order", async () => {
    await assign(ambassador, RSN_A, [floors[`${RSN_A}:3`], floors[`${RSN_A}:G`]]);
    expect((await home()).buildings).toEqual([{ rsn: RSN_A, address: "41 Home Test Dr", floorLabels: ["G", "3"] }]);

    await owner`update building_floor set label = 'Lobby' where id = ${floors[`${RSN_A}:G`]}`;
    expect((await home()).buildings[0].floorLabels).toEqual(["Lobby", "3"]);
  });
});

describe("an Ambassador's own posts", () => {
  it("lists their posts with each one's state, and none that another Ambassador or a Coordinator wrote", async () => {
    await assign(ambassador, RSN_A);
    await assign(other, RSN_A);
    const waiting = await seedThread({ slug: "waitbldg01", entries: [{ author: ambassador, status: "pending_approval", publishedAt: null, text: "Waiting post." }] });
    const approved = await seedThread({ slug: "apprbldg01", entries: [{ author: ambassador, text: "Approved post." }] });
    const returned = await seedThread({ slug: "retnbldg01", entries: [{ author: ambassador, status: "draft", submitted: false, returnedFor: "return", note: "Which floors?", text: "Returned post." }] });
    const declined = await seedThread({ slug: "declbldg01", entries: [{ author: ambassador, status: "discarded", discardReason: "declined", text: "Declined post." }] });
    // S08.02: a post the alert's close discarded reads as ended, and one its author took back is not shown: neither is "Not sent by the Hub".
    const ended = await seedThread({ slug: "endbldg001", entries: [{ author: ambassador, status: "discarded", discardReason: "by_close", text: "Ended post." }] });
    await seedThread({ slug: "ownbldg001", entries: [{ author: ambassador, status: "discarded", discardReason: "by_author", text: "Taken back post." }] });
    await seedThread({ slug: "othrbldg01", entries: [{ author: other, text: "Someone else's post." }] });
    await seedThread({ slug: "coorbldg01", entries: [{ author: coordinator, text: "A Coordinator's alert." }] });

    const { posts } = await home();

    const byText = Object.fromEntries(posts.map((post) => [post.text, post]));
    expect(Object.keys(byText).sort()).toEqual(["Approved post.", "Declined post.", "Ended post.", "Returned post.", "Waiting post."]);
    expect(byText["Waiting post."]).toMatchObject({ entryId: waiting.entryIds[0], state: "waiting", note: null, buildings: [RSN_A] });
    expect(byText["Approved post."]).toMatchObject({ entryId: approved.entryIds[0], state: "approved" });
    expect(byText["Returned post."]).toMatchObject({ entryId: returned.entryIds[0], state: "returned", note: "Which floors?" });
    expect(byText["Declined post."]).toMatchObject({ entryId: declined.entryIds[0], state: "declined" });
    expect(byText["Ended post."]).toMatchObject({ entryId: ended.entryIds[0], state: "ended" });
  });

  it("does not list a post discarded before S08.02 recorded why (no reason): it cannot say whether the Hub declined it, so it says nothing", async () => {
    await assign(ambassador, RSN_A);
    await seedThread({ slug: "oldscard01", entries: [{ author: ambassador, status: "discarded", discardReason: null, text: "Discarded before the reason." }] });
    const kept = await seedThread({ slug: "keptpost01", entries: [{ author: ambassador, text: "Approved post." }] });

    expect((await home()).posts.map((post) => post.entryId)).toEqual([kept.entryIds[0]]);
  });

  it("keeps a heavy author's real posts in view: more than 200 newer unsubmitted drafts do not crowd them out", async () => {
    await assign(ambassador, RSN_A);
    await seedThread({ slug: "crowdold01", entries: [{ author: ambassador, status: "pending_approval", publishedAt: null, text: "Old waiting post." }] });
    const alertId = randomUUID();
    await owner.begin(async (tx) => {
      await tx`select set_config('cvh.actor_id', ${coordinator}, true)`;
      await tx`insert into alert (id, is_drill, reported_at, created_by, slug) values (${alertId}, false, ${new Date(NOW.getTime() - 3_600_000)}, ${coordinator}, 'crowddraft1')`;
    });
    await owner.begin(async (tx) => {
      await tx`select set_config('cvh.actor_id', ${ambassador}, true)`;
      await tx.unsafe("alter table alert_entry disable trigger alert_entry_guard");
      await tx`insert into alert_entry (id, alert_id, kind, status, author_id, editor_ids, original_text, types, audience, phase, valid_until, version)
               select gen_random_uuid(), ${alertId}, 'ack', 'draft', ${ambassador}, ${[ambassador]}, 'Draft.', ${["power"]}, ${tx.json(buildingsAudience(RSN_A) as never)}, 'problem', ${VALID_UNTIL}, 0
               from generate_series(1, 210)`;
      await tx.unsafe("alter table alert_entry enable trigger alert_entry_guard");
    });

    const { posts } = await home();

    expect(posts.map((post) => post.text)).toEqual(["Old waiting post."]);
  });

  it("lists a post as corrected or withdrawn once an approved correction or withdrawal replaced it", async () => {
    await assign(ambassador, RSN_A);
    const corrected = await seedThread({
      slug: "corrbldg01",
      entries: [{ author: ambassador, status: "superseded", text: "Wrong floors." }, { author: coordinator, kind: "correction", text: "Right floors.", supersedes: 0 }],
    });
    const withdrawn = await seedThread({
      slug: "wdrwbldg01",
      entries: [{ author: ambassador, status: "superseded", text: "Wrong building." }, { author: coordinator, kind: "withdrawal", text: "Withdrawn.", supersedes: 0 }],
    });

    const states = Object.fromEntries((await home()).posts.map((post) => [post.entryId, post.state]));
    expect(states[corrected.entryIds[0]]).toBe("corrected");
    expect(states[withdrawn.entryIds[0]]).toBe("withdrawn");
  });

  it("shows no post of a drill's thread, and no draft nobody submitted", async () => {
    await assign(ambassador, RSN_A);
    await seedThread({ slug: "drilpostb01", drill: true, entries: [{ author: ambassador, text: "A drill post." }] });
    await seedThread({ slug: "draftpost01", entries: [{ author: ambassador, status: "draft", submitted: false, text: "Never submitted." }] });
    expect((await home()).posts).toEqual([]);
  });
});

describe("an Ambassador whose assignment changes", () => {
  it("loses the building, its alerts and their posts there with the very next request when an assignment is removed, and keeps the other building", async () => {
    await assign(ambassador, RSN_A);
    await assign(ambassador, RSN_B);
    await seedThread({ slug: "remvbldga1", entries: [{ author: coordinator, text: "At A.", audience: buildingsAudience(RSN_A) }] });
    await seedThread({ slug: "remvbldgb1", entries: [{ author: coordinator, text: "At B.", audience: buildingsAudience(RSN_B) }] });
    await seedThread({ slug: "remvposta1", entries: [{ author: ambassador, text: "Post at A.", audience: buildingsAudience(RSN_A) }] });
    await seedThread({ slug: "remvpostb1", entries: [{ author: ambassador, text: "Post at B.", audience: buildingsAudience(RSN_B) }] });
    const before = await home();
    expect(before.alerts.map((alert) => alert.headline).sort()).toEqual(["At A.", "At B.", "Post at A.", "Post at B."]);

    expect((await assignments.remove(admin, { staffId: ambassador, rsn: RSN_A })).ok).toBe(true);

    const after = await home();
    expect(after.buildings.map((building) => building.rsn)).toEqual([RSN_B]);
    expect(after.alerts.map((alert) => alert.headline).sort()).toEqual(["At B.", "Post at B."]);
    expect(after.posts.map((post) => post.text)).toEqual(["Post at B."]);
  });

  it("sees nothing at all with no assignment: no buildings, no alerts, no posts", async () => {
    await seedThread({ slug: "noassign01", entries: [{ author: coordinator }] });
    await seedThread({ slug: "noassign02", entries: [{ author: ambassador }] });
    expect(await home()).toEqual({ buildings: [], alerts: [], posts: [], drills: [], round: null });
  });

  it("sees nothing once suspended or locked: their assignments do not count (the guard has already refused their session, S01.08)", async () => {
    await assign(ambassador, RSN_A);
    await seedThread({ slug: "suspbldg01", entries: [{ author: coordinator }] });
    await seedThread({ slug: "susppost01", entries: [{ author: ambassador, text: "A post." }] });
    expect((await home()).alerts.length).toBeGreaterThan(0);

    for (const status of ["suspended", "locked_pending_reissue"]) {
      await owner`update staff_account set status = ${status} where id = ${ambassador}`;
      expect(await home(), status).toEqual({ buildings: [], alerts: [], posts: [], drills: [], round: null });
    }
    await owner`update staff_account set status = 'active' where id = ${ambassador}`;
    expect((await home()).alerts.length).toBeGreaterThan(0);
  });

  it("sees nothing as a role that is not an Ambassador any more, whatever is left in the assignment table", async () => {
    await assign(ambassador, RSN_A);
    await seedThread({ slug: "rolechg001", entries: [{ author: coordinator }] });
    expect((await home()).alerts).toHaveLength(1);
    await owner`update staff_account set role = 'coordinator' where id = ${ambassador}`;
    expect(await home()).toEqual({ buildings: [], alerts: [], posts: [], drills: [], round: null });
  });
});

describe("the round", () => {
  it("is none while no round exists, and the count the check-ins module gives while one is open, asked with the person's current assignments", async () => {
    await assign(ambassador, RSN_A, [floors[`${RSN_A}:2`]]);
    expect((await home()).round).toBeNull();
    const asked: unknown[] = [];
    const data = await loadAmbassadorHome({ staffId: ambassador }, { openFor: async (current) => (asked.push(current), { requests: 4 }) });
    expect(data.round).toEqual({ requests: 4 });
    expect(asked).toEqual([[{ rsn: RSN_A, floorIds: [floors[`${RSN_A}:2`]] }]]);
  });
});
