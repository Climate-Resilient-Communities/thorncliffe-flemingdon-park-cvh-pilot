// The two-Admin rule against a real database (S01.06): refusals of suspension, removal and
// demotion, the recovery exception, the shortfall that never re-enters bootstrap, concurrent
// demotions, and the database trigger that backs the rule. The app writes with its own
// credentials (cvh_app_login); Supabase Auth is the in-memory fake.
import { randomBytes, randomUUID } from "node:crypto";
import { sql as drizzleSql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import * as audit from "../../src/modules/audit";
import { adminShortfallMeta, createIdentity, type IdentityService } from "../../src/modules/identity";
import { memoryIdentityProvider, type MemoryIdentityProvider } from "../../src/modules/identity/adapters/memoryIdentityProvider";
import { createDb, type Db } from "../../src/platform/db";
import { connect, serverUrl } from "./helpers";

const RULE = "There must always be at least two usable Admins";

let owner: ReturnType<typeof connect>;
let app: Db;
let appUrl: string;
let auditBaseline = 0;

let idp: MemoryIdentityProvider;
let identity: IdentityService;

beforeAll(async () => {
  owner = connect(serverUrl());
  await migrate({ sql: owner, log: () => {} });
  const password = randomBytes(18).toString("hex");
  await owner.unsafe(`alter role cvh_app_login password '${password}'`);
  const url = new URL(serverUrl());
  url.username = "cvh_app_login";
  url.password = password;
  appUrl = url.href;
  app = createDb(appUrl);
  [{ max: auditBaseline }] = await owner`select coalesce(max(id), 0)::int as max from audit_event`;
});

/** As the owner: removes every account, the bootstrap row and this file's audit records. */
async function resetIdentity() {
  await owner.begin(async (tx) => {
    await tx.unsafe(`
      alter table audit_event disable trigger audit_event_no_update_or_delete;
      alter table staff_bootstrap disable trigger staff_bootstrap_forward_only;`);
    await tx`delete from audit_event where id > ${auditBaseline}`;
    await tx`delete from staff_bootstrap`;
    await tx`update staff_account set created_by = null`;
    await tx`delete from staff_account`;
    await tx.unsafe(`
      alter table audit_event enable trigger audit_event_no_update_or_delete;
      alter table staff_bootstrap enable trigger staff_bootstrap_forward_only;`);
  });
}

beforeEach(async () => {
  await resetIdentity();
  idp = memoryIdentityProvider();
  identity = createIdentity({ db: app, idp });
});

afterAll(async () => {
  await resetIdentity();
  await app?.$client.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

let counter = 0;

/**
 * As the owner, an account as it is once set up: by default a usable Admin (own password, an
 * enrolled authenticator in the fake identity provider).
 */
async function account(options: { role?: string; usable?: boolean; enrolled?: boolean } = {}): Promise<string> {
  const { role = "admin", usable = true, enrolled = usable } = options;
  const id = randomUUID();
  const authUserId = randomUUID();
  counter += 1;
  await owner`
    insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password, starting_password_issued_at)
    values (${id}, ${authUserId}, ${`person${counter}`}, 'Pat', 'Lee', 'pat@example.org', ${role}, ${!usable}, ${usable ? null : new Date()})`;
  idp.users.set(authUserId, { login: `person${counter}@staff.cvh.invalid`, password: "x", authenticatorEnrolled: enrolled });
  return id;
}

/** Bootstrap as it is after the first two Admins finished setting up. */
async function bootstrapCompleted(firstAdmin: string, secondAdmin: string) {
  await owner`insert into staff_bootstrap (first_admin_id, second_admin_id, completed_at) values (${firstAdmin}, ${secondAdmin}, now())`;
}

async function admins() {
  const [{ count }] = await owner`select count(*)::int as count from staff_account where role = 'admin' and status = 'active'`;
  return count as number;
}

const auditRecords = () =>
  owner`select actor_staff_id, action, subject_id, outcome, meta from audit_event where id > ${auditBaseline} order by id`;

/** Runs `body` as cvh_app_login in its own transaction on its own connection. */
async function asApp<T>(body: (tx: ReturnType<typeof connect>) => Promise<T>): Promise<T> {
  const sql = connect(appUrl);
  try {
    return (await sql.begin((tx) => body(tx as unknown as ReturnType<typeof connect>))) as T;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Resolves once at least one of the app's connections waits on a lock. */
async function someoneWaitsOnALock() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [{ waiting }] = await owner`
      select count(*)::int as waiting from pg_stat_activity where usename = 'cvh_app_login' and wait_event_type = 'Lock'`;
    if (waiting > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("No transaction ever waited on a lock");
}

describe("exactly two usable Admins", () => {
  it.each([
    ["suspend", (actor: string, target: string) => identity.suspendAccount(actor, target), "account.suspended", { reason: "two_admin_rule", role: "admin" }],
    ["remove", (actor: string, target: string) => identity.removeAccount(actor, target), "account.removed", { reason: "two_admin_rule", role: "admin" }],
    ["demote", (actor: string, target: string) => identity.changeRole(actor, target, "coordinator"), "account.role_changed", { reason: "two_admin_rule", from: "admin", to: "coordinator" }],
  ])("refuses to %s either of them, audited as refused", async (_, run, action, meta) => {
    const first = await account();
    const second = await account();
    await bootstrapCompleted(first, second);

    expect(await run(first, second)).toEqual({ ok: false, error: "two_admin_rule" });
    expect(await run(second, first)).toEqual({ ok: false, error: "two_admin_rule" });

    expect(await admins()).toBe(2);
    expect(await auditRecords()).toEqual([
      { actor_staff_id: first, action, subject_id: second, outcome: "refused", meta },
      { actor_staff_id: second, action, subject_id: first, outcome: "refused", meta },
    ]);
  });

  it("are both still needed when a third Admin has no authenticator yet", async () => {
    const first = await account();
    const second = await account();
    const third = await account({ usable: true, enrolled: false });
    await bootstrapCompleted(first, second);

    expect(await identity.changeRole(third, second, "director")).toEqual({ ok: false, error: "two_admin_rule" });
    expect(await identity.suspendAccount(first, third)).toEqual({ ok: true, value: undefined });
  });
});

describe("three usable Admins", () => {
  it("lets one be suspended, removed or demoted, audited", async () => {
    const [a, b, c] = [await account(), await account(), await account()];
    await bootstrapCompleted(a, b);

    expect(await identity.changeRole(a, c, "coordinator")).toEqual({ ok: true, value: undefined });

    const [row] = await owner`select role, status from staff_account where id = ${c}`;
    expect(row).toEqual({ role: "coordinator", status: "active" });
    expect(await auditRecords()).toEqual([
      { actor_staff_id: a, action: "account.role_changed", subject_id: c, outcome: "ok", meta: { from: "admin", to: "coordinator" } },
    ]);
  });

  it("when two requests demote two different Admins at the same time, exactly one succeeds and the other is refused", async () => {
    const [a, b, c] = [await account(), await account(), await account()];
    await bootstrapCompleted(a, b);
    // The first request to hold the Admin rows answers only once the other waits on them, so the
    // two really overlap in the database.
    let first = true;
    const slow: MemoryIdentityProvider = {
      ...idp,
      async hasVerifiedAuthenticator(authUserId) {
        if (first) {
          first = false;
          await someoneWaitsOnALock();
        }
        return idp.hasVerifiedAuthenticator(authUserId);
      },
    };
    const racing = createIdentity({ db: app, idp: slow });

    const results = await Promise.all([racing.changeRole(a, b, "coordinator"), racing.changeRole(a, c, "coordinator")]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: "two_admin_rule" }]);
    expect(await admins()).toBe(2);
    const records = await auditRecords();
    expect(records.map((record) => record.outcome).sort()).toEqual(["ok", "refused"]);
    expect(records.find((record) => record.outcome === "refused")?.meta).toEqual({ reason: "two_admin_rule", from: "admin", to: "coordinator" });
  });

  it("keeps two usable Admins however many concurrent changes race", async () => {
    const ids = [await account(), await account(), await account(), await account()];
    await bootstrapCompleted(ids[0], ids[1]);

    const results = await Promise.all([
      identity.suspendAccount(ids[0], ids[1]),
      identity.removeAccount(ids[0], ids[2]),
      identity.changeRole(ids[0], ids[3], "director"),
      identity.suspendAccount(ids[1], ids[2]),
      identity.changeRole(ids[1], ids[3], "ambassador"),
    ]);

    expect(await admins()).toBeGreaterThanOrEqual(2);
    expect(results.filter((result) => result.ok).length).toBeGreaterThanOrEqual(1);
  });
});

describe("the recovery exception", () => {
  /** Stands in for S01.08's Admin-issued password reset, in one transaction as the app. */
  async function resetPassword(actor: string, target: string) {
    return app.transaction(async (tx) => {
      const recovery = await identity.beginAdminRecovery(tx, target);
      await tx.execute(drizzleSql`update staff_account set must_change_password = true, starting_password_issued_at = now() where id = ${target}`);
      await audit.record(tx, { action: "password.reset", actorStaffId: actor, subjectType: "staff_account", subjectId: target, meta: adminShortfallMeta(recovery) });
      return recovery;
    });
  }

  it("lets a password reset leave fewer than two usable Admins, audited with admin_shortfall, and shows the banner to every Admin", async () => {
    const first = await account();
    const second = await account();
    await bootstrapCompleted(first, second);
    expect(await identity.adminShortfallBanner(first)).toBe(false);

    expect(await resetPassword(first, second)).toEqual({ adminShortfall: true });

    const [row] = await owner`select must_change_password from staff_account where id = ${second}`;
    expect(row.must_change_password).toBe(true);
    expect(await auditRecords()).toEqual([
      { actor_staff_id: first, action: "password.reset", subject_id: second, outcome: "ok", meta: { admin_shortfall: true } },
    ]);
    expect(await identity.adminShortfallBanner(first)).toBe(true);
    expect(await identity.adminShortfallBanner(second)).toBe(true);
  });

  it("carries no flag when two usable Admins remain", async () => {
    const [a, b, c] = [await account(), await account(), await account()];
    await bootstrapCompleted(a, b);

    expect(await resetPassword(a, c)).toEqual({ adminShortfall: false });
    expect((await auditRecords())[0].meta).toEqual({});
  });

  it("lets an authenticator reset through, which the database cannot see, and flags it", async () => {
    const first = await account();
    const second = await account();
    await bootstrapCompleted(first, second);

    const recovery = await app.transaction((tx) => identity.beginAdminRecovery(tx, second));
    const [{ auth_user_id }] = await owner`select auth_user_id from staff_account where id = ${second}`;
    idp.users.get(auth_user_id)!.authenticatorEnrolled = false;

    expect(recovery).toEqual({ adminShortfall: true });
    expect(await identity.adminShortfallBanner(first)).toBe(true);
  });

  it("never re-enters bootstrap; changes to Admins stay refused, and everything else continues", async () => {
    const first = await account();
    const second = await account();
    const coordinator = await account({ role: "coordinator" });
    await bootstrapCompleted(first, second);
    await resetPassword(first, second);

    const [state] = await owner`select completed_at is not null as completed from staff_bootstrap`;
    expect(state.completed).toBe(true);
    // The Admin waiting for a new password cannot be suspended, removed or demoted meanwhile.
    expect(await identity.suspendAccount(first, second)).toEqual({ ok: false, error: "two_admin_rule" });
    expect(await identity.changeRole(first, second, "ambassador")).toEqual({ ok: false, error: "two_admin_rule" });
    // Everything else continues: no bootstrap gate, other accounts change, people are added.
    expect(await identity.checkBootstrap(first, { kind: "other" }, "alert.approve")).toEqual({ ok: true, value: undefined });
    expect(await identity.suspendAccount(first, coordinator)).toEqual({ ok: true, value: undefined });
    const added = await identity.addPerson(first, { username: "newadmin", firstName: "Nia", lastName: "Long", email: "nia@example.org", role: "admin" });
    expect(added.ok).toBe(true);
    // Restoring a second usable Admin ends the shortfall.
    await owner`update staff_account set must_change_password = false, starting_password_issued_at = null where id = ${second}`;
    expect(await identity.adminShortfallBanner(first)).toBe(false);
  });
});

describe("the database trigger", () => {
  it("refuses an UPDATE that leaves fewer than two usable Admins, whoever runs it", async () => {
    const first = await account();
    const second = await account();

    for (const change of [`role = 'director'`, `status = 'suspended'`, `status = 'removed'`, `must_change_password = true, starting_password_issued_at = now()`]) {
      await expect(asApp((tx) => tx.unsafe(`update staff_account set ${change} where id = '${second}'`)), change).rejects.toMatchObject({
        message: RULE,
        code: "23514",
        constraint_name: "staff_account_two_usable_admins",
      });
    }
    await expect(owner`update staff_account set role = 'director' where id = ${first}`).rejects.toThrow(RULE);
    expect(await admins()).toBe(2);
  });

  it("refuses the second of two concurrent demotions that bypass the app's lock", async () => {
    const [a, b, c] = [await account(), await account(), await account()];
    let release!: () => void;
    const holding = new Promise<void>((resolve) => (release = resolve));

    const one = asApp(async (tx) => {
      await tx`update staff_account set role = 'coordinator' where id = ${a}`;
      await holding;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const two = asApp((tx) => tx`update staff_account set role = 'coordinator' where id = ${b}`);
    await someoneWaitsOnALock();
    release();

    const [first, second] = await Promise.allSettled([one, two]);
    expect(first.status).toBe("fulfilled");
    expect(second).toMatchObject({ status: "rejected", reason: { message: RULE } });
    const remaining = await owner`select id from staff_account where role = 'admin' order by id`;
    expect(remaining.map((row) => row.id).sort()).toEqual([b, c].sort());
  });

  it.each(["repeatable read", "serializable"])(
    "refuses to count in %s, where two transactions could each demote a different Admin on a stale snapshot",
    async (level) => {
      const [a, b] = [await account(), await account(), await account()];
      const one = connect(appUrl);
      const two = connect(appUrl);
      let go!: () => void;
      const release = new Promise<void>((resolve) => (go = resolve));
      try {
        // The reviewer's scenario: both snapshots are taken while three Admins exist, then each demotes another.
        const first = one.begin(`isolation level ${level}`, async (tx) => {
          await tx`select count(*) from staff_account`;
          await release;
          await tx`update staff_account set role = 'coordinator' where id = ${a}`;
        });
        const second = two.begin(`isolation level ${level}`, async (tx) => {
          await tx`select count(*) from staff_account`;
          await release;
          await tx`update staff_account set role = 'coordinator' where id = ${b}`;
        });
        await new Promise((resolve) => setTimeout(resolve, 150));
        go();

        const results = await Promise.allSettled([first, second]);
        expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
        for (const result of results) expect(result).toMatchObject({ reason: { message: "two-Admin guard requires READ COMMITTED", code: "23514" } });
      } finally {
        await one.end({ timeout: 5 });
        await two.end({ timeout: 5 });
      }
      expect(await admins()).toBe(3);
    },
  );

  it("still lets a recovery transaction through in repeatable read, since it counts nothing", async () => {
    await account();
    const second = await account();
    const sql = connect(appUrl);
    try {
      await sql.begin("isolation level repeatable read", async (tx) => {
        await tx`select set_config('cvh.admin_recovery', 'on', true)`;
        await tx`update staff_account set must_change_password = true, starting_password_issued_at = now() where id = ${second}`;
      });
    } finally {
      await sql.end({ timeout: 5 });
    }
    expect(await admins()).toBe(2);
  });

  it("lets a transaction that sets the recovery flag through, and the flag ends with it", async () => {
    await account();
    const second = await account();

    await asApp(async (tx) => {
      await tx`select set_config('cvh.admin_recovery', 'on', true)`;
      await tx`update staff_account set must_change_password = true, starting_password_issued_at = now() where id = ${second}`;
    });

    const sql = connect(appUrl);
    try {
      await sql`select set_config('cvh.admin_recovery', 'on', true)`; // its own transaction, which ends here
      const [{ setting }] = await sql`select coalesce(current_setting('cvh.admin_recovery', true), '') as setting`;
      expect(setting).toBe("");
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("lets every other change through during a shortfall", async () => {
    const only = await account();
    const pending = await account({ usable: false });
    const coordinator = await account({ role: "coordinator" });

    await asApp(async (tx) => {
      await tx`update staff_account set last_name = 'Lopez' where id = ${only}`;
      await tx`update staff_account set status = 'suspended' where id = ${coordinator}`;
      await tx`update staff_account set role = 'admin', status = 'active' where id = ${coordinator}`;
      await tx`update staff_account set must_change_password = false, starting_password_issued_at = null where id = ${pending}`;
    });
    expect(await admins()).toBe(3);
  });

  it("is not callable by anyone, and Supabase's client roles still reach nothing", async () => {
    const rows = await owner`
      select r.rolname, has_function_privilege(r.rolname, 'public.staff_account_keep_two_usable_admins()', 'execute') as can
      from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role')`;
    expect(rows.every((row) => row.can === false)).toBe(true);
  });
});
