// The alert lifecycle against a real database (S04.03): the tables and their lock-down, the state
// machine in the entry trigger checked for every pair of statuses against lifecycle.ts, the editor
// and approval rules (by the use cases and by direct SQL with the app's credentials), the frozen
// pending entry, the actor requirement, the thread lock with concurrent approvals, and the audit.
// The use cases run as the app's own role (cvh_app_login); "direct SQL" is the same role with no
// use case in front, which is all the app's code could ever do.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import {
  ENTRY_STATUSES,
  ENTRY_TRANSITIONS,
  createAlerting,
  requestTransition,
  type AlertActor,
  type AlertLifecycle,
  type EntryContent,
  type EntryPreparer,
  type EntryRef,
  type EntryStatus,
  type FrozenContent,
} from "../../src/modules/alerting";
import type { Audience } from "../../src/contracts/audience";
import { createAssignments } from "../../src/modules/identity";
import { floorsOfBuilding } from "../../src/modules/places";
import { createDb, type Db } from "../../src/platform/db";
import { connect, serverUrl } from "./helpers";
import { submitSeams } from "./alertSubmitSeams";

/** The buildings the tests name (S04.04: an audience may name only buildings that exist), with the floors of the first. */
const RSN = "4154146";
const OTHER_RSN = "4154147";
const floorId = (index: number) => `01900000-0000-7000-8000-0000000a${String(index).padStart(4, "0")}`;
const FLOORS = ["G", "1", "2", "3", "4", "5"];
const madeNeighbourhoods: string[] = [];

const NOW = new Date("2026-10-01T15:00:00Z");
let clock = NOW;

const sha = (tag: string) => createHash("sha256").update(tag).digest("hex");

const NB_AUDIENCE: Audience = { scope: "neighbourhood", neighbourhood_ids: ["TP"], groups: [], types: ["power"] };
/** The audience of a building (the whole building by default), carrying the entry's types. */
const buildingAudience = (types: string[] = ["power"], rsn = RSN, floors: string[] | null = null): Audience => ({ scope: "buildings", buildings: [{ rsn, floors }], groups: [], types: [...types].sort() });

const content = (over: Partial<EntryContent> = {}): EntryContent => ({
  text: "Power is out on floors 3 to 5.",
  types: ["power"],
  audience: buildingAudience([...(over.types ?? ["power"])]),
  phase: "problem",
  validUntil: new Date("2026-10-02T15:00:00Z"),
  ...over,
});

const frozen = (tag: string): FrozenContent => ({
  contentHash: sha(tag),
  smsBodies: { en: { body: `en ${tag}`, encoding: "gsm7", segments: 1 }, ur: { body: `ur ${tag}`, encoding: "ucs2", segments: 1 } },
  translations: [
    { lang: "ur", body: `ur ${tag}`, machine: true, model: "m1", status: "translated", sourceHash: sha("source") },
    {
      lang: "zh-Hant",
      body: `zh-Hant ${tag}`,
      machine: true,
      model: "opencc-js 1.4.2",
      status: "script_converted",
      sourceHash: sha("source"),
      conversion: { from: "zh", fromTextHash: sha("zh"), openccVersion: "1.4.2", config: "s2twp" },
    },
  ],
});

const preparerOf = (tag: string): EntryPreparer => ({ prepare: async () => ({ ok: true, value: frozen(tag) }) });
const failingPreparer: EntryPreparer = {
  prepare: async () => {
    throw new Error("every model failed");
  },
};

type Role = "ambassador" | "coordinator" | "director" | "admin";
interface Account {
  id: string;
  role: Role;
}

let owner: ReturnType<typeof connect>;
let appUrl: string;
let appSql: postgres.Sql;
let app: Db;
let alerting: AlertLifecycle;
let seams: ReturnType<typeof submitSeams>;
const accounts: Account[] = [];

async function account(role: Role): Promise<Account> {
  const id = randomUUID();
  await owner`insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password)
              values (${id}, ${randomUUID()}, ${`al_${randomBytes(5).toString("hex")}`}, 'Test', ${role}, 'test@example.org', ${role}, false)`;
  const created = { id, role };
  accounts.push(created);
  return created;
}

let authorA: Account;
let coordB: Account;
let adminC: Account;
let director: Account;
let ambassador: Account;

const actorOf = (who: Account, aal: AlertActor["aal"] = who.role === "ambassador" ? "aal1" : "aal2"): AlertActor => ({ staffId: who.id, aal });

async function clear() {
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await tx`delete from audit_event where subject_type in ('alert', 'alert_entry')`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
    await tx.unsafe("truncate alert_submit_attempt, delivery, alert_entry_translation, alert_entry, alert");
  });
  await owner`update staff_account set role = ${authorA.role}::staff_role, status = 'active' where id = ${authorA.id}`;
}

beforeAll(async () => {
  owner = connect(serverUrl());
  await migrate({ sql: owner, log: () => {} });
  const password = randomBytes(18).toString("hex");
  await owner.unsafe(`alter role cvh_app_login password '${password}'`);
  const url = new URL(serverUrl());
  url.username = "cvh_app_login";
  url.password = password;
  appUrl = url.href;
  appSql = postgres(appUrl, { max: 4, onnotice: () => {} });
  app = createDb(appUrl);
  for (const [id, name, fsa] of [["TP", "Thorncliffe Park", "M4H"], ["FP", "Flemingdon Park", "M3C"]]) {
    if ((await owner`select 1 from neighbourhood where id = ${id}`).length === 0) {
      await owner`insert into neighbourhood (id, name, fsa) values (${id}, ${name}, ${fsa})`;
      madeNeighbourhoods.push(id);
    }
  }
  for (const rsn of [RSN, OTHER_RSN]) {
    await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at)
                values (${rsn}, 'TP', ${`${rsn} Test Dr`}, 43.7, -79.34, '2026-10-01T12:00:00Z') on conflict do nothing`;
  }
  for (const [index, label] of FLOORS.entries()) {
    await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${floorId(index)}, ${RSN}, ${label}, ${index}, true) on conflict do nothing`;
  }
  authorA = await account("coordinator");
  coordB = await account("coordinator");
  adminC = await account("admin");
  director = await account("director");
  ambassador = await account("ambassador");
  alerting = createAlerting({ db: app, now: () => clock });
  seams = submitSeams(owner, alerting);
});

afterAll(async () => {
  await clear();
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    for (const { id } of accounts) await tx`delete from audit_event where actor_staff_id = ${id}`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
    for (const { id } of accounts) await tx`delete from staff_account where id = ${id}`;
  });
  await owner`delete from building_floor where rsn = ${RSN}`;
  await owner`delete from building where rsn in (${RSN}, ${OTHER_RSN})`;
  for (const id of madeNeighbourhoods) await owner`delete from neighbourhood where id = ${id}`;
  await app?.$client.end({ timeout: 5 });
  await appSql?.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

beforeEach(async () => {
  clock = NOW;
  await clear();
});

// --- helpers ----------------------------------------------------------------------------------------

async function newDraft(by: Account = authorA, over: Partial<EntryContent> = {}, isDrill = false): Promise<EntryRef> {
  const created = await alerting.createAlert(actorOf(by), { kind: "ack", isDrill, reportedAt: new Date("2026-10-01T14:50:00Z"), content: content(over) });
  if (!created.ok) throw new Error(`createAlert refused: ${created.error}`);
  return { alertId: created.value.thread.id, entryId: created.value.entry.id };
}

async function newPending(by: Account = authorA, tag = "v1", isDrill = false): Promise<EntryRef> {
  const ref = await newDraft(by, {}, isDrill);
  const submitted = await seams.freeze(actorOf(by), ref, frozen(tag));
  if (!submitted.ok) throw new Error(`freeze refused: ${submitted.error}`);
  return ref;
}

const entryRow = async (id: string) => (await owner`select * from alert_entry where id = ${id}`)[0];
const feedVersion = async () => Number((await owner`select version from feed_version`)[0].version);
const auditRows = () =>
  owner<{ action: string; outcome: string; actor_staff_id: string | null; subject_type: string; subject_id: string | null; is_drill: boolean; meta: Record<string, unknown> }[]>`
    select action, outcome, actor_staff_id, subject_type, subject_id, is_drill, meta from audit_event where subject_type in ('alert', 'alert_entry') order by id`;

/** A thread written directly by the owner, as the acting account (the insert trigger requires it). */
async function insertRawAlert(alertId: string) {
  await owner.begin(async (tx) => {
    await tx`select set_config('cvh.actor_id', ${authorA.id}, true)`;
    await tx`insert into alert (id, is_drill, reported_at, created_by, slug) values (${alertId}, false, ${new Date(NOW.getTime() - 60_000)}, ${authorA.id}, ${alertId.slice(-12)})`;
  });
}

/** Direct SQL with the app's credentials: one transaction, the acting account set the way a use case sets it. */
async function asApp<T>(actor: string | null, run: (tx: postgres.TransactionSql) => PromiseLike<T>): Promise<T> {
  return appSql.begin(async (tx) => {
    if (actor !== null) await tx`select set_config('cvh.actor_id', ${actor}, true)`;
    return await run(tx);
  }) as Promise<T>;
}

// --- tables, lock-down, drill ----------------------------------------------------------------------

describe("the tables", () => {
  it("exist with row level security on and no policy or privilege for anon, authenticated or service_role", async () => {
    for (const table of ["alert", "alert_entry", "alert_entry_translation", "feed_version", "disruption_type"]) {
      const [info] = await owner`select relrowsecurity as rls from pg_class where oid = ${`public.${table}`}::regclass`;
      expect(info.rls, table).toBe(true);
      const policies = await owner`select roles::text[] as roles from pg_policies where schemaname = 'public' and tablename = ${table}`;
      for (const policy of policies) expect(policy.roles, table).toEqual(["cvh_app"]);
      for (const role of ["anon", "authenticated", "service_role", "public"]) {
        const [privilege] = await owner.unsafe(`select has_table_privilege('${role}', 'public.${table}', 'select, insert, update, delete') as any_privilege`);
        expect(privilege.any_privilege, `${role} on ${table}`).toBe(false);
      }
    }
    const [view] = await owner`select has_table_privilege('authenticated', 'public.nondrill_alert', 'select') as a, has_table_privilege('anon', 'public.nondrill_alert', 'select') as b`;
    expect(view).toEqual({ a: false, b: false });
  });

  it("seed disruption_type with direct per type: power, water, elevator, flood true; fire, other false; heat, smoke, winter null", async () => {
    const rows = await owner`select id, direct from disruption_type order by id`;
    expect(Object.fromEntries(rows.map((row) => [row.id, row.direct]))).toEqual({
      elevator: true,
      fire: false,
      flood: true,
      heat: null,
      other: false,
      power: true,
      smoke: null,
      water: true,
      winter: null,
    });
    expect(await owner`select id from feed_version`).toMatchObject([{ id: 1 }]);
  });

  it("let the app change only what the lifecycle changes: no delete anywhere, no editor_ids, no is_drill, no disruption_type write", async () => {
    const can = async (privilege: string, table: string, column?: string) =>
      (await owner.unsafe(`select ${column ? `has_column_privilege('cvh_app', 'public.${table}', '${column}', '${privilege}')` : `has_table_privilege('cvh_app', 'public.${table}', '${privilege}')`} as ok`))[0].ok;
    for (const table of ["alert", "alert_entry", "feed_version", "disruption_type"]) expect(await can("delete", table), `delete ${table}`).toBe(false);
    expect(await can("truncate", "alert_entry")).toBe(false);
    expect(await can("update", "alert_entry", "editor_ids")).toBe(false);
    expect(await can("update", "alert_entry", "author_id")).toBe(false);
    expect(await can("update", "alert_entry", "status")).toBe(true);
    expect(await can("update", "alert", "is_drill")).toBe(false);
    expect(await can("update", "alert", "status")).toBe(true);
    expect(await can("insert", "disruption_type")).toBe(false);
    expect(await can("update", "alert_entry_translation")).toBe(false);
    expect(await can("delete", "alert_entry_translation")).toBe(true);
  });
});

describe("alert.is_drill and the nondrill_alert view", () => {
  it("cannot be updated, by the app (no privilege) or by anyone else (trigger)", async () => {
    const ref = await newDraft();
    await expect(asApp(authorA.id, (tx) => tx`update alert set is_drill = true where id = ${ref.alertId}`)).rejects.toThrow(/permission denied/);
    await expect(owner`update alert set is_drill = true where id = ${ref.alertId}`).rejects.toThrow(/is_drill/);
    await expect(owner`update alert set reported_at = reported_at - interval '1 hour' where id = ${ref.alertId}`).rejects.toThrow(/never change/);
    expect((await owner`select is_drill from alert where id = ${ref.alertId}`)[0].is_drill).toBe(false);
  });

  it("shows only non-drill threads", async () => {
    const real = await newDraft(authorA);
    const drill = await newDraft(authorA, {}, true);

    const visible = await owner`select id from nondrill_alert`;
    expect(visible.map((row) => row.id)).toEqual([real.alertId]);
    expect((await owner`select count(*)::int as n from alert`)[0].n).toBe(2);
    expect(drill.alertId).not.toBe(real.alertId);
    // The view runs with the caller's rights, and the app can read it.
    expect(await asApp(null, (tx) => tx`select id from nondrill_alert`)).toHaveLength(1);
  });

  it("never reopens a closed thread or changes it", async () => {
    const ref = await newDraft();
    await asApp(null, (tx) => tx`update alert set status = 'closed', closed_reason = 'resolved', closed_at = now() where id = ${ref.alertId}`);
    await expect(asApp(null, (tx) => tx`update alert set status = 'open', closed_reason = null, closed_at = null where id = ${ref.alertId}`)).rejects.toThrow(/ALERT_CLOSED/);
    await expect(asApp(null, (tx) => tx`update alert set closed_reason = 'expired' where id = ${ref.alertId}`)).rejects.toThrow(/ALERT_CLOSED/);
  });
});

// --- the state machine ------------------------------------------------------------------------------

/** A row in the given status, written with the entry trigger off (only a migration-owner can), as an earlier epic's data would be. */
async function seedRaw(status: EntryStatus): Promise<{ alertId: string; entryId: string }> {
  const alertId = randomUUID();
  const entryId = randomUUID();
  const hash = sha(`raw-${status}`);
  const frozenCols = status !== "draft" && status !== "discarded";
  await insertRawAlert(alertId);
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table alert_entry disable trigger alert_entry_guard");
    await tx`insert into alert_entry (id, alert_id, kind, status, author_id, editor_ids, original_text, types, audience, phase, valid_until,
                                      version, content_hash, sms_bodies, submitted_at, approved_by, approved_at, approved_version, approved_hash, web_published_at)
             values (${entryId}, ${alertId}, 'ack', ${status}, ${authorA.id}, ${[authorA.id]}, 'text', ${["power"]}, ${tx.json(NB_AUDIENCE)}, 'problem', ${new Date("2026-10-02T15:00:00Z")},
                     ${frozenCols ? 1 : 0}, ${frozenCols ? hash : null}, ${frozenCols ? tx.json({ en: { body: "x", encoding: "gsm7", segments: 1 } }) : null}, ${frozenCols ? NOW : null},
                     ${status === "approved" || status === "superseded" ? coordB.id : null}, ${status === "approved" || status === "superseded" ? NOW : null},
                     ${status === "approved" || status === "superseded" ? 1 : null}, ${status === "approved" || status === "superseded" ? hash : null}, ${status === "approved" ? NOW : null})`;
    await tx.unsafe("alter table alert_entry enable trigger alert_entry_guard");
  });
  return { alertId, entryId };
}

/** The statement that makes a legal transition from `from` to `to` by an actor who may. */
async function legalChange(tx: postgres.TransactionSql, id: string, from: EntryStatus, to: EntryStatus) {
  if (from === "draft" && to === "pending_approval") {
    await tx`insert into alert_entry_translation (entry_id, lang, body, model, status, source_hash) values (${id}, 'ur', 'body', 'm1', 'translated', ${sha("source")})`;
    return tx`update alert_entry set status = 'pending_approval', version = 1, content_hash = ${sha("h")}, sms_bodies = ${tx.json({ en: { body: "x" } })}, submitted_at = now() where id = ${id}`;
  }
  if (from === "pending_approval" && to === "draft") return tx`update alert_entry set status = 'draft', returned_for = 'return', returned_note = 'Say more.', content_hash = null, sms_bodies = null, submitted_at = null where id = ${id}`;
  if (from === "pending_approval" && to === "approved") {
    return tx`update alert_entry set status = 'approved', approved_by = ${coordB.id}, approved_at = now(), approved_version = version, approved_hash = content_hash, web_published_at = now() where id = ${id}`;
  }
  return tx`update alert_entry set status = ${to} where id = ${id}`;
}

/**
 * The change to `superseded` (S05.02) is allowed only beside an approved correction or withdrawal that names the entry and was approved in this very transaction.
 * The owner makes one with the trigger off (the way a migration would), then makes the change with the trigger on, all in one transaction.
 */
async function supersedeBesideCorrection(id: string) {
  return owner.begin(async (tx) => {
    await tx`select set_config('cvh.actor_id', ${authorA.id}, true)`;
    const [target] = await tx`select alert_id from alert_entry where id = ${id}`;
    await tx.unsafe("alter table alert_entry disable trigger alert_entry_guard");
    await tx`insert into alert_entry (id, alert_id, kind, status, author_id, editor_ids, original_text, types, audience, phase, valid_until,
                                      version, content_hash, sms_bodies, submitted_at, approved_by, approved_at, approved_version, approved_hash, web_published_at, supersedes_id)
             values (${randomUUID()}, ${target.alert_id}, 'correction', 'approved', ${authorA.id}, ${[authorA.id]}, 'text', ${["power"]}, ${tx.json(NB_AUDIENCE)}, 'problem', ${new Date("2026-10-02T15:00:00Z")},
                     1, ${sha("c")}, ${tx.json({ en: { body: "x", encoding: "gsm7", segments: 1 } })}, now(), ${coordB.id}, now(), 1, ${sha("c")}, now(), ${id})`;
    await tx.unsafe("alter table alert_entry enable trigger alert_entry_guard");
    return tx`update alert_entry set status = 'superseded' where id = ${id}`;
  });
}

describe("the entry trigger and lifecycle.ts", () => {
  it("allow exactly the same transitions, for every pair of statuses", async () => {
    const outcomes: string[] = [];
    for (const from of ENTRY_STATUSES) {
      for (const to of ENTRY_STATUSES) {
        if (from === "draft" && to === "draft") continue;
        const domain = requestTransition({ from, to, webPublished: false, threadOpen: true });
        const { entryId } = await seedRaw(from);
        const actor = to === "approved" ? coordB.id : authorA.id;
        // An approval is by someone who is not an editor; every other change is by the author.
        const attempt = to === "superseded" ? supersedeBesideCorrection(entryId) : asApp(actor === coordB.id ? coordB.id : authorA.id, (tx) => legalChange(tx, entryId, from, to));
        if (domain.ok) {
          await expect(attempt, `${from} -> ${to}`).resolves.toBeDefined();
          expect((await entryRow(entryId)).status).toBe(to);
        } else {
          await expect(attempt, `${from} -> ${to}`).rejects.toThrow(/is not an allowed transition|cannot be changed/);
          expect((await entryRow(entryId)).status).toBe(from);
        }
        outcomes.push(`${from} -> ${to}: ${domain.ok ? "allowed" : "refused"}`);
      }
    }
    expect(outcomes).toHaveLength(ENTRY_STATUSES.length ** 2 - 1);
    // A pending entry is superseded only when residents can read it: these rows are not web-published, so that one is refused here (alertCorrection.db.test.ts has the published case).
    expect(outcomes.filter((line) => line.endsWith("allowed"))).toHaveLength(ENTRY_TRANSITIONS.filter((rule) => rule.from !== null && !(rule.from === "pending_approval" && rule.to === "superseded")).length);
  });

  it("start an entry as a draft only: [*] -> any other status is refused", async () => {
    for (const status of ENTRY_STATUSES.filter((s) => s !== "draft")) {
      const alertId = randomUUID();
      await insertRawAlert(alertId);
      await expect(
        asApp(authorA.id, (tx) => tx`insert into alert_entry (id, alert_id, kind, status, author_id, editor_ids, original_text, types, audience, phase, valid_until)
              values (${randomUUID()}, ${alertId}, 'ack', ${status}, ${authorA.id}, ${[authorA.id]}, 'text', ${["power"]}, ${tx.json(NB_AUDIENCE)}, 'problem', ${new Date("2026-10-02T15:00:00Z")})`),
        status,
      ).rejects.toThrow(/starts as a draft/);
    }
  });

  it("refuse a transition the app tries on a final status, and on an entry whose thread is closed (except a discard)", async () => {
    const approved = await seedRaw("approved");
    await expect(asApp(authorA.id, (tx) => tx`update alert_entry set status = 'draft' where id = ${approved.entryId}`)).rejects.toThrow(/not an allowed transition/);
    const pending = await newPending();
    await owner`update alert set status = 'closed', closed_reason = 'withdrawn', closed_at = now() where id = ${pending.alertId}`;
    await expect(asApp(adminC.id, (tx) => legalChange(tx, pending.entryId, "pending_approval", "approved"))).rejects.toThrow(/ALERT_CLOSED/);
    await expect(asApp(authorA.id, (tx) => tx`update alert_entry set status = 'draft', returned_for = 'edit', content_hash = null, sms_bodies = null, submitted_at = null where id = ${pending.entryId}`)).rejects.toThrow(/ALERT_CLOSED/);
    // The closing flag allows a discard and nothing else.
    await expect(
      asApp(authorA.id, async (tx) => {
        await tx`select set_config('cvh.closing', 'on', true)`;
        return tx`update alert_entry set status = 'draft', returned_for = 'edit', content_hash = null, sms_bodies = null, submitted_at = null where id = ${pending.entryId}`;
      }),
    ).rejects.toThrow(/ALERT_CLOSED/);
    // A discard is allowed in a closed thread only while it is closing (cvh.closing), the domain's `closing` flag.
    await expect(asApp(authorA.id, (tx) => tx`update alert_entry set status = 'discarded' where id = ${pending.entryId}`)).rejects.toThrow(/ALERT_CLOSED/);
    await expect(
      asApp(authorA.id, async (tx) => {
        await tx`select set_config('cvh.closing', 'on', true)`;
        return tx`update alert_entry set status = 'discarded' where id = ${pending.entryId}`;
      }),
    ).resolves.toBeDefined();
    expect((await entryRow(pending.entryId)).status).toBe("discarded");
  });

  it("refuse to return or discard a web-published entry", async () => {
    const pending = await newPending();
    await owner.begin(async (tx) => {
      await tx.unsafe("alter table alert_entry disable trigger alert_entry_guard");
      await tx`update alert_entry set web_published_at = now() where id = ${pending.entryId}`;
      await tx.unsafe("alter table alert_entry enable trigger alert_entry_guard");
    });
    await expect(asApp(authorA.id, (tx) => tx`update alert_entry set status = 'draft', returned_for = 'edit', content_hash = null, sms_bodies = null, submitted_at = null where id = ${pending.entryId}`)).rejects.toThrow(/web-published/);
    await expect(asApp(authorA.id, (tx) => tx`update alert_entry set status = 'discarded' where id = ${pending.entryId}`)).rejects.toThrow(/web-published/);
    const result = await alerting.returnEntry(actorOf(authorA), pending, "edit");
    expect(result).toEqual({ ok: false, error: "WEB_PUBLISHED" });
  });
});

// --- the use cases ------------------------------------------------------------------------------------

describe("create, save, submit and discard", () => {
  it("creates the thread and its first draft, with the author as the only editor, and audits alert.created", async () => {
    const created = await alerting.createAlert(actorOf(authorA), { kind: "ack", isDrill: false, reportedAt: new Date("2026-10-01T14:50:00Z"), content: content() });

    expect(created).toMatchObject({ ok: true, value: { thread: { isDrill: false, status: "open" }, entry: { status: "draft", version: 0, kind: "ack", authorId: authorA.id, editorIds: [authorA.id], contentHash: null } } });
    if (!created.ok) return;
    expect(await auditRows()).toEqual([
      {
        action: "alert.created",
        outcome: "ok",
        actor_staff_id: authorA.id,
        subject_type: "alert",
        subject_id: created.value.thread.id,
        is_drill: false,
        meta: { entry_id: created.value.entry.id, kind: "ack", types: ["power"] },
      },
    ]);
  });

  it("refuses a first report in the future, content that breaks a rule, a valid-until in the past or too far ahead, and a person the policy refuses", async () => {
    const base = { kind: "ack", isDrill: false, reportedAt: new Date("2026-10-01T14:50:00Z") } as const;
    const refuse = async (who: Account, input: Parameters<AlertLifecycle["createAlert"]>[1], aal?: AlertActor["aal"]) => {
      const result = await alerting.createAlert(actorOf(who, aal), input);
      return result.ok ? "ok" : result.error;
    };

    expect(await refuse(authorA, { ...base, reportedAt: new Date("2026-10-01T15:00:01Z"), content: content() })).toBe("REPORTED_AT_INVALID");
    expect(await refuse(authorA, { ...base, content: content({ text: "  " }) })).toBe("TEXT_EMPTY");
    expect(await refuse(authorA, { ...base, content: content({ text: "x".repeat(601) }) })).toBe("TEXT_TOO_LONG");
    expect(await refuse(authorA, { ...base, content: content({ validUntil: NOW }) })).toBe("VALID_UNTIL_PAST");
    expect(await refuse(authorA, { ...base, content: content({ validUntil: new Date("2026-10-08T15:00:01Z") }) })).toBe("VALID_UNTIL_TOO_FAR");
    expect(await refuse(authorA, { ...base, content: content({ types: ["heat"] }) })).toBe("NEIGHBOURHOOD_ONLY_TYPE");
    expect(await refuse(authorA, { ...base, content: content({ types: ["no_such_type"] }) })).toBe("UNKNOWN_TYPE");
    expect(await refuse(director, { ...base, content: content() })).toBe("NOT_ALLOWED");
    // An Ambassador covers nothing until S01.14 gives them assignments.
    expect(await refuse(ambassador, { ...base, content: content() })).toBe("OUT_OF_SCOPE");
    expect(await refuse(ambassador, { ...base, content: content({ audience: NB_AUDIENCE }) })).toBe("NOT_ALLOWED");
    expect(await refuse(authorA, { ...base, content: content({ types: ["heat"], audience: { ...NB_AUDIENCE, types: ["heat"] } }) })).toBe("ok");

    expect((await owner`select count(*)::int as n from alert`)[0].n).toBe(1);
    const refusals = (await auditRows()).filter((row) => row.outcome === "refused");
    expect(refusals.every((row) => row.action === "alert.created" && row.subject_type === "alert")).toBe(true);
    expect(refusals.map((row) => row.meta.reason)).toEqual(["validation", "validation", "validation", "validation", "validation", "validation", "validation", "forbidden", "out_of_scope", "forbidden"]);
  });

  it("adds whoever saves a change to editor_ids, and keeps a no-op save from adding anyone", async () => {
    const ref = await newDraft(authorA);
    const saved = await alerting.saveDraft(actorOf(coordB), ref, content({ text: "Power is out on every floor." }));
    expect(saved).toMatchObject({ ok: true, value: { editorIds: [authorA.id, coordB.id], content: { text: "Power is out on every floor." } } });

    const same = await alerting.saveDraft(actorOf(adminC), ref, content({ text: "Power is out on every floor." }));
    expect(same).toMatchObject({ ok: true, value: { editorIds: [authorA.id, coordB.id] } });
    expect(await alerting.saveDraft(actorOf(director), ref, content())).toEqual({ ok: false, error: "NOT_ALLOWED" });
  });

  it("submits the next version with the frozen hash, bodies and translations, and audits entry.submitted", async () => {
    const ref = await newDraft();
    const submitted = await seams.freeze(actorOf(authorA), ref, frozen("v1"));

    expect(submitted).toMatchObject({ ok: true, value: { status: "pending_approval", version: 1, contentHash: sha("v1") } });
    expect((await owner`select lang from alert_entry_translation where entry_id = ${ref.entryId} order by lang`).map((row) => row.lang)).toEqual(["ur", "zh-Hant"]);
    expect((await auditRows()).at(-1)).toMatchObject({ action: "entry.submitted", outcome: "ok", subject_id: ref.entryId, meta: { entry_id: ref.entryId, version: 1, content_hash: sha("v1") } });
  });

  it("refuses a submit when the draft changed since it was prepared, a valid-until that passed, and someone who is not an editor", async () => {
    const ref = await newDraft();
    expect(await seams.freeze(actorOf(authorA), ref, frozen("v1"), content({ text: "An older text." }))).toEqual({ ok: false, error: "DRAFT_CHANGED" });
    expect(await seams.freeze(actorOf(coordB), ref, frozen("v1"))).toEqual({ ok: false, error: "OUT_OF_SCOPE" });
    clock = new Date("2026-10-02T15:00:00Z");
    expect(await seams.freeze(actorOf(authorA), ref, frozen("v1"))).toEqual({ ok: false, error: "VALID_UNTIL_PAST" });
    expect((await entryRow(ref.entryId)).status).toBe("draft");
    expect((await owner`select count(*)::int as n from alert_entry_translation where entry_id = ${ref.entryId}`)[0].n).toBe(0);
    expect((await auditRows()).filter((row) => row.outcome === "refused").map((row) => [row.action, row.meta.reason])).toEqual([
      ["entry.submitted", "conflict"],
      ["entry.submitted", "out_of_scope"],
      ["entry.submitted", "validation"],
    ]);
  });

  it("discards a draft (by an editor) and a pending entry (by its editor or an approver), and nothing else", async () => {
    const draft = await newDraft();
    expect(await alerting.discardEntry(actorOf(coordB), draft)).toEqual({ ok: false, error: "OUT_OF_SCOPE" });
    expect(await alerting.discardEntry(actorOf(authorA), draft)).toMatchObject({ ok: true, value: { status: "discarded" } });
    expect(await alerting.discardEntry(actorOf(authorA), draft)).toEqual({ ok: false, error: "ILLEGAL_TRANSITION" });

    const pending = await newPending();
    expect(await alerting.discardEntry(actorOf(coordB, "aal1"), pending)).toEqual({ ok: false, error: "AAL2_REQUIRED" });
    expect(await alerting.discardEntry(actorOf(coordB), pending)).toMatchObject({ ok: true, value: { status: "discarded", version: 1 } });
    expect((await auditRows()).filter((row) => row.action === "entry.discarded" && row.outcome === "ok").map((row) => row.meta.from)).toEqual(["draft", "pending_approval"]);
    expect(await alerting.discardEntry(actorOf(director), await newPending())).toEqual({ ok: false, error: "NOT_ALLOWED" });
  });
});

describe("return to draft", () => {
  it("clears the approval binding, deletes the translations, keeps the text and the version, and adds an editing person but not an approver who returns it", async () => {
    const ref = await newPending(authorA, "v1");

    const returned = await alerting.returnEntry(actorOf(coordB), ref, "return", { note: "Please add the floors." });
    expect(returned).toMatchObject({ ok: true, value: { status: "draft", version: 1, contentHash: null, returnedFor: "return", returnedNote: "Please add the floors.", editorIds: [authorA.id], content: { text: "Power is out on floors 3 to 5." } } });
    const row = await entryRow(ref.entryId);
    expect([row.content_hash, row.sms_bodies, row.submitted_at]).toEqual([null, null, null]);
    expect((await owner`select count(*)::int as n from alert_entry_translation where entry_id = ${ref.entryId}`)[0].n).toBe(0);

    // The author re-submits as version 2 with a new hash; then the author pulls it back to edit it.
    expect(await seams.freeze(actorOf(authorA), ref, frozen("v2"))).toMatchObject({ ok: true, value: { version: 2, contentHash: sha("v2"), returnedFor: null, returnedNote: null } });
    expect(await alerting.returnEntry(actorOf(adminC), ref, "edit")).toMatchObject({ ok: true, value: { status: "draft", editorIds: [authorA.id, adminC.id], version: 2 } });
    expect((await auditRows()).filter((r) => r.action === "entry.returned").map((r) => r.meta)).toEqual([
      { entry_id: ref.entryId, version: 1, returned_for: "return", with_note: true },
      { entry_id: ref.entryId, version: 2, returned_for: "edit" },
    ]);
  });

  it("lets an approver return it only at aal2, and only if they are not an editor", async () => {
    const ref = await newPending();
    expect(await alerting.returnEntry(actorOf(coordB, "aal1"), ref, "return")).toEqual({ ok: false, error: "AAL2_REQUIRED" });
    expect(await alerting.returnEntry(actorOf(authorA), ref, "return")).toEqual({ ok: false, error: "EDITOR_CANNOT_APPROVE" });
    expect(await alerting.returnEntry(actorOf(director), ref, "return")).toEqual({ ok: false, error: "NOT_ALLOWED" });
    expect((await entryRow(ref.entryId)).status).toBe("pending_approval");
  });
});

// --- approval -------------------------------------------------------------------------------------------

describe("approval", () => {
  it("approves what was shown: approved, web-published, feed_version up by one, audited with the version and hash", async () => {
    const ref = await newPending();
    const before = await feedVersion();

    const approved = await alerting.approveEntry(actorOf(coordB), ref, { version: 1, contentHash: sha("v1") });

    expect(approved).toMatchObject({ ok: true, value: { entry: { status: "approved", approvedBy: coordB.id }, recipients: { total: 0, byLanguage: {} }, feedVersion: before + 1 } });
    // The database's clock times the approval, not the app's (`clock`).
    const view = (approved as unknown as { value: { entry: { approvedAt: Date; webPublishedAt: Date } } }).value.entry;
    expect(view.webPublishedAt).toEqual(view.approvedAt);
    expect(Math.abs(view.approvedAt.getTime() - Date.now())).toBeLessThan(60_000);
    expect(await feedVersion()).toBe(before + 1);
    const row = await entryRow(ref.entryId);
    expect([row.approved_version, row.approved_hash]).toEqual([1, sha("v1")]);
    expect((await auditRows()).at(-1)).toEqual({
      action: "entry.approved",
      outcome: "ok",
      actor_staff_id: coordB.id,
      subject_type: "alert_entry",
      subject_id: ref.entryId,
      is_drill: false,
      meta: { entry_id: ref.entryId, version: 1, content_hash: sha("v1"), recipient_count: 0 },
    });
  });

  it("does not raise feed_version for a drill", async () => {
    const ref = await newPending(authorA, "v1", true);
    const before = await feedVersion();
    expect(await alerting.approveEntry(actorOf(coordB), ref, { version: 1, contentHash: sha("v1") })).toMatchObject({ ok: true });
    expect(await feedVersion()).toBe(before);
    expect((await auditRows()).at(-1)).toMatchObject({ action: "entry.approved", is_drill: true });
  });

  it("refuses an editor, by the use case and by the trigger, and records the use case's refusal", async () => {
    const ref = await newPending(authorA);
    const edited = await alerting.returnEntry(actorOf(coordB), ref, "edit");
    expect(edited).toMatchObject({ ok: true });
    await seams.freeze(actorOf(coordB), ref, frozen("v2"));

    // Use case: the author and the editor are both refused with their own record.
    expect(await alerting.approveEntry(actorOf(authorA), ref, { version: 2, contentHash: sha("v2") })).toEqual({ ok: false, error: "EDITOR_CANNOT_APPROVE" });
    expect(await alerting.approveEntry(actorOf(coordB), ref, { version: 2, contentHash: sha("v2") })).toEqual({ ok: false, error: "EDITOR_CANNOT_APPROVE" });
    const refusals = (await auditRows()).filter((row) => row.action === "entry.approved");
    expect(refusals).toEqual([
      { action: "entry.approved", outcome: "refused", actor_staff_id: authorA.id, subject_type: "alert_entry", subject_id: ref.entryId, is_drill: false, meta: { reason: "self_action", refusal: "EDITOR_CANNOT_APPROVE" } },
      { action: "entry.approved", outcome: "refused", actor_staff_id: coordB.id, subject_type: "alert_entry", subject_id: ref.entryId, is_drill: false, meta: { reason: "self_action", refusal: "EDITOR_CANNOT_APPROVE" } },
    ]);

    // Trigger: the same, by direct SQL with the app's credentials, for each editor, and for naming someone else.
    for (const editor of [authorA, coordB]) {
      await expect(
        asApp(editor.id, (tx) => tx`update alert_entry set status = 'approved', approved_by = ${editor.id}, approved_at = now(), approved_version = 2, approved_hash = ${sha("v2")}, web_published_at = now() where id = ${ref.entryId}`),
      ).rejects.toThrow(/an editor of the entry cannot approve it/);
    }
    await expect(
      asApp(adminC.id, (tx) => tx`update alert_entry set status = 'approved', approved_by = ${coordB.id}, approved_at = now(), approved_version = 2, approved_hash = ${sha("v2")}, web_published_at = now() where id = ${ref.entryId}`),
    ).rejects.toThrow(/approver must be the acting account/);
    await expect(asApp(null, (tx) => tx`update alert_entry set status = 'approved', approved_by = ${adminC.id}, approved_at = now(), approved_version = 2, approved_hash = ${sha("v2")}, web_published_at = now() where id = ${ref.entryId}`)).rejects.toThrow(/acting account/);
    expect((await entryRow(ref.entryId)).status).toBe("pending_approval");

    // A person who never edited can approve it.
    expect(await alerting.approveEntry(actorOf(adminC), ref, { version: 2, contentHash: sha("v2") })).toMatchObject({ ok: true });
  });

  it("refuses the wrong role, a session below aal2, a dead account and a valid-until that passed", async () => {
    const ref = await newPending();
    const shown = { version: 1, contentHash: sha("v1") };
    expect(await alerting.approveEntry(actorOf(director), ref, shown)).toEqual({ ok: false, error: "NOT_ALLOWED" });
    expect(await alerting.approveEntry(actorOf(ambassador), ref, shown)).toEqual({ ok: false, error: "NOT_ALLOWED" });
    expect(await alerting.approveEntry(actorOf(coordB, "aal1"), ref, shown)).toEqual({ ok: false, error: "AAL2_REQUIRED" });
    await owner`update staff_account set status = 'suspended' where id = ${coordB.id}`;
    expect(await alerting.approveEntry(actorOf(coordB), ref, shown)).toEqual({ ok: false, error: "NOT_ALLOWED" });
    await owner`update staff_account set status = 'active' where id = ${coordB.id}`;
    clock = new Date("2026-10-02T15:00:00Z");
    expect(await alerting.approveEntry(actorOf(coordB), ref, shown)).toEqual({ ok: false, error: "VALID_UNTIL_PAST" });
    expect((await entryRow(ref.entryId)).status).toBe("pending_approval");
    expect((await auditRows()).filter((row) => row.outcome === "refused").map((row) => row.meta.reason)).toEqual(["forbidden", "forbidden", "aal_required", "forbidden", "validation"]);
  });

  it("re-checks the author at approval: refused when the author is no longer allowed to author it", async () => {
    const ref = await newPending(authorA);
    const shown = { version: 1, contentHash: sha("v1") };
    await owner`update staff_account set role = 'director' where id = ${authorA.id}`;
    expect(await alerting.approveEntry(actorOf(coordB), ref, shown)).toEqual({ ok: false, error: "AUTHOR_NOT_ALLOWED" });
    await owner`update staff_account set role = 'coordinator', status = 'suspended' where id = ${authorA.id}`;
    expect(await alerting.approveEntry(actorOf(coordB), ref, shown)).toEqual({ ok: false, error: "AUTHOR_NOT_ALLOWED" });
    await owner`update staff_account set status = 'active' where id = ${authorA.id}`;
    expect(await alerting.approveEntry(actorOf(coordB), ref, shown)).toMatchObject({ ok: true });
  });

  it("refuses an approval of a version or hash other than the pending one (an edit while the approver was looking), and a trigger refuses a mismatched binding", async () => {
    const ref = await newPending(authorA, "v1");
    // The approver opened v1. Meanwhile the author pulls it back, edits and re-submits.
    await alerting.returnEntry(actorOf(authorA), ref, "edit");
    await alerting.saveDraft(actorOf(authorA), ref, content({ text: "Power is out on floors 3 to 6." }));
    await seams.freeze(actorOf(authorA), ref, frozen("v2"));

    expect(await alerting.approveEntry(actorOf(coordB), ref, { version: 1, contentHash: sha("v1") })).toEqual({ ok: false, error: "ENTRY_CHANGED" });
    expect(await alerting.approveEntry(actorOf(coordB), ref, { version: 2, contentHash: sha("v1") })).toEqual({ ok: false, error: "ENTRY_CHANGED" });
    await expect(
      asApp(coordB.id, (tx) => tx`update alert_entry set status = 'approved', approved_by = ${coordB.id}, approved_at = now(), approved_version = 1, approved_hash = ${sha("v1")}, web_published_at = now() where id = ${ref.entryId}`),
    ).rejects.toThrow(/must name the version and hash that are pending/);
    expect(await alerting.approveEntry(actorOf(coordB), ref, { version: 2, contentHash: sha("v2") })).toMatchObject({ ok: true, value: { entry: { version: 2 } } });
  });
});

// --- a pending entry is frozen ------------------------------------------------------------------------

describe("an Ambassador author and their assignments (S01.14)", () => {

  /** Runs the test, then forgets the Ambassador's assignments (the buildings are the file's fixture). */
  async function withBuildings<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } finally {
      await owner`delete from ambassador_assignment where staff_id = ${ambassador.id}`;
    }
  }

  it("creates an alert for an assigned building, and approval refuses once an Admin removes the assignment (AUTHOR_NOT_ALLOWED)", async () => {
    await withBuildings(async () => {
      const assignments = createAssignments({ db: app, floors: { floorsOf: floorsOfBuilding } });
      expect(await assignments.assign(adminC.id, { staffId: ambassador.id, rsn: RSN, floorIds: null })).toMatchObject({ ok: true });

      const ref = await newDraft(ambassador);
      const submitted = await seams.freeze(actorOf(ambassador), ref, frozen("v1"));
      expect(submitted).toMatchObject({ ok: true });

      expect(await assignments.remove(adminC.id, { staffId: ambassador.id, rsn: RSN })).toMatchObject({ ok: true });
      expect(await alerting.approveEntry(actorOf(coordB), ref, { version: 1, contentHash: sha("v1") })).toEqual({ ok: false, error: "AUTHOR_NOT_ALLOWED" });
      expect((await entryRow(ref.entryId)).status).toBe("pending_approval");
    });
  });

  it("approves while the assignment stands", async () => {
    await withBuildings(async () => {
      const assignments = createAssignments({ db: app, floors: { floorsOf: floorsOfBuilding } });
      expect(await assignments.assign(adminC.id, { staffId: ambassador.id, rsn: RSN, floorIds: null })).toMatchObject({ ok: true });
      const ref = await newDraft(ambassador);
      expect(await seams.freeze(actorOf(ambassador), ref, frozen("v1"))).toMatchObject({ ok: true });
      expect(await alerting.approveEntry(actorOf(coordB), ref, { version: 1, contentHash: sha("v1") })).toMatchObject({ ok: true });
    });
  });

  it("refuses an Ambassador's createAlert for a building they are not assigned to", async () => {
    await withBuildings(async () => {
      const assignments = createAssignments({ db: app, floors: { floorsOf: floorsOfBuilding } });
      expect(await assignments.assign(adminC.id, { staffId: ambassador.id, rsn: OTHER_RSN, floorIds: null })).toMatchObject({ ok: true });
      const created = await alerting.createAlert(actorOf(ambassador), { kind: "ack", isDrill: false, reportedAt: new Date("2026-10-01T14:50:00Z"), content: content() });
      expect(created).toEqual({ ok: false, error: "OUT_OF_SCOPE" });
    });
  });
});

describe("a pending_approval entry", () => {
  it("cannot have its text, audience, types, valid-until, translations, SMS bodies, hash or version changed by direct SQL, by anyone", async () => {
    const ref = await newPending();
    const changes: [string, (tx: postgres.TransactionSql) => PromiseLike<unknown>][] = [
      ["text", (tx) => tx`update alert_entry set original_text = 'changed' where id = ${ref.entryId}`],
      ["audience", (tx) => tx`update alert_entry set audience = ${tx.json({ ...NB_AUDIENCE, neighbourhood_ids: ["FP"] })} where id = ${ref.entryId}`],
      ["types", (tx) => tx`update alert_entry set types = ${["water"]} where id = ${ref.entryId}`],
      ["valid_until", (tx) => tx`update alert_entry set valid_until = valid_until + interval '1 hour' where id = ${ref.entryId}`],
      ["phase", (tx) => tx`update alert_entry set phase = 'in_progress' where id = ${ref.entryId}`],
      ["sms_bodies", (tx) => tx`update alert_entry set sms_bodies = ${tx.json({ en: { body: "other" } })} where id = ${ref.entryId}`],
      ["content_hash", (tx) => tx`update alert_entry set content_hash = ${sha("other")} where id = ${ref.entryId}`],
      ["version", (tx) => tx`update alert_entry set version = version + 1 where id = ${ref.entryId}`],
      ["translation added", (tx) => tx`insert into alert_entry_translation (entry_id, lang, body, model, status, source_hash) values (${ref.entryId}, 'fr', 'b', 'm1', 'translated', ${sha("s")})`],
      ["translation removed", (tx) => tx`delete from alert_entry_translation where entry_id = ${ref.entryId} and lang = 'ur'`],
    ];
    for (const actor of [authorA.id, coordB.id]) {
      for (const [name, change] of changes) {
        await expect(asApp(actor, change), `${name} as ${actor === authorA.id ? "author" : "other"}`).rejects.toThrow(/cannot be changed|are frozen/);
      }
    }
    // Not even the table owner's ordinary update gets through the trigger.
    await expect(owner`update alert_entry set original_text = 'changed' where id = ${ref.entryId}`).rejects.toThrow(/cannot be changed/);
    const row = await entryRow(ref.entryId);
    expect([row.original_text, row.version, row.content_hash]).toEqual(["Power is out on floors 3 to 5.", 1, sha("v1")]);
    expect((await owner`select count(*)::int as n from alert_entry_translation where entry_id = ${ref.entryId}`)[0].n).toBe(2);
  });

  it("can change content only after it returns to draft", async () => {
    const ref = await newPending();
    await alerting.returnEntry(actorOf(authorA), ref, "edit");
    await expect(asApp(authorA.id, (tx) => tx`update alert_entry set original_text = 'changed now' where id = ${ref.entryId}`)).resolves.toBeDefined();
    expect((await entryRow(ref.entryId)).original_text).toBe("changed now");
  });
});

// --- a draft needs an actor -----------------------------------------------------------------------------

describe("a draft entry", () => {
  it("requires the acting account for a content change and adds it to editor_ids; an update without one is refused", async () => {
    const ref = await newDraft(authorA);
    const update = (actor: string | null, text: string) => asApp(actor, (tx) => tx`update alert_entry set original_text = ${text} where id = ${ref.entryId}`);

    await expect(update(null, "no actor")).rejects.toThrow(/acting account/);
    await expect(update("", "empty actor")).rejects.toThrow(/acting account/);
    await expect(update("not-a-uuid", "bad actor")).rejects.toThrow(/acting account/);
    expect((await entryRow(ref.entryId)).editor_ids).toEqual([authorA.id]);

    await update(coordB.id, "by B");
    await update(coordB.id, "by B again");
    await update(adminC.id, "by C");
    const row = await entryRow(ref.entryId);
    expect(row.original_text).toBe("by C");
    expect(row.editor_ids).toEqual([authorA.id, coordB.id, adminC.id]);
  });

  it("cannot have the app write editor_ids, the author, the frozen fields or an approval; and cannot be created without or as another actor", async () => {
    const ref = await newDraft(authorA);
    await expect(asApp(coordB.id, (tx) => tx`update alert_entry set editor_ids = ${[authorA.id, coordB.id]} where id = ${ref.entryId}`)).rejects.toThrow(/permission denied/);
    await expect(asApp(coordB.id, (tx) => tx`update alert_entry set author_id = ${coordB.id} where id = ${ref.entryId}`)).rejects.toThrow(/permission denied/);
    await expect(asApp(coordB.id, (tx) => tx`update alert_entry set content_hash = ${sha("x")} where id = ${ref.entryId}`)).rejects.toThrow();
    await expect(asApp(coordB.id, (tx) => tx`update alert_entry set approved_by = ${coordB.id}, approved_at = now(), approved_version = 1, approved_hash = ${sha("x")} where id = ${ref.entryId}`)).rejects.toThrow();
    const insert = (actor: string | null, author: string) =>
      asApp(actor, (tx) => tx`insert into alert_entry (id, alert_id, kind, author_id, editor_ids, original_text, types, audience, phase, valid_until)
              values (${randomUUID()}, ${ref.alertId}, 'update', ${author}, ${[author]}, 't', ${["power"]}, ${tx.json(NB_AUDIENCE)}, 'problem', ${new Date("2026-10-02T15:00:00Z")})`);
    await expect(insert(null, authorA.id)).rejects.toThrow(/acting account/);
    await expect(insert(coordB.id, authorA.id)).rejects.toThrow(/author must be the acting account/);
    await expect(insert(authorA.id, authorA.id)).resolves.toBeDefined();
  });

  it("cannot be created in, or changed in, a closed thread", async () => {
    const ref = await newDraft(authorA);
    await asApp(null, (tx) => tx`update alert set status = 'closed', closed_reason = 'expired', closed_at = now() where id = ${ref.alertId}`);
    await expect(asApp(authorA.id, (tx) => tx`update alert_entry set original_text = 'late' where id = ${ref.entryId}`)).rejects.toThrow(/ALERT_CLOSED/);
    await expect(
      asApp(authorA.id, (tx) => tx`insert into alert_entry (id, alert_id, kind, author_id, editor_ids, original_text, types, audience, phase, valid_until)
              values (${randomUUID()}, ${ref.alertId}, 'update', ${authorA.id}, ${[authorA.id]}, 't', ${["power"]}, ${tx.json(NB_AUDIENCE)}, 'problem', ${new Date("2026-10-02T15:00:00Z")})`),
    ).rejects.toThrow(/ALERT_CLOSED/);
    expect(await alerting.saveDraft(actorOf(authorA), ref, content())).toEqual({ ok: false, error: "ALERT_CLOSED" });
    expect(await seams.freeze(actorOf(authorA), ref, frozen("v1"))).toEqual({ ok: false, error: "ALERT_CLOSED" });
    expect((await auditRows()).at(-1)).toMatchObject({ action: "entry.submitted", outcome: "refused", meta: { reason: "alert_closed", refusal: "ALERT_CLOSED" } });
  });
});

// --- "Try translation again" ------------------------------------------------------------------------------

describe("Try translation again", () => {
  it("returns the entry to draft, adds the person as an editor, re-translates and re-submits as a new version with a new hash; the person can no longer approve it", async () => {
    const ref = await newPending(authorA, "v1");

    const retried = await seams.retranslate(actorOf(coordB), ref, { version: 1, contentHash: sha("v1") }, preparerOf("v2"));

    expect(retried).toMatchObject({ ok: true, value: { status: "pending_approval", version: 2, contentHash: sha("v2"), editorIds: [authorA.id, coordB.id] } });
    expect((await owner`select body from alert_entry_translation where entry_id = ${ref.entryId} and lang = 'ur'`)[0].body).toBe("ur v2");
    expect(await alerting.approveEntry(actorOf(coordB), ref, { version: 2, contentHash: sha("v2") })).toEqual({ ok: false, error: "EDITOR_CANNOT_APPROVE" });
    expect(await alerting.approveEntry(actorOf(adminC), ref, { version: 1, contentHash: sha("v1") })).toEqual({ ok: false, error: "ENTRY_CHANGED" });
    expect(await alerting.approveEntry(actorOf(adminC), ref, { version: 2, contentHash: sha("v2") })).toMatchObject({ ok: true });
    expect((await auditRows()).filter((row) => row.outcome === "ok").map((row) => row.action)).toEqual(["alert.created", "entry.submitted", "entry.returned", "entry.submitted", "entry.approved"]);
  });

  it("refuses what was not the pending version, and leaves a draft the person edited when preparing fails", async () => {
    const ref = await newPending(authorA, "v1");
    expect(await seams.retranslate(actorOf(coordB), ref, { version: 1, contentHash: sha("old") }, preparerOf("v2"))).toEqual({ ok: false, error: "ENTRY_CHANGED" });
    expect((await entryRow(ref.entryId)).status).toBe("pending_approval");

    expect(await seams.retranslate(actorOf(coordB), ref, { version: 1, contentHash: sha("v1") }, failingPreparer)).toEqual({ ok: false, error: "PREPARATION_FAILED" });
    const row = await entryRow(ref.entryId);
    expect(row.status).toBe("draft");
    expect(row.editor_ids).toEqual([authorA.id, coordB.id]);
    expect(row.content_hash).toBeNull();
    // Submit is still there.
    expect(await seams.freeze(actorOf(coordB), ref, frozen("v2"))).toMatchObject({ ok: true, value: { version: 2 } });
  });

  it("refuses the re-submit when the draft was edited while it was being prepared", async () => {
    const ref = await newPending(authorA, "v1");
    const slow: EntryPreparer = {
      prepare: async () => {
        await alerting.saveDraft(actorOf(adminC), ref, content({ text: "Edited while preparing." }));
        return { ok: true, value: frozen("v2") };
      },
    };
    expect(await seams.retranslate(actorOf(coordB), ref, { version: 1, contentHash: sha("v1") }, slow)).toEqual({ ok: false, error: "DRAFT_CHANGED" });
    expect((await entryRow(ref.entryId)).status).toBe("draft");
  });
});

// --- concurrency -----------------------------------------------------------------------------------------------

describe("the thread lock", () => {
  it("lets exactly one of two simultaneous approvals of the same entry succeed", async () => {
    const ref = await newPending();
    const before = await feedVersion();
    const shown = { version: 1, contentHash: sha("v1") };

    const results = await Promise.all([alerting.approveEntry(actorOf(coordB), ref, shown), alerting.approveEntry(actorOf(adminC), ref, shown)]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: "ENTRY_NOT_PENDING" }]);
    expect(await feedVersion()).toBe(before + 1);
    const rows = (await auditRows()).filter((row) => row.action === "entry.approved");
    expect(rows.map((row) => row.outcome).sort()).toEqual(["ok", "refused"]);
  });

  it("starts every use case on the thread with SELECT ... FROM alert ... FOR UPDATE: an approval waits behind a held thread lock", async () => {
    const ref = await newPending();
    let settled = false;
    let approval!: Promise<unknown>;
    await appSql.begin(async (tx) => {
      await tx`select id from alert where id = ${ref.alertId} for update`;
      approval = alerting.approveEntry(actorOf(coordB), ref, { version: 1, contentHash: sha("v1") }).finally(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(settled).toBe(false);
    });
    expect(await approval).toMatchObject({ ok: true });
  });

  it("re-reads the thread after the lock and refuses with ALERT_CLOSED when it was closed while the use case waited", async () => {
    const ref = await newPending();
    let approval!: Promise<unknown>;
    await appSql.begin(async (tx) => {
      await tx`select id from alert where id = ${ref.alertId} for update`;
      approval = alerting.approveEntry(actorOf(coordB), ref, { version: 1, contentHash: sha("v1") });
      await new Promise((resolve) => setTimeout(resolve, 300));
      await tx`update alert set status = 'closed', closed_reason = 'resolved', closed_at = now() where id = ${ref.alertId}`;
    });
    expect(await approval).toEqual({ ok: false, error: "ALERT_CLOSED" });
    expect((await entryRow(ref.entryId)).status).toBe("pending_approval");
    expect((await auditRows()).at(-1)).toMatchObject({ action: "entry.approved", outcome: "refused", meta: { reason: "alert_closed", refusal: "ALERT_CLOSED" } });
  });

  it("serializes two simultaneous direct approvals without the thread lock: the entry row lock and the trigger leave one winner", async () => {
    const ref = await newPending();
    const approveAs = (who: Account) =>
      asApp(who.id, (tx) => tx`update alert_entry set status = 'approved', approved_by = ${who.id}, approved_at = now(), approved_version = 1, approved_hash = ${sha("v1")}, web_published_at = now() where id = ${ref.entryId}`);

    const settled = await Promise.allSettled([approveAs(coordB), approveAs(adminC)]);

    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failed = settled.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(String(failed.reason)).toMatch(/cannot be changed/);
  });

  it("moves two different entries of different threads at the same time", async () => {
    const [one, two] = [await newPending(authorA, "a1"), await newPending(authorA, "b1")];
    const results = await Promise.all([
      alerting.approveEntry(actorOf(coordB), one, { version: 1, contentHash: sha("a1") }),
      alerting.approveEntry(actorOf(adminC), two, { version: 1, contentHash: sha("b1") }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
  });
});

describe("feed_version", () => {
  it("only goes up by one, and the app cannot reset or skip it", async () => {
    const now = await feedVersion();
    await expect(asApp(null, (tx) => tx`update feed_version set version = ${now + 2}`)).rejects.toThrow(/only goes up, by one/);
    await expect(asApp(null, (tx) => tx`update feed_version set version = ${Math.max(0, now - 1)}`)).rejects.toThrow(/only goes up, by one|check/);
    await expect(asApp(null, (tx) => tx`insert into feed_version (id, version) values (2, 0)`)).rejects.toThrow();
    await expect(asApp(null, (tx) => tx`delete from feed_version`)).rejects.toThrow(/permission denied/);
    await expect(asApp(null, (tx) => tx`update feed_version set version = version + 1`)).resolves.toBeDefined();
  });
});

// --- review fixes (S04.03) ------------------------------------------------------------------------------

const insertTranslation = (tx: postgres.TransactionSql, entryId: string) =>
  tx`insert into alert_entry_translation (entry_id, lang, body, model, status, source_hash) values (${entryId}, 'ur', 'body', 'm1', 'translated', ${sha("source")})`;
const submitSql = (tx: postgres.TransactionSql, entryId: string, tag = "x") =>
  tx`update alert_entry set status = 'pending_approval', version = version + 1, content_hash = ${sha(tag)}, sms_bodies = ${tx.json({ en: { body: "x" } })}, submitted_at = now() where id = ${entryId}`;

describe("the two-person rule in the trigger, against direct SQL", () => {
  it("refuses a submit by an account that is not an editor of the entry", async () => {
    const ref = await newDraft(authorA);
    // The editor supplies the translation a submit needs; the outsider only tries to submit.
    await asApp(authorA.id, (tx) => insertTranslation(tx, ref.entryId));
    await expect(asApp(coordB.id, (tx) => submitSql(tx, ref.entryId))).rejects.toThrow(/only an editor submits/);
    await expect(asApp(null, (tx) => submitSql(tx, ref.entryId))).rejects.toThrow(/acting account/);
    expect((await entryRow(ref.entryId)).status).toBe("draft");
    await expect(asApp(authorA.id, (tx) => submitSql(tx, ref.entryId))).resolves.toBeDefined();
  });

  it("refuses a translation added by an account that is not an editor of the entry, and keeps the cascade delete of a return working", async () => {
    const ref = await newDraft(authorA);
    await expect(asApp(coordB.id, (tx) => insertTranslation(tx, ref.entryId))).rejects.toThrow(/only an editor of the entry adds a translation/);
    await expect(asApp(null, (tx) => insertTranslation(tx, ref.entryId))).rejects.toThrow(/only an editor of the entry adds a translation/);
    expect((await owner`select count(*)::int as n from alert_entry_translation where entry_id = ${ref.entryId}`)[0].n).toBe(0);
    await expect(asApp(authorA.id, (tx) => insertTranslation(tx, ref.entryId))).resolves.toBeDefined();

    // A return by an approver who is not an editor still deletes the translations.
    const pending = await newPending(authorA, "v1");
    expect(await alerting.returnEntry(actorOf(coordB), pending, "return", { note: "Say when." })).toMatchObject({ ok: true });
    expect((await owner`select count(*)::int as n from alert_entry_translation where entry_id = ${pending.entryId}`)[0].n).toBe(0);
  });

  it("refuses the whole reproduction: A submits, B returns, B adds a translation, B submits, B approves", async () => {
    const ref = await newPending(authorA, "v1");
    expect(await alerting.returnEntry(actorOf(coordB), ref, "return", { note: "Say when." })).toMatchObject({ ok: true });
    expect((await entryRow(ref.entryId)).editor_ids).toEqual([authorA.id]);

    // B re-freezes the content in one go: the translation, the submit and the approval, each as B.
    await expect(
      asApp(coordB.id, async (tx) => {
        await insertTranslation(tx, ref.entryId);
        await submitSql(tx, ref.entryId, "b");
        await tx`update alert_entry set status = 'approved', approved_by = ${coordB.id}, approved_at = now(), approved_version = 2, approved_hash = ${sha("b")}, web_published_at = now() where id = ${ref.entryId}`;
      }),
    ).rejects.toThrow(/only an editor/);
    // Even with a translation in place, B's submit is the step that is refused.
    await asApp(authorA.id, (tx) => insertTranslation(tx, ref.entryId));
    await expect(asApp(coordB.id, (tx) => submitSql(tx, ref.entryId, "b"))).rejects.toThrow(/only an editor submits/);
    const row = await entryRow(ref.entryId);
    expect([row.status, row.version, row.approved_by]).toEqual(["draft", 1, null]);
  });
});

describe("what the trigger allows, against direct SQL", () => {
  it("creates only an ack, an update, a correction or a withdrawal (a final is S05.03's), and a correction or a withdrawal only beside the entry it replaces", async () => {
    const ref = await newDraft(authorA);
    const insert = (kind: string) =>
      asApp(authorA.id, (tx) => tx`insert into alert_entry (id, alert_id, kind, author_id, editor_ids, original_text, types, audience, phase, valid_until)
              values (${randomUUID()}, ${ref.alertId}, ${kind}, ${authorA.id}, ${[authorA.id]}, 't', ${["power"]}, ${tx.json(NB_AUDIENCE)}, 'problem', ${new Date("2026-10-02T15:00:00Z")})`);
    await expect(insert("final")).rejects.toThrow(/only an ack, an update, a correction or a withdrawal/);
    // A correction or a withdrawal that names nothing is refused by the table's check as well as by the trigger.
    for (const kind of ["correction", "withdrawal"]) await expect(insert(kind), kind).rejects.toThrow(/names the entry it replaces/);
    await expect(insert("update")).resolves.toBeDefined();
  });

  it("times an approval by the database clock: approved_at and web_published_at are now(), whatever the app sends", async () => {
    const ref = await newPending(authorA, "v1");
    const [row] = await asApp(coordB.id, (tx) =>
      tx`update alert_entry set status = 'approved', approved_by = ${coordB.id}, approved_at = '2000-01-01T00:00:00Z', approved_version = 1, approved_hash = ${sha("v1")}, web_published_at = '2099-01-01T00:00:00Z'
         where id = ${ref.entryId} returning approved_at, web_published_at, now() as db_now`,
    );
    expect(row.approved_at.getTime()).toBe(row.db_now.getTime());
    expect(row.web_published_at.getTime()).toBe(row.db_now.getTime());
    const stored = await entryRow(ref.entryId);
    expect(stored.approved_at.getTime()).toBe(row.db_now.getTime());
    expect(stored.web_published_at.getTime()).toBe(row.db_now.getTime());
  });

  it("times a use-case approval by the database clock too, not by the app's clock", async () => {
    const ref = await newPending(authorA, "v1");
    const before = Date.now();
    expect(await alerting.approveEntry(actorOf(coordB), ref, { version: 1, contentHash: sha("v1") })).toMatchObject({ ok: true });
    const stored = await entryRow(ref.entryId);
    expect(Math.abs(stored.approved_at.getTime() - before)).toBeLessThan(60_000);
    expect(stored.web_published_at.getTime()).toBe(stored.approved_at.getTime());
  });
});

describe("the thread insert trigger", () => {
  const insertAlert = (actor: string | null, createdBy: string, createdAt?: string) =>
    asApp(actor, (tx) =>
      tx.unsafe(
        `insert into alert (id, is_drill, reported_at, created_by, slug${createdAt ? ", created_at" : ""}) values ('${randomUUID()}', false, now() - interval '1 minute', '${createdBy}', '${randomBytes(4).toString("hex")}x2'${createdAt ? `, '${createdAt}'` : ""}) returning created_at`,
      ),
    );

  it("requires the acting account and that it is the creator", async () => {
    await expect(insertAlert(null, authorA.id)).rejects.toThrow(/acting account/);
    await expect(insertAlert("not-a-uuid", authorA.id)).rejects.toThrow(/acting account/);
    await expect(insertAlert(coordB.id, authorA.id)).rejects.toThrow(/creator must be the acting account/);
    await expect(insertAlert(authorA.id, authorA.id)).resolves.toBeDefined();
  });

  it("takes created_at from the database clock, whatever the caller writes", async () => {
    const before = Date.now();
    const [row] = await insertAlert(authorA.id, authorA.id, "2020-01-01T00:00:00Z");
    expect(Math.abs(new Date(row.created_at).getTime() - before)).toBeLessThan(60_000);
  });
});

describe("the nondrill_alert view", () => {
  it("runs with the caller's rights (security_invoker)", async () => {
    const [view] = await owner`select reloptions from pg_class where oid = 'public.nondrill_alert'::regclass`;
    expect(view.reloptions).toContain("security_invoker=true");
  });
});

describe("a refused change on a drill", () => {
  it("is audited as a drill, once the thread has been read", async () => {
    const ref = await newPending(authorA, "v1", true);
    expect(await alerting.approveEntry(actorOf(authorA), ref, { version: 1, contentHash: sha("v1") })).toEqual({ ok: false, error: "EDITOR_CANNOT_APPROVE" });
    const real = await newPending(authorA, "v1", false);
    expect(await alerting.approveEntry(actorOf(authorA), real, { version: 1, contentHash: sha("v1") })).toEqual({ ok: false, error: "EDITOR_CANNOT_APPROVE" });
    const refusals = (await auditRows()).filter((row) => row.outcome === "refused");
    expect(refusals.map((row) => [row.subject_id, row.is_drill])).toEqual([
      [ref.entryId, true],
      [real.entryId, false],
    ]);
  });

  it("is audited as a drill when the preparation of a retry fails", async () => {
    const ref = await newPending(authorA, "v1", true);
    expect(await seams.retranslate(actorOf(coordB), ref, { version: 1, contentHash: sha("v1") }, failingPreparer)).toEqual({ ok: false, error: "PREPARATION_FAILED" });
    expect((await auditRows()).filter((row) => row.outcome === "refused")).toMatchObject([{ subject_id: ref.entryId, is_drill: true }]);
  });
});
