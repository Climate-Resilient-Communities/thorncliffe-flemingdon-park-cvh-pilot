// Staff session limits and revocation against a real database (S01.08): the Ambassador's idle
// limit and everyone's 12-hour limit on an injected clock, revocation by suspension, removal, role
// change and an Admin's password reset seen on the next request of a second device, the reset
// itself (a recovery action for an Admin) and a reset racing a sign-in with the old password. The
// app writes with its own credentials (cvh_app_login); Supabase Auth is the in-memory fake.
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import {
  createIdentity,
  createStaffAuth,
  pepperPassword,
  type AuthSessions,
  type CookieJar,
  type IdentityService,
  type StaffAuthService,
} from "../../src/modules/identity";
import { memoryIdentityProvider, type MemoryIdentityProvider } from "../../src/modules/identity/adapters/memoryIdentityProvider";
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
const T0 = new Date("2026-10-05T08:00:00Z");
const minutes = (n: number) => n * 60_000;
const hours = (n: number) => n * 3_600_000;
const advance = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};

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

/** A device: its cookies across requests. */
function device() {
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
  return { cookies, sessions: (): AuthSessions => idp.sessions(jar) };
}
type Device = ReturnType<typeof device>;

let nextId = 1;
/** As the owner: an account on its own password (enrolled), like S01.05 and S01.07 leave it. */
async function account(username: string, role: "ambassador" | "coordinator" | "director" | "admin", own = `${username} own password`): Promise<string> {
  const authUserId = idp.plant(`${username}@staff.cvh.invalid`, { password: peppered(own) });
  idp.enrol(authUserId);
  const id = `01900000-0000-7000-8000-${String(nextId++).padStart(12, "0")}`;
  await owner`
    insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password, factor_enrolled_at)
    values (${id}, ${authUserId}, ${username}, 'Ann', 'Okafor', 'someone@example.org', ${role}, false, now())`;
  return id;
}

/** Three usable Admins and a completed bootstrap: account changes are allowed. */
async function admins(): Promise<string[]> {
  const ids = [await account("admina", "admin"), await account("adminb", "admin"), await account("adminc", "admin")];
  await owner`insert into staff_bootstrap (first_admin_id, second_admin_id, completed_at) values (${ids[0]}, ${ids[1]}, now())`;
  return ids;
}

const signIn = async (who: Device, username: string, password = `${username} own password`) =>
  auth.signIn(who.sessions(), { username, password, client: "203.0.113.7" });
const request = (who: Device) => auth.currentSession(who.sessions());
const audits = (action: string) => owner`select actor_staff_id, subject_id, outcome, meta from audit_event where id > ${auditBaseline} and action = ${action} order by id`;
const sessionRows = (staffId: string) => owner`select created_at, last_seen_at, revoked_at from staff_session where staff_account_id = ${staffId} order by created_at`;

describe("session limits", () => {
  it("signs an Ambassador out after 30 minutes with no request, counted from the last one", async () => {
    const id = await account("aokafor", "ambassador");
    const phone = device();
    expect((await signIn(phone, "aokafor")).ok).toBe(true);

    advance(minutes(29));
    expect(await request(phone)).toMatchObject({ staffId: id });
    expect((await sessionRows(id))[0].last_seen_at).toEqual(clock);
    advance(minutes(29));
    expect(await request(phone)).toMatchObject({ staffId: id });

    advance(minutes(30));
    expect(await request(phone)).toBeNull();
    // Ended for good: revoked in the app, ended at the provider, the cookie cleared.
    expect((await sessionRows(id))[0].revoked_at).toEqual(clock);
    expect(phone.cookies.size).toBe(0);
    expect(idp.sessionTokens.size).toBe(0);
    advance(-minutes(30));
    expect(await request(phone)).toBeNull();
  });

  it("writes the last activity at most once a minute", async () => {
    const id = await account("aokafor", "ambassador");
    const phone = device();
    await signIn(phone, "aokafor");

    advance(30_000);
    await request(phone);
    expect((await sessionRows(id))[0].last_seen_at).toEqual(T0);
    advance(31_000);
    await request(phone);
    expect((await sessionRows(id))[0].last_seen_at).toEqual(clock);
  });

  it("signs an Ambassador out 12 hours after sign-in however active", async () => {
    const id = await account("aokafor", "ambassador");
    const phone = device();
    await signIn(phone, "aokafor");
    for (let elapsed = 0; elapsed < hours(12) - minutes(20); elapsed += minutes(20)) {
      advance(minutes(20));
      expect(await request(phone), `${elapsed}`).toMatchObject({ staffId: id });
    }
    advance(minutes(20));
    expect(await request(phone)).toBeNull();
  });

  it.each(["coordinator", "director", "admin"] as const)("never idles a %s out, and signs them out 12 hours after sign-in", async (role) => {
    if (role === "admin") await admins();
    const id = await account("cmensah", role);
    const laptop = device();
    expect((await signIn(laptop, "cmensah")).ok).toBe(true);

    advance(hours(12) - 1);
    expect(await request(laptop)).toMatchObject({ staffId: id, role });
    advance(1);
    expect(await request(laptop)).toBeNull();
  });
});

describe("revocation", () => {
  it.each([
    ["suspension", (actor: string, target: string) => accounts.suspendAccount(actor, target), "suspended"],
    ["removal", (actor: string, target: string) => accounts.removeAccount(actor, target), "removed"],
    ["role change", (actor: string, target: string) => accounts.changeRole(actor, target, "director"), "role_changed"],
  ])("ends the account's sessions on every device at its next request after a %s, audited", async (_, change, cause) => {
    const [adminA] = await admins();
    const id = await account("aokafor", "ambassador");
    const phone = device();
    const laptop = device();
    await signIn(phone, "aokafor");
    await signIn(laptop, "aokafor");
    expect(await request(phone)).not.toBeNull();

    expect(await change(adminA, id)).toEqual({ ok: true, value: undefined });

    // The provider still accepts both sessions: only the app's revocation refuses them.
    expect(idp.sessionTokens.size).toBe(2);
    expect(await request(laptop)).toBeNull();
    expect(await request(phone)).toBeNull();
    expect(await audits("session.revoked")).toEqual([{ actor_staff_id: adminA, subject_id: id, outcome: "ok", meta: { cause, sessions: 2 } }]);
    expect((await sessionRows(id)).every((row) => row.revoked_at !== null)).toBe(true);
  });

  it("lets the person sign in again after a role change, with the new role", async () => {
    const [adminA] = await admins();
    const id = await account("aokafor", "ambassador");
    const phone = device();
    await signIn(phone, "aokafor");
    await accounts.changeRole(adminA, id, "director");

    expect(await request(phone)).toBeNull();
    expect((await signIn(phone, "aokafor")).ok).toBe(true);
    expect(await request(phone)).toMatchObject({ staffId: id, role: "director" });
  });
});

describe("an Admin's Reset password", () => {
  it("issues a new starting password for 24 hours, ends every session and audits password.reset", async () => {
    const [adminA] = await admins();
    const id = await account("aokafor", "ambassador");
    const phone = device();
    const laptop = device();
    await signIn(phone, "aokafor");
    await signIn(laptop, "aokafor");

    expect(await accounts.resetPassword(adminA, "aokafor")).toEqual({ ok: true, value: { username: "aokafor", startingPassword: "rvh-ann-okafor" } });

    expect(await request(phone)).toBeNull();
    expect(await request(laptop)).toBeNull();
    const [state] = await owner`select status, must_change_password, starting_password_issued_at, starting_password_used_at from staff_account where id = ${id}`;
    expect(state).toEqual({ status: "active", must_change_password: true, starting_password_issued_at: clock, starting_password_used_at: null });
    expect(await audits("password.reset")).toEqual([{ actor_staff_id: adminA, subject_id: id, outcome: "ok", meta: {} }]);
    expect(await audits("session.revoked")).toEqual([{ actor_staff_id: adminA, subject_id: id, outcome: "ok", meta: { cause: "password_reset", sessions: 2 } }]);

    // The old password no longer works; the starting password does, once, at gate 1.
    expect(await signIn(device(), "aokafor")).toEqual({ ok: false, error: "sign_in_failed" });
    expect(await signIn(phone, "aokafor", "rvh-ann-okafor")).toEqual({ ok: true, staffId: id, gate: "choose_password" });
    advance(hours(24));
    expect(await signIn(device(), "aokafor", "rvh-ann-okafor")).toEqual({ ok: false, error: "starting_password_expired" });
  });

  it("resets an Admin's password even when it leaves fewer than two usable Admins (recovery), audited admin_shortfall", async () => {
    const adminA = await account("admina", "admin");
    const adminB = await account("adminb", "admin");
    await owner`insert into staff_bootstrap (first_admin_id, second_admin_id, completed_at) values (${adminA}, ${adminB}, now())`;

    expect((await accounts.resetPassword(adminA, "adminb")).ok).toBe(true);

    expect(await audits("password.reset")).toEqual([{ actor_staff_id: adminA, subject_id: adminB, outcome: "ok", meta: { admin_shortfall: true } }]);
    expect(await accounts.adminShortfallBanner(adminA)).toBe(true);
  });

  it("refuses an Admin's own account and anyone but an Admin", async () => {
    const [adminA] = await admins();
    await account("cmensah", "coordinator");

    expect(await accounts.resetPassword(adminA, "admina")).toEqual({ ok: false, error: "self_action" });
    expect(await accounts.resetPassword((await owner`select id from staff_account where username = 'cmensah'`)[0].id, "admina")).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect((await audits("password.reset")).map((record) => record.outcome)).toEqual(["refused", "refused"]);
  });

  it("never lets a password checked before the reset open a session after it", async () => {
    const [adminA] = await admins();
    const id = await account("aokafor", "ambassador");
    // The sign-in checks the old password at the provider, then the reset runs to the end, then
    // the sign-in tries to keep its session.
    let resetDone!: () => void;
    const afterReset = new Promise<void>((resolve) => (resetDone = resolve));
    let checked!: () => void;
    const passwordChecked = new Promise<void>((resolve) => (checked = resolve));
    const thief = device();
    const slowCheck: AuthSessions = {
      ...thief.sessions(),
      checkPassword: async (input) => {
        const result = await thief.sessions().checkPassword(input);
        checked();
        await afterReset;
        return result;
      },
    };

    const signingIn = auth.signIn(slowCheck, { username: "aokafor", password: "aokafor own password", client: "198.51.100.4" });
    await passwordChecked;
    expect((await accounts.resetPassword(adminA, "aokafor")).ok).toBe(true);
    resetDone();

    expect(await signingIn).toEqual({ ok: false, error: "sign_in_failed" });
    expect(thief.cookies.size).toBe(0);
    expect(await sessionRows(id)).toEqual([]);
    expect((await owner`select starting_password_used_at from staff_account where id = ${id}`)[0].starting_password_used_at).toBeNull();
    // Not counted as a failed attempt: the person can use the new starting password at once.
    expect((await signIn(device(), "aokafor", "rvh-ann-okafor")).ok).toBe(true);
  });

  it("leaves no usable old-password session when resets and sign-ins run concurrently", async () => {
    const [adminA] = await admins();
    await account("aokafor", "ambassador");
    for (let round = 0; round < 4; round += 1) {
      await owner`delete from sign_in_failure`;
      await owner`delete from sign_in_lock`;
      await owner`update staff_account set must_change_password = false, starting_password_issued_at = null, starting_password_used_at = null where username = 'aokafor'`;
      const authUserId = (await owner`select auth_user_id from staff_account where username = 'aokafor'`)[0].auth_user_id as string;
      await idp.setPassword(authUserId, peppered("aokafor own password"));
      const devices = [device(), device()];

      await Promise.all([...devices.map((who) => signIn(who, "aokafor")), accounts.resetPassword(adminA, "aokafor")]);

      for (const who of devices) expect(await request(who), `round ${round}`).toBeNull();
    }
  });
});

describe("an Admin's Reset password racing the person's \"Choose your password\" (S01.07 serialisation, S01.08)", () => {
  const START = "rvh-ann-okafor";
  const OWN = "a long new password";

  /** An account still on its starting password (gate 1), issued at the clock's time. */
  async function onStartingPassword(username: string): Promise<{ id: string; authUserId: string }> {
    const authUserId = idp.plant(`${username}@staff.cvh.invalid`, { password: peppered(START) });
    const id = `01900000-0000-7000-8000-${String(nextId++).padStart(12, "0")}`;
    await owner`
      insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password, starting_password_issued_at)
      values (${id}, ${authUserId}, ${username}, 'Ann', 'Okafor', 'someone@example.org', 'ambassador', true, ${clock})`;
    return { id, authUserId };
  }

  /** Services over a provider whose setPassword, once it has answered for a password `matches` accepts, waits for release(). */
  function pausingProvider(matches: (password: string) => boolean) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const paused = new Promise<void>((resolve) => (reached = resolve));
    const provider: MemoryIdentityProvider = {
      ...idp,
      setPassword: async (authUserId, password) => {
        const result = await idp.setPassword(authUserId, password);
        if (matches(password)) {
          reached();
          await gate;
        }
        return result;
      },
    };
    const wiring = { db: app, idp: provider, throttleKey: THROTTLE_KEY, passwordPepper: PEPPER, now: () => clock, sleep: async () => {}, monotonicMs: () => 0 };
    const raced = createIdentity(wiring);
    return { paused, release, accounts: raced, auth: createStaffAuth({ ...wiring, accounts: raced }) };
  }

  /** Resolves once some transaction waits for a row lock. */
  async function lockWaiter(): Promise<void> {
    const watcher = connect(serverUrl());
    try {
      for (let attempt = 0; attempt < 400; attempt += 1) {
        const [{ waiting }] = await watcher`select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`;
        if (waiting > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error("no transaction ever waited for a lock");
    } finally {
      await watcher.end({ timeout: 5 });
    }
  }

  const stateOf = async (id: string) =>
    (await owner`select status, must_change_password, starting_password_issued_at, starting_password_used_at from staff_account where id = ${id}`)[0];
  const providerPassword = (authUserId: string) => idp.users.get(authUserId)!.password;

  it("holds the reset until the person's change has finished, then the reset wins: provider and database both on the starting password with a fresh window", async () => {
    const [adminA] = await admins();
    const { id, authUserId } = await onStartingPassword("aokafor");
    const race = pausingProvider((password) => password === peppered(OWN));

    // The person's call reaches the provider and stops there, holding the account's lock.
    const changing = race.auth.changePassword(id, { password: OWN, confirm: OWN });
    await race.paused;
    // The Admin's reset starts meanwhile and has to wait for that lock.
    const resetting = race.accounts.resetPassword(adminA, "aokafor");
    await lockWaiter();
    advance(minutes(5));
    race.release();

    expect(await changing).toMatchObject({ ok: true });
    expect(await resetting).toEqual({ ok: true, value: { username: "aokafor", startingPassword: START } });
    // Never "own password chosen" in the database with the starting password at the provider.
    expect(providerPassword(authUserId)).toBe(peppered(START));
    expect(await stateOf(id)).toEqual({ status: "active", must_change_password: true, starting_password_issued_at: clock, starting_password_used_at: null });
    expect(await signIn(device(), "aokafor", OWN)).toEqual({ ok: false, error: "sign_in_failed" });
    expect(await signIn(device(), "aokafor", START)).toMatchObject({ ok: true, gate: "choose_password" });
    advance(hours(23));
    expect(await signIn(device(), "aokafor", START)).toEqual({ ok: false, error: "starting_password_expired" });
  });

  it("refuses the person's change while the reset is between its provider call and its second transaction", async () => {
    // The opposite interleaving: the reset has set the starting password at the provider and has
    // not yet made the account active again when the person submits.
    const [adminA] = await admins();
    const { id, authUserId } = await onStartingPassword("aokafor");
    const race = pausingProvider((password) => password === peppered(START));

    const resetting = race.accounts.resetPassword(adminA, "aokafor");
    await race.paused;
    expect(await race.auth.changePassword(id, { password: OWN, confirm: OWN })).toEqual({ ok: false, error: "not_required" });
    race.release();

    expect(await resetting).toMatchObject({ ok: true });
    expect(providerPassword(authUserId)).toBe(peppered(START));
    expect(await stateOf(id)).toEqual({ status: "active", must_change_password: true, starting_password_issued_at: clock, starting_password_used_at: null });
    expect(await signIn(device(), "aokafor", START)).toMatchObject({ ok: true, gate: "choose_password" });
  });

  it("refuses the person's change when a reset finished after the request read the account, even in the same millisecond", async () => {
    const { id, authUserId } = await onStartingPassword("aokafor");

    // The request reads the account, then waits for its lock, which another transaction holds
    // while it does what a finished reset does: same starting password, same clock, one more revocation.
    let changing!: ReturnType<StaffAuthService["changePassword"]>;
    await owner.begin(async (tx) => {
      await tx`select 1 from staff_account where id = ${id} for update`;
      changing = auth.changePassword(id, { password: OWN, confirm: OWN });
      await lockWaiter();
      await tx`update staff_account set session_generation = session_generation + 1, starting_password_issued_at = ${clock} where id = ${id}`;
    });

    expect(await changing).toEqual({ ok: false, error: "not_required" });
    expect(providerPassword(authUserId)).toBe(peppered(START));
    expect(await stateOf(id)).toMatchObject({ status: "active", must_change_password: true });
  });

  it("counts a revocation when an Admin re-issues a starting password, and when IT re-issues the first Admin's", async () => {
    const [adminA, adminB] = await admins();
    const { id } = await onStartingPassword("aokafor");
    await owner`update staff_account set status = 'locked_pending_reissue' where id = ${id}`;
    const generation = async (staffId: string) => (await owner`select session_generation from staff_account where id = ${staffId}`)[0].session_generation as number;

    const before = await generation(id);
    expect((await auth.reissueStartingPassword(adminA, "aokafor")).ok).toBe(true);
    expect(await generation(id)).toBe(before + 1);

    // The first Admin, still on a starting password while bootstrap is in progress.
    await owner.begin(async (tx) => {
      await tx.unsafe("alter table staff_bootstrap disable trigger staff_bootstrap_forward_only");
      await tx`delete from staff_bootstrap`;
      await tx`update staff_account set must_change_password = true, starting_password_issued_at = ${clock} where id = ${adminA}`;
      await tx`insert into staff_bootstrap (first_admin_id) values (${adminA})`;
      await tx.unsafe("alter table staff_bootstrap enable trigger staff_bootstrap_forward_only");
    });
    const first = await generation(adminA);
    expect((await auth.reissueFirstAdminStartingPassword("admina")).ok).toBe(true);
    expect(await generation(adminA)).toBe(first + 1);
    expect(adminB).toBeTruthy();
  });
});
