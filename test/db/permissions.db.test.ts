// The role policy enforced on every staff endpoint (S01.12, AD-4), against a real database: each
// page, route handler and server action of the permission test list (test/permissions/endpoints.ts)
// is called directly, as no session, as each role and as an Ambassador outside their assigned
// building, through its real guard and session lookup. Refusals answer 401 (a server action: the
// sign-in redirect, audited with status 401) or 403, leave the business data unchanged and add
// exactly one `permission.denied` record; a page is not a call: it redirects, or shows its refusal
// view to a role the policy refuses, and is not audited.
//
// The app writes with its own credentials (cvh_app_login); Supabase Auth is the in-memory fake,
// whose TOTP codes are computed here (memoryTotp.ts). The guard's scope (src/app/staff/scope.ts) is replaced by
// a stub that hands the guard the assignments each caller is given; the real scope is tested at the end.
import { randomBytes } from "node:crypto";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { GATE_PAGES, SIGN_IN_PAGE, type SetupGate } from "../../src/contracts/staffAuth";
import type { StaffRole } from "../../src/contracts/staffRoles";
import {
  createAssignments,
  createIdentity,
  createStaffAuth,
  pepperPassword,
  type AssignmentService,
  type AuthSessions,
  type CookieJar,
  type IdentityService,
  type PolicyAssignment,
  type StaffAuthService,
} from "../../src/modules/identity";
import { record, recordRefusal, type AuditEvent } from "../../src/modules/audit";
import { createAlertSubmitter, createAlerting, createDrillThreads } from "../../src/modules/alerting";
import { createDeliveryQueue, createMessagingPause, createResend, drillResults } from "../../src/modules/messaging";
import { createDrillRoster } from "../../src/modules/subscriptions";
import { createOncallRoster } from "../../src/modules/ops";
import { createSpendCap, readSpendOverview } from "../../src/modules/spend";
import { noTranslation } from "../../src/modules/translation";
import { createBuildingService, floorsOfBuilding } from "../../src/modules/places";
import { memoryIdentityProvider, type MemoryIdentityProvider } from "../../src/modules/identity/adapters/memoryIdentityProvider";
import { totpCode } from "../../src/modules/identity/adapters/memoryTotp";
import { memoryDirectoryStorage } from "../../src/modules/directory";
import { createDb, type Db } from "../../src/platform/db";
import { PROVIDER_ID, ROLE_CALLERS, STAFF_ENDPOINTS, TARGET_USERNAME, type RoleCaller, type StaffEndpoint } from "../permissions/endpoints";
import { connect, serverUrl } from "./helpers";

/** What the staff surface's composition root (src/app/staff/identity.ts) hands out, for this test. */
const wired = vi.hoisted(() => ({
  accounts: null as unknown,
  auth: null as unknown,
  sessions: null as null | (() => unknown),
  assignments: [] as unknown[],
  places: null as unknown,
  assignmentService: null as unknown,
  alerting: null as unknown,
  alertSubmitter: null as unknown,
  db: null as unknown,
  publish: null as unknown,
  pause: null as unknown,
  oncall: null as unknown,
  spend: null as unknown,
  resend: null as unknown,
  spendOverview: null as null | (() => Promise<unknown>),
  drills: null as unknown,
  drillThreads: null as unknown,
  drillResults: null as unknown,
}));

vi.mock("../../src/app/staff/identity", () => ({
  identity: () => wired.accounts,
  staffAuth: () => wired.auth,
  identityConfigured: () => true,
  requestAuthSessions: async () => {
    if (!wired.sessions) throw new Error("no device");
    return wired.sessions();
  },
}));
// A provider change asks Next to refresh the list, which only a request inside Next can do.
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
// The providers screen (S02.04) reads and writes through the app's database connection.
// "Publish directory" (S02.05) writes its files to a store of this test's own, never to Supabase.
vi.mock("../../src/app/staff/directory", () => ({ directoryDb: () => wired.db, directoryPublishDeps: () => wired.publish }));
// The buildings page and its actions (S01.13) read and write through the places module on the app's own connection.
vi.mock("../../src/app/staff/places", () => ({ buildings: () => wired.places }));
// The coverage page and its actions (S01.14) read and write through identity's assignments on the app's own connection.
vi.mock("../../src/app/staff/assignments", () => ({ assignments: () => wired.assignmentService }));
// The Ambassador's home (S08.01), which an Ambassador gets at the Hub's home, reads the alerts and posts on the app's own connection; the guard is what this test is
// about (the reads are test/db/ambassadorHome.db.test.ts).
vi.mock("../../src/app/staff/ambassador/home", () => ({
  loadAmbassadorHome: async () => ({ buildings: [], alerts: [], posts: [], round: null }),
  loadPostStatus: async () => null,
  loadResolvable: async () => null,
}));
// The audience pickers and their actions (S04.04) run the alert use cases on the app's own connection.
// Submit and the entry state (S04.05) run on the same connection, with no translation model and nothing to freeze: the endpoints are called for a draft that does not exist.
vi.mock("../../src/app/staff/alerts", () => ({ alerting: () => wired.alerting, alertSubmitter: () => wired.alertSubmitter }));
// The Pause texts page and its actions (S06.06) run the pause on the app's own connection; no sender is started after a resume.
vi.mock("../../src/app/staff/messagingPause", () => ({
  messagingPause: () => wired.pause,
  pausedByName: async () => "Ann Okafor",
  startSending: async () => {},
  logPauseError: () => {},
}));
// The On-call numbers page and its actions (S06.07) run the roster on the app's own connection.
vi.mock("../../src/app/oncall", () => ({ oncallRoster: () => wired.oncall }));
// The Spend page and its action (S07.08) run the spend module on the app's own connection.
vi.mock("../../src/app/staff/spendSeam", () => ({
  spendCap: () => wired.spend,
  readOverview: async () => wired.spendOverview?.(),
  logSpendError: () => {},
  capNoticeFor: async () => null,
}));
// The sending texts page's resend actions (S09.02) run the resend on the app's own connection; starting a dispatcher run after a resend is a no-op here.
vi.mock("../../src/app/staff/resendSeam", () => ({ resendService: () => wired.resend, startSending: async () => {}, logResendError: () => {} }));
// The Drills page, the drill roster page and their actions (S06.05) run the roster, the drill threads and their results on the app's own connection.
vi.mock("../../src/app/drills", () => ({
  drillRoster: () => wired.drills,
  drillThreads: () => wired.drillThreads,
  drillResultsReader: () => wired.drillResults,
}));
// The assignments the guard reads for the caller.
vi.mock("../../src/app/staff/scope", () => ({ assignmentsOf: async () => wired.assignments }));

const ROOT = path.join(__dirname, "..", "..");

let owner: ReturnType<typeof connect>;
let app: Db;
let auditBaseline = 0;

let idp: MemoryIdentityProvider;
let accounts: IdentityService;
let auth: StaffAuthService;

const THROTTLE_KEY = randomBytes(32).toString("hex");
const PEPPER = randomBytes(32).toString("hex");
const peppered = (password: string) => pepperPassword(PEPPER, password);
const T0 = new Date("2026-10-05T09:00:00Z");
const CLIENT = "203.0.113.12";

/** The tables the audit trail and the session bookkeeping do not own: what a refused call must leave as it was. */
const NOT_BUSINESS = new Set(["audit_event", "staff_session", "sign_in_failure", "sign_in_lock"]);
let businessTables: string[] = [];

beforeAll(async () => {
  owner = connect(serverUrl());
  await migrate({ sql: owner, log: () => {} });
  const password = randomBytes(18).toString("hex");
  await owner.unsafe(`alter role cvh_app_login password '${password}'`);
  const url = new URL(serverUrl());
  url.username = "cvh_app_login";
  url.password = password;
  app = createDb(url.href);
  wired.db = app;
  wired.publish = {
    storage: memoryDirectoryStorage(),
    catalogue: async () => ({ hash: "a".repeat(64), gitCommit: null }),
    neighbourhoods: async () => ({ reviewed: true, byProvider: { [PROVIDER_ID]: [] } }),
    zhHant: async () => ({ convert: (text: string) => text, openccVersion: "1.4.2", config: "test" }),
    onFailure: async () => {},
  };
  [{ max: auditBaseline }] = await owner`select coalesce(max(id), 0)::int as max from audit_event`;
  const tables = await owner<{ name: string; table_name: string }[]>`
    select format('%I.%I', table_schema, table_name) as name, table_name
    from information_schema.tables
    where table_type = 'BASE TABLE'
      and table_schema not in ('pg_catalog', 'information_schema', 'auth', 'storage', 'cron', 'net', 'extensions', 'graphql', 'graphql_public', 'realtime', 'supabase_functions', 'vault', 'pgsodium', 'pgsodium_masks', 'supabase_migrations', '_realtime', 'pgbouncer')
      and table_name <> 'schema_migrations'
    order by 1`;
  businessTables = tables.filter((table) => !NOT_BUSINESS.has(table.table_name)).map((table) => table.name);
  expect(businessTables).toEqual(expect.arrayContaining(["public.staff_account", "public.staff_bootstrap"]));
});

async function reset() {
  // An Admin's allowed "Pause all texts" really pauses (S06.06), and the pause names the Admin who paused: clear it before the accounts go.
  await owner`update messaging_control set paused = false, paused_by = null, paused_at = null, reason = null, handed_off_at_pause = null where id = 1`;
  // An Admin's allowed "Add number" (S06.07) names the Admin who added it: clear the roster before the accounts go.
  await owner`delete from oncall_roster`;
  // An allowed "Save cap" (S07.08) names the Admin who set it: clear the cap before the accounts go.
  await owner`update spend_cap set monthly_cents = null, set_by = null, set_at = null where id = 1`;
  // ... and an allowed "Add phone" (S06.05) names the Admin who added it, too.
  await owner`delete from drill_roster`;
  await owner.begin(async (tx) => {
    await tx.unsafe(`
      alter table audit_event disable trigger audit_event_no_update_or_delete;
      alter table staff_bootstrap disable trigger staff_bootstrap_forward_only;
      alter table directory_release disable trigger directory_release_guard;`);
    await tx`delete from audit_event where id > ${auditBaseline}`;
    await tx`delete from directory_release`;
    await tx`delete from ops_event`;
    await tx`delete from catalogue_load`;
    // The seed ran with the catalogue the publish dependencies below report.
    await tx`insert into catalogue_load (hash) values (${"a".repeat(64)})`;
    await tx`delete from provider_category`;
    await tx`delete from provider_location`;
    await tx`delete from provider`;
    await tx`delete from category`;
    await tx`delete from staff_bootstrap`;
    await tx`delete from staff_session`;
    await tx`delete from ambassador_assignment`;
    await tx`update staff_account set created_by = null`;
    await tx`delete from staff_account`;
    await tx`delete from sign_in_failure`;
    await tx`delete from sign_in_lock`;
    await tx.unsafe(`
      alter table audit_event enable trigger audit_event_no_update_or_delete;
      alter table staff_bootstrap enable trigger staff_bootstrap_forward_only;
      alter table directory_release enable trigger directory_release_guard;`);
  });
}

let nextId = 1;
/** As the owner: an account, on its own password unless `starting`; `enrolled` gives it an authenticator. */
async function account(username: string, role: StaffRole, options: { starting?: boolean; enrolled?: boolean; status?: string } = {}) {
  const authUserId = idp.plant(`${username}@staff.cvh.invalid`, { password: peppered(`${username} own password`) });
  if (options.enrolled) idp.enrol(authUserId);
  const id = `01900000-0000-7000-8000-${String(nextId++).padStart(12, "0")}`;
  await owner`
    insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, status, must_change_password, starting_password_issued_at, factor_enrolled_at)
    values (${id}, ${authUserId}, ${username}, 'Ann', 'Okafor', 'someone@example.org', ${role}, ${options.status ?? "active"},
            ${options.starting === true}, ${options.starting ? T0 : null}, ${options.enrolled ? T0 : null})`;
  return { id, authUserId, username };
}

beforeEach(async () => {
  await reset();
  idp = memoryIdentityProvider();
  const wiring = { db: app, idp, throttleKey: THROTTLE_KEY, passwordPepper: PEPPER, now: () => T0, sleep: async () => {}, monotonicMs: () => 0 };
  accounts = createIdentity(wiring);
  auth = createStaffAuth({ ...wiring, accounts });
  wired.accounts = accounts;
  wired.auth = auth;
  wired.sessions = null;
  wired.assignments = [];
  const assignmentService = createAssignments({ db: app, floors: { floorsOf: floorsOfBuilding } });
  wired.assignmentService = assignmentService;
  const alerting = createAlerting({ db: app });
  wired.alerting = alerting;
  wired.alertSubmitter = createAlertSubmitter({
    alerting,
    db: app,
    translator: noTranslation(),
    translationConfigured: false,
    freeze: () => {
      throw new Error("no entry is frozen in the permission test");
    },
  });
  wired.pause = createMessagingPause({ db: app });
  wired.oncall = createOncallRoster({
    db: app,
    audit: { record: (tx, event) => record(tx, event as AuditEvent), recordRefusal: (db, event) => recordRefusal(db, event as AuditEvent) },
    skipRecipientDeliveries: (tx, recipient) => createDeliveryQueue().skipRecipientDeliveries(tx, recipient),
  });
  wired.spend = createSpendCap({ db: app, audit: { record: (tx, event) => record(tx, event), recordRefusal: (db, event) => recordRefusal(db, event) } });
  wired.resend = createResend({
    db: app,
    recipients: { receives: async () => false },
    standing: { standingOf: async () => null },
    audit: { record: (tx, event) => record(tx, event as AuditEvent), recordRefusal: (db, event) => recordRefusal(db, event as AuditEvent) },
  });
  wired.spendOverview = () => readSpendOverview(app, { now: new Date(), budgetCents: 100_000, cohereEstimateCadPerMillionTokens: null });
  wired.drills = createDrillRoster({
    db: app,
    audit: { record: (tx, event) => record(tx, event as AuditEvent), recordRefusal: (db, event) => recordRefusal(db, event as AuditEvent) },
    skipRecipientDeliveries: (tx, recipient) => createDeliveryQueue().skipRecipientDeliveries(tx, recipient),
  });
  wired.drillThreads = createDrillThreads({ db: app });
  wired.drillResults = { forAlert: (alertId: string) => drillResults.forAlert(app, alertId) };
  wired.places = createBuildingService({
    db: app,
    audit: { record: (tx, event) => record(tx, event as AuditEvent), recordRefusal: (db, event) => recordRefusal(db, event as AuditEvent) },
    assignments: { onFloor: (executor, floor) => assignmentService.onFloor(executor, floor) },
  });
  // Two usable Admins and a completed bootstrap, as the Hub runs; and the account the account actions aim at.
  const first = await account("admina", "admin", { enrolled: true });
  const second = await account("adminb", "admin", { enrolled: true });
  await owner`insert into staff_bootstrap (first_admin_id, second_admin_id, completed_at) values (${first.id}, ${second.id}, ${T0})`;
  await account(TARGET_USERNAME, "ambassador", { starting: true, status: "locked_pending_reissue" });
  // The provider the provider actions are aimed at: confirmed and published, so a call that got through would change it.
  await owner`
    insert into provider (id, name, texts, published, published_at, last_confirmed)
    values (${PROVIDER_ID}, 'Test provider', ${owner.json({ services: { en: "Services" } })}, true, ${T0}, '2026-09-01')`;
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
  return { sessions: (): AuthSessions => idp.sessions(jar) };
}

const NEEDS_AUTHENTICATOR: readonly StaffRole[] = ["admin", "coordinator"];

/** Where a role caller stands for an endpoint at `gate`: there when the role can be, at the Hub otherwise. */
function standsAt(role: StaffRole, gate: SetupGate): SetupGate {
  if (gate === "enrol_authenticator" || gate === "authenticator_code") return NEEDS_AUTHENTICATOR.includes(role) ? gate : "hub";
  return gate;
}

/** A signed-in caller of `role` at `gate` (the Hub: aal2 for Admins and Coordinators, who entered their code). */
async function signedIn(role: StaffRole, gate: SetupGate) {
  const person = await account(`caller${role}`, role, { starting: gate === "choose_password", enrolled: NEEDS_AUTHENTICATOR.includes(role) && gate !== "enrol_authenticator" });
  const phone = device();
  const signedInResult = await auth.signIn(phone.sessions(), { username: person.username, password: `${person.username} own password`, client: CLIENT });
  expect(signedInResult.ok).toBe(true);
  let session = await auth.currentSession(phone.sessions());
  if (gate === "hub" && session?.gate === "authenticator_code") {
    const code = totpCode(idp.totpSecret(person.authUserId));
    expect((await auth.verifyAuthenticatorCode(session, { code, client: CLIENT }, phone.sessions())).ok).toBe(true);
    session = await auth.currentSession(phone.sessions());
  }
  expect(session, `${role} at ${gate}`).toMatchObject({ role, gate, aal: gate === "hub" && NEEDS_AUTHENTICATOR.includes(role) ? "aal2" : "aal1" });
  return { id: person.id, phone };
}

/** A hash of every business table's rows. */
async function businessData(): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const table of businessTables) {
    const [{ digest }] = await owner.unsafe(`select coalesce(md5(string_agg(t::text, '|' order by t::text)), '') as digest from ${table} t`);
    result[table] = digest;
  }
  return result;
}

const denialsSince = (id: number) =>
  owner<{ actor_staff_id: string | null; outcome: string; meta: Record<string, unknown> }[]>`
    select actor_staff_id, outcome, meta from audit_event where id > ${id} and action = 'permission.denied' order by id`;
const lastAuditId = async () => (await owner`select coalesce(max(id), 0)::int as max from audit_event`)[0].max as number;

type Answer = { redirect: string } | { status: number; body: unknown } | { state: { status: string; message?: string } } | { rendered: true } | { refusedView: true };

async function redirectOr<T>(run: () => Promise<T>): Promise<{ redirect: string } | { value: T }> {
  try {
    return { value: await run() };
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;")) return { redirect: digest.split(";")[2] };
    throw error;
  }
}

/** Calls an endpoint directly, the way a browser or a script would reach it. */
async function call(endpoint: StaffEndpoint): Promise<Answer> {
  const exportsOf: Record<string, unknown> = await import(path.join(ROOT, endpoint.file));
  const target = exportsOf[endpoint.export] as (...args: unknown[]) => Promise<unknown>;
  if (endpoint.kind === "page") {
    const { PolicyRefusal } = await import("../../src/app/staff/guard");
    const answer = await redirectOr(() => target({}));
    if ("redirect" in answer) return answer;
    return (answer.value as { type?: unknown } | null)?.type === PolicyRefusal ? { refusedView: true } : { rendered: true };
  }
  if (endpoint.kind === "route") {
    const method = endpoint.export;
    const request = new Request(`http://localhost${endpoint.route}`, {
      method,
      headers: { "content-type": "application/json", host: "localhost" },
      body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify(endpoint.body ?? {}),
    });
    const response = (await target(request)) as Response;
    return { status: response.status, body: await response.json().catch(() => null) };
  }
  const form = new FormData();
  for (const [name, value] of Object.entries(endpoint.form ?? {})) form.set(name, value);
  const answer = await redirectOr(() => target({ status: "idle" }, form));
  return "redirect" in answer ? answer : { state: answer.value as { status: string; message?: string } };
}

const ROLE_OF: Record<RoleCaller, StaffRole> = {
  ambassador: "ambassador",
  coordinator: "coordinator",
  director: "director",
  admin: "admin",
  ambassador_out_of_scope: "ambassador",
};
/** The stub assignments: the Ambassador covers building 7001; the one outside their building covers only 7002. */
const ASSIGNMENTS: Record<RoleCaller, PolicyAssignment[]> = {
  ambassador: [{ rsn: "7001", floorIds: null }],
  coordinator: [],
  director: [],
  admin: [],
  ambassador_out_of_scope: [{ rsn: "7002", floorIds: null }],
};

const GUARD_MESSAGES = [
  "Finish setting up your account first.",
  "This needs a sign-in confirmed with an authenticator code. Only Admins and Coordinators can do it, after entering their code.",
];

describe.each(STAFF_ENDPOINTS.map((endpoint) => [endpoint.id, endpoint] as const))("%s", (_id, endpoint) => {
  it("called without a session: refused as unauthenticated, nothing changed, one refusal record (pages: sign-in, unaudited)", async () => {
    wired.sessions = device().sessions;
    const before = await businessData();
    const since = await lastAuditId();
    const answer = await call(endpoint);
    expect(await businessData()).toEqual(before);
    const denials = await denialsSince(since);
    if (endpoint.kind === "page") {
      expect(answer).toEqual({ redirect: SIGN_IN_PAGE });
      expect(denials).toEqual([]);
      return;
    }
    if (endpoint.kind === "route") expect(answer).toEqual({ status: 401, body: { error: "unauthenticated" } });
    // A server action has no status of its own: it sends the person to sign-in; the record carries the 401.
    else expect(answer).toEqual({ redirect: SIGN_IN_PAGE });
    expect(denials).toEqual([{ actor_staff_id: null, outcome: "refused", meta: { status: 401, permission: endpoint.action, route: endpoint.route, reason: "unauthenticated" } }]);
  });

  it.each(ROLE_CALLERS.map((caller) => [caller, endpoint.expected[caller]] as const))("called as %s: %s", async (caller, expected) => {
    const role = ROLE_OF[caller];
    const gate = standsAt(role, endpoint.gate);
    const { id, phone } = await signedIn(role, gate);
    wired.sessions = phone.sessions;
    wired.assignments = ASSIGNMENTS[caller];
    const before = await businessData();
    const since = await lastAuditId();

    const answer = await call(endpoint);
    const denials = await denialsSince(since);

    if (expected === "allowed") {
      expect(denials, "the guard let the call through").toEqual([]);
      if (endpoint.kind === "page") expect(answer).toEqual({ rendered: true });
      else if (endpoint.kind === "route") expect([401, 403]).not.toContain((answer as { status: number }).status);
      else expect(GUARD_MESSAGES).not.toContain((answer as { state: { message?: string } }).state.message);
      return;
    }

    expect(await businessData(), "business data unchanged").toEqual(before);
    if (endpoint.kind === "page") {
      if (expected === "forbidden") {
        // The page's refusal view in place of its content, or the Hub's home for a page without one.
        expect([{ refusedView: true }, { redirect: GATE_PAGES.hub }]).toContainEqual(answer);
      } else {
        expect(answer).toEqual({ redirect: GATE_PAGES[gate] });
      }
      // A page shows: its refusal is not audited (the calls it would make are, by their own guards).
      expect(denials).toEqual([]);
      return;
    }
    const meta = expected === "forbidden" ? { status: 403, permission: endpoint.action, route: endpoint.route, reason: endpoint.auditedReason?.[caller] ?? "forbidden" } : { status: 403, route: endpoint.route, reason: "setup_incomplete" };
    expect(denials).toEqual([{ actor_staff_id: id, outcome: "refused", meta }]);
    if (endpoint.kind === "route") {
      expect(answer).toEqual({ status: 403, body: { error: expected } });
    } else {
      const state = (answer as { state: { status: string; message?: string } }).state;
      expect(state.status).toBe("refused");
      expect(state.message).toEqual(expected === "forbidden" ? expect.stringMatching(endpoint.forbiddenMessage ?? /^Only an Admin can /) : "Finish setting up your account first.");
    }
  });
});

describe("a call on a building (the Ambassador's scope, the assignments given by the stub)", () => {
  /** A route and an action on one building, as an alert-authoring endpoint of E04 will be: the policy action `alert.author`. */
  async function scopedEndpoints() {
    const { staffAction, staffJson, staffRoute } = await import("../../src/app/staff/guard");
    const ran: string[] = [];
    const route = staffRoute(
      { route: "/api/staff/scope-check", access: "hub", action: "alert.author", context: async (request) => ({ target: { rsn: String(((await request.json()) as { rsn: string }).rsn) } }) },
      async (request) => {
        ran.push(`route ${((await request.json()) as { rsn: string }).rsn}`);
        await owner`update staff_account set first_name = 'Changed' where username = ${TARGET_USERNAME}`;
        return staffJson({ ok: true });
      },
    );
    const action = staffAction(
      { route: "/staff/scope-check", access: "hub", action: "alert.author", context: async (_session, rsn: string) => ({ target: { rsn } }) },
      async (_session, _facts, rsn: string) => {
        ran.push(`action ${rsn}`);
        await owner`update staff_account set first_name = 'Changed' where username = ${TARGET_USERNAME}`;
        return "done";
      },
      (error) => error,
    );
    const post = (rsn: string) =>
      route(new Request("http://localhost/api/staff/scope-check", { method: "POST", headers: { "content-type": "application/json", host: "localhost" }, body: JSON.stringify({ rsn }) }));
    return { ran, post, action };
  }

  it.each([
    ["ambassador", "7001", "allowed"],
    ["ambassador", "7002", "out_of_scope"],
    ["ambassador_out_of_scope", "7001", "out_of_scope"],
    ["coordinator", "7002", "allowed"],
    ["admin", "7001", "allowed"],
    ["director", "7001", "forbidden"],
  ] as const)("as %s, on building %s: %s", async (caller, rsn, expected) => {
    const role = ROLE_OF[caller];
    const { id, phone } = await signedIn(role, "hub");
    wired.sessions = phone.sessions;
    wired.assignments = ASSIGNMENTS[caller];
    const { ran, post, action } = await scopedEndpoints();

    for (const kind of ["route", "action"] as const) {
      const before = await businessData();
      const since = await lastAuditId();
      const answer = kind === "route" ? await post(rsn) : await action(rsn);
      const denials = await denialsSince(since);
      if (expected === "allowed") {
        expect(kind === "route" ? (answer as Response).status : answer).toBe(kind === "route" ? 200 : "done");
        expect(ran.at(-1)).toBe(`${kind} ${rsn}`);
        expect(denials).toEqual([]);
        continue;
      }
      expect(kind === "route" ? await (answer as Response).json() : answer).toEqual(kind === "route" ? { error: "forbidden" } : "forbidden");
      if (kind === "route") expect((answer as Response).status).toBe(403);
      expect(await businessData(), "business data unchanged").toEqual(before);
      expect(denials).toEqual([
        { actor_staff_id: id, outcome: "refused", meta: { status: 403, permission: "alert.author", route: kind === "route" ? "/api/staff/scope-check" : "/staff/scope-check", reason: expected } },
      ]);
    }
    if (expected !== "allowed") expect(ran).toEqual([]);
  });

  /** Endpoints whose context is "loaded from the database": the building the request claims is not the one the call is on. */
  async function claimedVersusReal() {
    const { staffAction, staffJson, staffRoute } = await import("../../src/app/staff/guard");
    const handled: (string | undefined)[] = [];
    const real = async (claimed: string) => ({ target: { rsn: claimed === "7001" ? "7002" : claimed } });
    const route = staffRoute(
      { route: "/api/staff/scope-check", access: "hub", action: "alert.author", context: async (request) => real(String(((await request.json()) as { rsn: string }).rsn)) },
      async (_request, _session, facts) => {
        handled.push(facts.target?.rsn);
        await owner`update staff_account set first_name = 'Changed' where username = ${TARGET_USERNAME}`;
        return staffJson({ ok: true });
      },
    );
    const action = staffAction(
      { route: "/staff/scope-check", access: "hub", action: "alert.author", context: async (_session, claimed: string) => real(claimed) },
      async (_session, facts) => {
        handled.push(facts.target?.rsn);
        return "done";
      },
      (error) => error,
    );
    const post = (rsn: string) =>
      route(new Request("http://localhost/api/staff/scope-check", { method: "POST", headers: { "content-type": "application/json", host: "localhost" }, body: JSON.stringify({ rsn }) }));
    return { handled, post, action };
  }

  it("judges the facts the handler acts on: a request claiming building 7001 for a call on 7002 is judged, and handled, as 7002", async () => {
    const { phone } = await signedIn("coordinator", "hub");
    wired.sessions = phone.sessions;
    const { handled, post, action } = await claimedVersusReal();
    // A Coordinator needs no facts to be allowed; the handler still gets the judged ones.
    expect((await post("7001")).status).toBe(200);
    expect(await action("7001")).toBe("done");
    expect(handled).toEqual(["7002", "7002"]);
  });

  it("refuses an Ambassador assigned to the claimed building 7001 when the call is on 7002", async () => {
    const { id, phone } = await signedIn("ambassador", "hub");
    wired.sessions = phone.sessions;
    wired.assignments = ASSIGNMENTS.ambassador;
    const { handled, post, action } = await claimedVersusReal();
    const before = await businessData();
    const since = await lastAuditId();
    const response = await post("7001");
    expect(response.status).toBe(403);
    expect(await action("7001")).toBe("forbidden");
    expect(handled).toEqual([]);
    expect(await businessData(), "business data unchanged").toEqual(before);
    expect((await denialsSince(since)).map((denial) => [denial.actor_staff_id, denial.meta.reason])).toEqual([[id, "out_of_scope"], [id, "out_of_scope"]]);
  });

  it("answers 400 bad_request, with one permission.denied record and nothing changed, when the context cannot read the call", async () => {
    const { staffAction, staffRoute, staffJson } = await import("../../src/app/staff/guard");
    const { id, phone } = await signedIn("coordinator", "hub");
    wired.sessions = phone.sessions;
    const ran: string[] = [];
    const route = staffRoute(
      { route: "/api/staff/scope-check", access: "hub", action: "alert.author", context: async (request) => ({ target: { rsn: String(((await request.json()) as { rsn: string }).rsn) } }) },
      async () => {
        ran.push("route");
        await owner`update staff_account set first_name = 'Changed' where username = ${TARGET_USERNAME}`;
        return staffJson({ ok: true });
      },
    );
    const action = staffAction(
      {
        route: "/staff/scope-check",
        access: "hub",
        action: "alert.author",
        context: async (_session, form: FormData) => {
          if (!form.get("rsn")) throw new Error("no building");
          return { target: { rsn: String(form.get("rsn")) } };
        },
      },
      async () => {
        ran.push("action");
        return "done";
      },
      (error) => error,
    );
    const before = await businessData();
    const since = await lastAuditId();
    const malformed = await route(new Request("http://localhost/api/staff/scope-check", { method: "POST", headers: { "content-type": "application/json", host: "localhost" }, body: "{not json" }));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "bad_request" });
    expect(await action(new FormData())).toBe("bad_request");
    expect(ran).toEqual([]);
    expect(await businessData(), "business data unchanged").toEqual(before);
    const meta = (routePattern: string) => ({ status: 400, permission: "alert.author", route: routePattern, reason: "bad_request" });
    expect(await denialsSince(since)).toEqual([
      { actor_staff_id: id, outcome: "refused", meta: meta("/api/staff/scope-check") },
      { actor_staff_id: id, outcome: "refused", meta: meta("/staff/scope-check") },
    ]);
  });

  it("reads the Ambassador's real assignments for the guard's scope, and nothing for an Ambassador with none", async () => {
    const { assignmentsOf } = await vi.importActual<typeof import("../../src/app/staff/scope")>("../../src/app/staff/scope");
    const { id, phone } = await signedIn("ambassador", "hub");
    const session = await auth.currentSession(phone.sessions());
    expect(await assignmentsOf(session!)).toEqual([]);

    await owner`insert into neighbourhood (id, name, fsa) values ('TP', 'Thorncliffe Park', 'M4H') on conflict do nothing`;
    await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at) values ('7001', 'TP', '4 Milepost Pl', 43.7, -79.34, ${T0}) on conflict do nothing`;
    const floorId = "01900000-0000-7000-8000-00000000f001";
    await owner`insert into building_floor (id, rsn, label, sort_order) values (${floorId}, '7001', '3', 3) on conflict do nothing`;
    try {
      // The assigner is an Admin (the use case re-reads the actor's authority), not the Ambassador themself.
      const assigner = await account("assigner", "admin");
      const saved = await (wired.assignmentService as AssignmentService).assign(assigner.id, { staffId: id, rsn: "7001", floorIds: [floorId] });
      expect(saved.ok).toBe(true);
      expect(await assignmentsOf(session!)).toEqual([{ rsn: "7001", floorIds: [floorId] }]);
    } finally {
      await owner`delete from ambassador_assignment`;
      await owner`delete from building_floor where rsn = '7001'`;
      await owner`delete from building where rsn = '7001'`;
    }
  });
});

describe("the coverage actions as an Admin (S01.14): they act on the building the guard judged", () => {
  const FLOOR_3 = "01900000-0000-7000-8000-00000000f003";
  const FLOOR_4 = "01900000-0000-7000-8000-00000000f004";

  async function withBuilding<T>(run: () => Promise<T>): Promise<T> {
    await owner`insert into neighbourhood (id, name, fsa) values ('TP', 'Thorncliffe Park', 'M4H') on conflict do nothing`;
    await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at) values ('7001', 'TP', '4 Milepost Pl', 43.7, -79.34, ${T0})`;
    await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at) values ('7002', 'TP', '6 Milepost Pl', 43.7, -79.34, ${T0})`;
    await owner`insert into building_floor (id, rsn, label, sort_order) values (${FLOOR_3}, '7001', '3', 3), (${FLOOR_4}, '7002', '4', 4)`;
    try {
      return await run();
    } finally {
      await owner`delete from ambassador_assignment`;
      await owner`delete from building_floor where rsn in ('7001', '7002')`;
      await owner`delete from building where rsn in ('7001', '7002')`;
    }
  }

  const formOf = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [name, value] of Object.entries(fields)) data.set(name, value);
    return data;
  };

  it("assigns the Ambassador to the building named in the form, saves and audits it, and sends the Admin back to the building", async () => {
    await withBuilding(async () => {
      const { id, phone } = await signedIn("admin", "hub");
      wired.sessions = phone.sessions;
      const nia = await account("nia", "ambassador");
      const { assignAmbassadorAction, removeAssignmentAction } = await import("../../src/app/staff/coverage/actions");
      const since = await lastAuditId();

      const assigned = await redirectOr(() => assignAmbassadorAction({ status: "idle" }, formOf({ rsn: "7001", staffId: nia.id, scope: "some", floorId: FLOOR_3 })));
      expect(assigned).toEqual({ redirect: "/staff/coverage?building=7001&done=assigned" });
      expect(await owner`select rsn, all_floors, assigned_by from ambassador_assignment where staff_id = ${nia.id}`).toEqual([{ rsn: "7001", all_floors: false, assigned_by: id }]);
      expect(await owner`select action, outcome, subject_id, meta from audit_event where id > ${since} and action like 'assignment.%'`).toEqual([
        { action: "assignment.saved", outcome: "ok", subject_id: "7001", meta: { staff_id: nia.id, rsn: "7001", floor_ids: [FLOOR_3] } },
      ]);

      // A floor of the other building is refused in the form's own words, and nothing changes.
      const refused = await redirectOr(() => assignAmbassadorAction({ status: "idle" }, formOf({ rsn: "7001", staffId: nia.id, scope: "some", floorId: FLOOR_4 })));
      expect(refused).toEqual({ value: { status: "refused", message: "One of those floors is not a floor of this building. Reload the page." } });
      expect(await owner`select count(*)::int as n from ambassador_assignment_floor where floor_id = ${FLOOR_4}`).toEqual([{ n: 0 }]);

      // Removing asks first: the first submit changes nothing.
      const asked = await redirectOr(() => removeAssignmentAction({ status: "idle" }, formOf({ rsn: "7001", staffId: nia.id, name: "Nia Mensah" })));
      expect(asked).toEqual({ value: { status: "confirm", message: "Remove Nia Mensah from this building? They stay an ambassador and stop covering it." } });
      expect(await owner`select count(*)::int as n from ambassador_assignment`).toEqual([{ n: 1 }]);

      const removed = await redirectOr(() => removeAssignmentAction({ status: "idle" }, formOf({ rsn: "7001", staffId: nia.id, confirm: "1" })));
      expect(removed).toEqual({ redirect: "/staff/coverage?building=7001&done=removed" });
      expect(await owner`select count(*)::int as n from ambassador_assignment`).toEqual([{ n: 0 }]);
    });
  });

  it("refuses an account that is not an Ambassador, and a form that names no building, without changing anything", async () => {
    await withBuilding(async () => {
      const { phone } = await signedIn("admin", "hub");
      wired.sessions = phone.sessions;
      const { assignAmbassadorAction } = await import("../../src/app/staff/coverage/actions");
      const coordinator = await account("coord", "coordinator");
      const before = await businessData();

      expect(await redirectOr(() => assignAmbassadorAction({ status: "idle" }, formOf({ rsn: "7001", staffId: coordinator.id, scope: "all" })))).toEqual({
        value: { status: "refused", message: "Only an ambassador can be assigned to a building." },
      });
      expect(await redirectOr(() => assignAmbassadorAction({ status: "idle" }, formOf({ staffId: coordinator.id, scope: "all" })))).toEqual({
        value: { status: "refused", message: "That building does not exist." },
      });
      expect(await businessData()).toEqual(before);
    });
  });
});
