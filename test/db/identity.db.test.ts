// Staff accounts and the bootstrap of the first two Admins against a real database (S01.05):
// the first-Admin script, "Add a person", the bootstrap gate and its completion, concurrency, and
// the tables' lockdown. The app side writes with the app's own credentials (cvh_app_login); Supabase
// Auth is the in-memory fake.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runCreateFirstAdmin } from "../../scripts/identity/create-first-admin";
import { migrate } from "../../scripts/db/migrate.mjs";
import { createIdentity, pepperPassword, type AccountService } from "../../src/modules/identity";
import { memoryIdentityProvider, type MemoryIdentityProvider } from "../../src/modules/identity/adapters/memoryIdentityProvider";
import { createDb, type Db } from "../../src/platform/db";
import { connect, serverUrl } from "./helpers";

let owner: ReturnType<typeof connect>;
let app: Db;
let appUrl: string;
/** Audit records with a larger id were written by this file, and are removed again. */
let auditBaseline = 0;

let idp: MemoryIdentityProvider;
let identity: AccountService;

/** STAFF_PASSWORD_PEPPER of these tests: random per run. */
const PEPPER = randomBytes(32).toString("hex");

const jane = { username: "JDoe", firstName: "Jane", lastName: "Doe", email: "jane.doe@example.org" };
const omar = { username: "ofarouk", firstName: "Omar", lastName: "Farouk", email: "omar@example.org", role: "admin" };

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
    await tx`delete from staff_session`;
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
  identity = createIdentity({ db: app, idp, passwordPepper: PEPPER });
});

afterAll(async () => {
  await resetIdentity();
  await app?.$client.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

const accounts = () =>
  owner`select username, first_name, last_name, email, role, status, must_change_password,
               starting_password_issued_at is not null as issued, created_by
        from staff_account order by created_at, id`;
const bootstrap = async () => (await owner`select first_admin_id, second_admin_id, completed_at from staff_bootstrap`)[0] ?? null;
const auditRecords = () =>
  owner`select actor_staff_id, action, subject_type, subject_id, outcome, meta from audit_event where id > ${auditBaseline} order by id`;

async function firstAdmin() {
  const created = await identity.createFirstAdmin(jane);
  if (!created.ok) throw new Error(`first Admin refused: ${created.error}`);
  return created.value.staffId;
}

async function secondAdmin(firstId: string) {
  const created = await identity.addPerson(firstId, omar);
  if (!created.ok) throw new Error(`second Admin refused: ${created.error}`);
  return created.value.staffId;
}

/** As the owner, stands in for S01.07: the person replaced their starting password. */
async function replacePassword(staffId: string) {
  await owner`update staff_account set must_change_password = false, starting_password_issued_at = null where id = ${staffId}`;
}

/** As the owner, stands in for S01.10: the person enrolled an authenticator through the app. */
async function enrol(staffId: string) {
  const [{ auth_user_id }] = await owner`update staff_account set factor_enrolled_at = now() where id = ${staffId} returning auth_user_id`;
  idp.enrol(auth_user_id);
}

/** An identity provider whose createLogin answers only once `count` calls have arrived, so concurrent requests race past the pre-checks. */
function gatedProvider(inner: MemoryIdentityProvider, count: number): MemoryIdentityProvider {
  let arrived = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  return {
    ...inner,
    async createLogin(input) {
      const result = await inner.createLogin(input);
      arrived += 1;
      if (arrived >= count) release();
      await gate;
      return result;
    },
  };
}

describe("the first Admin", () => {
  it("is created with a starting password, audited with the system as actor, and starts bootstrap", async () => {
    const created = await identity.createFirstAdmin(jane);

    expect(created).toEqual({ ok: true, value: { staffId: expect.any(String), username: "jdoe", startingPassword: "cvh-jane-doe", role: "admin" } });
    const staffId = created.ok ? created.value.staffId : "";
    expect(await accounts()).toEqual([
      { username: "jdoe", first_name: "Jane", last_name: "Doe", email: "jane.doe@example.org", role: "admin", status: "active", must_change_password: true, issued: true, created_by: null },
    ]);
    expect(await bootstrap()).toEqual({ first_admin_id: staffId, second_admin_id: null, completed_at: null });
    // Supabase Auth is given the peppered starting password, never the one handed over.
    expect([...idp.users.values()]).toEqual([{ login: "jdoe@staff.cvh.invalid", password: pepperPassword(PEPPER, "cvh-jane-doe"), authenticatorEnrolled: false }]);
    const [{ auth_user_id }] = await owner`select auth_user_id from staff_account where id = ${staffId}`;
    expect(idp.users.has(auth_user_id)).toBe(true);
    expect(await auditRecords()).toEqual([
      { actor_staff_id: null, action: "account.created", subject_type: "staff_account", subject_id: staffId, outcome: "ok", meta: { role: "admin", bootstrap: true } },
    ]);
  });

  it("is refused while any Admin exists, and the refusal is audited", async () => {
    await firstAdmin();

    expect(await identity.createFirstAdmin({ ...jane, username: "another" })).toEqual({ ok: false, error: "admin_exists" });
    expect(await accounts()).toHaveLength(1);
    expect(idp.users.size).toBe(1);
    expect((await auditRecords()).at(-1)).toEqual({
      actor_staff_id: null, action: "account.created", subject_type: "staff_account", subject_id: null, outcome: "refused", meta: { reason: "conflict", role: "admin" },
    });
  });

  it("is created once when two runs race, and the losing run's login is removed", async () => {
    const gated = gatedProvider(idp, 2);
    const racing = createIdentity({ db: app, idp: gated, passwordPepper: PEPPER });

    const results = await Promise.all([racing.createFirstAdmin(jane), racing.createFirstAdmin({ ...jane, username: "jdoe2" })]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "admin_exists" }]);
    expect(await accounts()).toHaveLength(1);
    expect(idp.users.size).toBe(1);
    const winner = results.find((r) => r.ok);
    expect((await bootstrap())?.first_admin_id).toBe(winner?.ok ? winner.value.staffId : "none");
  });

  it("refuses names that make an empty starting password, with a message, and saves nothing", async () => {
    expect(await identity.createFirstAdmin({ ...jane, firstName: "***" })).toEqual({ ok: false, error: "starting_password_empty" });
    expect(await accounts()).toEqual([]);
    expect(idp.users.size).toBe(0);
    expect(await auditRecords()).toEqual([
      expect.objectContaining({ action: "account.created", outcome: "refused", meta: { reason: "validation", role: "admin" } }),
    ]);
  });

  it("removes the login again when the account cannot be saved", async () => {
    const failing = createIdentity({
      db: app,
      idp,
      passwordPepper: PEPPER,
      audit: {
        record: async () => {
          throw new Error("audit store down");
        },
        recordRefusal: async () => {},
      },
    });

    await expect(failing.createFirstAdmin(jane)).rejects.toThrow("audit store down");
    expect(await accounts()).toEqual([]);
    expect(await bootstrap()).toBeNull();
    expect(idp.users.size).toBe(0);
  });

  it("is refused when the identity provider fails, and nothing is saved", async () => {
    idp.failNext("unavailable");

    expect(await identity.createFirstAdmin(jane)).toEqual({ ok: false, error: "provider_error" });
    expect(await accounts()).toEqual([]);
  });
});

describe("a login left behind without an account", () => {
  const login = "jdoe@staff.cvh.invalid";
  const longAgo = new Date(Date.now() - 60 * 60 * 1000);

  it("is removed and the account is created when no account is linked to it and it carries the staff marker", async () => {
    const orphan = idp.plant(login, { createdAt: longAgo });

    const result = await identity.createFirstAdmin(jane);

    expect(result.ok).toBe(true);
    expect(idp.users.has(orphan)).toBe(false);
    const [account] = await owner`select auth_user_id from staff_account`;
    expect(idp.findByLogin(login)?.[0]).toBe(account.auth_user_id);
  });

  it("keeps username_taken when the login has no staff marker", async () => {
    const foreign = idp.plant(login, { createdAt: longAgo, staffMarker: false });

    expect(await identity.createFirstAdmin(jane)).toEqual({ ok: false, error: "username_taken" });
    expect(idp.users.has(foreign)).toBe(true);
    expect(await accounts()).toEqual([]);
  });

  it("keeps username_taken when an account is linked to the login", async () => {
    const linked = idp.plant(login, { createdAt: longAgo });
    await owner`insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password, starting_password_issued_at)
      values (${randomUUID()}, ${linked}, ${"someoneelse"}, 'Some', 'One', 'x@example.org', 'ambassador', true, now())`;

    expect(await identity.createFirstAdmin(jane)).toEqual({ ok: false, error: "username_taken" });
    expect(idp.users.has(linked)).toBe(true);
  });

  it("keeps a very recent login, which may belong to a request still saving its account", async () => {
    const recent = idp.plant(login, { createdAt: new Date() });

    expect(await identity.createFirstAdmin(jane)).toEqual({ ok: false, error: "username_taken" });
    expect(idp.users.has(recent)).toBe(true);
  });

  it("tries only once: a login that cannot be deleted leaves username_taken", async () => {
    idp.plant(login, { createdAt: longAgo });
    idp.failDeletes(true);

    expect(await identity.createFirstAdmin(jane)).toEqual({ ok: false, error: "username_taken" });
  });
});

describe("a starting password the identity provider rejects", () => {
  it("is refused as provider_rejected, which is not the retryable provider_error", async () => {
    idp.failNext("rejected");

    expect(await identity.createFirstAdmin(jane)).toEqual({ ok: false, error: "provider_rejected" });
    expect(await accounts()).toEqual([]);
  });
});

describe("without STAFF_PASSWORD_PEPPER", () => {
  it("refuses to create any account, with an explicit refusal and an operational log line, and gives the provider nothing", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: string) => void lines.push(line));
    try {
      const unpeppered = createIdentity({ db: app, idp });
      expect(await unpeppered.createFirstAdmin(jane)).toEqual({ ok: false, error: "passwords_not_configured" });
      const firstId = await firstAdmin();
      expect(await unpeppered.addPerson(firstId, omar)).toEqual({ ok: false, error: "passwords_not_configured" });
      // A pepper too short to be one is no pepper.
      expect(await createIdentity({ db: app, idp, passwordPepper: "short" }).addPerson(firstId, omar)).toEqual({ ok: false, error: "passwords_not_configured" });
    } finally {
      spy.mockRestore();
    }
    expect(idp.users.size).toBe(1);
    expect(await accounts()).toHaveLength(1);
    expect(lines.map((line) => JSON.parse(line))).toEqual(
      expect.arrayContaining([{ level: "error", evt: "identity.staff_passwords_not_configured", module: "identity", operation: "create_account" }]),
    );
    expect((await auditRecords()).at(-1)).toMatchObject({ action: "account.created", outcome: "refused", meta: { reason: "provider_error", role: "admin" } });
  });
});

describe("scripts/create-first-admin", () => {
  const production = () => ({
    VERCEL_ENV: "production",
    SMS_MODE: "live",
    PUBLIC_BASE_URL: "https://project-6qcs4.vercel.app",
    // Only parsed (the connection is stubbed below): production must name the app role and the pooler port.
    DATABASE_URL: "postgres://cvh_app_login.ref:pw@pooler.example:6543/postgres",
    SUPABASE_SECRET_KEY: "sb_secret_test_only",
    NEXT_PUBLIC_SUPABASE_URL: "https://example-project.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only",
    STAFF_PASSWORD_PEPPER: PEPPER,
  });
  const args = ["--username", "jdoe", "--first-name", "Jane", "--last-name", "Doe", "--email", "jane.doe@example.org"];

  async function run(env: Record<string, string>) {
    const out: string[] = [];
    const error: string[] = [];
    const connect = vi.fn(() => ({ identity, staffAuth: { reissueFirstAdminStartingPassword: async () => ({ ok: false as const, error: "not_first_admin" as const }) }, close: async () => {} }));
    const code = await runCreateFirstAdmin(args, { env, out: (l) => out.push(l), error: (l) => error.push(l), connect });
    return { code, out: out.join("\n"), error: error.join("\n"), connect };
  }

  it("creates the first Admin in production and prints the starting password to hand over", async () => {
    const { code, out } = await run(production());

    expect(code).toBe(0);
    expect(out).toContain("Username: jdoe");
    expect(out).toContain("Starting password: cvh-jane-doe");
    expect(out).toContain("Finish setting up two Admins first");
    expect(await accounts()).toHaveLength(1);
  });

  it("is refused when an Admin exists", async () => {
    await firstAdmin();

    const { code, error } = await run(production());

    expect(code).toBe(1);
    expect(error).toBe("Refused: An Admin already exists. The first Admin can be created only once. (admin_exists)");
  });

  it("refuses to run outside production, before connecting to anything", async () => {
    const { code, error, connect } = await run({ ...production(), VERCEL_ENV: "preview", SMS_MODE: "log", PUBLIC_BASE_URL: "https://cvh-preview.vercel.app" });

    expect(code).toBe(1);
    expect(error).toMatch(/runs only in production/);
    expect(connect).not.toHaveBeenCalled();
    expect(await accounts()).toEqual([]);
  });
});

describe("Add a person", () => {
  it("lets the first Admin create the one second Admin during bootstrap", async () => {
    const firstId = await firstAdmin();

    const created = await identity.addPerson(firstId, omar);

    expect(created).toEqual({ ok: true, value: { staffId: expect.any(String), username: "ofarouk", startingPassword: "cvh-omar-farouk", role: "admin" } });
    const secondId = created.ok ? created.value.staffId : "";
    expect((await accounts())[1]).toMatchObject({ username: "ofarouk", role: "admin", must_change_password: true, issued: true, created_by: firstId });
    expect(await bootstrap()).toEqual({ first_admin_id: firstId, second_admin_id: secondId, completed_at: null });
    expect((await auditRecords()).at(-1)).toEqual({
      actor_staff_id: firstId, action: "account.created", subject_type: "staff_account", subject_id: secondId, outcome: "ok", meta: { role: "admin", bootstrap: true },
    });
  });

  it.each(["ambassador", "coordinator", "director"])("refuses the first Admin a %s account during bootstrap", async (role) => {
    const firstId = await firstAdmin();

    expect(await identity.addPerson(firstId, { ...omar, role })).toEqual({ ok: false, error: "bootstrap_incomplete" });
    expect(await accounts()).toHaveLength(1);
    expect(idp.users.size).toBe(1);
    expect((await auditRecords()).at(-1)).toEqual({
      actor_staff_id: firstId, action: "account.created", subject_type: "staff_account", subject_id: null, outcome: "refused", meta: { reason: "bootstrap_incomplete", role },
    });
  });

  it("refuses a third account during bootstrap, from either Admin", async () => {
    const firstId = await firstAdmin();
    const secondId = await secondAdmin(firstId);

    expect(await identity.addPerson(firstId, { ...omar, username: "third" })).toEqual({ ok: false, error: "bootstrap_incomplete" });
    expect(await identity.addPerson(secondId, { ...omar, username: "third", role: "coordinator" })).toEqual({ ok: false, error: "bootstrap_incomplete" });
    expect(await accounts()).toHaveLength(2);
  });

  it("creates one second Admin when two requests race", async () => {
    const firstId = await firstAdmin();
    const racing = createIdentity({ db: app, idp: gatedProvider(idp, 2), passwordPepper: PEPPER });

    const results = await Promise.all([racing.addPerson(firstId, omar), racing.addPerson(firstId, { ...omar, username: "other" })]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "bootstrap_incomplete" }]);
    expect(await accounts()).toHaveLength(2);
    expect(idp.users.size).toBe(2);
  });

  it("refuses a duplicate username, whatever its case", async () => {
    const firstId = await firstAdmin();

    expect(await identity.addPerson(firstId, { ...omar, username: "JDOE" })).toEqual({ ok: false, error: "username_taken" });
    expect((await auditRecords()).at(-1)).toMatchObject({ outcome: "refused", meta: { reason: "duplicate", role: "admin" } });
    expect(await accounts()).toHaveLength(1);
  });

  it("refuses a username the identity provider already holds", async () => {
    const firstId = await firstAdmin();
    await idp.createLogin({ login: "ofarouk@staff.cvh.invalid", password: "x" });

    expect(await identity.addPerson(firstId, omar)).toEqual({ ok: false, error: "username_taken" });
    expect(await accounts()).toHaveLength(1);
  });

  it("refuses names that make an empty starting password", async () => {
    const firstId = await firstAdmin();

    expect(await identity.addPerson(firstId, { ...omar, lastName: "فاروق" })).toEqual({ ok: false, error: "starting_password_empty" });
    expect(await accounts()).toHaveLength(1);
  });

  it("refuses anyone but an active Admin, audited as permission denied", async () => {
    const firstId = await firstAdmin();
    await owner`update staff_account set status = 'suspended' where id = ${firstId}`;

    expect(await identity.addPerson(firstId, omar)).toEqual({ ok: false, error: "forbidden" });
    expect((await auditRecords()).at(-1)).toEqual({
      actor_staff_id: firstId, action: "permission.denied", subject_type: "staff_account", subject_id: firstId, outcome: "refused",
      meta: { status: 403, permission: "accounts.create", reason: "forbidden" },
    });
    expect(await identity.addPersonView(firstId)).toEqual({ allowed: false, refusal: "forbidden" });
    expect(await identity.addPersonView(randomUUID())).toEqual({ allowed: false, refusal: "forbidden" });
  });

  it("offers only the Admin role to the first Admin during bootstrap, and nothing once the second Admin exists", async () => {
    const firstId = await firstAdmin();
    expect(await identity.addPersonView(firstId)).toEqual({ allowed: true, roles: ["admin"], bootstrap: "in_progress" });

    const secondId = await secondAdmin(firstId);
    expect(await identity.addPersonView(firstId)).toEqual({ allowed: false, refusal: "bootstrap_incomplete" });
    expect(await identity.addPersonView(secondId)).toEqual({ allowed: false, refusal: "bootstrap_incomplete" });
  });
});

describe("the bootstrap gate", () => {
  it("refuses anything but own setup, from both pending Admins, and audits it", async () => {
    const firstId = await firstAdmin();
    const secondId = await secondAdmin(firstId);

    for (const id of [firstId, secondId]) {
      expect(await identity.checkBootstrap(id, { kind: "complete_own_setup" }, "password.change")).toEqual({ ok: true, value: undefined });
      expect(await identity.checkBootstrap(id, { kind: "other" }, "building.confirm")).toEqual({ ok: false, error: "bootstrap_incomplete" });
    }
    const denied = (await auditRecords()).filter((r) => r.action === "permission.denied");
    expect(denied).toEqual(
      [firstId, secondId].map((id) => ({
        actor_staff_id: id, action: "permission.denied", subject_type: "staff_account", subject_id: id, outcome: "refused",
        meta: { status: 403, permission: "building.confirm", reason: "bootstrap_incomplete" },
      })),
    );
  });

  it("completes once both Admins are usable, in either order, audits it once, and never returns", async () => {
    const firstId = await firstAdmin();
    const secondId = await secondAdmin(firstId);

    // The second Admin finishes first, without waiting for the first.
    await replacePassword(secondId);
    await enrol(secondId);
    expect(await identity.completeBootstrapIfReady(secondId)).toBe(false);
    await replacePassword(firstId);
    expect(await identity.completeBootstrapIfReady(firstId)).toBe(false);
    await enrol(firstId);
    expect(await identity.completeBootstrapIfReady(firstId)).toBe(true);
    expect(await identity.completeBootstrapIfReady(secondId)).toBe(false);

    expect((await bootstrap())?.completed_at).toBeInstanceOf(Date);
    expect((await auditRecords()).filter((r) => r.action === "bootstrap.completed")).toEqual([
      { actor_staff_id: firstId, action: "bootstrap.completed", subject_type: "staff_bootstrap", subject_id: null, outcome: "ok", meta: {} },
    ]);

    // Usable Admins drop below two (only a recovery can do that, S01.06): bootstrap does not come back.
    await owner.begin(async (tx) => {
      await tx`select set_config('cvh.admin_recovery', 'on', true)`;
      await tx`update staff_account set must_change_password = true, starting_password_issued_at = now() where id = ${secondId}`;
    });
    expect(await identity.checkBootstrap(firstId, { kind: "other" }, "building.confirm")).toEqual({ ok: true, value: undefined });
    const coordinator = await identity.addPerson(firstId, { ...omar, username: "coord", role: "coordinator" });
    expect(coordinator).toMatchObject({ ok: true, value: { role: "coordinator" } });
    expect(await identity.addPersonView(firstId)).toEqual({ allowed: true, roles: ["ambassador", "coordinator", "director", "admin"], bootstrap: "completed" });
    expect(await identity.createFirstAdmin({ ...jane, username: "fresh" })).toEqual({ ok: false, error: "admin_exists" });
  });
});

describe("the identity tables", () => {
  it("only move bootstrap forward, even for the owner", async () => {
    const firstId = await firstAdmin();
    const secondId = await secondAdmin(firstId);
    await owner`update staff_bootstrap set completed_at = now()`;

    for (const statement of [
      "update staff_bootstrap set completed_at = null",
      "update staff_bootstrap set second_admin_id = null",
      "update staff_bootstrap set first_admin_id = second_admin_id",
      "delete from staff_bootstrap",
      "truncate staff_bootstrap cascade",
    ]) {
      await expect(owner.unsafe(statement), statement).rejects.toMatchObject({ code: "42501" });
    }
    await expect(app.$client`insert into staff_bootstrap (first_admin_id) values (${secondId})`).rejects.toMatchObject({ code: "23505" });
    expect(await bootstrap()).toMatchObject({ first_admin_id: firstId, second_admin_id: secondId, completed_at: expect.any(Date) });
  });

  it("never let the app delete an account, and give Supabase's client roles no access", async () => {
    const firstId = await firstAdmin();

    await expect(app.$client`delete from staff_account where id = ${firstId}`).rejects.toMatchObject({ code: "42501" });
    const [row] = await owner`
      select bool_or(has_table_privilege(r, t, 'select, insert, update, delete, truncate, references, trigger')) as any_privilege
      from unnest(array['anon', 'authenticated', 'service_role']) as r, unnest(array['public.staff_account', 'public.staff_bootstrap']) as t`;
    expect(row.any_privilege).toBe(false);
  });

  it("make every audit actor a staff account", async () => {
    const stranger = randomUUID();

    await expect(
      app.transaction((tx) =>
        import("../../src/modules/audit").then((audit) =>
          audit.record(tx, { action: "password.changed", actorStaffId: stranger, subjectType: "staff_account", subjectId: stranger }),
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
  });
});
