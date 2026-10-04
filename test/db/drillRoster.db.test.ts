// The drill roster against a real database (S06.05): the table and its lock-down (the app may add, change a label, a number and a language, and delete a row;
// no client role reaches it), an Admin's add, edit and remove audited without the number, the label or the language, the size limit and the duplicate, the removal
// that skips a member's waiting texts and detaches the ones already handed off, and that the number is in no delivery row, ops_event, audit record or log line.
// Every number is fictional (555).
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { record, recordRefusal } from "../../src/modules/audit";
import { createDeliveryQueue } from "../../src/modules/messaging";
import { DRILL_ROSTER_MAX, createDrillRoster, type DrillRoster } from "../../src/modules/subscriptions";
import { createDb, type Db } from "../../src/platform/db";
import { transitionStatement } from "./deliveryFixtures";
import { dispatcherWorld, type DispatcherWorld } from "./dispatcherSupport";
import { connect, serverUrl } from "./helpers";

let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
let world: DispatcherWorld;
let roster: DrillRoster;
let admin: string;
let auditBaseline = 0;

const NUMBERS = [
  "416-555-0123",
  "(647) 555-0199",
  "+1 905 555 0142",
  "437-555-0166",
  "289-555-0117",
  "613-555-0188",
  "519-555-0105",
  "807-555-0133",
  "705-555-0171",
  "343-555-0150",
  "226-555-0194",
  "403-555-0111",
  "587-555-0112",
  "780-555-0113",
  "604-555-0114",
  "778-555-0115",
  "250-555-0116",
  "902-555-0118",
  "506-555-0119",
  "709-555-0120",
  "867-555-0121",
];
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
  roster = createDrillRoster({
    db: app,
    audit: { record: (tx, event) => record(tx, event), recordRefusal: (db, event) => recordRefusal(db, event) },
    skipRecipientDeliveries: (tx, recipient) => createDeliveryQueue().skipRecipientDeliveries(tx, recipient),
  });
});

/** The roster, the audit records this file wrote (they name the Admin, whom the fixtures delete) and the world. */
async function resetAll() {
  await owner`delete from drill_roster`;
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

const audits = () =>
  owner`select action, actor_staff_id, subject_type, subject_id, outcome, meta from audit_event where id > ${auditBaseline} and action like 'drill_roster.%' order by id`;

async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? `${error.message} ${(error as { cause?: Error }).cause?.message ?? ""}` : String(error);
  }
  return "";
}

describe("the table and its lock-down", () => {
  it("lets the app read, add, delete and change a label, a number and a language, and nothing else; no client role reaches it", async () => {
    const privileges = await owner<{ role: string; privilege: string; allowed: boolean }[]>`
      select r.role, p.privilege, has_table_privilege(r.role, 'public.drill_roster', p.privilege) as allowed
      from (values ('cvh_app'), ('anon'), ('authenticated'), ('service_role')) as r(role),
           (values ('select'), ('insert'), ('delete'), ('truncate'), ('references'), ('trigger')) as p(privilege)`;
    expect(privileges.filter((row) => row.allowed).map((row) => `${row.role}:${row.privilege}`).sort()).toEqual(["cvh_app:delete", "cvh_app:insert", "cvh_app:select"]);
    const columns = await owner<{ grantee: string; column_name: string }[]>`
      select grantee, column_name from information_schema.column_privileges
      where table_name = 'drill_roster' and privilege_type = 'UPDATE' and grantee in ('cvh_app', 'anon', 'authenticated', 'service_role') order by column_name`;
    expect(columns.map((row) => `${row.grantee}:${row.column_name}`)).toEqual(["cvh_app:label", "cvh_app:lang", "cvh_app:phone", "cvh_app:updated_at"]);
  });

  it("has row level security on, and policies for the app's role only", async () => {
    expect(await owner`select relrowsecurity from pg_class where relname = 'drill_roster'`).toEqual([{ relrowsecurity: true }]);
    const policies = await owner`select policyname, cmd, roles::text from pg_policies where tablename = 'drill_roster' order by cmd`;
    expect(policies.map((row) => [row.cmd, row.roles])).toEqual([
      ["DELETE", "{cvh_app}"],
      ["INSERT", "{cvh_app}"],
      ["SELECT", "{cvh_app}"],
      ["UPDATE", "{cvh_app}"],
    ]);
  });

  it("refuses a number that is not a Canadian E.164 number, a blank label, a label over 40 characters and a language that is not one, whoever asks", async () => {
    const insert = (label: string, phone: string, lang = "en") =>
      owner.unsafe(`insert into drill_roster (id, label, phone, lang, added_by) values (gen_random_uuid(), '${label}', '${phone}', '${lang}', '${admin}')`);
    expect(await refusal(() => insert("A", "4165550123"))).toMatch(/drill_roster_phone_format/);
    expect(await refusal(() => insert("A", "+4165550123"))).toMatch(/drill_roster_phone_format/);
    expect(await refusal(() => insert(" ", "+14165550123"))).toMatch(/drill_roster_label_format/);
    expect(await refusal(() => insert("x".repeat(41), "+14165550123"))).toMatch(/drill_roster_label_format/);
    expect(await refusal(() => insert("A", "+14165550123", "xx"))).toMatch(/drill_roster_lang_valid/);
  });

  it("keeps a number once (unique) and carries the delivery trigger that detaches a deleted member's texts", async () => {
    const insert = () => owner.unsafe(`insert into drill_roster (id, label, phone, lang, added_by) values (gen_random_uuid(), 'A', '+14165550123', 'en', '${admin}')`);
    await insert();
    expect(await refusal(insert)).toMatch(/drill_roster_phone_idx/);
    const triggers = await owner`select tgname from pg_trigger where tgrelid = 'drill_roster'::regclass and not tgisinternal`;
    expect(triggers).toEqual([{ tgname: "drill_roster_forget_deliveries" }]);
  });

  it("is refused to the app's role when it tries to change what it may not (who added it, when, the id)", async () => {
    const added = await roster.add({ actorStaffId: admin, label: "A", number: NUMBERS[0], lang: "en" });
    if (added.kind !== "added") throw new Error("not added");
    expect(await refusal(() => appSql`update drill_roster set added_by = ${admin} where id = ${added.id}`)).toMatch(/permission denied/);
    expect(await refusal(() => appSql`update drill_roster set created_at = now() where id = ${added.id}`)).toMatch(/permission denied/);
    expect(await refusal(() => appSql`update drill_roster set label = 'B' where id = ${added.id}`)).toBe("");
  });
});

describe("an Admin's 'Add'", () => {
  it("saves the member, audits it without the number, the label or the language, and lists it masked", async () => {
    const outcome = await roster.add({ actorStaffId: admin, label: "IT lead", number: NUMBERS[0], lang: "ur" });

    expect(outcome).toMatchObject({ kind: "added", label: "IT lead", size: 1 });
    const stored = await owner`select label, phone, lang, added_by from drill_roster`;
    expect(stored).toEqual([{ label: "IT lead", phone: E164(NUMBERS[0]), lang: "ur", added_by: admin }]);
    const trail = await audits();
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({ action: "drill_roster.added", actor_staff_id: admin, subject_type: "drill_roster", outcome: "ok", meta: { roster_size: 1 } });
    expect(trail[0].subject_id).toBe((outcome as { id: string }).id);
    const everything = JSON.stringify(await owner`select * from audit_event where id > ${auditBaseline}`);
    expect(everything).not.toContain(DIGITS(NUMBERS[0]));
    expect(everything).not.toContain("IT lead");
    expect(await roster.list()).toEqual([{ id: (outcome as { id: string }).id, label: "IT lead", masked: "+1 ••• ••• 0123", lang: "ur", createdAt: expect.any(Date) }]);
    expect(JSON.stringify(await roster.list())).not.toContain("416");
  });

  it("writes the member and its audit record together: an audit that cannot be written leaves the roster as it was", async () => {
    const failing = createDrillRoster({
      db: app,
      audit: { record: async () => Promise.reject(new Error("audit down")), recordRefusal: (db, event) => recordRefusal(db, event) },
      skipRecipientDeliveries: (tx, recipient) => createDeliveryQueue().skipRecipientDeliveries(tx, recipient),
    });
    await expect(failing.add({ actorStaffId: admin, label: "IT lead", number: NUMBERS[0], lang: "en" })).rejects.toThrow("audit down");
    expect(await owner`select count(*)::int as n from drill_roster`).toEqual([{ n: 0 }]);
  });

  it.each([
    ["no label", { label: "", number: NUMBERS[0], lang: "en" }, "label_missing", "validation"],
    ["a label over 40 characters", { label: "x".repeat(41), number: NUMBERS[0], lang: "en" }, "label_too_long", "validation"],
    ["a number that is not Canadian", { label: "A", number: "+44 20 7946 0958", lang: "en" }, "number_invalid", "validation"],
    ["no number", { label: "A", number: null, lang: "en" }, "number_invalid", "validation"],
    ["a language that is not one", { label: "A", number: NUMBERS[0], lang: "klingon" }, "language_invalid", "validation"],
    ["no language", { label: "A", number: NUMBERS[0], lang: undefined }, "language_invalid", "validation"],
  ])("refuses %s, changes nothing and audits the refusal with only its reason", async (_name, input, problem, reason) => {
    expect(await roster.add({ actorStaffId: admin, ...input })).toEqual({ kind: "refused", problem });
    expect(await owner`select count(*)::int as n from drill_roster`).toEqual([{ n: 0 }]);
    const trail = await audits();
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({ action: "drill_roster.added", outcome: "refused", subject_id: null, meta: { reason } });
  });

  it("refuses a number already on the roster, however it is written, and audits a duplicate", async () => {
    await roster.add({ actorStaffId: admin, label: "IT lead", number: NUMBERS[0], lang: "en" });
    expect(await roster.add({ actorStaffId: admin, label: "Again", number: "1 (416) 555-0123", lang: "en" })).toEqual({ kind: "refused", problem: "number_duplicate" });
    expect(await owner`select count(*)::int as n from drill_roster`).toEqual([{ n: 1 }]);
    expect((await audits()).map((row) => [row.outcome, (row.meta as { reason?: string }).reason])).toEqual([["ok", undefined], ["refused", "duplicate"]]);
  });

  it(`refuses the ${DRILL_ROSTER_MAX + 1}th member, and two Admins who add the last place at once get one of them`, async () => {
    for (const number of NUMBERS.slice(0, DRILL_ROSTER_MAX - 1)) expect(await roster.add({ actorStaffId: admin, label: "A", number, lang: "en" })).toMatchObject({ kind: "added" });
    const [first, second] = await Promise.all([
      roster.add({ actorStaffId: admin, label: "B", number: NUMBERS[DRILL_ROSTER_MAX - 1], lang: "en" }),
      roster.add({ actorStaffId: admin, label: "C", number: NUMBERS[DRILL_ROSTER_MAX], lang: "en" }),
    ]);
    expect([first.kind, second.kind].sort()).toEqual(["added", "refused"]);
    expect(await owner`select count(*)::int as n from drill_roster`).toEqual([{ n: DRILL_ROSTER_MAX }]);
    expect(await roster.add({ actorStaffId: admin, label: "D", number: "418-555-0100", lang: "en" })).toEqual({ kind: "refused", problem: "roster_full" });
  });
});

describe("an Admin's 'Edit'", () => {
  it("changes the label and the language, and the number when one is given, audited without any of them", async () => {
    const added = await roster.add({ actorStaffId: admin, label: "IT lead", number: NUMBERS[0], lang: "en" });
    if (added.kind !== "added") throw new Error("not added");

    expect(await roster.edit({ actorStaffId: admin, id: added.id, label: "Priya", number: "", lang: "hi" })).toEqual({ kind: "edited", label: "Priya", size: 1 });
    expect(await owner`select label, phone, lang from drill_roster`).toEqual([{ label: "Priya", phone: E164(NUMBERS[0]), lang: "hi" }]);

    expect(await roster.edit({ actorStaffId: admin, id: added.id, label: "Priya", number: NUMBERS[1], lang: "hi" })).toMatchObject({ kind: "edited" });
    expect(await owner`select phone from drill_roster`).toEqual([{ phone: E164(NUMBERS[1]) }]);

    const trail = await audits();
    expect(trail.map((row) => [row.action, row.outcome, (row.meta as { roster_size?: number }).roster_size])).toEqual([["drill_roster.added", "ok", 1], ["drill_roster.edited", "ok", 1], ["drill_roster.edited", "ok", 1]]);
    expect(trail[1]).toMatchObject({ subject_type: "drill_roster", subject_id: added.id, actor_staff_id: admin });
    const everything = JSON.stringify(await owner`select * from audit_event where id > ${auditBaseline}`);
    for (const number of NUMBERS.slice(0, 2)) expect(everything).not.toContain(DIGITS(number));
    for (const word of ["IT lead", "Priya", '"hi"']) expect(everything).not.toContain(word);
    expect(await roster.list()).toEqual([{ id: added.id, label: "Priya", masked: "+1 ••• ••• 0199", lang: "hi", createdAt: expect.any(Date) }]);
  });

  it("refuses what an add refuses, a number that is another member's, and a member who is not there, changing nothing and auditing the reason", async () => {
    const a = await roster.add({ actorStaffId: admin, label: "A", number: NUMBERS[0], lang: "en" });
    const b = await roster.add({ actorStaffId: admin, label: "B", number: NUMBERS[1], lang: "ur" });
    if (a.kind !== "added" || b.kind !== "added") throw new Error("not added");
    expect(await roster.edit({ actorStaffId: admin, id: b.id, label: "B", number: NUMBERS[0], lang: "ur" })).toEqual({ kind: "refused", problem: "number_duplicate" });
    expect(await roster.edit({ actorStaffId: admin, id: b.id, label: "", number: "", lang: "ur" })).toEqual({ kind: "refused", problem: "label_missing" });
    expect(await roster.edit({ actorStaffId: admin, id: b.id, label: "B", number: "12", lang: "ur" })).toEqual({ kind: "refused", problem: "number_invalid" });
    expect(await roster.edit({ actorStaffId: admin, id: b.id, label: "B", number: "", lang: "xx" })).toEqual({ kind: "refused", problem: "language_invalid" });
    expect(await roster.edit({ actorStaffId: admin, id: "01900000-0000-7000-8000-0000000000e9", label: "B", number: "", lang: "ur" })).toEqual({ kind: "refused", problem: "not_found" });
    expect(await roster.edit({ actorStaffId: admin, id: "not-an-id", label: "B", number: "", lang: "ur" })).toEqual({ kind: "refused", problem: "not_found" });
    // A number that is its own is not a duplicate.
    expect(await roster.edit({ actorStaffId: admin, id: b.id, label: "B2", number: "647-555-0199", lang: "ur" })).toMatchObject({ kind: "edited" });
    expect(await owner`select label, phone, lang from drill_roster order by label`).toEqual([
      { label: "A", phone: E164(NUMBERS[0]), lang: "en" },
      { label: "B2", phone: E164(NUMBERS[1]), lang: "ur" },
    ]);
    expect((await audits()).filter((row) => row.outcome === "refused").map((row) => (row.meta as { reason: string }).reason)).toEqual(["duplicate", "validation", "validation", "validation", "not_found", "not_found"]);
  });
});

describe("an Admin's 'Remove'", () => {
  it("deletes the member and audits it without the number or the label", async () => {
    const a = await roster.add({ actorStaffId: admin, label: "IT lead", number: NUMBERS[0], lang: "en" });
    const b = await roster.add({ actorStaffId: admin, label: "Priya", number: NUMBERS[1], lang: "ur" });
    if (a.kind !== "added" || b.kind !== "added") throw new Error("not added");

    expect(await roster.remove({ actorStaffId: admin, id: a.id })).toEqual({ kind: "removed", label: "IT lead", size: 1, skippedTexts: 0 });

    expect((await roster.list()).map((entry) => entry.id)).toEqual([b.id]);
    const trail = await audits();
    expect(trail.map((row) => [row.action, row.outcome, (row.meta as { roster_size?: number }).roster_size])).toEqual([["drill_roster.added", "ok", 1], ["drill_roster.added", "ok", 2], ["drill_roster.removed", "ok", 1]]);
    expect(trail[2]).toMatchObject({ subject_type: "drill_roster", subject_id: a.id, actor_staff_id: admin });
    const everything = JSON.stringify(await owner`select * from audit_event where id > ${auditBaseline}`);
    for (const number of NUMBERS.slice(0, 2)) expect(everything).not.toContain(DIGITS(number));
    expect(everything).not.toContain("IT lead");
  });

  it("refuses a member that is not there (or an id that is not one), changes nothing and audits the refusal", async () => {
    expect(await roster.remove({ actorStaffId: admin, id: "01900000-0000-7000-8000-0000000000e9" })).toEqual({ kind: "refused", problem: "not_found" });
    expect(await roster.remove({ actorStaffId: admin, id: "not-an-id" })).toEqual({ kind: "refused", problem: "not_found" });
    expect(await roster.remove({ actorStaffId: admin, id: undefined })).toEqual({ kind: "refused", problem: "not_found" });
    expect((await audits()).map((row) => [row.outcome, (row.meta as { reason: string }).reason])).toEqual([["refused", "not_found"], ["refused", "validation"], ["refused", "validation"]]);
  });

  it("skips the member's waiting texts, leaves a text already handed off alone, and detaches the member from every delivery", async () => {
    const added = await roster.add({ actorStaffId: admin, label: "IT lead", number: NUMBERS[0], lang: "en" });
    if (added.kind !== "added") throw new Error("not added");
    const drill = await world.seedAlert({ isDrill: true, recipients: [added.id] });
    const second = await world.seedAlert({ isDrill: true, recipients: [added.id] });
    // The second drill's text is already with the provider (the dispatcher's own steps: claim, hand-off, accepted).
    await appSql.begin(async (tx) => {
      await transitionStatement(tx, second.ids[0], "claimed");
      await tx`update delivery set handed_off_at = now() where id = ${second.ids[0]}`;
      await transitionStatement(tx, second.ids[0], "submitted");
    });

    expect(await roster.remove({ actorStaffId: admin, id: added.id })).toEqual({ kind: "removed", label: "IT lead", size: 0, skippedTexts: 1 });

    expect(await world.stateOf(drill.ids[0])).toBe("skipped");
    expect(await world.stateOf(second.ids[0])).toBe("submitted");
    const rows = await owner`select recipient_id, idempotency_key from delivery where id = any(${[drill.ids[0], second.ids[0]]})`;
    expect(rows.every((row) => row.recipient_id === null && String(row.idempotency_key).startsWith("detached:"))).toBe(true);
  });
});
