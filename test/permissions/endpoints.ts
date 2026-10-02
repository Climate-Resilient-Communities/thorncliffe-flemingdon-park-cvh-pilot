// The permission test list (S01.12): every staff page, route handler and server action, the
// policy action it names, and what each kind of caller gets. test/db/permissions.db.test.ts calls
// each one directly, as every caller, against a real database; test/permission-list.test.ts fails
// when a staff endpoint on disk is missing here (or listed here but gone), so each story that adds
// an endpoint adds its row.
//
// Callers: no session, each role, and an Ambassador outside their assigned building (the test gives the
// guard's scope stub the assignments). A role caller stands at the endpoint's `gate` when the
// role can be there (gate 1 for everyone; gate 2 and the code gate only for Admins and
// Coordinators), at the Hub otherwise.
import type { SetupGate } from "../../src/contracts/staffAuth";
import type { PolicyAction } from "../../src/modules/identity";

export const ROLE_CALLERS = ["ambassador", "coordinator", "director", "admin", "ambassador_out_of_scope"] as const;
export type RoleCaller = (typeof ROLE_CALLERS)[number];

/**
 * What a signed-in caller gets:
 *  - `allowed`: the guard lets the call through to its own code (no `permission.denied`);
 *  - `forbidden`: the role policy refuses it: 403 `forbidden`, one `permission.denied` (a page: its refusal view or the Hub's home, unaudited);
 *  - `setup_incomplete`: the caller cannot be at the endpoint's gate: 403 `setup_incomplete` with
 *    one `permission.denied` (a page: their own gate's page, not audited).
 */
export type Outcome = "allowed" | "forbidden" | "setup_incomplete";

/**
 * What an endpoint writes: `business` (the Hub's data: accounts, and in later epics alerts,
 * guides, spend), `own_account` (the caller's own setup: their password, their authenticator) or
 * `none`. A Director is refused every `business` write (S01.12).
 */
export type Writes = "business" | "own_account" | "none";

interface EndpointBase {
  /** `page /staff/people`, `POST /api/staff/password` or `action src/app/staff/people/actions.ts#addPersonAction`. */
  id: string;
  /** The file under the repository root, and its export (`default`, the HTTP method, or the action's name). */
  file: string;
  export: string;
  /** The route pattern the guard audits. */
  route: string;
}

export interface StaffEndpoint extends EndpointBase {
  kind: "page" | "route" | "action";
  action: PolicyAction;
  writes: Writes;
  gate: SetupGate;
  /** A route handler's JSON body, or a server action's form fields: a real request, which would change data if allowed. */
  body?: unknown;
  form?: Record<string, string>;
  /** What a refused action's message starts with, when it is not the Admin-only default ("Only an Admin can ..."). */
  forbiddenMessage?: RegExp;
  expected: Record<RoleCaller, Outcome>;
}

const ADMIN_ONLY = { ambassador: "forbidden", coordinator: "forbidden", director: "forbidden", admin: "allowed", ambassador_out_of_scope: "forbidden" } as const;
const EVERYONE = { ambassador: "allowed", coordinator: "allowed", director: "allowed", admin: "allowed", ambassador_out_of_scope: "allowed" } as const;
/**
 * The coverage view (S01.14): `coverage.view` is for an Admin and a Coordinator, and a Director read-only; an Ambassador
 * is refused, whatever building they are assigned to.
 */
const COVERAGE_VIEWERS = { ambassador: "forbidden", coordinator: "allowed", director: "allowed", admin: "allowed", ambassador_out_of_scope: "forbidden" } as const;
/**
 * Choosing who an alert is for (S04.04): `alert.author_wide`, the neighbourhood scope and the neighbourhood-only types, which a
 * Coordinator and an Admin author. An Ambassador (who authors only for assigned buildings, in E08's own screens) and a
 * Director are refused, whatever building they are assigned to.
 */
const WIDE_AUTHORS = { ambassador: "forbidden", coordinator: "allowed", director: "forbidden", admin: "allowed", ambassador_out_of_scope: "forbidden" } as const;
/** Gate 2 and the code gate: only Admins and Coordinators stand there; Ambassadors and Directors are at the Hub. */
const AUTHENTICATOR_GATE = {
  ambassador: "setup_incomplete",
  coordinator: "allowed",
  director: "setup_incomplete",
  admin: "allowed",
  ambassador_out_of_scope: "setup_incomplete",
} as const;

/** The username of the account the account actions are aimed at (the test creates it). */
export const TARGET_USERNAME = "target";

const PEOPLE_ACTIONS = "src/app/staff/people/actions.ts";
const SMS_TEST_ACTIONS = "src/app/staff/sms-test/actions.ts";
const BUILDING_ACTIONS = "src/app/staff/buildings/actions.ts";
/** A building that does not exist: an Admin's call passes the guard and is then refused by the use case, changing nothing. */
const NO_SUCH_BUILDING = "7001";
const NO_SUCH_FLOOR = "01900000-0000-7000-8000-00000000f100";
const BUILDING_ACTION_NAMES = ["addFloorAction", "renameFloorAction", "removeFloorAction", "confirmBuildingAction", "setContactAction"] as const;
const COVERAGE_ACTIONS = "src/app/staff/coverage/actions.ts";
const ALERT_AUDIENCE_ACTIONS = "src/app/staff/alerts/audience/actions.ts";
/** An alert thread and entry that do not exist: a Coordinator's or an Admin's call passes the guard and is refused by the use case. */
const NO_SUCH_ALERT = "01900000-0000-7000-8000-00000000a1e7";
const PROVIDER_ACTIONS = "src/app/staff/providers/actions.ts";
const DIRECTORY_ACTIONS = "src/app/staff/directory/actions.ts";

/** The provider the provider actions are aimed at (the DB test loads it). */
export const PROVIDER_ID = "M001";

export const STAFF_ENDPOINTS: StaffEndpoint[] = [
  // ---- pages ----
  { id: "page /staff", kind: "page", file: "src/app/staff/page.tsx", export: "default", route: "/staff", action: "hub.open", writes: "none", gate: "hub", expected: EVERYONE },
  { id: "page /staff/people", kind: "page", file: "src/app/staff/people/page.tsx", export: "default", route: "/staff/people", action: "accounts.manage", writes: "none", gate: "hub", expected: ADMIN_ONLY },
  { id: "page /staff/providers", kind: "page", file: "src/app/staff/providers/page.tsx", export: "default", route: "/staff/providers", action: "provider.manage", writes: "none", gate: "hub", expected: ADMIN_ONLY },
  { id: "page /staff/sms-test", kind: "page", file: "src/app/staff/sms-test/page.tsx", export: "default", route: "/staff/sms-test", action: "sms.test_send", writes: "none", gate: "hub", expected: ADMIN_ONLY },
  { id: "page /staff/buildings", kind: "page", file: "src/app/staff/buildings/page.tsx", export: "default", route: "/staff/buildings", action: "buildings.manage", writes: "none", gate: "hub", expected: ADMIN_ONLY },
  { id: "page /staff/coverage", kind: "page", file: "src/app/staff/coverage/page.tsx", export: "default", route: "/staff/coverage", action: "coverage.view", writes: "none", gate: "hub", expected: COVERAGE_VIEWERS },
  { id: "page /staff/alerts/audience", kind: "page", file: "src/app/staff/alerts/audience/page.tsx", export: "default", route: "/staff/alerts/audience", action: "alert.author_wide", writes: "none", gate: "hub", expected: WIDE_AUTHORS },
  {
    id: "page /staff/alerts/audience/groups",
    kind: "page",
    file: "src/app/staff/alerts/audience/groups/page.tsx",
    export: "default",
    route: "/staff/alerts/audience/groups",
    action: "alert.author_wide",
    writes: "none",
    gate: "hub",
    expected: WIDE_AUTHORS,
  },
  { id: "page /staff/directory", kind: "page", file: "src/app/staff/directory/page.tsx", export: "default", route: "/staff/directory", action: "guide.publish", writes: "none", gate: "hub", expected: ADMIN_ONLY },
  {
    id: "page /staff/setup/password",
    kind: "page",
    file: "src/app/staff/setup/password/page.tsx",
    export: "default",
    route: "/staff/setup/password",
    action: "account.own_setup",
    writes: "none",
    gate: "choose_password",
    expected: EVERYONE,
  },
  {
    id: "page /staff/setup/authenticator",
    kind: "page",
    file: "src/app/staff/setup/authenticator/page.tsx",
    export: "default",
    route: "/staff/setup/authenticator",
    action: "account.own_setup",
    writes: "none",
    gate: "enrol_authenticator",
    expected: AUTHENTICATOR_GATE,
  },
  {
    id: "page /staff/sign-in/code",
    kind: "page",
    file: "src/app/staff/sign-in/code/page.tsx",
    export: "default",
    route: "/staff/sign-in/code",
    action: "account.own_setup",
    writes: "none",
    gate: "authenticator_code",
    expected: AUTHENTICATOR_GATE,
  },

  // ---- route handlers ----
  { id: "GET /api/staff/me", kind: "route", file: "src/app/api/staff/me/route.ts", export: "GET", route: "/api/staff/me", action: "session.read_own", writes: "none", gate: "hub", expected: EVERYONE },
  {
    id: "POST /api/staff/password",
    kind: "route",
    file: "src/app/api/staff/password/route.ts",
    export: "POST",
    route: "/api/staff/password",
    action: "account.own_setup",
    writes: "own_account",
    gate: "choose_password",
    body: { password: "a long enough own password 1", confirm: "a long enough own password 1" },
    expected: EVERYONE,
  },
  {
    id: "POST /api/staff/factor/enrol",
    kind: "route",
    file: "src/app/api/staff/factor/enrol/route.ts",
    export: "POST",
    route: "/api/staff/factor/enrol",
    action: "account.own_setup",
    writes: "own_account",
    gate: "enrol_authenticator",
    body: {},
    expected: AUTHENTICATOR_GATE,
  },
  {
    id: "POST /api/staff/factor/verify",
    kind: "route",
    file: "src/app/api/staff/factor/verify/route.ts",
    export: "POST",
    route: "/api/staff/factor/verify",
    action: "account.own_setup",
    writes: "own_account",
    gate: "authenticator_code",
    body: { code: "000000" },
    expected: AUTHENTICATOR_GATE,
  },

  // ---- server actions ----
  {
    id: `action ${PEOPLE_ACTIONS}#addPersonAction`,
    kind: "action",
    file: PEOPLE_ACTIONS,
    export: "addPersonAction",
    route: "/staff/people",
    action: "accounts.manage",
    writes: "business",
    gate: "hub",
    form: { username: "newperson", firstName: "Nia", lastName: "Mensah", email: "nia@example.org", role: "ambassador" },
    expected: ADMIN_ONLY,
  },
  {
    id: `action ${PEOPLE_ACTIONS}#reissueAction`,
    kind: "action",
    file: PEOPLE_ACTIONS,
    export: "reissueAction",
    route: "/staff/people",
    action: "accounts.manage",
    writes: "business",
    gate: "hub",
    form: { username: TARGET_USERNAME },
    expected: ADMIN_ONLY,
  },
  {
    id: `action ${PEOPLE_ACTIONS}#resetPasswordAction`,
    kind: "action",
    file: PEOPLE_ACTIONS,
    export: "resetPasswordAction",
    route: "/staff/people",
    action: "accounts.manage",
    writes: "business",
    gate: "hub",
    form: { username: TARGET_USERNAME },
    expected: ADMIN_ONLY,
  },
  // S01.15 (the first-text spike; E06 removes it). Called as an allowed Admin, the action reaches the use case,
  // which in the test's environment (no production variables) answers that texts cannot be sent: no provider is called.
  {
    id: `action ${SMS_TEST_ACTIONS}#sendTestTextAction`,
    kind: "action",
    file: SMS_TEST_ACTIONS,
    export: "sendTestTextAction",
    route: "/staff/sms-test",
    action: "sms.test_send",
    writes: "business",
    gate: "hub",
    form: { requestId: "01900000-0000-7000-8000-00000000f015", number: "+14165550101" },
    expected: ADMIN_ONLY,
  },
  ...BUILDING_ACTION_NAMES.map(
    (name): StaffEndpoint => ({
      id: `action ${BUILDING_ACTIONS}#${name}`,
      kind: "action",
      file: BUILDING_ACTIONS,
      export: name,
      route: "/staff/buildings",
      action: "buildings.manage",
      writes: "business",
      gate: "hub",
      form: { rsn: NO_SUCH_BUILDING, floorId: NO_SUCH_FLOOR, label: "G", place: "bottom" },
      expected: ADMIN_ONLY,
    }),
  ),
  {
    id: `action ${PEOPLE_ACTIONS}#resetAuthenticatorAction`,
    kind: "action",
    file: PEOPLE_ACTIONS,
    export: "resetAuthenticatorAction",
    route: "/staff/people",
    action: "accounts.manage",
    writes: "business",
    gate: "hub",
    form: { username: TARGET_USERNAME },
    expected: ADMIN_ONLY,
  },
  // S01.14: assign an ambassador to a building and remove an assignment (policy action `accounts.manage`, Admins at aal2).
  // The building does not exist, so an Admin's call passes the guard and is then refused by the use case, changing nothing.
  ...(["assignAmbassadorAction", "removeAssignmentAction"] as const).map(
    (name): StaffEndpoint => ({
      id: `action ${COVERAGE_ACTIONS}#${name}`,
      kind: "action",
      file: COVERAGE_ACTIONS,
      export: name,
      route: "/staff/coverage",
      action: "accounts.manage",
      writes: "business",
      gate: "hub",
      form: { rsn: NO_SUCH_BUILDING, staffId: NO_SUCH_FLOOR, scope: "all" },
      expected: ADMIN_ONLY,
    }),
  ),
  // S04.04: the place picker (O-03) and the group picker (O-04), policy action `alert.author_wide`. The draft does not exist, so a
  // Coordinator's or an Admin's call passes the guard and is then refused by the use case ("that alert draft was not found"),
  // changing nothing. An Ambassador, a Director and an Ambassador outside their building are refused by the guard on the
  // role alone: the neighbourhood scope and heat, smoke and winter storm are for a Coordinator or an Admin to author.
  {
    id: `action ${ALERT_AUDIENCE_ACTIONS}#savePlaceAction`,
    kind: "action",
    file: ALERT_AUDIENCE_ACTIONS,
    export: "savePlaceAction",
    route: "/staff/alerts/audience",
    action: "alert.author_wide",
    writes: "business",
    gate: "hub",
    form: { alert: NO_SUCH_ALERT, entry: NO_SUCH_ALERT, scope: "neighbourhood", neighbourhood: "TP" },
    forbiddenMessage: /^Only a Coordinator or an Admin can /,
    expected: WIDE_AUTHORS,
  },
  {
    id: `action ${ALERT_AUDIENCE_ACTIONS}#saveGroupsAction`,
    kind: "action",
    file: ALERT_AUDIENCE_ACTIONS,
    export: "saveGroupsAction",
    route: "/staff/alerts/audience/groups",
    action: "alert.author_wide",
    writes: "business",
    gate: "hub",
    form: { alert: NO_SUCH_ALERT, entry: NO_SUCH_ALERT, group: "seniors" },
    forbiddenMessage: /^Only a Coordinator or an Admin can /,
    expected: WIDE_AUTHORS,
  },
  // S02.04: publish, unpublish and confirm a provider (policy action `provider.manage`, Admins at aal2).
  ...(["publishProviderAction", "unpublishProviderAction", "confirmProviderAction"] as const).map(
    (name): StaffEndpoint => ({
      id: `action ${PROVIDER_ACTIONS}#${name}`,
      kind: "action",
      file: PROVIDER_ACTIONS,
      export: name,
      route: "/staff/providers",
      action: "provider.manage",
      writes: "business",
      gate: "hub",
      form: { providerId: PROVIDER_ID, date: "2026-10-01" },
      expected: ADMIN_ONLY,
    }),
  ),
  // S02.05: "Publish directory" (policy action `guide.publish`, Admins at aal2).
  {
    id: `action ${DIRECTORY_ACTIONS}#publishDirectoryAction`,
    kind: "action",
    file: DIRECTORY_ACTIONS,
    export: "publishDirectoryAction",
    route: "/staff/directory",
    action: "guide.publish",
    writes: "business",
    gate: "hub",
    form: {},
    expected: ADMIN_ONLY,
  },
];

/** The endpoints anyone may call, without a session (S01.07): listed so the completeness check knows them. */
export const PUBLIC_ENDPOINTS: EndpointBase[] = [
  { id: "page /staff/sign-in", file: "src/app/staff/sign-in/page.tsx", export: "default", route: "/staff/sign-in" },
  { id: "POST /api/staff/sign-in", file: "src/app/api/staff/sign-in/route.ts", export: "POST", route: "/api/staff/sign-in" },
  { id: "POST /api/staff/sign-out", file: "src/app/api/staff/sign-out/route.ts", export: "POST", route: "/api/staff/sign-out" },
];
