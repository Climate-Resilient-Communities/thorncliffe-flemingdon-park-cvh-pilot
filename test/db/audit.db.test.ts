// The audit trail against a real database (S01.04, AD-14): ok records commit
// and roll back with their change, refused records survive the rollback, a
// failed ok record fails the change, a failed refused record is only logged,
// and the app's own role (cvh_app_login, not the owner) cannot change or
// remove a record. The app side runs with the app's credentials.
import { randomBytes, randomUUID } from "node:crypto";
import { sql as drizzleSql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import * as audit from "../../src/modules/audit";
import { createDb, type Db } from "../../src/platform/db";
import { connect, serverUrl } from "./helpers";

const SCHEMA = "cvh_test_audit";
const ACTOR = randomUUID();

let owner: ReturnType<typeof connect>;
let app: Db;

class Refused extends Error {}

beforeAll(async () => {
  owner = connect(serverUrl());
  await migrate({ sql: owner, log: () => {} });
  // A stand-in for a business table, which the app may change.
  await owner.unsafe(`
    drop schema if exists ${SCHEMA} cascade;
    create schema ${SCHEMA};
    create table ${SCHEMA}.widget (id uuid primary key, label text not null);
    grant usage on schema ${SCHEMA} to cvh_app;
    grant select, insert, update, delete on ${SCHEMA}.widget to cvh_app;`);
  // The migration creates the login role without a password; the owner sets
  // one in production. Here a throwaway one, on a disposable server.
  const password = randomBytes(18).toString("hex");
  await owner.unsafe(`alter role cvh_app_login password '${password}'`);
  const url = new URL(serverUrl());
  url.username = "cvh_app_login";
  url.password = password;
  app = createDb(url.href);
});

afterAll(async () => {
  await app?.$client.end({ timeout: 5 });
  await owner.unsafe(`drop schema if exists ${SCHEMA} cascade; alter role cvh_app_login password null`);
  await owner.end({ timeout: 5 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const records = (subjectId: string) =>
  owner`select actor_staff_id, action, subject_type, subject_id, outcome, is_drill, meta
        from audit_event where subject_id = ${subjectId} order by id`;
const widget = async (id: string) => (await owner`select label from ${owner(SCHEMA)}.widget where id = ${id}`)[0]?.label ?? null;

async function insertWidget(db: Db | Parameters<Parameters<Db["transaction"]>[0]>[0], id: string, label: string) {
  await db.execute(drizzleSql`insert into ${drizzleSql.identifier(SCHEMA)}.widget (id, label) values (${id}, ${label})`);
}

async function withoutAuditInsert(fn: () => Promise<void>) {
  await owner`revoke insert on audit_event from cvh_app`;
  try {
    await fn();
  } finally {
    await owner`grant insert on audit_event to cvh_app`;
  }
}

describe("the app's connection", () => {
  it("is the app's own role, not the owner", async () => {
    const [row] = await app.$client`select current_user as role, pg_has_role(current_user, 'cvh_app', 'member') as member,
      (select pg_get_userbyid(relowner) from pg_class where oid = 'public.audit_event'::regclass) as owner`;

    expect(row).toEqual({ role: "cvh_app_login", member: true, owner: "postgres" });
  });
});

describe("audit.record", () => {
  it("commits the ok record with the change", async () => {
    const id = randomUUID();

    await app.transaction(async (tx) => {
      await insertWidget(tx, id, "first");
      await audit.record(tx, {
        action: "building.floor_added",
        actorStaffId: ACTOR,
        subjectType: "building_floor",
        subjectId: id,
        isDrill: true,
        meta: { label: "G" },
      });
    });

    expect(await widget(id)).toBe("first");
    expect(await records(id)).toEqual([
      {
        actor_staff_id: ACTOR,
        action: "building.floor_added",
        subject_type: "building_floor",
        subject_id: id,
        outcome: "ok",
        is_drill: true,
        meta: { label: "G" },
      },
    ]);
  });

  it("rolls the ok record back with the change", async () => {
    const id = randomUUID();

    await expect(
      app.transaction(async (tx) => {
        await insertWidget(tx, id, "first");
        await audit.record(tx, { action: "building.floor_added", actorStaffId: ACTOR, subjectType: "building_floor", subjectId: id });
        throw new Error("a later step failed");
      }),
    ).rejects.toThrow("a later step failed");

    expect(await widget(id)).toBeNull();
    expect(await records(id)).toEqual([]);
  });

  it("fails the whole change when the ok record cannot be written (fail closed)", async () => {
    const id = randomUUID();

    await withoutAuditInsert(async () => {
      await expect(
        app.transaction(async (tx) => {
          await insertWidget(tx, id, "first");
          await audit.record(tx, { action: "building.floor_added", actorStaffId: ACTOR, subjectType: "building_floor", subjectId: id });
        }),
      ).rejects.toMatchObject({ cause: { code: "42501" } });
    });

    expect(await widget(id)).toBeNull();
    expect(await records(id)).toEqual([]);
  });

  it("fails the whole change when the ok record's meta is not allowed", async () => {
    const id = randomUUID();

    await expect(
      app.transaction(async (tx) => {
        await insertWidget(tx, id, "first");
        await audit.record(tx, {
          action: "account.created",
          actorStaffId: null,
          subjectType: "staff_account",
          subjectId: id,
          meta: { role: "admin", email: "jane@example.com" } as never,
        });
      }),
    ).rejects.toThrow(audit.AuditRecordError);

    expect(await widget(id)).toBeNull();
    expect(await records(id)).toEqual([]);
  });
});

describe("audit.recordRefusal", () => {
  async function refusedRename(id: string) {
    try {
      await app.transaction(async (tx) => {
        await tx.execute(drizzleSql`update ${drizzleSql.identifier(SCHEMA)}.widget set label = 'changed' where id = ${id}`);
        throw new Refused("There must always be at least two usable Admins");
      });
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      await audit.recordRefusal(app, {
        action: "account.suspended",
        actorStaffId: ACTOR,
        subjectType: "staff_account",
        subjectId: id,
        meta: { reason: "two_admin_rule", role: "admin" },
      });
      return "refused" as const;
    }
    return "done" as const;
  }

  it("leaves business data unchanged and adds exactly one refused record", async () => {
    const id = randomUUID();
    await insertWidget(app, id, "original");

    expect(await refusedRename(id)).toBe("refused");

    expect(await widget(id)).toBe("original");
    expect(await records(id)).toEqual([
      {
        actor_staff_id: ACTOR,
        action: "account.suspended",
        subject_type: "staff_account",
        subject_id: id,
        outcome: "refused",
        is_drill: false,
        meta: { reason: "two_admin_rule", role: "admin" },
      },
    ]);
  });

  it("keeps the action refused and logs an operational error when the refused record cannot be written", async () => {
    const id = randomUUID();
    await insertWidget(app, id, "original");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    let outcome: string | undefined;
    await withoutAuditInsert(async () => {
      outcome = await refusedRename(id);
    });

    expect(outcome).toBe("refused");
    expect(await widget(id)).toBe("original");
    expect(await records(id)).toEqual([]);
    const lines = log.mock.calls.map(([line]) => JSON.parse(String(line)));
    expect(lines).toEqual([
      { level: "error", evt: "audit.refusal_not_recorded", module: "audit", action: "account.suspended", error: "DrizzleQueryError", error_code: "42501", message: null },
    ]);
  });
});

describe("audit_event is append-only", () => {
  let id: string;

  beforeAll(async () => {
    id = randomUUID();
    await audit.record(app, { action: "password.changed", actorStaffId: ACTOR, subjectType: "staff_account", subjectId: id });
  });

  it.each([
    ["UPDATE", "update audit_event set action = 'password.reset' where subject_id = $1"],
    ["DELETE", "delete from audit_event where subject_id = $1"],
    ["TRUNCATE", "truncate audit_event"],
  ])("refuses %s by the app's own role", async (_, statement) => {
    await expect(app.$client.unsafe(statement, statement.includes("$1") ? [id] : [])).rejects.toMatchObject({
      code: "42501",
      message: "permission denied for table audit_event",
    });
    expect(await records(id)).toHaveLength(1);
  });

  it.each([
    ["UPDATE", "update audit_event set action = 'password.reset' where subject_id = $1"],
    ["DELETE", "delete from audit_event where subject_id = $1"],
    ["TRUNCATE", "truncate audit_event"],
  ])("refuses %s even by the owner", async (op, statement) => {
    await expect(owner.unsafe(statement, statement.includes("$1") ? [id] : [])).rejects.toMatchObject({
      code: "42501",
      message: `audit_event is append-only: ${op} is not allowed`,
    });
    expect(await records(id)).toHaveLength(1);
  });

  it("gives Supabase's client roles no access at all", async () => {
    const [row] = await owner`
      select bool_or(has_table_privilege(r, 'public.audit_event', 'select, insert, update, delete, truncate, references, trigger')) as any_privilege
      from unnest(array['anon', 'authenticated', 'service_role']) as r`;

    expect(row.any_privilege).toBe(false);
  });
});
