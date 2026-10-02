// Staff sign-in against a real database (S01.07): the starting password's one use and 24-hour
// window, the password change, re-issue, the failed-sign-in throttle (with concurrent failures),
// the session lookup and its binding to sessions the app opened, the password pepper, the timing
// of refusals, the purge job and the tables' lockdown. The app writes with its own credentials
// (cvh_app_login); Supabase Auth is the in-memory fake.
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { runCreateFirstAdmin } from "../../scripts/identity/create-first-admin";
import {
  MIN_REFUSAL_MS,
  MEMORY_SESSION_COOKIE,
  createIdentity,
  createStaffAuth,
  pepperPassword,
  type CookieJar,
  type IdentityService,
  type IdentityWiring,
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
/** STAFF_PASSWORD_PEPPER of these tests: random per run. */
const PEPPER = randomBytes(32).toString("hex");
/** What the provider stores for a password. */
const peppered = (password: string) => pepperPassword(PEPPER, password);
/** The timing pad's waits: the fake monotonic clock stands still unless a test moves it. */
let sleeps: number[] = [];
let monotonic = 0;
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

/** The wiring of these tests; `overrides` changes it for one test. */
function wire(overrides: Partial<IdentityWiring> = {}) {
  const wiring: IdentityWiring & { throttleKey: string } = {
    db: app,
    idp,
    throttleKey: THROTTLE_KEY,
    passwordPepper: PEPPER,
    now: () => clock,
    sleep: async (ms) => void sleeps.push(ms),
    monotonicMs: () => monotonic,
    ...overrides,
  };
  const identity = createIdentity(wiring);
  return { accounts: identity, auth: createStaffAuth({ ...wiring, accounts: identity }) };
}

beforeEach(async () => {
  await reset();
  clock = T0;
  sleeps = [];
  monotonic = 0;
  idp = memoryIdentityProvider();
  ({ accounts, auth } = wire());
});

/** The operational log lines (JSON on stdout) written while `run` runs. */
async function logged(run: () => Promise<unknown>): Promise<Record<string, unknown>[]> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((line: string) => void lines.push(line));
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

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
  // As S01.05 makes them: Supabase Auth holds the peppered password.
  const authUserId = idp.plant(`${person.username}@staff.cvh.invalid`, { password: peppered(person.own ?? starting) });
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
const sessionRows = (staffId: string) =>
  owner`select id, created_at, revoked_at from staff_session where staff_account_id = ${staffId} order by revoked_at nulls last, created_at, id`;
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
    const before = await auth.currentSession(phone.sessions());
    advance(minutes(5));

    expect(await auth.changePassword(id, { password: "a long new password", confirm: "a long new password" }, { sessions: phone.sessions(), sessionId: before!.sessionId })).toEqual({
      ok: true,
      value: { gate: "hub" },
    });

    expect(await row(id)).toMatchObject({ must_change_password: false, starting_password_issued_at: null, starting_password_used_at: null });
    expect((await auditsOf("password.changed")).at(-1)).toEqual({ actor_staff_id: id, action: "password.changed", subject_id: id, outcome: "ok", meta: {} });
    // The provider ended every session on the change; this browser's was reopened, keeping its start.
    const after = await auth.currentSession(phone.sessions());
    expect(after).toMatchObject({ gate: "hub" });
    expect(after!.sessionId).not.toBe(before!.sessionId);
    expect(await sessionRows(id)).toEqual([
      { id: before!.sessionId, created_at: T0, revoked_at: clock },
      { id: after!.sessionId, created_at: T0, revoked_at: null },
    ]);
    // The provider holds the peppered password, never the typed one.
    expect(idp.findByLogin("aokafor@staff.cvh.invalid")?.[1].password).toBe(peppered("a long new password"));
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

describe("the password pepper", () => {
  it("makes a password grant at the provider with the typed password fail, while the app's sign-in works", async () => {
    await account({ ...ann, own: "the right password" });

    // Anyone with the public key can ask the provider directly: the typed password is not what it holds.
    expect(idp.grant("aokafor@staff.cvh.invalid", "the right password")).toBeNull();
    expect(idp.findByLogin("aokafor@staff.cvh.invalid")?.[1].password).toBe(peppered("the right password"));
    expect(await signIn(browser(), "aokafor", "the right password")).toMatchObject({ ok: true, gate: "hub" });
  });

  it("is applied to a starting password too: the derivable rvh-first-last does not open a provider session", async () => {
    await account(ann);

    expect(idp.grant("aokafor@staff.cvh.invalid", ANN_START)).toBeNull();
    expect(await signIn(browser(), "aokafor", ANN_START)).toMatchObject({ ok: true, gate: "choose_password" });
  });

  it("is required: without it sign-in refuses with the generic message (padded) and a password change refuses, each logged", async () => {
    const id = await account(ann);
    const unpeppered = wire({ passwordPepper: undefined }).auth;

    const lines = await logged(async () => {
      expect(await unpeppered.signIn(browser().sessions(), { username: "aokafor", password: ANN_START, client: CLIENT })).toEqual({ ok: false, error: "sign_in_failed" });
      expect(await unpeppered.changePassword(id, { password: "a long new password", confirm: "a long new password" })).toEqual({ ok: false, error: "provider_error" });
    });

    expect(lines.filter((line) => line.evt === "identity.staff_passwords_not_configured").map((line) => line.operation)).toEqual(["sign_in", "change_password"]);
    expect(sleeps).toEqual([MIN_REFUSAL_MS]);
    expect(idp.sessionTokens.size).toBe(0);
    expect(await row(id)).toMatchObject({ must_change_password: true, starting_password_used_at: null });
    expect(await owner`select count(*)::int as n from sign_in_failure`).toEqual([{ n: 0 }]);
  });

  it("is required for a re-issue too", async () => {
    const admin = await account({ username: "admin1", firstName: "Ada", lastName: "Admin", role: "admin", own: "admin password one", enrolled: true });
    const second = await account({ username: "admin2", firstName: "Bo", lastName: "Admin", role: "admin", own: "admin password two", enrolled: true });
    await owner`insert into staff_bootstrap (first_admin_id, second_admin_id, completed_at) values (${admin}, ${second}, now())`;
    const id = await account(ann);
    const unpeppered = wire({ passwordPepper: undefined }).auth;

    const lines = await logged(async () => expect(await unpeppered.reissueStartingPassword(admin, "aokafor")).toEqual({ ok: false, error: "passwords_not_configured" }));

    expect(lines).toContainEqual({ level: "error", evt: "identity.staff_passwords_not_configured", module: "identity", operation: "reissue_starting_password" });
    expect(await row(id)).toMatchObject({ starting_password_issued_at: T0 });
  });
});

describe("sessions the app did not open", () => {
  /** A browser holding a session opened at the provider directly, never through signIn. */
  function grantedBrowser(login: string, providerPassword: string) {
    const token = idp.grant(login, providerPassword);
    if (!token) throw new Error("the provider refused the grant");
    const who = browser();
    who.cookies.set(MEMORY_SESSION_COOKIE, token);
    return who;
  }

  it("are rejected even though the provider verifies them: signed out, cookie cleared, nothing audited as signed in", async () => {
    const id = await account(ann);
    // The reviewer's repro, even with the pepper known: a password grant made outside signIn.
    const attacker = grantedBrowser("aokafor@staff.cvh.invalid", peppered(ANN_START));
    expect(await idp.sessions(attacker.jar).currentUser()).toMatchObject({ authUserId: expect.any(String) });

    expect(await auth.currentSession(attacker.sessions())).toBeNull();

    expect(attacker.cookies.size).toBe(0);
    expect(idp.sessionTokens.size).toBe(0);
    expect(await auditsOf("auth.signed_in")).toEqual([]);
    expect((await row(id)).starting_password_used_at).toBeNull();
    // The starting password is still valid once, for its owner.
    expect(await signIn(browser(), "aokafor", ANN_START)).toMatchObject({ ok: true, gate: "choose_password" });
  });

  it("are rejected once revoked, and a session recorded for another account is not this account's", async () => {
    const id = await account({ ...ann, own: "the right password" });
    await account({ username: "bobee", firstName: "Bo", lastName: "Bee", own: "another password" });
    const phone = browser();
    await signIn(phone, "aokafor", "the right password");
    const session = await auth.currentSession(phone.sessions());
    expect(session).toMatchObject({ staffId: id });

    // Bo's own provider session, recorded as if the app had opened it for Ann.
    const borrowed = grantedBrowser("bobee@staff.cvh.invalid", peppered("another password"));
    const borrowedKey = (await idp.sessions(borrowed.jar).currentUser())!.sessionKey;
    await owner`insert into staff_session (id, staff_account_id, created_at, last_seen_at) values (${borrowedKey}, ${id}, ${clock}, ${clock})`;
    expect(await auth.currentSession(borrowed.sessions())).toBeNull();

    await owner`update staff_session set revoked_at = ${clock} where id = ${session!.sessionId}`;
    expect(await auth.currentSession(phone.sessions())).toBeNull();
    expect(phone.cookies.size).toBe(0);
  });

  it("rejects a session on a starting password that has expired", async () => {
    const id = await account(ann);
    const phone = browser();
    await signIn(phone, "aokafor", ANN_START);
    expect(await auth.currentSession(phone.sessions())).toMatchObject({ gate: "choose_password" });

    // Its one use not recorded (as for a session opened outside this rule), 24 hours after issue.
    await owner`update staff_account set starting_password_used_at = null where id = ${id}`;
    advance(minutes(24 * 60));
    expect(await auth.currentSession(phone.sessions())).toBeNull();
    expect(phone.cookies.size).toBe(0);
  });

  it("records each request's time on the session at most once a minute (S01.08's idle limit reads it)", async () => {
    const id = await account({ ...ann, own: "the right password" });
    const phone = browser();
    await signIn(phone, "aokafor", "the right password");
    const seen = async () => (await owner`select last_seen_at from staff_session where staff_account_id = ${id}`)[0].last_seen_at;

    advance(30_000);
    await auth.currentSession(phone.sessions());
    expect(await seen()).toEqual(T0);
    advance(31_000);
    await auth.currentSession(phone.sessions());
    expect(await seen()).toEqual(clock);
  });

  it("signing out revokes the app's record of the session", async () => {
    const id = await account({ ...ann, own: "the right password" });
    const phone = browser();
    await signIn(phone, "aokafor", "the right password");
    const { sessionId } = (await auth.currentSession(phone.sessions()))!;

    await auth.signOut(phone.sessions());

    expect(await sessionRows(id)).toEqual([{ id: sessionId, created_at: T0, revoked_at: T0 }]);
  });
});

describe("ending sessions on password changes", () => {
  async function hubAdmin() {
    const admin = await account({ username: "admin1", firstName: "Ada", lastName: "Admin", role: "admin", own: "admin password one", enrolled: true });
    const second = await account({ username: "admin2", firstName: "Bo", lastName: "Admin", role: "admin", own: "admin password two", enrolled: true });
    await owner`insert into staff_bootstrap (first_admin_id, second_admin_id, completed_at) values (${admin}, ${second}, now())`;
    return admin;
  }

  it("a re-issue revokes every session of the account: the old gate-1 session is rejected", async () => {
    const admin = await hubAdmin();
    const id = await account(ann);
    const old = browser();
    await signIn(old, "aokafor", ANN_START);
    expect(await auth.currentSession(old.sessions())).toMatchObject({ gate: "choose_password" });
    const authUserId = idp.findByLogin("aokafor@staff.cvh.invalid")![0];

    expect(await auth.reissueStartingPassword(admin, "aokafor")).toMatchObject({ ok: true });

    expect(await auth.currentSession(old.sessions())).toBeNull();
    expect((await sessionRows(id)).map((session) => session.revoked_at)).toEqual([clock]);
    // Ended at the provider too (its admin password update signs the user out everywhere).
    expect([...idp.sessionTokens.values()]).not.toContain(authUserId);
    expect(await signIn(browser(), "aokafor", ANN_START)).toMatchObject({ ok: true, gate: "choose_password" });
  });

  it("a re-issue revokes the app's records even when the provider would have kept its sessions", async () => {
    const admin = await hubAdmin();
    await account(ann);
    const old = browser();
    await signIn(old, "aokafor", ANN_START);
    // A provider whose password update leaves sessions open: only the app's revocation stands.
    const keepsSessions = {
      ...idp,
      async setPassword(authUserId: string, password: string) {
        idp.users.get(authUserId)!.password = password;
        return { ok: true as const };
      },
    };
    const { auth: lenient } = wire({ idp: keepsSessions });

    expect(await lenient.reissueStartingPassword(admin, "aokafor")).toMatchObject({ ok: true });

    expect(idp.sessionTokens.size).toBe(1);
    expect(await lenient.currentSession(old.sessions())).toBeNull();
  });

  it("a re-issue whose provider call fails changes nothing and is logged", async () => {
    const admin = await hubAdmin();
    const id = await account(ann);
    advance(minutes(25 * 60));
    await signIn(browser(), "aokafor", ANN_START);
    idp.failNextPassword("unavailable");

    const lines = await logged(async () => expect(await auth.reissueStartingPassword(admin, "aokafor")).toEqual({ ok: false, error: "provider_error" }));

    expect(lines).toContainEqual(expect.objectContaining({ evt: "identity.password_not_reissued", staff_id: id }));
    expect((await row(id)).status).toBe("locked_pending_reissue");
  });

  it("choosing a password revokes the account's other sessions and keeps this one", async () => {
    const id = await account(ann);
    const phone = browser();
    await signIn(phone, "aokafor", ANN_START);
    const current = (await auth.currentSession(phone.sessions()))!;
    // Another session of the account (another device), recorded as the app records them.
    const laptop = browser();
    laptop.cookies.set(MEMORY_SESSION_COOKIE, idp.grant("aokafor@staff.cvh.invalid", peppered(ANN_START))!);
    const laptopKey = (await idp.sessions(laptop.jar).currentUser())!.sessionKey;
    await owner`insert into staff_session (id, staff_account_id, created_at, last_seen_at) values (${laptopKey}, ${id}, ${clock}, ${clock})`;
    expect(await auth.currentSession(laptop.sessions())).toMatchObject({ staffId: id });

    expect(await auth.changePassword(id, { password: "a long new password", confirm: "a long new password" }, { sessions: phone.sessions(), sessionId: current.sessionId })).toMatchObject({
      ok: true,
    });

    expect(await auth.currentSession(phone.sessions())).toMatchObject({ staffId: id, gate: "hub" });
    expect(await auth.currentSession(laptop.sessions())).toBeNull();
    expect((await sessionRows(id)).filter((session) => session.revoked_at === null)).toHaveLength(1);
  });

  it("revokes the app's record of the other sessions even when the provider would have kept them", async () => {
    const id = await account(ann);
    const phone = browser();
    await signIn(phone, "aokafor", ANN_START);
    const current = (await auth.currentSession(phone.sessions()))!;
    const laptop = browser();
    laptop.cookies.set(MEMORY_SESSION_COOKIE, idp.grant("aokafor@staff.cvh.invalid", peppered(ANN_START))!);
    const laptopKey = (await idp.sessions(laptop.jar).currentUser())!.sessionKey;
    await owner`insert into staff_session (id, staff_account_id, created_at, last_seen_at) values (${laptopKey}, ${id}, ${clock}, ${clock})`;
    const keepsSessions = {
      ...idp,
      async setPassword(authUserId: string, password: string) {
        idp.users.get(authUserId)!.password = password;
        return { ok: true as const };
      },
    };
    const { auth: lenient } = wire({ idp: keepsSessions });

    await lenient.changePassword(id, { password: "a long new password", confirm: "a long new password" }, { sessions: phone.sessions(), sessionId: current.sessionId });

    expect(await lenient.currentSession(laptop.sessions())).toBeNull();
    expect(await lenient.currentSession(phone.sessions())).toMatchObject({ staffId: id, gate: "hub" });
  });

  it("signs this browser out when its session cannot be reopened, and logs it", async () => {
    const id = await account(ann);
    const phone = browser();
    await signIn(phone, "aokafor", ANN_START);
    const current = (await auth.currentSession(phone.sessions()))!;
    const sessions = phone.sessions();
    const failing = { ...sessions, checkPassword: async () => ({ ok: false as const, error: "unavailable" as const }) };

    const lines = await logged(async () =>
      expect(await auth.changePassword(id, { password: "a long new password", confirm: "a long new password" }, { sessions: failing, sessionId: current.sessionId })).toMatchObject({
        ok: true,
      }),
    );

    expect(lines).toContainEqual(expect.objectContaining({ evt: "identity.session_not_reopened", staff_id: id }));
    expect(phone.cookies.size).toBe(0);
    expect((await sessionRows(id)).every((session) => session.revoked_at !== null)).toBe(true);
    expect(await signIn(browser(), "aokafor", "a long new password")).toMatchObject({ ok: true, gate: "hub" });
  });
});

describe("the access token's lifetime", () => {
  it("is checked on sign-in: shorter than 12 hours logs one warning per process, without any token", async () => {
    await account({ ...ann, own: "the right password" });
    await account({ username: "bobee", firstName: "Bo", lastName: "Bee", own: "another password" });
    idp.setTokenLifetime(3600);

    const lines = await logged(async () => {
      await signIn(browser(), "aokafor", "the right password");
      await signIn(browser(), "bobee", "another password");
    });

    expect(lines).toEqual([{ level: "warn", evt: "identity.jwt_expiry_short", module: "identity", lifetime_seconds: 3600, required_seconds: 43_200 }]);
    for (const token of idp.sessionTokens.keys()) expect(JSON.stringify(lines)).not.toContain(token);
  });

  it("says nothing when the tokens last 12 hours", async () => {
    await account({ ...ann, own: "the right password" });

    expect(await logged(() => signIn(browser(), "aokafor", "the right password"))).toEqual([]);
  });
});

describe("the timing of refusals", () => {
  it("pads every refused sign-in to MIN_REFUSAL_MS, and not a successful one", async () => {
    await account({ ...ann, own: "the right password" });
    await account({ username: "gone", firstName: "Go", lastName: "Ne", own: "a password", status: "suspended" });

    await signIn(browser(), "ghost", "whatever"); // unknown username
    await signIn(browser(), "aokafor", "wrong"); // wrong password
    await signIn(browser(), "gone", "a password"); // an account that may not sign in
    await signIn(browser(), "", ""); // not even a username
    expect(sleeps).toEqual([MIN_REFUSAL_MS, MIN_REFUSAL_MS, MIN_REFUSAL_MS, MIN_REFUSAL_MS]);

    expect(await signIn(browser(), "aokafor", "the right password")).toMatchObject({ ok: true });
    expect(sleeps).toHaveLength(4);
  });

  it("waits only for what is left of it", async () => {
    await account({ ...ann, own: "the right password" });
    const sessions = browser().sessions();
    const taking = (ms: number) => ({
      ...sessions,
      async checkPassword(input: { login: string; password: string }) {
        monotonic += ms;
        return sessions.checkPassword(input);
      },
    });

    await auth.signIn(taking(250), { username: "aokafor", password: "wrong", client: CLIENT });
    expect(sleeps).toEqual([MIN_REFUSAL_MS - 250]);
    // A refusal that already took longer waits no more.
    await auth.signIn(taking(MIN_REFUSAL_MS + 1), { username: "aokafor", password: "wrong", client: CLIENT });
    expect(sleeps).toEqual([MIN_REFUSAL_MS - 250]);
  });

  it("uses the real clock and sleep by default", async () => {
    const { auth: real } = wire({ sleep: undefined, monotonicMs: undefined });

    const started = performance.now();
    await real.signIn(browser().sessions(), { username: "ghost", password: "whatever", client: CLIENT });
    expect(performance.now() - started).toBeGreaterThanOrEqual(MIN_REFUSAL_MS - 5);
  });
});

describe("the purge of the sign-in tables", () => {
  it("is an hourly pg_cron job that deletes throttle rows older than 24 hours and staff sessions ended over 30 days ago", async () => {
    const [job] = await owner`select schedule, command, username from cron.job where jobname = 'identity-purge-sign-in'`;
    expect(job).toMatchObject({ schedule: "23 * * * *", username: "postgres" });

    const id = await account(ann);
    const hash = (n: number) => String(n).repeat(64);
    await owner`insert into sign_in_failure (at, username_hash, client_hash) values
      (now() - interval '25 hours', ${hash(1)}, ${hash(1)}), (now() - interval '23 hours', ${hash(2)}, ${hash(2)})`;
    await owner`insert into sign_in_lock (kind, key_hash, locked_until) values
      ('username', ${hash(3)}, now() - interval '25 hours'), ('client', ${hash(4)}, now() - interval '1 hour')`;
    await owner`insert into staff_session (id, staff_account_id, created_at, last_seen_at, revoked_at) values
      (${hash(5)}, ${id}, now() - interval '40 days', now() - interval '40 days', now() - interval '31 days'),
      (${hash(6)}, ${id}, now() - interval '31 days', now() - interval '31 days', null),
      (${hash(7)}, ${id}, now() - interval '3 days', now() - interval '3 days', now() - interval '2 days'),
      (${hash(8)}, ${id}, now(), now(), null)`;

    await owner.unsafe(job.command);

    expect((await owner`select username_hash from sign_in_failure`).map((r) => r.username_hash)).toEqual([hash(2)]);
    expect((await owner`select key_hash from sign_in_lock`).map((r) => r.key_hash)).toEqual([hash(4)]);
    expect((await owner`select id from staff_session order by id`).map((r) => r.id)).toEqual([hash(7), hash(8)]);
  });

  it("also happens on a successful sign-in, not only on a failure", async () => {
    await account({ ...ann, own: "the right password" });
    await signIn(browser(), "someone", "wrong", "198.51.100.9");
    advance(minutes(24 * 60 + 1));

    expect(await signIn(browser(), "aokafor", "the right password")).toMatchObject({ ok: true });
    expect(await owner`select count(*)::int as n from sign_in_failure`).toEqual([{ n: 0 }]);
  });
});

describe("IT's re-issue of the first Admin's starting password (scripts/create-first-admin --reissue)", () => {
  const jane: Person = { username: "jdoe", firstName: "Jane", lastName: "Doe", role: "admin" };
  const omar: Person = { username: "ofarouk", firstName: "Omar", lastName: "Farouk", role: "admin" };

  async function bootstrapWith(first: Person, second?: Person, completed = false) {
    const firstId = await account(first);
    const secondId = second ? await account(second) : null;
    await owner`insert into staff_bootstrap (first_admin_id, second_admin_id, completed_at) values (${firstId}, ${secondId}, ${completed ? clock : null})`;
    return firstId;
  }

  it("re-issues it while bootstrap is in progress, revokes the account's sessions, and audits it with the system as actor", async () => {
    const first = await bootstrapWith(jane);
    const old = browser();
    await signIn(old, "jdoe", "rvh-jane-doe");
    advance(minutes(25 * 60));
    expect(await signIn(browser(), "jdoe", "rvh-jane-doe")).toEqual({ ok: false, error: "starting_password_expired" });

    expect(await auth.reissueFirstAdminStartingPassword("JDoe")).toEqual({ ok: true, value: { username: "jdoe", startingPassword: "rvh-jane-doe" } });

    expect(await row(first)).toMatchObject({ status: "active", must_change_password: true, starting_password_issued_at: clock, starting_password_used_at: null });
    expect((await auditsOf("password.reissued")).at(-1)).toEqual({ actor_staff_id: null, action: "password.reissued", subject_id: first, outcome: "ok", meta: {} });
    expect(await auth.currentSession(old.sessions())).toBeNull();
    expect((await sessionRows(first)).every((session) => session.revoked_at !== null)).toBe(true);
    advance(minutes(23 * 60));
    expect(await signIn(browser(), "jdoe", "rvh-jane-doe")).toMatchObject({ ok: true, gate: "choose_password" });
  });

  it.each([
    ["no bootstrap yet", () => account(jane), "jdoe", "bootstrap_not_in_progress"],
    ["bootstrap completed", () => bootstrapWith(jane, omar, true), "jdoe", "bootstrap_not_in_progress"],
    ["the second Admin", () => bootstrapWith(jane, omar), "ofarouk", "not_first_admin"],
    ["an unknown username", () => bootstrapWith(jane), "nobody", "not_first_admin"],
    ["a first Admin who chose their own password", () => bootstrapWith({ ...jane, own: "my own password" }), "jdoe", "not_reissuable"],
    ["a suspended first Admin", () => bootstrapWith({ ...jane, status: "suspended" }), "jdoe", "not_reissuable"],
  ] as const)("is refused for %s, and audited", async (_name, arrange, username, error) => {
    await arrange();
    const before = idp.findByLogin(`${username}@staff.cvh.invalid`)?.[1].password;

    expect(await auth.reissueFirstAdminStartingPassword(username)).toEqual({ ok: false, error });

    expect(idp.findByLogin(`${username}@staff.cvh.invalid`)?.[1].password).toBe(before);
    expect((await auditsOf("password.reissued")).at(-1)).toMatchObject({ actor_staff_id: null, outcome: "refused" });
  });

  it("runs from the script, which prints the starting password once", async () => {
    await bootstrapWith(jane);
    advance(minutes(25 * 60));
    const out: string[] = [];
    const error: string[] = [];
    const env = {
      VERCEL_ENV: "production",
      SMS_MODE: "live",
      PUBLIC_BASE_URL: "https://project-6qcs4.vercel.app",
      DATABASE_URL: "postgres://cvh_app_login.ref:secret@aws-0-ca-central-1.pooler.supabase.com:6543/postgres",
      SUPABASE_SECRET_KEY: "sb_secret_test_only",
      NEXT_PUBLIC_SUPABASE_URL: "https://example-project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only",
      STAFF_PASSWORD_PEPPER: PEPPER,
    };
    const deps = { env, out: (l: string) => void out.push(l), error: (l: string) => void error.push(l), connect: () => ({ identity: accounts, staffAuth: auth, close: async () => {} }) };

    expect(await runCreateFirstAdmin(["--reissue", "--username", "jdoe"], deps)).toBe(0);
    expect(out.join("\n")).toContain("New starting password for jdoe: rvh-jane-doe");
    expect(out.join("\n").match(/rvh-jane-doe/g)).toHaveLength(1);
    expect(await runCreateFirstAdmin(["--reissue", "--username", "nobody"], deps)).toBe(1);
    expect(error.join("\n")).toBe("Refused: that username is not the first Admin's (not_first_admin)");
  });
});

describe("the staff session table", () => {
  it("is out of reach of Supabase's client roles, and the app cannot delete a row or write one that is not a hash", async () => {
    const [privileges] = await owner`
      select has_table_privilege('anon', 'staff_session', 'select') as anon_select,
             has_table_privilege('authenticated', 'staff_session', 'insert') as authenticated_insert,
             has_table_privilege('service_role', 'staff_session', 'select') as service_select,
             has_table_privilege('cvh_app_login', 'staff_session', 'update') as app_update,
             has_table_privilege('cvh_app_login', 'staff_session', 'delete') as app_delete,
             (select relrowsecurity from pg_class where relname = 'staff_session') as rls`;
    expect(privileges).toEqual({ anon_select: false, authenticated_insert: false, service_select: false, app_update: true, app_delete: false, rls: true });
    await expect(app.$client`delete from staff_session`).rejects.toThrow(/permission denied/);
    const id = await account(ann);
    await expect(app.$client`insert into staff_session (id, staff_account_id, created_at, last_seen_at) values ('not a hash', ${id}, now(), now())`).rejects.toThrow(/staff_session_id_format/);
  });
});
