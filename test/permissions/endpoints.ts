// The permission test list (S01.12): every staff page, route handler and server action, the
// policy action it names, and what each kind of caller gets. test/db/permissions.db.test.ts calls
// each one directly, as every caller, against a real database; test/permission-list.test.ts fails
// when a staff endpoint on disk is missing here (or listed here but gone), so each story that adds
// an endpoint adds its row.
//
// Callers: no session, each role, and an Ambassador outside their assigned building (until S01.14
// the assignments are a stub in the test). A role caller stands at the endpoint's `gate` when the
// role can be there (gate 1 for everyone; gate 2 and the code gate only for Admins and
// Coordinators), at the Hub otherwise.
import type { SetupGate } from "../../src/contracts/staffAuth";
import type { PolicyAction } from "../../src/modules/identity";

export const ROLE_CALLERS = ["ambassador", "coordinator", "director", "admin", "ambassador_out_of_scope"] as const;
export type RoleCaller = (typeof ROLE_CALLERS)[number];

/**
 * What a signed-in caller gets:
 *  - `allowed`: the guard lets the call through to its own code (no `permission.denied`);
 *  - `forbidden`: the role policy refuses it: 403 `forbidden` (a page: the Hub's home), one `permission.denied`;
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
  expected: Record<RoleCaller, Outcome>;
}

const ADMIN_ONLY = { ambassador: "forbidden", coordinator: "forbidden", director: "forbidden", admin: "allowed", ambassador_out_of_scope: "forbidden" } as const;
const EVERYONE = { ambassador: "allowed", coordinator: "allowed", director: "allowed", admin: "allowed", ambassador_out_of_scope: "allowed" } as const;
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

export const STAFF_ENDPOINTS: StaffEndpoint[] = [
  // ---- pages ----
  { id: "page /staff", kind: "page", file: "src/app/staff/page.tsx", export: "default", route: "/staff", action: "hub.open", writes: "none", gate: "hub", expected: EVERYONE },
  { id: "page /staff/people", kind: "page", file: "src/app/staff/people/page.tsx", export: "default", route: "/staff/people", action: "accounts.manage", writes: "none", gate: "hub", expected: ADMIN_ONLY },
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
];

/** The endpoints anyone may call, without a session (S01.07): listed so the completeness check knows them. */
export const PUBLIC_ENDPOINTS: EndpointBase[] = [
  { id: "page /staff/sign-in", file: "src/app/staff/sign-in/page.tsx", export: "default", route: "/staff/sign-in" },
  { id: "POST /api/staff/sign-in", file: "src/app/api/staff/sign-in/route.ts", export: "POST", route: "/api/staff/sign-in" },
  { id: "POST /api/staff/sign-out", file: "src/app/api/staff/sign-out/route.ts", export: "POST", route: "/api/staff/sign-out" },
];
