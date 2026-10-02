// Authenticators against a real database (S01.10): gate 2's enrolment, the sign-in's code, the
// session's aal2 bound to staff_session, wrong codes counted by the sign-in throttle, roles without
// an authenticator, a promotion that requires enrolment, bootstrap completing on the second
// Admin's enrolment, the two-Admin trigger's use of factor_enrolled_at and S01.11's reset hook.
// The app writes with its own credentials (cvh_app_login); Supabase Auth is the in-memory fake,
// whose TOTP codes are computed here with RFC 6238 (memoryTotp.ts).
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import * as audit from "../../src/modules/audit";
import {
  MEMORY_SESSION_COOKIE,
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
import { stdoutOperationalLog } from "../../src/modules/identity/adapters/operationalLog";
import { drizzleStaffSessionStore } from "../../src/modules/identity/adapters/sessionStore";
import { drizzleStaffStore } from "../../src/modules/identity/adapters/staffStore";
import { createAdminRecovery } from "../../src/modules/identity/application/adminRecovery";
import { createFactorReset } from "../../src/modules/identity/application/factorReset";
import { createSessionRevocation } from "../../src/modules/identity/application/sessionRevocation";
import { throttleHash } from "../../src/modules/identity/application/staffAuth";
import { createDb, type Db } from "../../src/platform/db";
import { connect, serverUrl } from "./helpers";

let owner: ReturnType<typeof connect>;
let app: Db;
let appUrl: string;
let auditBaseline = 0;

let idp: MemoryIdentityProvider;
let accounts: IdentityService;
let auth: StaffAuthService;
let clock: Date;

const THROTTLE_KEY = randomBytes(32).toString("hex");
const PEPPER = randomBytes(32).toString("hex");
const peppered = (password: string) => pepperPassword(PEPPER, password);
const T0 = new Date("2026-10-05T14:00:00Z");
const hours = (n: number) => n * 3_600_000;
const advance = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};
const CLIENT = "203.0.113.9";

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

beforeEach(async () => {
  await reset();
  clock = T0;
  idp = memoryIdentityProvider();
  const wiring = { db: app, idp, throttleKey: THROTTLE_KEY, passwordPepper: PEPPER, now: () => clock, sleep: async () => {}, monotonicMs: () => 0 };
  accounts = createIdentity(wiring);
  auth = createStaffAuth({ ...wiring, accounts });
});

afterAll(async () => {
  await reset();
  await app?.$client.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

/** A browser's cookies across requests. */
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
/**
 * As the owner: an account on its own password, like S01.05 and S01.07 leave it; `enrolled` gives
 * it an authenticator enrolled through the app (the provider's verified factor and factor_enrolled_at).
 */
async function account(username: string, role: Role, options: { enrolled?: boolean } = {}) {
  const authUserId = idp.plant(`${username}@staff.cvh.invalid`, { password: peppered(`${username} own password`) });
  if (options.enrolled) idp.enrol(authUserId);
  const id = `01900000-0000-7000-8000-${String(nextId++).padStart(12, "0")}`;
  await owner`
    insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password, factor_enrolled_at)
    values (${id}, ${authUserId}, ${username}, 'Ann', 'Okafor', 'someone@example.org', ${role}, false, ${options.enrolled ? clock : null})`;
  return { id, authUserId, username };
}

async function signIn(device: Browser, username: string) {
  return auth.signIn(device.sessions(), { username, password: `${username} own password`, client: CLIENT });
}

/** The session of a device's next request (the guard's lookup). */
async function current(device: Browser): Promise<StaffSession | null> {
  return auth.currentSession(device.sessions());
}

/** The code the person's authenticator app shows now. */
const codeFor = (authUserId: string) => totpCode(idp.totpSecret(authUserId));
/** A code that is not the person's (a different six digits). */
const wrongFor = (authUserId: string) => String((Number(codeFor(authUserId)) + 500_000) % 1_000_000).padStart(6, "0");

async function verify(device: Browser, code: string) {
  const session = await current(device);
  if (!session) throw new Error("no session");
  return auth.verifyAuthenticatorCode(session, { code, client: CLIENT }, device.sessions());
}

const auditOf = (actions: string[]) =>
  owner`select actor_staff_id, action, subject_id, outcome, meta from audit_event where id > ${auditBaseline} and action in ${owner(actions)} order by id`;

const sessionRow = async (staffId: string) => (await owner`select id, aal2_at, revoked_at from staff_session where staff_account_id = ${staffId} order by created_at`).at(-1)!;

/** Two usable Admins and a completed bootstrap. */
async function twoAdmins() {
  const first = await account("admin1", "admin", { enrolled: true });
  const second = await account("admin2", "admin", { enrolled: true });
  await owner`insert into staff_bootstrap (first_admin_id, second_admin_id, completed_at) values (${first.id}, ${second.id}, now())`;
  return { first, second };
}

describe("gate 2: an Admin or Coordinator without an authenticator", () => {
  it.each(["admin", "coordinator"] as const)("holds a %s at enrolment, then the confirming code makes the session aal2, audits factor.enrolled and opens the Hub", async (role) => {
    const person = await account("pat", role);
    const device = browser();
    expect(await signIn(device, "pat")).toEqual({ ok: true, staffId: person.id, gate: "enrol_authenticator" });
    const atGate = await current(device);
    expect(atGate).toMatchObject({ gate: "enrol_authenticator", aal: "aal1" });

    const started = await auth.startEnrolment(atGate!, device.sessions());
    expect(started).toMatchObject({ ok: true, value: { secret: idp.totpSecret(person.authUserId), qrCode: null } });
    if (!started.ok) throw new Error("expected an enrolment");
    expect(started.value.uri).toMatch(/^otpauth:\/\/totp\/CVH%20Hub%3Apat\?secret=[A-Z2-7]+&issuer=CVH%20Hub$/);
    // Nothing is recorded until the first code is accepted.
    expect((await owner`select factor_enrolled_at from staff_account where id = ${person.id}`)[0].factor_enrolled_at).toBeNull();

    expect(await verify(device, codeFor(person.authUserId))).toEqual({ ok: true, value: { gate: "hub" } });

    expect(await current(device)).toMatchObject({ staffId: person.id, gate: "hub", aal: "aal2" });
    expect((await owner`select factor_enrolled_at from staff_account where id = ${person.id}`)[0].factor_enrolled_at).toEqual(clock);
    expect((await sessionRow(person.id)).aal2_at).toEqual(clock);
    expect(await auditOf(["factor.enrolled", "auth.signed_in"])).toEqual([
      { actor_staff_id: person.id, action: "auth.signed_in", subject_id: person.id, outcome: "ok", meta: { aal: "aal1" } },
      { actor_staff_id: person.id, action: "factor.enrolled", subject_id: person.id, outcome: "ok", meta: {} },
      { actor_staff_id: person.id, action: "auth.signed_in", subject_id: person.id, outcome: "ok", meta: { aal: "aal2" } },
    ]);
  });

  it("removes any factor made at the provider outside the app before enrolling, so it never counts", async () => {
    const person = await account("pat", "coordinator");
    idp.enrol(person.authUserId);
    const device = browser();
    expect(await signIn(device, "pat")).toMatchObject({ ok: true, gate: "enrol_authenticator" });
    expect(await current(device)).toMatchObject({ gate: "enrol_authenticator" });

    expect(await auth.startEnrolment((await current(device))!, device.sessions())).toMatchObject({ ok: true });
    expect(idp.users.get(person.authUserId)!.factors).toEqual([expect.objectContaining({ status: "unverified" })]);
    expect(await verify(device, codeFor(person.authUserId))).toEqual({ ok: true, value: { gate: "hub" } });
  });

  it("refuses a wrong code, counts it as a failed sign-in, and locks the username after 5", async () => {
    const person = await account("pat", "admin");
    const device = browser();
    await signIn(device, "pat");
    await auth.startEnrolment((await current(device))!, device.sessions());

    expect(await verify(device, "12 34")).toEqual({ ok: false, error: "code_invalid" });
    for (let attempt = 0; attempt < 5; attempt += 1) expect(await verify(device, wrongFor(person.authUserId))).toEqual({ ok: false, error: "code_invalid" });
    // Locked: even the right code is refused without asking the provider.
    expect(await verify(device, codeFor(person.authUserId))).toEqual({ ok: false, error: "code_locked" });
    expect(await current(device)).toMatchObject({ gate: "enrol_authenticator", aal: "aal1" });

    const failed = await auditOf(["auth.failed", "auth.locked"]);
    expect(failed.map((row) => [row.action, row.meta.reason ?? row.meta.lock])).toEqual([
      ["auth.failed", "validation"],
      ["auth.failed", "wrong_code"],
      ["auth.failed", "wrong_code"],
      ["auth.failed", "wrong_code"],
      ["auth.failed", "wrong_code"],
      ["auth.locked", "failed_sign_in"],
      ["auth.failed", "wrong_code"],
      ["auth.failed", "throttled"],
    ]);
    expect((await owner`select count(*)::int as n from sign_in_lock where kind = 'username'`)[0].n).toBe(1);
  });

  /** The device's sessions with verifyFactor watched: `reached` counts the codes that got to the provider; `hold` delays each. */
  function watched(device: Browser, hold: () => Promise<void> = async () => {}) {
    const real = device.sessions();
    const state = { reached: 0 };
    const sessions: typeof real = {
      ...real,
      verifyFactor: async (input) => {
        state.reached += 1;
        await hold();
        return real.verifyFactor(input);
      },
    };
    return { state, sessions };
  }

  it("refuses a right code that was being checked when the username lock started, and ends its provider session", async () => {
    const person = await account("pat", "admin");
    const device = browser();
    await signIn(device, "pat");
    await auth.startEnrolment((await current(device))!, device.sessions());
    const session = (await current(device))!;

    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const right = watched(device, () => held);
    const pending = auth.verifyAuthenticatorCode(session, { code: codeFor(person.authUserId), client: CLIENT }, right.sessions);
    await vi.waitFor(() => expect(right.state.reached).toBe(1));

    // The username lock starts while the right code is inside the provider.
    await owner`insert into sign_in_lock (kind, key_hash, locked_until) values ('username', ${throttleHash(THROTTLE_KEY, "username", "pat")}, ${new Date(clock.getTime() + 900_000)})`;
    release();

    expect(await pending).toEqual({ ok: false, error: "code_locked" });
    expect(device.cookies.has(MEMORY_SESSION_COOKIE)).toBe(false);
    expect((await owner`select factor_enrolled_at from staff_account where id = ${person.id}`)[0].factor_enrolled_at).toBeNull();
    expect((await sessionRow(person.id)).aal2_at).toBeNull();
    expect((await auditOf(["auth.failed"])).at(-1)).toMatchObject({ meta: { reason: "throttled" } });
  });

  it("refuses a right code held in the provider while 5 wrong codes run, however they interleave", async () => {
    const person = await account("pat", "admin");
    const device = browser();
    await signIn(device, "pat");
    await auth.startEnrolment((await current(device))!, device.sessions());
    const session = (await current(device))!;

    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const right = watched(device, () => held);
    const pending = auth.verifyAuthenticatorCode(session, { code: codeFor(person.authUserId), client: CLIENT }, right.sessions);
    await vi.waitFor(() => expect(right.state.reached).toBe(1));
    const wrong = await Promise.all(
      Array.from({ length: 5 }, () => auth.verifyAuthenticatorCode(session, { code: wrongFor(person.authUserId), client: CLIENT }, device.sessions())),
    );
    expect(wrong.every((result) => !result.ok)).toBe(true);
    release();

    expect(await pending).toEqual({ ok: false, error: "code_locked" });
    expect((await sessionRow(person.id)).aal2_at).toBeNull();
  });

  it("lets at most 5 codes per username reach the provider when wrong codes are fired in parallel", async () => {
    const person = await account("pat", "admin");
    const device = browser();
    await signIn(device, "pat");
    await auth.startEnrolment((await current(device))!, device.sessions());
    const session = (await current(device))!;

    const seen = watched(device, () => new Promise((resolve) => setTimeout(resolve, 100)));
    const results = await Promise.all(
      Array.from({ length: 8 }, () => auth.verifyAuthenticatorCode(session, { code: wrongFor(person.authUserId), client: CLIENT }, seen.sessions)),
    );
    expect(seen.state.reached).toBe(5);
    expect(results.filter((result) => !result.ok && result.error === "code_invalid")).toHaveLength(5);
    expect(results.filter((result) => !result.ok && result.error === "code_locked")).toHaveLength(3);
    expect((await owner`select count(*)::int as n from sign_in_failure`)[0].n).toBe(5);
    expect((await owner`select count(*)::int as n from sign_in_lock where kind = 'username'`)[0].n).toBe(1);
    expect(await auditOf(["auth.locked"])).toHaveLength(1);
    // Locked: even the right code is refused.
    expect(await verify(device, codeFor(person.authUserId))).toEqual({ ok: false, error: "code_locked" });
  });

  it("does not count a right code as a failure, so 4 wrong codes and a right one still sign in", async () => {
    const person = await account("pat", "admin");
    const device = browser();
    await signIn(device, "pat");
    await auth.startEnrolment((await current(device))!, device.sessions());
    for (let attempt = 0; attempt < 4; attempt += 1) expect(await verify(device, wrongFor(person.authUserId))).toEqual({ ok: false, error: "code_invalid" });
    expect(await verify(device, codeFor(person.authUserId))).toEqual({ ok: true, value: { gate: "hub" } });
    expect((await owner`select count(*)::int as n from sign_in_failure`)[0].n).toBe(4);
    expect((await owner`select count(*)::int as n from sign_in_lock`)[0].n).toBe(0);
  });

  it("does not take a code from someone who is not at a code gate", async () => {
    const person = await account("amb", "ambassador");
    const device = browser();
    expect(await signIn(device, "amb")).toMatchObject({ ok: true, gate: "hub" });
    const session = (await current(device))!;
    expect(await auth.startEnrolment(session, device.sessions())).toEqual({ ok: false, error: "not_required" });
    expect(await auth.verifyAuthenticatorCode(session, { code: "123456", client: CLIENT }, device.sessions())).toEqual({ ok: false, error: "not_required" });
    expect(idp.users.get(person.authUserId)!.authenticatorEnrolled).toBe(false);
  });

  it("does not keep a raised session whose account was revoked while the code was checked", async () => {
    const person = await account("pat", "coordinator");
    const device = browser();
    await signIn(device, "pat");
    const session = (await current(device))!;
    await auth.startEnrolment(session, device.sessions());
    await owner`update staff_session set revoked_at = now() where staff_account_id = ${person.id}`;

    expect(await auth.verifyAuthenticatorCode(session, { code: codeFor(person.authUserId), client: CLIENT }, device.sessions())).toEqual({ ok: false, error: "not_required" });
    expect((await owner`select factor_enrolled_at from staff_account where id = ${person.id}`)[0].factor_enrolled_at).toBeNull();
    expect(device.cookies.has(MEMORY_SESSION_COOKIE)).toBe(false);
  });

  it("ends bootstrap when the second Admin's enrolment makes them usable", async () => {
    const first = await account("admin1", "admin", { enrolled: true });
    const second = await account("admin2", "admin");
    await owner`insert into staff_bootstrap (first_admin_id, second_admin_id) values (${first.id}, ${second.id})`;
    const device = browser();
    await signIn(device, "admin2");
    await auth.startEnrolment((await current(device))!, device.sessions());
    expect(await verify(device, codeFor(second.authUserId))).toEqual({ ok: true, value: { gate: "hub" } });

    expect((await owner`select completed_at from staff_bootstrap`)[0].completed_at).not.toBeNull();
    expect(await auditOf(["bootstrap.completed"])).toHaveLength(1);
  });
});

describe("the sign-in code of an enrolled Admin or Coordinator", () => {
  it.each(["admin", "coordinator"] as const)("asks a %s for one code after the password, then keeps the session aal2 for its 12 hours", async (role) => {
    const person = await account("pat", role, { enrolled: true });
    const device = browser();
    expect(await signIn(device, "pat")).toEqual({ ok: true, staffId: person.id, gate: "authenticator_code" });
    expect(await current(device)).toMatchObject({ gate: "authenticator_code", aal: "aal1" });
    // The code gate takes no enrolment.
    expect(await auth.startEnrolment((await current(device))!, device.sessions())).toEqual({ ok: false, error: "not_required" });

    expect(await verify(device, codeFor(person.authUserId))).toEqual({ ok: true, value: { gate: "hub" } });
    for (const later of [hours(1), hours(10)]) {
      advance(later - (clock.getTime() - T0.getTime()));
      expect(await current(device)).toMatchObject({ gate: "hub", aal: "aal2" });
    }
    advance(hours(2));
    expect(await current(device)).toBeNull();
    expect(await auditOf(["factor.enrolled"])).toEqual([]);
  });

  it("does not count a session raised to aal2 at the provider directly, outside the app", async () => {
    const person = await account("pat", "admin", { enrolled: true });
    const device = browser();
    await signIn(device, "pat");
    idp.raiseOutsideApp(device.cookies.get(MEMORY_SESSION_COOKIE)!);

    expect(await device.sessions().currentUser()).toMatchObject({ aal: "aal2" });
    expect(await current(device)).toMatchObject({ gate: "authenticator_code", aal: "aal1" });
    expect((await sessionRow(person.id)).aal2_at).toBeNull();
  });

  it("does not count an aal2 mark on a session whose token is aal1 (the provider's verified claim is needed too)", async () => {
    const person = await account("pat", "coordinator", { enrolled: true });
    const device = browser();
    await signIn(device, "pat");
    await owner`update staff_session set aal2_at = now() where staff_account_id = ${person.id}`;

    expect(await current(device)).toMatchObject({ gate: "authenticator_code", aal: "aal1" });
  });

  it.each(["ambassador", "director"] as const)("asks a %s for no code: the Hub at aal1", async (role) => {
    await account("pat", role);
    const device = browser();
    expect(await signIn(device, "pat")).toMatchObject({ ok: true, gate: "hub" });
    expect(await current(device)).toMatchObject({ gate: "hub", aal: "aal1" });
  });
});

describe("a role change to Admin or Coordinator", () => {
  it("revokes every session and makes someone without an authenticator enrol one before using the new role", async () => {
    const { first } = await twoAdmins();
    const person = await account("dee", "director");
    const device = browser();
    expect(await signIn(device, "dee")).toMatchObject({ ok: true, gate: "hub" });

    expect(await accounts.changeRole(first.id, person.id, "admin")).toEqual({ ok: true, value: undefined });
    expect(await current(device)).toBeNull();
    expect((await auditOf(["session.revoked"])).map((row) => row.meta)).toEqual([{ cause: "role_changed", sessions: 1 }]);

    const again = browser();
    expect(await signIn(again, "dee")).toMatchObject({ ok: true, gate: "enrol_authenticator" });
  });

  it("clears an authenticator kept from an earlier authenticator role when the person comes back to one", async () => {
    const { first } = await twoAdmins();
    const person = await account("cora", "coordinator", { enrolled: true });
    expect(await accounts.changeRole(first.id, person.id, "director")).toMatchObject({ ok: true });
    expect(await accounts.changeRole(first.id, person.id, "coordinator")).toMatchObject({ ok: true });

    expect(await signIn(browser(), "cora")).toMatchObject({ ok: true, gate: "enrol_authenticator" });
  });

  it.each(["admin", "coordinator"] as const)("clears the factor flag before the role changes when promoting an Ambassador to %s", async (role) => {
    const { first } = await twoAdmins();
    const person = await account("amy", "ambassador");
    // A stale flag, kept from an earlier authenticator role.
    await owner`update staff_account set factor_enrolled_at = now() where id = ${person.id}`;
    // Fails any write that leaves a new Admin or Coordinator with the flag set: that account would be usable for an instant.
    await owner.unsafe(`
      create function test_no_stale_flag() returns trigger language plpgsql as $fn$
      begin
        if new.role in ('admin', 'coordinator') and new.factor_enrolled_at is not null and old.role not in ('admin', 'coordinator') then
          raise exception 'stale factor flag on a new authenticator role';
        end if;
        return new;
      end $fn$;
      create trigger test_no_stale_flag before update on staff_account for each row execute function test_no_stale_flag();`);
    try {
      expect(await accounts.changeRole(first.id, person.id, role)).toEqual({ ok: true, value: undefined });
    } finally {
      await owner.unsafe("drop trigger test_no_stale_flag on staff_account; drop function test_no_stale_flag();");
    }
    expect((await owner`select role, factor_enrolled_at from staff_account where id = ${person.id}`)[0]).toEqual({ role, factor_enrolled_at: null });
  });

  it("asks a Coordinator made Admin, who has an authenticator, for its code at next sign-in", async () => {
    const { first } = await twoAdmins();
    const person = await account("cora", "coordinator", { enrolled: true });
    const device = browser();
    await signIn(device, "cora");
    await verify(device, codeFor(person.authUserId));

    expect(await accounts.changeRole(first.id, person.id, "admin")).toMatchObject({ ok: true });
    expect(await current(device)).toBeNull();
    expect(await signIn(browser(), "cora")).toMatchObject({ ok: true, gate: "authenticator_code" });
  });
});

describe("the two-Admin trigger sees the authenticator (factor_enrolled_at)", () => {
  /** Runs `body` as cvh_app_login in its own transaction on its own connection. */
  async function asApp<T>(body: (tx: ReturnType<typeof connect>) => Promise<T>): Promise<T> {
    const sql = connect(appUrl);
    try {
      return (await sql.begin((tx) => body(tx as unknown as ReturnType<typeof connect>))) as T;
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  it("does not count an Admin without one, so it refuses demoting either of the two enrolled Admins", async () => {
    const { first, second } = await twoAdmins();
    await account("admin3", "admin");

    await expect(asApp((tx) => tx`update staff_account set role = 'coordinator' where id = ${second.id}`)).rejects.toMatchObject({ constraint_name: "staff_account_two_usable_admins" });
    await expect(asApp((tx) => tx`update staff_account set status = 'suspended' where id = ${first.id}`)).rejects.toMatchObject({ constraint_name: "staff_account_two_usable_admins" });
  });

  it("lets an Admin without one be changed: it was not usable", async () => {
    await twoAdmins();
    const third = await account("admin3", "admin");

    await asApp((tx) => tx`update staff_account set role = 'coordinator' where id = ${third.id}`);
    expect((await owner`select role from staff_account where id = ${third.id}`)[0].role).toBe("coordinator");
  });

  it("counts a third enrolled Admin, so one of three can go", async () => {
    const { second } = await twoAdmins();
    await account("admin3", "admin", { enrolled: true });

    await asApp((tx) => tx`update staff_account set role = 'coordinator' where id = ${second.id}`);
    expect((await owner`select role from staff_account where id = ${second.id}`)[0].role).toBe("coordinator");
  });
});

describe("the authenticator reset hook (for S01.11)", () => {
  function factorReset() {
    const now = () => clock;
    return createFactorReset({
      db: app,
      store: drizzleStaffStore,
      idp,
      audit,
      log: stdoutOperationalLog,
      beginAdminRecovery: createAdminRecovery({ store: drizzleStaffStore, idp, now, signInLockedUntil: async () => null }).beginAdminRecovery,
      revocation: createSessionRevocation({ store: drizzleStaffStore, sessions: drizzleStaffSessionStore, audit, now }),
    });
  }

  it("removes the factor, revokes every session, audits factor.reset with admin_shortfall, and the next sign-in enrols again", async () => {
    const { first, second } = await twoAdmins();
    const device = browser();
    await signIn(device, "admin2");
    await verify(device, codeFor(second.authUserId));

    expect(await factorReset().resetFactor({ staffId: second.id, actorStaffId: first.id, cause: "lost_device" })).toEqual({ ok: true, value: { adminShortfall: true, providerCleared: true } });

    expect(await current(device)).toBeNull();
    expect(idp.users.get(second.authUserId)!.authenticatorEnrolled).toBe(false);
    expect((await owner`select factor_enrolled_at from staff_account where id = ${second.id}`)[0].factor_enrolled_at).toBeNull();
    expect(await auditOf(["factor.reset", "session.revoked"])).toEqual([
      { actor_staff_id: first.id, action: "session.revoked", subject_id: second.id, outcome: "ok", meta: { cause: "factor_reset", sessions: 1 } },
      { actor_staff_id: first.id, action: "factor.reset", subject_id: second.id, outcome: "ok", meta: { recovery: "lost_device", admin_shortfall: true } },
    ]);
    expect(await accounts.adminShortfallBanner(first.id)).toBe(true);
    expect(await signIn(browser(), "admin2")).toMatchObject({ ok: true, gate: "enrol_authenticator" });
  });

  it("carries no shortfall when two usable Admins remain", async () => {
    const { first } = await twoAdmins();
    const third = await account("admin3", "admin", { enrolled: true });

    expect(await factorReset().resetFactor({ staffId: third.id, actorStaffId: first.id, cause: "lost_device" })).toEqual({ ok: true, value: { adminShortfall: false, providerCleared: true } });
    expect((await auditOf(["factor.reset"]))[0].meta).toEqual({ recovery: "lost_device" });
  });
});
