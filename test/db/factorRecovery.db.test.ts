// Authenticator recovery against a real database (S01.11): an Admin's "Reset authenticator" and
// IT's scripts/recover-admin, both on S01.10's factorReset hook. The app writes with its own
// credentials (cvh_app_login); Supabase Auth is the in-memory fake, whose TOTP codes are computed
// with RFC 6238 (memoryTotp.ts).
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runRecoverAdmin } from "../../scripts/identity/recover-admin";
import { migrate } from "../../scripts/db/migrate.mjs";
import {
  createIdentity,
  createStaffAuth,
  pepperPassword,
  type CookieJar,
  type IdentityService,
  type StaffAuthService,
  type StaffSession,
} from "../../src/modules/identity";
import { memoryIdentityProvider, type MemoryIdentityProvider } from "../../src/modules/identity/adapters/memoryIdentityProvider";
import { totpCode } from "../../src/modules/identity/adapters/memoryTotp";
import * as audit from "../../src/modules/audit";
import { stdoutOperationalLog } from "../../src/modules/identity/adapters/operationalLog";
import { drizzleStaffSessionStore } from "../../src/modules/identity/adapters/sessionStore";
import { drizzleStaffStore } from "../../src/modules/identity/adapters/staffStore";
import { createAdminRecovery } from "../../src/modules/identity/application/adminRecovery";
import { createFactorRecovery } from "../../src/modules/identity/application/factorRecovery";
import { createFactorReset } from "../../src/modules/identity/application/factorReset";
import { createSessionRevocation } from "../../src/modules/identity/application/sessionRevocation";
import { createDb, type Db } from "../../src/platform/db";
import { connect, serverUrl } from "./helpers";

let owner: ReturnType<typeof connect>;
let app: Db;
let auditBaseline = 0;

let idp: MemoryIdentityProvider;
let accounts: IdentityService;
let auth: StaffAuthService;
let clock: Date;

const THROTTLE_KEY = randomBytes(32).toString("hex");
const PEPPER = randomBytes(32).toString("hex");
const peppered = (password: string) => pepperPassword(PEPPER, password);
const T0 = new Date("2026-10-05T14:00:00Z");
const CLIENT = "203.0.113.9";

beforeAll(async () => {
  owner = connect(serverUrl());
  await migrate({ sql: owner, log: () => {} });
  const password = randomBytes(18).toString("hex");
  await owner.unsafe(`alter role cvh_app_login password '${password}'`);
  const url = new URL(serverUrl());
  url.username = "cvh_app_login";
  url.password = password;
  app = createDb(url.href);
  [{ max: auditBaseline }] = await owner`select coalesce(max(id), 0)::int as max from audit_event`;
});

async function reset() {
  await owner.begin(async (tx) => {
    await tx.unsafe(`
      alter table audit_event disable trigger audit_event_no_update_or_delete;
      alter table staff_bootstrap disable trigger staff_bootstrap_forward_only;`);
    await tx`delete from audit_event where id > ${auditBaseline}`;
    await tx`delete from staff_bootstrap`;
    await tx`delete from staff_session`;
    await tx`update staff_account set created_by = null`;
    await tx`delete from staff_account`;
    await tx`delete from sign_in_failure`;
    await tx`delete from sign_in_lock`;
    await tx.unsafe(`
      alter table audit_event enable trigger audit_event_no_update_or_delete;
      alter table staff_bootstrap enable trigger staff_bootstrap_forward_only;`);
  });
}

function wire(provider: MemoryIdentityProvider) {
  const wiring = { db: app, idp: provider, throttleKey: THROTTLE_KEY, passwordPepper: PEPPER, now: () => clock, sleep: async () => {}, monotonicMs: () => 0 };
  accounts = createIdentity(wiring);
  auth = createStaffAuth({ ...wiring, accounts });
}

beforeEach(async () => {
  await reset();
  clock = T0;
  idp = memoryIdentityProvider();
  wire(idp);
});

afterAll(async () => {
  await reset();
  await app?.$client.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

function browser() {
  const cookies = new Map<string, string>();
  const jar: CookieJar = {
    getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
    setAll: (list) => {
      for (const { name, value, options } of list) {
        if (options.maxAge === 0 || value === "") cookies.delete(name);
        else cookies.set(name, value);
      }
    },
  };
  return { cookies, jar, sessions: () => idp.sessions(jar) };
}
type Browser = ReturnType<typeof browser>;

type Role = "ambassador" | "coordinator" | "director" | "admin";

let nextId = 1;
async function account(username: string, role: Role, options: { enrolled?: boolean; status?: string } = {}) {
  const authUserId = idp.plant(`${username}@staff.cvh.invalid`, { password: peppered(`${username} own password`) });
  if (options.enrolled) idp.enrol(authUserId);
  const id = `01900000-0000-7000-8000-${String(nextId++).padStart(12, "0")}`;
  await owner`
    insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, status, must_change_password, factor_enrolled_at)
    values (${id}, ${authUserId}, ${username}, 'Ann', 'Okafor', 'someone@example.org', ${role}, ${options.status ?? "active"}, false, ${options.enrolled ? clock : null})`;
  return { id, authUserId, username };
}

const signIn = (device: Browser, username: string) => auth.signIn(device.sessions(), { username, password: `${username} own password`, client: CLIENT });
const current = (device: Browser): Promise<StaffSession | null> => auth.currentSession(device.sessions());
const codeFor = (authUserId: string) => totpCode(idp.totpSecret(authUserId));

/** Signs in and enters the authenticator code: an aal2 session. */
async function signedInAal2(username: string, authUserId: string) {
  const device = browser();
  await signIn(device, username);
  const session = await current(device);
  await auth.verifyAuthenticatorCode(session!, { code: codeFor(authUserId), client: CLIENT }, device.sessions());
  return device;
}

/** As the owner, allowed to leave fewer than two usable Admins (the recovery exception's setting). */
const asRecovery = (change: (tx: typeof owner) => unknown) =>
  owner.begin(async (tx) => {
    await tx`select set_config('cvh.admin_recovery', 'on', true)`;
    await change(tx as unknown as typeof owner);
  });

const auditOf = (actions: string[]) =>
  owner`select actor_staff_id, action, subject_id, outcome, meta from audit_event where id > ${auditBaseline} and action in ${owner(actions)} order by id`;
const factorEnrolledAt = async (id: string) => (await owner`select factor_enrolled_at from staff_account where id = ${id}`)[0].factor_enrolled_at;
const bootstrapCompleted = async () => (await owner`select completed_at from staff_bootstrap`)[0].completed_at !== null;

async function twoAdmins() {
  const first = await account("admin1", "admin", { enrolled: true });
  const second = await account("admin2", "admin", { enrolled: true });
  await owner`insert into staff_bootstrap (first_admin_id, second_admin_id, completed_at) values (${first.id}, ${second.id}, now())`;
  return { first, second };
}

describe("an Admin's Reset authenticator", () => {
  it("removes a Coordinator's factor, ends every session of theirs, audits factor.reset and sends them to enrolment", async () => {
    const { first } = await twoAdmins();
    const coordinator = await account("coord", "coordinator", { enrolled: true });
    const phone = await signedInAal2("coord", coordinator.authUserId);
    const laptop = await signedInAal2("coord", coordinator.authUserId);
    expect(await current(phone)).toMatchObject({ gate: "hub", aal: "aal2" });

    expect(await accounts.resetAuthenticator(first.id, "coord")).toEqual({ ok: true, value: { username: "coord", adminShortfall: false, providerCleared: true } });

    expect(await current(phone)).toBeNull();
    expect(await current(laptop)).toBeNull();
    expect(idp.users.get(coordinator.authUserId)!.authenticatorEnrolled).toBe(false);
    expect(await factorEnrolledAt(coordinator.id)).toBeNull();
    expect(await auditOf(["factor.reset", "session.revoked"])).toEqual([
      { actor_staff_id: first.id, action: "session.revoked", subject_id: coordinator.id, outcome: "ok", meta: { cause: "factor_reset", sessions: 2 } },
      { actor_staff_id: first.id, action: "factor.reset", subject_id: coordinator.id, outcome: "ok", meta: { recovery: "lost_device" } },
    ]);
    expect(await accounts.adminShortfallBanner(first.id)).toBe(false);
    expect(await signIn(browser(), "coord")).toMatchObject({ ok: true, gate: "enrol_authenticator" });
  });

  it("never lets an Admin reset their own authenticator", async () => {
    const { first } = await twoAdmins();

    expect(await accounts.resetAuthenticator(first.id, "admin1")).toEqual({ ok: false, error: "self_action" });

    expect(await factorEnrolledAt(first.id)).not.toBeNull();
    expect(idp.users.get(first.authUserId)!.authenticatorEnrolled).toBe(true);
    expect(await auditOf(["factor.reset"])).toEqual([{ actor_staff_id: first.id, action: "factor.reset", subject_id: first.id, outcome: "refused", meta: { reason: "self_action" } }]);
  });

  it.each(["coordinator", "director", "ambassador"] as const)("refuses a %s who asks", async (role) => {
    const { second } = await twoAdmins();
    const asker = await account("asker", role, { enrolled: role === "coordinator" });

    expect(await accounts.resetAuthenticator(asker.id, "admin2")).toEqual({ ok: false, error: "forbidden" });

    expect(await factorEnrolledAt(second.id)).not.toBeNull();
    expect((await auditOf(["factor.reset"]))[0]).toMatchObject({ actor_staff_id: asker.id, outcome: "refused", meta: { reason: "forbidden" } });
  });

  it("refuses an unknown username, an Ambassador or Director (no authenticator) and a suspended account, changing nothing", async () => {
    const { first } = await twoAdmins();
    const ambassador = await account("amb", "ambassador");
    await account("dir", "director");
    const suspended = await account("susp", "coordinator", { enrolled: true, status: "suspended" });

    expect(await accounts.resetAuthenticator(first.id, "nobody")).toEqual({ ok: false, error: "not_found" });
    expect(await accounts.resetAuthenticator(first.id, "amb")).toEqual({ ok: false, error: "no_authenticator" });
    expect(await accounts.resetAuthenticator(first.id, "dir")).toEqual({ ok: false, error: "no_authenticator" });
    expect(await accounts.resetAuthenticator(first.id, "susp")).toEqual({ ok: false, error: "not_resettable" });

    expect(await factorEnrolledAt(suspended.id)).not.toBeNull();
    expect(await factorEnrolledAt(ambassador.id)).toBeNull();
    expect((await auditOf(["factor.reset"])).map((record) => [record.outcome, record.meta])).toEqual([
      ["refused", { reason: "not_found" }],
      ["refused", { reason: "validation" }],
      ["refused", { reason: "validation" }],
      ["refused", { reason: "conflict" }],
    ]);
    expect(await auditOf(["session.revoked"])).toEqual([]);
  });

  it("is refused while the first two Admins are still being set up", async () => {
    const first = await account("admin1", "admin", { enrolled: true });
    await account("coord", "coordinator", { enrolled: true });
    await owner`insert into staff_bootstrap (first_admin_id) values (${first.id})`;

    expect(await accounts.resetAuthenticator(first.id, "coord")).toEqual({ ok: false, error: "bootstrap_incomplete" });
  });

  it("resets an Admin even when it leaves fewer than two usable Admins: the banner shows to the remaining Admin, bootstrap does not return", async () => {
    const { first, second } = await twoAdmins();
    const secondDevice = await signedInAal2("admin2", second.authUserId);

    expect(await accounts.resetAuthenticator(first.id, "admin2")).toEqual({ ok: true, value: { username: "admin2", adminShortfall: true, providerCleared: true } });

    expect(await current(secondDevice)).toBeNull();
    expect((await auditOf(["factor.reset"]))[0].meta).toEqual({ recovery: "lost_device", admin_shortfall: true });
    expect(await accounts.adminShortfallBanner(first.id)).toBe(true);
    expect(await bootstrapCompleted()).toBe(true);
    // Not bootstrap again: other actions go on, but Admins cannot be suspended, removed or demoted.
    const coordinator = await account("coord", "coordinator", { enrolled: true });
    expect(await accounts.suspendAccount(first.id, coordinator.id)).toMatchObject({ ok: true });
    expect(await accounts.suspendAccount(first.id, second.id)).toEqual({ ok: false, error: "two_admin_rule" });
    // The Admin is back once they enrol again, and the banner goes when a second Admin is usable.
    expect(await signIn(browser(), "admin2")).toMatchObject({ ok: true, gate: "enrol_authenticator" });
  });

  it("keeps the reset when the provider cannot delete the old factor: nothing counts it and the sign-in enrols again", async () => {
    const { first, second } = await twoAdmins();
    wire({ ...idp, removeFactors: async () => { throw new Error("provider down"); } });

    expect(await accounts.resetAuthenticator(first.id, "admin2")).toEqual({ ok: true, value: { username: "admin2", adminShortfall: true, providerCleared: false } });

    expect(await factorEnrolledAt(second.id)).toBeNull();
    expect((await auditOf(["factor.reset"]))[0]).toMatchObject({ outcome: "ok" });
    wire(idp);
    expect(await signIn(browser(), "admin2")).toMatchObject({ ok: true, gate: "enrol_authenticator" });
  });

  it("lets two Admins reset each other at the same time: both are recovery actions and both go ahead", async () => {
    const { first, second } = await twoAdmins();

    const [a, b] = await Promise.all([accounts.resetAuthenticator(first.id, "admin2"), accounts.resetAuthenticator(second.id, "admin1")]);

    expect(a.ok && b.ok).toBe(true);
    expect(await factorEnrolledAt(first.id)).toBeNull();
    expect(await factorEnrolledAt(second.id)).toBeNull();
    expect(await bootstrapCompleted()).toBe(true);
  });
});

describe("IT's recoverAdmin (scripts/recover-admin)", () => {
  it("resets an Admin when no other Admin is usable, as actor system with the reason code, and leaves a shortfall", async () => {
    const { first, second } = await twoAdmins();
    // The first Admin lost access too: no authenticator on record, so not usable.
    await asRecovery((tx) => tx`update staff_account set factor_enrolled_at = null where id = ${first.id}`);
    const device = await signedInAal2("admin2", second.authUserId);

    expect(await accounts.recoverAdmin("admin2", "lost_device")).toEqual({ ok: true, value: { username: "admin2", adminShortfall: true, providerCleared: true } });

    expect(await current(device)).toBeNull();
    expect(idp.users.get(second.authUserId)!.authenticatorEnrolled).toBe(false);
    expect(await factorEnrolledAt(second.id)).toBeNull();
    expect(await auditOf(["factor.reset", "session.revoked"])).toEqual([
      { actor_staff_id: null, action: "session.revoked", subject_id: second.id, outcome: "ok", meta: { cause: "factor_reset", sessions: 1 } },
      { actor_staff_id: null, action: "factor.reset", subject_id: second.id, outcome: "ok", meta: { recovery: "lost_device", admin_shortfall: true } },
    ]);
    expect(await bootstrapCompleted()).toBe(true);
    expect(await signIn(browser(), "admin2")).toMatchObject({ ok: true, gate: "enrol_authenticator" });
  });

  it("reads the other Admins' sign-in locks through the reset's transaction, never a second pool connection", async () => {
    const { second } = await twoAdmins();
    // The first Admin is locked out by failed sign-ins (the lock reader says so), so they are not usable.
    const executors: unknown[] = [];
    const now = () => clock;
    const lockReader = async (executor: unknown) => {
      executors.push(executor);
      return new Date(clock.getTime() + 15 * 60_000);
    };
    const revocation = createSessionRevocation({ store: drizzleStaffStore, sessions: drizzleStaffSessionStore, audit, now });
    const factorReset = createFactorReset({
      db: app,
      store: drizzleStaffStore,
      idp,
      audit,
      log: stdoutOperationalLog,
      // The recovery exception reads the locks too: through the same reader, so the assertion covers it.
      beginAdminRecovery: createAdminRecovery({ store: drizzleStaffStore, idp, now, signInLockedUntil: lockReader }).beginAdminRecovery,
      revocation,
    });
    const recovery = createFactorRecovery({ db: app, store: drizzleStaffStore, idp, audit, now, factorReset, signInLockedUntil: lockReader, sessions: drizzleStaffSessionStore });

    expect((await recovery.recoverAdmin("admin2", "lost_device")).ok).toBe(true);

    expect(executors.length).toBeGreaterThan(0);
    expect(executors.every((executor) => executor !== app)).toBe(true);
    expect(await factorEnrolledAt(second.id)).toBeNull();
  });

  it("completes on a pool of one connection: an Admin's reset and IT's recovery read everything through their transaction", async () => {
    const { first } = await twoAdmins();
    const url = new URL(serverUrl());
    const password = randomBytes(18).toString("hex");
    await owner.unsafe(`alter role cvh_app_login password '${password}'`);
    url.username = "cvh_app_login";
    url.password = password;
    const single = createDb(url.href, { max: 1 });
    try {
      const wiring = { db: single, idp, throttleKey: THROTTLE_KEY, passwordPepper: PEPPER, now: () => clock, sleep: async () => {}, monotonicMs: () => 0 };
      const identity = createIdentity(wiring);
      const within = <T>(work: Promise<T>) =>
        Promise.race([work, new Promise<never>((_, rejected) => setTimeout(() => rejected(new Error("the reset waited for a second pool connection")), 8000))]);

      expect((await within(identity.resetAuthenticator(first.id, "admin2"))).ok).toBe(true);
      expect((await within(identity.recoverAdmin("admin1", "all_admins_lost_access"))).ok).toBe(true);
    } finally {
      await single.$client.end({ timeout: 5 });
    }
  }, 20_000);

  it("refuses while another usable Admin exists, changing nothing, and audits the refusal as system", async () => {
    const { first, second } = await twoAdmins();
    const device = await signedInAal2("admin1", first.authUserId);

    expect(await accounts.recoverAdmin("admin2", "all_admins_lost_access")).toEqual({ ok: false, error: "other_usable_admin" });

    expect(await factorEnrolledAt(second.id)).not.toBeNull();
    expect(idp.users.get(second.authUserId)!.authenticatorEnrolled).toBe(true);
    expect(await current(device)).not.toBeNull();
    expect(await auditOf(["factor.reset", "session.revoked"])).toEqual([
      { actor_staff_id: null, action: "factor.reset", subject_id: second.id, outcome: "refused", meta: { reason: "conflict" } },
    ]);
  });

  it("with the attestation resets an Admin although another Admin counts as usable, audited as attested", async () => {
    const { second } = await twoAdmins();
    // Both Admins are usable on paper (active, enrolled), but both lost their phones: no live aal2 session exists.

    expect(await accounts.recoverAdmin("admin2", "all_admins_lost_access", { attested: true })).toEqual({
      ok: true,
      value: { username: "admin2", adminShortfall: true, providerCleared: true },
    });

    expect(await factorEnrolledAt(second.id)).toBeNull();
    expect(await auditOf(["factor.reset"])).toEqual([
      { actor_staff_id: null, action: "factor.reset", subject_id: second.id, outcome: "ok", meta: { recovery: "all_admins_lost_access", admin_shortfall: true, attested: true } },
    ]);
    // Without the attestation the same state refuses.
    await owner`update staff_account set factor_enrolled_at = now() where id = ${second.id}`;
    idp.enrol(second.authUserId);
    expect(await accounts.recoverAdmin("admin2", "all_admins_lost_access")).toEqual({ ok: false, error: "other_usable_admin" });
  });

  it("still refuses with the attestation while another Admin has a live aal2 session, who can reset from the Hub", async () => {
    const { first, second } = await twoAdmins();
    const device = await signedInAal2("admin1", first.authUserId);

    expect(await accounts.recoverAdmin("admin2", "all_admins_lost_access", { attested: true })).toEqual({ ok: false, error: "other_admin_signed_in" });

    expect(await factorEnrolledAt(second.id)).not.toBeNull();
    expect(await current(device)).not.toBeNull();
    expect(await auditOf(["factor.reset"])).toEqual([
      { actor_staff_id: null, action: "factor.reset", subject_id: second.id, outcome: "refused", meta: { reason: "conflict" } },
    ]);
  });

  it("does not count an aal1 session as a way in", async () => {
    await twoAdmins();
    await signIn(browser(), "admin1");

    expect(await accounts.recoverAdmin("admin2", "all_admins_lost_access", { attested: true })).toMatchObject({ ok: true });
  });

  it("does not count an aal2 session opened more than 12 hours ago, but counts one opened just inside the limit", async () => {
    const { first } = await twoAdmins();
    await signedInAal2("admin1", first.authUserId);
    const opened = (hours: number) => owner`update staff_session set created_at = ${new Date(clock.getTime() - hours * 3600_000)}, last_seen_at = ${new Date(clock.getTime() - hours * 3600_000)} where aal2_at is not null`;

    await opened(11.9);
    expect(await accounts.recoverAdmin("admin2", "all_admins_lost_access", { attested: true })).toEqual({ ok: false, error: "other_admin_signed_in" });
    await opened(12.1);
    expect(await accounts.recoverAdmin("admin2", "all_admins_lost_access", { attested: true })).toMatchObject({ ok: true });
  });

  it("refuses --confirm-no-admin-can-sign-in with another reason through the CLI as a usage error, changing nothing", async () => {
    const { second } = await twoAdmins();
    const lines: string[] = [];

    const code = await runRecoverAdmin(["--username", "admin2", "--reason", "lost_device", "--confirm-no-admin-can-sign-in"], {
      env: PRODUCTION,
      out: (line) => lines.push(line),
      error: (line) => lines.push(line),
      connect: () => ({ identity: accounts, close: async () => {} }),
    });

    expect(code).toBe(2);
    expect(lines.join("\n")).toMatch(/valid only with --reason all_admins_lost_access/);
    expect(await factorEnrolledAt(second.id)).not.toBeNull();
    expect(await auditOf(["factor.reset"])).toEqual([]);
  });

  it("resets through the CLI with the attestation when two Admins are usable on paper", async () => {
    const { second } = await twoAdmins();
    const lines: string[] = [];

    const code = await runRecoverAdmin(["--username", "admin2", "--reason", "all_admins_lost_access", "--confirm-no-admin-can-sign-in"], {
      env: PRODUCTION,
      out: (line) => lines.push(line),
      error: (line) => lines.push(line),
      connect: () => ({ identity: accounts, close: async () => {} }),
    });

    expect(code).toBe(0);
    expect(await factorEnrolledAt(second.id)).toBeNull();
    expect((await auditOf(["factor.reset"]))[0]).toMatchObject({ outcome: "ok", meta: { attested: true, recovery: "all_admins_lost_access" } });
  });

  it("counts a locked Admin as not usable, and the same Admin as a reason to refuse once active again", async () => {
    const { first, second } = await twoAdmins();
    await asRecovery((tx) => tx`update staff_account set status = 'locked_pending_reissue' where id = ${first.id}`);

    expect(await accounts.recoverAdmin("admin2", "device_broken")).toMatchObject({ ok: true, value: { username: "admin2", adminShortfall: true } });
    expect(await factorEnrolledAt(second.id)).toBeNull();
    // Both Admins are not usable now; the first one is made usable again, so the second may not be reset by IT.
    await asRecovery((tx) => tx`update staff_account set status = 'active' where id = ${first.id}`);
    await owner`update staff_account set factor_enrolled_at = now() where id = ${second.id}`;
    idp.enrol(second.authUserId);
    expect(await accounts.recoverAdmin("admin2", "device_broken")).toEqual({ ok: false, error: "other_usable_admin" });
  });

  it("refuses an account that is not an Admin, an unknown one and a removed one", async () => {
    await twoAdmins();
    await account("coord", "coordinator", { enrolled: true });
    await account("gone", "admin", { enrolled: true, status: "removed" });

    expect(await accounts.recoverAdmin("coord", "lost_device")).toEqual({ ok: false, error: "not_admin" });
    expect(await accounts.recoverAdmin("nobody", "lost_device")).toEqual({ ok: false, error: "not_found" });
    expect(await accounts.recoverAdmin("gone", "lost_device")).toEqual({ ok: false, error: "not_resettable" });
    expect((await auditOf(["factor.reset"])).map((record) => [record.actor_staff_id, record.outcome])).toEqual([
      [null, "refused"],
      [null, "refused"],
      [null, "refused"],
    ]);
  });

  it("runs through the CLI: resets the Admin, audited with actor system and the reason, and prints the next step", async () => {
    const { first, second } = await twoAdmins();
    // Neither can get in: the first Admin's account is locked after failed sign-ins.
    await asRecovery((tx) => tx`update staff_account set status = 'locked_pending_reissue' where id = ${first.id}`);
    const device = browser();
    await signIn(device, "admin2");
    const lines: string[] = [];

    const code = await runRecoverAdmin(["--username", "admin2", "--reason", "all_admins_lost_access"], {
      env: PRODUCTION,
      out: (line) => lines.push(line),
      error: (line) => lines.push(line),
      connect: () => ({ identity: accounts, close: async () => {} }),
    });

    expect(code).toBe(0);
    expect(lines.join("\n")).toMatch(/Authenticator reset for admin2\./);
    expect(lines.join("\n")).toMatch(/actor system, reason all_admins_lost_access/);
    expect(lines.join("\n")).toMatch(/fewer than two usable Admins/);
    expect(await current(device)).toBeNull();
    expect(await factorEnrolledAt(second.id)).toBeNull();
    expect(await auditOf(["factor.reset", "session.revoked"])).toEqual([
      { actor_staff_id: null, action: "session.revoked", subject_id: second.id, outcome: "ok", meta: { cause: "factor_reset", sessions: expect.any(Number) } },
      { actor_staff_id: null, action: "factor.reset", subject_id: second.id, outcome: "ok", meta: { recovery: "all_admins_lost_access", admin_shortfall: true } },
    ]);
    expect(await signIn(browser(), "admin2")).toMatchObject({ ok: true, gate: "enrol_authenticator" });
  });

  it("refuses through the CLI with a next step when another usable Admin exists", async () => {
    await twoAdmins();
    const lines: string[] = [];

    const code = await runRecoverAdmin(["--username", "admin2", "--reason", "lost_device"], {
      env: PRODUCTION,
      out: (line) => lines.push(line),
      error: (line) => lines.push(line),
      connect: () => ({ identity: accounts, close: async () => {} }),
    });

    expect(code).toBe(1);
    expect(lines.join("\n")).toMatch(/^Refused: another usable Admin exists\. Ask an Admin to reset this authenticator from the Hub/);
  });
});

/** Production's environment, as test/recover-admin.test.ts builds it: the CLI's guard reads it, nothing here connects to it. */
const PRODUCTION = {
  VERCEL_ENV: "production",
  SMS_MODE: "live",
  PUBLIC_BASE_URL: "https://project-6qcs4.vercel.app",
  DATABASE_URL: "postgres://cvh_app_login.ref:secret@aws-0-ca-central-1.pooler.supabase.com:6543/postgres",
  SUPABASE_SECRET_KEY: "sb_secret_test_only",
  NEXT_PUBLIC_SUPABASE_URL: "https://example-project.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only",
};
