// The on-call roster against a real database (S06.07): the table and its lock-down (the app may add and delete a row and never change one; no
// client role reaches it), an Admin's add and remove audited without the number or the label, the size limit and the duplicate, the removal
// that skips a number's waiting texts and detaches the ones already handed off, the resolver's source (the number leaves the table only to the
// sender's hand-off transaction), and that the number is in no delivery row, ops_event, audit record or log line. Every number is fictional (555).
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { record, recordRefusal } from "../../src/modules/audit";
import { createContactResolver, createDeliveryQueue, type MessagingLog } from "../../src/modules/messaging";
import { ONCALL_MAX_NUMBERS, createOncallRoster, oncallNumberSource, type OncallRoster } from "../../src/modules/ops";
import { createDb, type Db } from "../../src/platform/db";
import { transitionStatement } from "./deliveryFixtures";
import { dispatcherWorld, type DispatcherWorld } from "./dispatcherSupport";
import { connect, serverUrl } from "./helpers";

let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
let world: DispatcherWorld;
let roster: OncallRoster;
let admin: string;
let auditBaseline = 0;

const NUMBERS = ["416-555-0123", "(647) 555-0199", "+1 905 555 0142", "437-555-0166", "289-555-0117", "613-555-0188", "519-555-0105", "807-555-0133", "705-555-0171", "343-555-0150", "226-555-0194"];
const E164 = (formatted: string) => `+1${formatted.replace(/\D/g, "").slice(-10)}`;
const DIGITS = (formatted: string) => formatted.replace(/\D/g, "").slice(-10);

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
  world = dispatcherWorld(owner, appSql, app);
  [{ max: auditBaseline }] = await owner`select coalesce(max(id), 0)::int as max from audit_event`;
  roster = createOncallRoster({
    db: app,
    audit: { record: (tx, event) => record(tx, event), recordRefusal: (db, event) => recordRefusal(db, event) },
    skipRecipientDeliveries: (tx, recipient) => createDeliveryQueue().skipRecipientDeliveries(tx, recipient),
  });
});

/** The roster, the audit records this file wrote (they name the Admin, whom the fixtures delete) and the world. */
async function resetAll() {
  await owner`delete from oncall_roster`;
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await tx`delete from audit_event where id > ${auditBaseline}`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
  });
  await world.reset();
}

afterAll(async () => {
  await resetAll();
  await app.$client.end({ timeout: 5 });
  await appSql.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

beforeEach(async () => {
  await resetAll();
  admin = (await world.fx.staff("admin")).id;
});

const audits = () => owner`select action, actor_staff_id, subject_type, subject_id, outcome, meta from audit_event where id > ${auditBaseline} and action in ('oncall.added', 'oncall.removed') order by id`;

async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? `${error.message} ${(error as { cause?: Error }).cause?.message ?? ""}` : String(error);
  }
  return "";
}

describe("the table and its lock-down", () => {
  it("lets the app add and delete a row, and read it, and nothing else; no client role reaches it", async () => {
    const privileges = await owner<{ role: string; privilege: string; allowed: boolean }[]>`
      select r.role, p.privilege, has_table_privilege(r.role, 'public.oncall_roster', p.privilege) as allowed
      from (values ('cvh_app'), ('anon'), ('authenticated'), ('service_role')) as r(role),
           (values ('select'), ('insert'), ('update'), ('delete'), ('truncate')) as p(privilege)`;
    const allowed = privileges.filter((row) => row.allowed).map((row) => `${row.role}:${row.privilege}`);
    expect(allowed.sort()).toEqual(["cvh_app:delete", "cvh_app:insert", "cvh_app:select"]);
    // S08.08: the app may change an entry's role and account (the on-duty Admin), never its label or number.
    const columns = await owner`select grantee, column_name from information_schema.column_privileges where table_name = 'oncall_roster' and privilege_type = 'UPDATE' and grantee in ('cvh_app', 'anon', 'authenticated', 'service_role') order by column_name`;
    expect(columns.map((row) => `${row.grantee}:${row.column_name}`)).toEqual(["cvh_app:role", "cvh_app:staff_id"]);
  });

  it("has row level security on, and policies for the app's role only", async () => {
    expect(await owner`select relrowsecurity from pg_class where relname = 'oncall_roster'`).toEqual([{ relrowsecurity: true }]);
    const policies = await owner`select policyname, cmd, roles::text from pg_policies where tablename = 'oncall_roster' order by cmd`;
    expect(policies.map((row) => [row.cmd, row.roles])).toEqual([
      ["DELETE", "{cvh_app}"],
      ["INSERT", "{cvh_app}"],
      ["SELECT", "{cvh_app}"],
      ["UPDATE", "{cvh_app}"],
    ]);
  });

  it("refuses a number that is not a Canadian E.164 number, a blank label and a label over 40 characters, whoever asks", async () => {
    const insert = (label: string, phone: string) => owner.unsafe(`insert into oncall_roster (id, label, phone, added_by) values (gen_random_uuid(), '${label}', '${phone}', '${admin}')`);
    expect(await refusal(() => insert("A", "4165550123"))).toMatch(/oncall_roster_phone_format/);
    expect(await refusal(() => insert("A", "+4165550123"))).toMatch(/oncall_roster_phone_format/);
    expect(await refusal(() => insert("A", "+14165550123 "))).toMatch(/oncall_roster_phone_format/);
    expect(await refusal(() => insert(" ", "+14165550123"))).toMatch(/oncall_roster_label_format/);
    expect(await refusal(() => insert("x".repeat(41), "+14165550123"))).toMatch(/oncall_roster_label_format/);
  });

  it("keeps a number once (unique)", async () => {
    const insert = () => owner.unsafe(`insert into oncall_roster (id, label, phone, added_by) values (gen_random_uuid(), 'A', '+14165550123', '${admin}')`);
    await insert();
    expect(await refusal(insert)).toMatch(/oncall_roster_phone_idx/);
  });

  it("is in the ownership table as ops' (the spine) and carries the delivery trigger that detaches a deleted entry's texts", async () => {
    const triggers = await owner`select tgname from pg_trigger where tgrelid = 'oncall_roster'::regclass and not tgisinternal`;
    // S08.08: and the guard that keeps an entry's label and number as written and an on-duty entry an active Admin's with an authenticator.
    expect(triggers.map((row) => row.tgname).sort()).toEqual(["oncall_roster_forget_deliveries", "oncall_roster_guard"]);
  });
});

describe("an Admin's 'Add number'", () => {
  it("saves the entry, audits it without the number or the label, and lists it masked", async () => {
    const outcome = await roster.add({ actorStaffId: admin, label: "IT lead", number: NUMBERS[0] });

    expect(outcome).toMatchObject({ kind: "added", label: "IT lead", size: 1 });
    const stored = await owner`select label, phone, added_by from oncall_roster`;
    expect(stored).toEqual([{ label: "IT lead", phone: E164(NUMBERS[0]), added_by: admin }]);
    const trail = await audits();
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({ action: "oncall.added", actor_staff_id: admin, subject_type: "oncall_roster", outcome: "ok", meta: { roster_size: 1 } });
    expect(trail[0].subject_id).toBe((outcome as { id: string }).id);
    const everything = JSON.stringify(await owner`select * from audit_event where id > ${auditBaseline}`);
    expect(everything).not.toContain(DIGITS(NUMBERS[0]));
    expect(everything).not.toContain("IT lead");
    expect(await roster.list()).toEqual([{ id: (outcome as { id: string }).id, label: "IT lead", masked: "+1 ••• ••• 0123", createdAt: expect.any(Date), onDuty: false, staffId: null }]);
    expect(JSON.stringify(await roster.list())).not.toContain("416");
  });

  it("writes the entry and its audit record together: an audit that cannot be written leaves the roster as it was", async () => {
    const failing = createOncallRoster({
      db: app,
      audit: { record: async () => Promise.reject(new Error("audit down")), recordRefusal: (db, event) => recordRefusal(db, event) },
      skipRecipientDeliveries: (tx, recipient) => createDeliveryQueue().skipRecipientDeliveries(tx, recipient),
    });
    await expect(failing.add({ actorStaffId: admin, label: "IT lead", number: NUMBERS[0] })).rejects.toThrow("audit down");
    expect(await owner`select count(*)::int as n from oncall_roster`).toEqual([{ n: 0 }]);
  });

  it.each([
    ["no label", { label: "", number: NUMBERS[0] }, "label_missing", "validation"],
    ["a label over 40 characters", { label: "x".repeat(41), number: NUMBERS[0] }, "label_too_long", "validation"],
    ["a number that is not Canadian", { label: "A", number: "+44 20 7946 0958" }, "number_invalid", "validation"],
    ["no number", { label: "A", number: null }, "number_invalid", "validation"],
  ])("refuses %s, changes nothing and audits the refusal with only its reason", async (_name, input, problem, reason) => {
    expect(await roster.add({ actorStaffId: admin, ...input })).toEqual({ kind: "refused", problem });
    expect(await owner`select count(*)::int as n from oncall_roster`).toEqual([{ n: 0 }]);
    const trail = await audits();
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({ action: "oncall.added", outcome: "refused", subject_id: null, meta: { reason } });
  });

  it("refuses a number already on the list, however it is written, and audits a duplicate", async () => {
    await roster.add({ actorStaffId: admin, label: "IT lead", number: NUMBERS[0] });
    expect(await roster.add({ actorStaffId: admin, label: "Again", number: "1 (416) 555-0123" })).toEqual({ kind: "refused", problem: "number_duplicate" });
    expect(await owner`select count(*)::int as n from oncall_roster`).toEqual([{ n: 1 }]);
    expect((await audits()).map((row) => [row.outcome, (row.meta as { reason?: string }).reason])).toEqual([["ok", undefined], ["refused", "duplicate"]]);
  });

  it(`refuses the ${ONCALL_MAX_NUMBERS + 1}th number, and two Admins who add the last place at once get one of them`, async () => {
    for (const number of NUMBERS.slice(0, ONCALL_MAX_NUMBERS - 1)) expect(await roster.add({ actorStaffId: admin, label: "A", number })).toMatchObject({ kind: "added" });
    const [first, second] = await Promise.all([
      roster.add({ actorStaffId: admin, label: "B", number: NUMBERS[ONCALL_MAX_NUMBERS - 1] }),
      roster.add({ actorStaffId: admin, label: "C", number: NUMBERS[ONCALL_MAX_NUMBERS] }),
    ]);
    expect([first.kind, second.kind].sort()).toEqual(["added", "refused"]);
    expect(await owner`select count(*)::int as n from oncall_roster`).toEqual([{ n: ONCALL_MAX_NUMBERS }]);
    expect(await roster.add({ actorStaffId: admin, label: "D", number: "418-555-0100" })).toEqual({ kind: "refused", problem: "roster_full" });
  });

  it("is refused to the app's role when it tries to change a number in place", async () => {
    const added = await roster.add({ actorStaffId: admin, label: "IT lead", number: NUMBERS[0] });
    if (added.kind !== "added") throw new Error("not added");
    expect(await refusal(() => appSql`update oncall_roster set phone = '+14165550199' where id = ${added.id}`)).toMatch(/permission denied/);
    expect(await refusal(() => appSql`update oncall_roster set label = 'x' where id = ${added.id}`)).toMatch(/permission denied/);
  });
});

describe("an Admin's 'Remove'", () => {
  it("deletes the entry and audits it without the number or the label", async () => {
    const a = await roster.add({ actorStaffId: admin, label: "IT lead", number: NUMBERS[0] });
    const b = await roster.add({ actorStaffId: admin, label: "Priya", number: NUMBERS[1] });
    if (a.kind !== "added" || b.kind !== "added") throw new Error("not added");

    expect(await roster.remove({ actorStaffId: admin, id: a.id })).toEqual({ kind: "removed", label: "IT lead", size: 1, skippedTexts: 0 });

    expect((await roster.list()).map((entry) => entry.id)).toEqual([b.id]);
    const trail = await audits();
    expect(trail.map((row) => [row.action, row.outcome, (row.meta as { roster_size?: number }).roster_size])).toEqual([["oncall.added", "ok", 1], ["oncall.added", "ok", 2], ["oncall.removed", "ok", 1]]);
    expect(trail[2]).toMatchObject({ subject_type: "oncall_roster", subject_id: a.id, actor_staff_id: admin });
    const everything = JSON.stringify(await owner`select * from audit_event where id > ${auditBaseline}`);
    for (const number of NUMBERS.slice(0, 2)) expect(everything).not.toContain(DIGITS(number));
    expect(everything).not.toContain("IT lead");
  });

  it("refuses an entry that is not there (or an id that is not one), changes nothing and audits the refusal", async () => {
    expect(await roster.remove({ actorStaffId: admin, id: "01900000-0000-7000-8000-0000000000e9" })).toEqual({ kind: "refused", problem: "not_found" });
    expect(await roster.remove({ actorStaffId: admin, id: "not-an-id" })).toEqual({ kind: "refused", problem: "not_found" });
    expect(await roster.remove({ actorStaffId: admin, id: undefined })).toEqual({ kind: "refused", problem: "not_found" });
    expect((await audits()).map((row) => [row.outcome, (row.meta as { reason: string }).reason])).toEqual([["refused", "not_found"], ["refused", "validation"], ["refused", "validation"]]);
  });

  it("skips the number's waiting texts, leaves a text already handed off alone, and detaches the entry from every delivery", async () => {
    const added = await roster.add({ actorStaffId: admin, label: "IT lead", number: NUMBERS[0] });
    if (added.kind !== "added") throw new Error("not added");
    const waiting = await world.seedTransactional(2, { recipient_kind: "oncall", recipient_id: added.id, purpose: "oncall_alert", created_by_module: "ops" });
    const [handedOff] = await world.seedTransactional(1, { recipient_kind: "oncall", recipient_id: added.id, purpose: "oncall_alert", created_by_module: "ops" });
    // One text is already with the provider (the dispatcher's own steps: claim, hand-off, accepted).
    await appSql.begin(async (tx) => {
      await transitionStatement(tx, handedOff, "claimed");
      await tx`update delivery set handed_off_at = now() where id = ${handedOff}`;
      await transitionStatement(tx, handedOff, "submitted");
    });

    expect(await roster.remove({ actorStaffId: admin, id: added.id })).toEqual({ kind: "removed", label: "IT lead", size: 0, skippedTexts: 2 });

    expect(await world.statesOf(waiting)).toEqual({ [waiting[0]]: "skipped", [waiting[1]]: "skipped" });
    expect(await world.stateOf(handedOff)).toBe("submitted");
    const rows = await owner`select recipient_id, idempotency_key from delivery where id = any(${[...waiting, handedOff]})`;
    expect(rows.every((row) => row.recipient_id === null && String(row.idempotency_key).startsWith("detached:"))).toBe(true);
  });
});

describe("the resolver's source", () => {
  it("gives the number of an entry inside the caller's transaction, and null for one that was removed", async () => {
    const added = await roster.add({ actorStaffId: admin, label: "IT lead", number: NUMBERS[2] });
    if (added.kind !== "added") throw new Error("not added");

    const found = await app.transaction((tx) => oncallNumberSource.numberOf(tx, added.id, { consume: false }));
    expect(found).toBe(E164(NUMBERS[2]));
    await roster.remove({ actorStaffId: admin, id: added.id });
    expect(await app.transaction((tx) => oncallNumberSource.numberOf(tx, added.id, { consume: false }))).toBeNull();
  });

  it("hands the sender the number at the hand-off, logs it masked to its last two digits only, and writes it nowhere", async () => {
    const added = await roster.add({ actorStaffId: admin, label: "IT lead", number: NUMBERS[0] });
    if (added.kind !== "added") throw new Error("not added");
    const [text] = await world.seedTransactional(1, { recipient_kind: "oncall", recipient_id: added.id, purpose: "oncall_alert", created_by_module: "ops", body: "CVH: test" });
    const lines: string[] = [];
    const log: MessagingLog = { info: (evt, fields) => void lines.push(JSON.stringify({ evt, fields })), error: (evt, fields) => void lines.push(JSON.stringify({ evt, fields })) };
    world.useResolver({ resolver: createContactResolver({ sources: { oncall: oncallNumberSource }, log }), asked: [], gone: new Set() });

    await world.dispatcher({ log }).run();

    expect(world.provider.calls.map((call) => call.to)).toEqual([E164(NUMBERS[0])]);
    expect(await world.stateOf(text)).toBe("submitted");
    expect(lines.join("\n")).not.toContain(DIGITS(NUMBERS[0]));
    expect(lines.join("\n")).toContain("contact.resolved");
    expect(await world.everythingStored()).not.toContain(DIGITS(NUMBERS[0]));
  });

  it("sends an on-call text while texts are paused, and skips the text of an entry removed before the hand-off", async () => {
    const kept = await roster.add({ actorStaffId: admin, label: "A", number: NUMBERS[0] });
    const gone = await roster.add({ actorStaffId: admin, label: "B", number: NUMBERS[1] });
    if (kept.kind !== "added" || gone.kind !== "added") throw new Error("not added");
    const [toKept] = await world.seedTransactional(1, { recipient_kind: "oncall", recipient_id: kept.id, purpose: "oncall_alert", created_by_module: "ops" });
    const [toGone] = await world.seedTransactional(1, { recipient_kind: "oncall", recipient_id: gone.id, purpose: "oncall_alert", created_by_module: "ops" });
    const [resident] = await world.seedTransactional(1);
    // The removal of "B" skips its waiting text before the sender is asked.
    await roster.remove({ actorStaffId: admin, id: gone.id });
    await world.setPause(true);
    world.useResolver({ resolver: createContactResolver({ sources: { oncall: oncallNumberSource }, log: world.log }), asked: [], gone: new Set() });

    await world.dispatcher().run();

    expect(world.provider.calls.map((call) => call.to)).toEqual([E164(NUMBERS[0])]);
    expect(await world.statesOf([toKept, toGone, resident])).toEqual({ [toKept]: "submitted", [toGone]: "skipped", [resident]: "queued" });
  });
});
