// Staff sign-in against a real database (S01.07): the starting password's one use and 24-hour
// window, the password change, re-issue, the failed-sign-in throttle (with concurrent failures),
// the session lookup and the throttle tables' lockdown. The app writes with its own credentials
// (cvh_app_login); Supabase Auth is the in-memory fake.
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { createIdentity, createStaffAuth, type CookieJar, type IdentityService, type StaffAuthService } from "../../src/modules/identity";
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
const T0 = new Date("2026-10-05T14:00:00Z");
const minutes = (n: number) => n * 60_000;
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
  const now = () => clock;
  accounts = createIdentity({ db: app, idp, throttleKey: THROTTLE_KEY, now });
  auth = createStaffAuth({ db: app, idp, throttleKey: THROTTLE_KEY, now, accounts });
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
  return { cookies, sessions: () => idp.sessions(jar) };
}

interface Person {
  username: string;
  firstName: string;
  lastName: string;
  role?: "ambassador" | "coordinator" | "director" | "admin";
  /** The person's own password; without it the account is on its starting password. */
  own?: string;
  status?: "active" | "locked_pending_reissue" | "suspended" | "removed";
  enrolled?: boolean;
}

let nextId = 1;
/** As the owner: an account and its login, like S01.05 makes them. Returns the staff id. */
async function account(person: Person): Promise<string> {
  const starting = `rvh-${person.firstName.toLowerCase()}-${person.lastName.toLowerCase()}`;
  const authUserId = idp.plant(`${person.username}@staff.cvh.invalid`, { password: person.own ?? starting });
  if (person.enrolled) idp.enrol(authUserId);
  const id = `01900000-0000-7000-8000-${String(nextId++).padStart(12, "0")}`;
  await owner`
    insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, status, must_change_password, starting_password_issued_at)
    values (${id}, ${authUserId}, ${person.username}, ${person.firstName}, ${person.lastName}, 'someone@example.org', ${person.role ?? "ambassador"},
            ${person.status ?? "active"}, ${person.own === undefined}, ${person.own === undefined ? clock : null})`;
  return id;
}

const ann = { username: "aokafor", firstName: "Ann", lastName: "Okafor" };
const ANN_START = "rvh-ann-okafor";
const CLIENT = "203.0.113.7";

const signIn = (who: ReturnType<typeof browser>, username: string, password: string, client = CLIENT) =>
  auth.signIn(who.sessions(), { username, password, client });

const row = async (id: string) =>
  (await owner`select status, must_change_password, starting_password_issued_at, starting_password_used_at from staff_account where id = ${id}`)[0];
const audits = () => owner`select actor_staff_id, action, subject_id, outcome, meta from audit_event where id > ${auditBaseline} order by id`;
const auditsOf = async (action: string) => (await audits()).filter((record) => record.action === action);

describe("signing in with a starting password", () => {
  it("opens a session at gate 1, records the one use and audits auth.signed_in", async () => {
    const id = await account(ann);
    const phone = browser();

    expect(await signIn(phone, "AOkafor ", ANN_START)).toEqual({ ok: true, staffId: id, gate: "choose_password" });

    expect(phone.cookies.size).toBe(1);
    expect((await row(id)).starting_password_used_at).toEqual(clock);
    expect(await auth.currentSession(phone.sessions())).toMatchObject({ staffId: id, username: "aokafor", role: "ambassador", gate: "choose_password" });
    expect(await audits()).toEqual([{ actor_staff_id: id, action: "auth.signed_in", subject_id: id, outcome: "ok", meta: { aal: "aal1" } }]);
  });

  it("works once: a second sign-in with it is refused as expired, without locking the account or the first session", async () => {
    const id = await account(ann);
    const first = browser();
    await signIn(first, "aokafor", ANN_START);
    const second = browser();

    expect(await signIn(second, "aokafor", ANN_START)).toEqual({ ok: false, error: "starting_password_expired" });
    expect(second.cookies.size).toBe(0);
    expect(idp.sessionTokens.size).toBe(1);
    expect((await row(id)).status).toBe("active");
    expect(await auth.currentSession(first.sessions())).toMatchObject({ staffId: id });
    expect((await auditsOf("auth.failed")).at(-1)).toMatchObject({ actor_staff_id: id, outcome: "refused", meta: { reason: "expired_starting_password" } });
  });

  it("expires 24 hours after issue: the account becomes locked_pending_reissue and auth.locked is audited, once", async () => {
    const id = await account(ann);
    advance(minutes(24 * 60));
    const phone = browser();

    expect(await signIn(phone, "aokafor", ANN_START)).toEqual({ ok: false, error: "starting_password_expired" });
    expect(phone.cookies.size).toBe(0);
    expect(idp.sessionTokens.size).toBe(0);
    expect((await row(id)).status).toBe("locked_pending_reissue");
    expect(await auditsOf("auth.locked")).toEqual([
      { actor_staff_id: null, action: "auth.locked", subject_id: id, outcome: "ok", meta: { lock: "expired_starting_password", reason: "expired_starting_password" } },
    ]);

    expect(await signIn(phone, "aokafor", ANN_START)).toEqual({ ok: false, error: "starting_password_expired" });
    expect(await auditsOf("auth.locked")).toHaveLength(1);
    expect((await auditsOf("auth.failed")).at(-1)).toMatchObject({ meta: { reason: "expired_starting_password" } });
  });

  it("is still valid a moment before 24 hours", async () => {
    await account(ann);
    advance(minutes(24 * 60) - 1);

    expect(await signIn(browser(), "aokafor", ANN_START)).toMatchObject({ ok: true, gate: "choose_password" });
  });

  it("answers a wrong password with the generic failure, never the expired message, even after expiry", async () => {
    await account(ann);
    advance(minutes(25 * 60));

    expect(await signIn(browser(), "aokafor", "rvh-ann-okafo")).toEqual({ ok: false, error: "sign_in_failed" });
  });
});

describe("choosing an own password", () => {
  it.each([
    ["short", "password_too_short"],
    ["my aokafor password", "password_contains_username"],
    ["x".repeat(73), "password_too_long"],
  ])("refuses %j with %s and audits the refusal", async (password, error) => {
    const id = await account({ ...ann, firstName: "Annabelle" });

    expect(await auth.changePassword(id, { password, confirm: password })).toEqual({ ok: false, error });
    expect((await row(id)).must_change_password).toBe(true);
    expect((await auditsOf("password.changed")).at(-1)).toMatchObject({ outcome: "refused", meta: { reason: "validation" } });
  });

  it("refuses the starting password itself, in any case", async () => {
    const id = await account({ ...ann, username: "annok", firstName: "Annabelle" });

    expect(await auth.changePassword(id, { password: "RVH-Annabelle-Okafor", confirm: "RVH-Annabelle-Okafor" })).toEqual({ ok: false, error: "password_is_starting_password" });
  });

  it("replaces it: the starting password stops working, password.changed is audited, and an Ambassador goes to the Hub", async () => {
    const id = await account(ann);
    const phone = browser();
    await signIn(phone, "aokafor", ANN_START);

    expect(await auth.changePassword(id, { password: "a long new password", confirm: "a long new password" })).toEqual({ ok: true, value: { gate: "hub" } });

    expect(await row(id)).toMatchObject({ must_change_password: false, starting_password_issued_at: null, starting_password_used_at: null });
    expect((await auditsOf("password.changed")).at(-1)).toEqual({ actor_staff_id: id, action: "password.changed", subject_id: id, outcome: "ok", meta: {} });
    expect(await auth.currentSession(phone.sessions())).toMatchObject({ gate: "hub" });
    expect(await signIn(browser(), "aokafor", ANN_START)).toEqual({ ok: false, error: "sign_in_failed" });
    expect(await signIn(browser(), "aokafor", "a long new password")).toMatchObject({ ok: true, gate: "hub" });
  });

  it.each(["coordinator", "admin"] as const)("sends a %s on to authenticator enrolment", async (role) => {
    const id = await account({ ...ann, role });
    expect(await auth.changePassword(id, { password: "a long new password", confirm: "a long new password" })).toEqual({ ok: true, value: { gate: "enrol_authenticator" } });
  });

  it("changes nothing when the provider refuses the password", async () => {
    const id = await account(ann);
    idp.failNextPassword("rejected");

    expect(await auth.changePassword(id, { password: "a long new password", confirm: "a long new password" })).toEqual({ ok: false, error: "password_rejected" });
    expect((await row(id)).must_change_password).toBe(true);
    expect(await signIn(browser(), "aokafor", ANN_START)).toMatchObject({ ok: true });
  });

  it("is refused once the starting password has been replaced", async () => {
    const id = await account({ ...ann, own: "already my own one" });
    expect(await auth.changePassword(id, { password: "a long new password", confirm: "a long new password" })).toEqual({ ok: false, error: "not_required" });
  });
});

describe("re-issuing a starting password", () => {
  async function hubAdmin() {
    const admin = await account({ username: "admin1", firstName: "Ada", lastName: "Admin", role: "admin", own: "admin password one", enrolled: true });
    const second = await account({ username: "admin2", firstName: "Bo", lastName: "Admin", role: "admin", own: "admin password two", enrolled: true });
    await owner`insert into staff_bootstrap (first_admin_id, second_admin_id, completed_at) values (${admin}, ${second}, now())`;
    return admin;
  }

  it("unlocks an expired account and starts a new 24-hour window, audited as password.reissued", async () => {
    const admin = await hubAdmin();
    const id = await account(ann);
    advance(minutes(30 * 60));
    await signIn(browser(), "aokafor", ANN_START);
    expect((await row(id)).status).toBe("locked_pending_reissue");

    expect(await auth.reissueStartingPassword(admin, "aokafor")).toEqual({ ok: true, value: { username: "aokafor", startingPassword: ANN_START } });

    expect(await row(id)).toMatchObject({ status: "active", must_change_password: true, starting_password_issued_at: clock, starting_password_used_at: null });
    expect((await auditsOf("password.reissued")).at(-1)).toEqual({ actor_staff_id: admin, action: "password.reissued", subject_id: id, outcome: "ok", meta: {} });
    advance(minutes(23 * 60));
    expect(await signIn(browser(), "aokafor", ANN_START)).toMatchObject({ ok: true, gate: "choose_password" });
  });

  it("is refused for someone with their own password, an unknown username and a non-Admin", async () => {
    const admin = await hubAdmin();
    await account({ ...ann, own: "already my own one" });
    const ambassador = await account({ username: "amb", firstName: "Al", lastName: "Bee" });

    expect(await auth.reissueStartingPassword(admin, "aokafor")).toEqual({ ok: false, error: "not_reissuable" });
    expect(await auth.reissueStartingPassword(admin, "nobody")).toEqual({ ok: false, error: "not_found" });
    expect(await auth.reissueStartingPassword(ambassador, "aokafor")).toEqual({ ok: false, error: "forbidden" });
    expect((await auditsOf("password.reissued")).map((record) => record.meta.reason)).toEqual(["conflict", "not_found", "forbidden"]);
  });
});

describe("the failed-sign-in throttle", () => {
  it("locks a username after 5 wrong passwords in 15 minutes, refuses even the right password for 15 minutes, and audits each failure", async () => {
    const id = await account({ ...ann, own: "the right password" });
    for (let i = 0; i < 5; i++) {
      expect(await signIn(browser(), "aokafor", `wrong ${i}`)).toEqual({ ok: false, error: "sign_in_failed" });
      advance(minutes(2));
    }

    const phone = browser();
    expect(await signIn(phone, "aokafor", "the right password")).toEqual({ ok: false, error: "sign_in_failed" });
    expect(phone.cookies.size).toBe(0);

    const failed = await auditsOf("auth.failed");
    expect(failed.map((record) => record.meta)).toEqual([
      { reason: "wrong_password", attempts: 1 },
      { reason: "wrong_password", attempts: 2 },
      { reason: "wrong_password", attempts: 3 },
      { reason: "wrong_password", attempts: 4 },
      { reason: "wrong_password", attempts: 5 },
      { reason: "throttled" },
    ]);
    expect(failed.every((record) => record.actor_staff_id === id && record.outcome === "refused")).toBe(true);
    expect(await auditsOf("auth.locked")).toEqual([{ actor_staff_id: null, action: "auth.locked", subject_id: id, outcome: "ok", meta: { lock: "failed_sign_in" } }]);
    expect(await accounts.completeBootstrapIfReady(id)).toBe(false);
    expect(await auth.signInLockedUntil(app, "aokafor")).toEqual(new Date(T0.getTime() + minutes(8) + minutes(15)));

    // The lock started at the fifth failure (T0 + 8 min) and lasts 15 minutes.
    clock = new Date(T0.getTime() + minutes(8) + minutes(15) - 1);
    expect(await signIn(browser(), "aokafor", "the right password")).toEqual({ ok: false, error: "sign_in_failed" });
    clock = new Date(T0.getTime() + minutes(8) + minutes(15));
    expect(await signIn(browser(), "aokafor", "the right password")).toMatchObject({ ok: true });
    expect(await auth.signInLockedUntil(app, "aokafor")).toBeNull();
  });

  it("counts only failures within 15 minutes", async () => {
    await account({ ...ann, own: "the right password" });
    for (let i = 0; i < 5; i++) {
      await signIn(browser(), "aokafor", "wrong");
      advance(minutes(4));
    }
    expect(await signIn(browser(), "aokafor", "the right password")).toMatchObject({ ok: true });
  });

  it("locks unknown usernames the same way, so the answer never shows whether a username exists", async () => {
    for (let i = 0; i < 6; i++) expect(await signIn(browser(), "ghost", "whatever")).toEqual({ ok: false, error: "sign_in_failed" });

    const failed = await auditsOf("auth.failed");
    expect(failed.map((record) => record.meta.reason)).toEqual(["unknown_username", "unknown_username", "unknown_username", "unknown_username", "unknown_username", "throttled"]);
    expect(failed.every((record) => record.actor_staff_id === null && record.subject_id === null)).toBe(true);
  });

  it("blocks a client for an hour after 20 failures in an hour, whatever the usernames, while other clients still sign in", async () => {
    await account({ ...ann, own: "the right password" });
    for (let i = 0; i < 20; i++) {
      await signIn(browser(), `guess${i}`, "whatever");
      advance(minutes(2));
    }

    expect(await signIn(browser(), "aokafor", "the right password")).toEqual({ ok: false, error: "sign_in_failed" });
    expect((await auditsOf("auth.failed")).at(-1)?.meta).toEqual({ reason: "throttled" });
    expect(await signIn(browser(), "aokafor", "the right password", "198.51.100.9")).toMatchObject({ ok: true });
    // The block started at the twentieth failure (T0 + 38 min) and lasts an hour.
    clock = new Date(T0.getTime() + minutes(38) + minutes(60));
    expect(await signIn(browser(), "aokafor", "the right password")).toMatchObject({ ok: true });
  });

  it("counts every one of many concurrent failures once, and locks at exactly one of them", async () => {
    const id = await account({ ...ann, own: "the right password" });

    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => signIn(browser(), "aokafor", `wrong ${i}`)));

    expect(results.every((result) => !result.ok && result.error === "sign_in_failed")).toBe(true);
    const failed = await auditsOf("auth.failed");
    expect(failed).toHaveLength(12);
    const counted = failed.filter((record) => record.meta.reason === "wrong_password").map((record) => record.meta.attempts as number);
    const [{ stored }] = await owner`select count(*)::int as stored from sign_in_failure`;
    expect(counted.length).toBe(stored);
    expect([...counted].sort((a, b) => a - b)).toEqual(Array.from({ length: counted.length }, (_, i) => i + 1));
    expect(counted.length).toBeGreaterThanOrEqual(5);
    expect(await auditsOf("auth.locked")).toEqual([expect.objectContaining({ subject_id: id, meta: { lock: "failed_sign_in" } })]);
    expect(await signIn(browser(), "aokafor", "the right password")).toEqual({ ok: false, error: "sign_in_failed" });
  });

  it("refuses a right password whose check raced a failure that started the lock", async () => {
    await account({ ...ann, own: "the right password" });
    for (let i = 0; i < 4; i++) await signIn(browser(), "aokafor", "wrong");

    // The fifth failure lands while the right password is being checked.
    const sessions = browser().sessions();
    const racing = {
      ...sessions,
      async checkPassword(input: { login: string; password: string }) {
        const check = await sessions.checkPassword(input);
        await signIn(browser(), "aokafor", "wrong again");
        return check;
      },
    };
    expect(await auth.signIn(racing, { username: "aokafor", password: "the right password", client: CLIENT })).toEqual({ ok: false, error: "sign_in_failed" });
    expect(idp.sessionTokens.size).toBe(0);
  });

  it("stores neither usernames nor client addresses, only keyed hashes, and deletes them after 24 hours", async () => {
    await account(ann);
    await signIn(browser(), "aokafor", "wrong");
    const rows = await owner`select username_hash, client_hash from sign_in_failure`;
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/aokafor|203\.0\.113\.7/);
    expect(rows[0].username_hash).toMatch(/^[0-9a-f]{64}$/);

    advance(minutes(24 * 60 + 1));
    await signIn(browser(), "someoneelse", "wrong", "198.51.100.9");
    expect(await owner`select count(*)::int as n from sign_in_failure`).toEqual([{ n: 1 }]);
  });
});

describe("the session lookup", () => {
  it("rejects a session whose account is no longer active, and an unknown session", async () => {
    const id = await account({ ...ann, own: "the right password" });
    const phone = browser();
    await signIn(phone, "aokafor", "the right password");
    expect(await auth.currentSession(phone.sessions())).toMatchObject({ staffId: id, gate: "hub" });

    for (const status of ["suspended", "removed"] as const) {
      await owner`update staff_account set status = ${status} where id = ${id}`;
      expect(await auth.currentSession(phone.sessions())).toBeNull();
    }
    expect(await auth.currentSession(browser().sessions())).toBeNull();
  });

  it("refuses the right password of a suspended account with the generic message", async () => {
    await account({ ...ann, own: "the right password", status: "suspended" });
    const phone = browser();

    expect(await signIn(phone, "aokafor", "the right password")).toEqual({ ok: false, error: "sign_in_failed" });
    expect(phone.cookies.size).toBe(0);
    expect(idp.sessionTokens.size).toBe(0);
    expect((await auditsOf("auth.failed")).at(-1)?.meta).toEqual({ reason: "forbidden", attempts: 1 });
  });

  it("signs out: the session ends at the provider and its cookie is cleared", async () => {
    await account({ ...ann, own: "the right password" });
    const phone = browser();
    await signIn(phone, "aokafor", "the right password");

    await auth.signOut(phone.sessions());

    expect(phone.cookies.size).toBe(0);
    expect(idp.sessionTokens.size).toBe(0);
  });

  it("reports the provider being down as unavailable, without counting a failure", async () => {
    await account(ann);
    idp.setUnavailable(true);

    expect(await signIn(browser(), "aokafor", ANN_START)).toEqual({ ok: false, error: "unavailable" });
    expect(await owner`select count(*)::int as n from sign_in_failure`).toEqual([{ n: 0 }]);
  });
});

describe("bootstrap completion", () => {
  it("does not count an Admin under a failed-sign-in lock as usable", async () => {
    const first = await account({ username: "admin1", firstName: "Ada", lastName: "Admin", role: "admin", own: "admin password one", enrolled: true });
    const second = await account({ username: "admin2", firstName: "Bo", lastName: "Admin", role: "admin", enrolled: true });
    await owner`insert into staff_bootstrap (first_admin_id, second_admin_id) values (${first}, ${second})`;
    for (let i = 0; i < 5; i++) await signIn(browser(), "admin1", "wrong");

    expect(await auth.changePassword(second, { password: "admin password two", confirm: "admin password two" })).toEqual({ ok: true, value: { gate: "hub" } });
    expect((await owner`select completed_at from staff_bootstrap`)[0].completed_at).toBeNull();

    advance(minutes(16));
    expect(await accounts.completeBootstrapIfReady(second)).toBe(true);
  });
});

describe("the two-Admin rule (S01.06)", () => {
  it("lets a failed-sign-in lock leave fewer than two usable Admins, marked admin_shortfall, and counts the locked Admin as unusable", async () => {
    const first = await account({ username: "admin1", firstName: "Ada", lastName: "Admin", role: "admin", own: "admin password one", enrolled: true });
    const second = await account({ username: "admin2", firstName: "Bo", lastName: "Admin", role: "admin", own: "admin password two", enrolled: true });
    await owner`insert into staff_bootstrap (first_admin_id, second_admin_id, completed_at) values (${first}, ${second}, now())`;
    expect(await accounts.adminShortfallBanner(second)).toBe(false);

    for (let i = 0; i < 5; i++) await signIn(browser(), "admin1", "wrong");

    expect(await auditsOf("auth.locked")).toEqual([
      { actor_staff_id: null, action: "auth.locked", subject_id: first, outcome: "ok", meta: { lock: "failed_sign_in", admin_shortfall: true } },
    ]);
    expect(await accounts.adminShortfallBanner(second)).toBe(true);
    expect(await accounts.suspendAccount(second, first)).toEqual({ ok: false, error: "two_admin_rule" });
    advance(minutes(15));
    expect(await accounts.adminShortfallBanner(second)).toBe(false);
  });
});

describe("the throttle tables", () => {
  it("are out of reach of Supabase's client roles, and the app can never rewrite a failure", async () => {
    const [privileges] = await owner`
      select has_table_privilege('anon', 'sign_in_failure', 'select') as anon_failure,
             has_table_privilege('authenticated', 'sign_in_lock', 'select') as authenticated_lock,
             has_sequence_privilege('anon', 'sign_in_failure_id_seq', 'usage') as anon_sequence,
             has_table_privilege('cvh_app_login', 'sign_in_failure', 'update') as app_update`;
    expect(privileges).toEqual({ anon_failure: false, authenticated_lock: false, anon_sequence: false, app_update: false });
    await expect(app.$client`update sign_in_failure set at = now()`).rejects.toThrow(/permission denied/);
  });
});
