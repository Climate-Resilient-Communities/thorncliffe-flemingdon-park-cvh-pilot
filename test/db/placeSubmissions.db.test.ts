// Residents' place suggestions against a real database (PRD §6.3, D9/E4): the store as the app's own role (cvh_app_login), the reference code,
// the queue's order, accept and decline once with their audit records, applying an accepted one, the table's guard and grants, and the demo
// seed (as the migration role, like scripts/seed/submissions.mjs). The migrations enable pg_cron, which Supabase allows only in the `postgres`
// database, so (like the other database tests) this migrates the test server's `postgres` database and empties its own rows after.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { checkPlaceSubmission, type PlaceSubmissionRequest, type PlaceSubmissionRequestBody } from "@/contracts/placeSubmission";
import {
  acceptSubmission,
  applySubmission,
  declineSubmission,
  listSubmissionQueue,
  listSubmissionsToApply,
  readSubmission,
  readSubmissionStatus,
  seedDemoSubmissions,
  submitPlace,
} from "@/modules/directory";
import { createDb, type Db } from "@/platform/db";
import { connect, serverUrl } from "./helpers";

const parse = (body: PlaceSubmissionRequestBody): PlaceSubmissionRequest => {
  const checked = checkPlaceSubmission(body);
  if (!checked.ok) throw new Error("the test's body does not pass the contract");
  return checked.value;
};

const ADD = parse({
  v: 1,
  lang: "ur",
  kind: "add",
  type: "offer",
  name: "Thursday food bank",
  what: "Free groceries on Thursday evenings.",
  where: { kind: "building", rsn: "4154159", text: "the community room" },
  cost: "free",
  languages: ["ur", "en", "ur"],
});
const CORRECT = parse({ v: 1, lang: "en", kind: "correct", providerId: "Z9001", providerName: "Overlea Clinic", changes: { where: "Second floor", cost: "free" } });

/** Random bytes that make the given codes in turn: "2222-2222" from zeros, "3333-3333" from ones. */
const bytesOf = (...fills: number[]) => {
  let at = 0;
  return () => new Uint8Array(8).fill(fills[Math.min(at++, fills.length - 1)]!);
};

describe("place suggestions (PRD §6.3)", () => {
  let sql: ReturnType<typeof connect>;
  let app: Db;
  let owner: Db;
  let auditBaseline = 0;
  const coordinator = randomUUID();
  const admin = randomUUID();

  beforeAll(async () => {
    sql = connect(serverUrl());
    await migrate({ sql });
    [{ max: auditBaseline }] = await sql`select coalesce(max(id), 0)::int as max from audit_event`;
    const password = randomBytes(18).toString("hex");
    await sql.unsafe(`alter role cvh_app_login password '${password}'`);
    const url = new URL(serverUrl());
    url.username = "cvh_app_login";
    url.password = password;
    app = createDb(url.href);
    owner = createDb(serverUrl());
    for (const [id, role] of [
      [coordinator, "coordinator"],
      [admin, "admin"],
    ] as const) {
      await sql`
        insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password)
        values (${id}, ${randomUUID()}, ${`${role}${randomBytes(3).toString("hex")}`}, 'Ann', 'Okafor', 'someone@example.org', ${role}, false)`;
    }
  });

  afterAll(async () => {
    await sql`delete from place_submission`;
    await sql.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await sql`delete from audit_event where id > ${auditBaseline}`;
    await sql.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
    await sql`delete from staff_account where id in (${coordinator}, ${admin})`;
    await sql.unsafe("alter role cvh_app_login password null");
    await app.$client.end({ timeout: 5 });
    await owner.$client.end({ timeout: 5 });
    await sql.end({ timeout: 5 });
  });

  let mark = 0;
  beforeEach(async () => {
    await sql`delete from place_submission`;
    [{ max: mark }] = await sql`select coalesce(max(id), 0)::int as max from audit_event`;
  });

  const auditOf = async (action: string) =>
    (await sql.unsafe("select actor_staff_id, subject_type, subject_id, outcome, meta from audit_event where id > $1 and action = $2 order by id", [mark, action])).map((e) => ({ ...e }));
  const idOf = async (ref: string) => ((await sql`select id from place_submission where ref = ${ref}`)[0]!.id as string);

  it("stores a new place as the app's role, with nothing about the person, and reads it back by its code", async () => {
    const { ref } = await submitPlace(app, ADD, { random: bytesOf(0), now: () => new Date("2026-11-05T15:00:00Z") });
    expect(ref).toBe("2222-2222");
    const [row] = await sql`select * from place_submission where ref = ${ref}`;
    expect(row).toMatchObject({ kind: "add", lang: "ur", type: "offer", status: "pending", location: { kind: "building", rsn: "4154159", text: "the community room" }, languages: ["ur", "en"] });
    expect(await readSubmissionStatus(app, "2222-2222")).toEqual({
      v: 1,
      ref: "2222-2222",
      kind: "add",
      status: "pending",
      name: "Thursday food bank",
      what: "Free groceries on Thursday evenings.",
      where: { kind: "building", rsn: "4154159", text: "the community room" },
      where_text: null,
      sent_at: "2026-11-05T15:00:00.000Z",
      decided_at: null,
      reason: null,
    });
    expect(await readSubmissionStatus(app, "3333-3333")).toBeNull();
  });

  it("draws another code when one is taken", async () => {
    await submitPlace(app, ADD, { random: bytesOf(0) });
    const { ref } = await submitPlace(app, CORRECT, { random: bytesOf(0, 1) });
    expect(ref).toBe("3333-3333");
  });

  it("lists the waiting ones oldest first, reads one with its place in the queue and the next, and a correction with the provider it names", async () => {
    await submitPlace(app, ADD, { random: bytesOf(0), now: () => new Date(Date.now() - 3 * 86_400_000) });
    await submitPlace(app, CORRECT, { random: bytesOf(1), now: () => new Date(Date.now() - 86_400_000) });
    const queue = await listSubmissionQueue(app);
    expect(queue.waiting.map((s) => s.ref)).toEqual(["2222-2222", "3333-3333"]);
    expect(queue.decided).toEqual([]);
    const first = await readSubmission(app, await idOf("2222-2222"));
    expect(first).toMatchObject({ waitingCount: 2, position: 1, nextId: await idOf("3333-3333"), provider: null });
    // Z9001 is not a provider the database holds: the correction is still readable, with no provider beside it.
    const second = await readSubmission(app, await idOf("3333-3333"));
    expect(second).toMatchObject({ position: 2, nextId: await idOf("2222-2222"), provider: null, submission: { kind: "correct", providerId: "Z9001", changes: { where: "Second floor", cost: "free" } } });
    expect(await readSubmission(app, "not-a-uuid")).toBeNull();
    expect(await readSubmission(app, randomUUID())).toBeNull();
  });

  it("accepts once, audited with the kind and never the text; a second decision is refused and audited as a conflict", async () => {
    await submitPlace(app, ADD, { random: bytesOf(0) });
    const id = await idOf("2222-2222");
    expect(await acceptSubmission(app, coordinator, id)).toEqual({ ok: true, name: "Thursday food bank", kind: "add" });
    expect(await declineSubmission(app, admin, id, "advert", null)).toEqual({ ok: false, error: "already_decided" });
    expect(await auditOf("submission.accepted")).toEqual([{ actor_staff_id: coordinator, subject_type: "place_submission", subject_id: id, outcome: "ok", meta: { kind: "add" } }]);
    expect(await auditOf("submission.declined")).toEqual([{ actor_staff_id: admin, subject_type: "place_submission", subject_id: id, outcome: "refused", meta: { reason: "conflict" } }]);
    expect(await readSubmissionStatus(app, "2222-2222")).toMatchObject({ status: "accepted", reason: null });
    expect((await listSubmissionQueue(app)).decided.map((s) => s.ref)).toEqual(["2222-2222"]);
  });

  it("declines with a pre-written reason the resident reads, keeping the Hub's note on the row and out of the audit trail", async () => {
    await submitPlace(app, CORRECT, { random: bytesOf(1) });
    const id = await idOf("3333-3333");
    expect(await declineSubmission(app, coordinator, id, "duplicate", "  Same as M014.  ")).toEqual({ ok: true, name: "Overlea Clinic", kind: "correct" });
    expect(await readSubmissionStatus(app, "3333-3333")).toMatchObject({ status: "declined", reason: "duplicate", name: "Overlea Clinic", where_text: "Second floor" });
    expect((await sql`select decline_note from place_submission where id = ${id}`)[0]).toEqual({ decline_note: "Same as M014." });
    expect(await auditOf("submission.declined")).toEqual([
      { actor_staff_id: coordinator, subject_type: "place_submission", subject_id: id, outcome: "ok", meta: { kind: "correct", decline_reason: "duplicate", with_note: true } },
    ]);
  });

  it("refuses a suggestion that is not there, audited without an id that is not one", async () => {
    expect(await acceptSubmission(app, coordinator, "nonsense")).toEqual({ ok: false, error: "not_found" });
    expect(await auditOf("submission.accepted")).toEqual([{ actor_staff_id: coordinator, subject_type: "place_submission", subject_id: null, outcome: "refused", meta: { reason: "not_found" } }]);
  });

  it("lists an accepted suggestion for the Providers page until an Admin marks it done, once", async () => {
    await submitPlace(app, ADD, { random: bytesOf(0) });
    await submitPlace(app, CORRECT, { random: bytesOf(1) });
    const added = await idOf("2222-2222");
    const pending = await idOf("3333-3333");
    await acceptSubmission(app, coordinator, added);
    expect((await listSubmissionsToApply(app)).map((s) => s.ref)).toEqual(["2222-2222"]);
    expect(await applySubmission(app, admin, pending)).toEqual({ ok: false, error: "not_accepted" });
    expect(await applySubmission(app, admin, added)).toEqual({ ok: true, name: "Thursday food bank", kind: "add" });
    expect(await applySubmission(app, admin, added)).toEqual({ ok: false, error: "already_applied" });
    expect(await listSubmissionsToApply(app)).toEqual([]);
    expect((await auditOf("submission.applied")).map((e) => [e.outcome, e.meta])).toEqual([
      ["refused", { reason: "conflict" }],
      ["ok", { kind: "add" }],
      ["refused", { reason: "conflict" }],
    ]);
  });

  it("keeps what was sent and a decision once made, whoever writes: the app's role may change only the decision", async () => {
    await submitPlace(app, ADD, { random: bytesOf(0) });
    const id = await idOf("2222-2222");
    await expect(app.$client`update place_submission set name = 'Changed' where id = ${id}`).rejects.toThrow(/permission denied/);
    await expect(app.$client`delete from place_submission where id = ${id}`).rejects.toThrow(/permission denied/);
    await expect(sql`update place_submission set name = 'Changed' where id = ${id}`).rejects.toThrow(/what was sent never changes/);
    await acceptSubmission(app, coordinator, id);
    await expect(sql`update place_submission set status = 'declined', decline_reason = 'advert' where id = ${id}`).rejects.toThrow(/a decision is made once/);
    await expect(sql`update place_submission set status = 'pending', decided_at = null, decided_by = null where id = ${id}`).rejects.toThrow(/a decision is made once/);
  });

  it("refuses rows the shape checks refuse", async () => {
    await expect(sql`insert into place_submission (ref, kind, lang, name) values ('4444-4444', 'add', 'en', 'No sentence or place')`).rejects.toThrow(/place_submission_add_shape/);
    await expect(sql`insert into place_submission (ref, kind, lang, name, provider_id, changes) values ('4444-4444', 'correct', 'en', 'X', 'M001', '{}'::jsonb)`).resolves.toBeDefined();
    await expect(sql`insert into place_submission (ref, kind, lang, name, provider_id, changes) values ('ABC0-EFGH', 'correct', 'en', 'X', 'M001', '{}'::jsonb)`).rejects.toThrow(/place_submission_ref_format/);
    await expect(
      sql`insert into place_submission (ref, kind, lang, name, provider_id, changes, status) values ('5555-5555', 'correct', 'en', 'X', 'M001', '{}'::jsonb, 'declined')`,
    ).rejects.toThrow(/place_submission_decided_when_not_pending|place_submission_reason_when_declined/);
  });

  it("seeds five demo suggestions once (four without a provider to correct), and inserts nothing on a second run", async () => {
    const providers = Number((await sql`select count(*)::int as n from provider`)[0]!.n);
    const first = await seedDemoSubmissions(owner);
    expect(first.inserted).toBe(providers > 0 ? 5 : 4);
    expect(await seedDemoSubmissions(owner)).toEqual({ inserted: 0 });
    const rows = await sql`select ref, status from place_submission order by ref`;
    expect(rows.map((r) => r.status).sort()).toEqual([...(providers > 0 ? ["pending"] : []), "accepted", "declined", "pending", "pending"].sort());
    expect((await listSubmissionQueue(app)).waiting.length).toBe(providers > 0 ? 3 : 2);
    expect((await listSubmissionsToApply(app)).map((s) => s.ref)).toEqual(["SEED-5E5E"]);
    expect(await readSubmissionStatus(app, "SEED-4D4D")).toMatchObject({ status: "declined", reason: "advert" });
  });
});
