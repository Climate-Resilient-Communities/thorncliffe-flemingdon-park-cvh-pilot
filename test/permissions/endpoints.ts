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
import type { PolicyAction, PolicyContext } from "../../src/modules/identity";

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
  /**
   * The facts the guard judges the call on when the role's rule depends on them, as the test's requests give them (test/permission-list.test.ts asks `can` with
   * them): the approval is for someone who is not an editor of the entry, and the entry these calls name is not there, so nobody is excluded from it.
   */
  policyContext?: PolicyContext;
  /**
   * The reason the refusal is audited with for a role whose rule depends on the context (the policy's `out_of_scope`), when it is not `forbidden`: the answer is
   * the same 403 `forbidden`. A correction or a withdrawal: an Ambassador's rule is their own pending entry (E08), which these calls never name.
   */
  auditedReason?: Partial<Record<RoleCaller, "out_of_scope">>;
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

/** An entry that is not there, as the approval's guard reads it: no editors, so no one is excluded from approving it (src/app/staff/alerts/approval/entryFacts.ts). */
const NO_ENTRY: PolicyContext = { actorId: "01900000-0000-7000-8000-0000000000aa", entry: { authorId: "00000000-0000-0000-0000-000000000000", editorIds: [], status: "pending_approval" } };

/** The username of the account the account actions are aimed at (the test creates it). */
export const TARGET_USERNAME = "target";

const PEOPLE_ACTIONS = "src/app/staff/people/actions.ts";
const BUILDING_ACTIONS = "src/app/staff/buildings/actions.ts";
/** A building that does not exist: an Admin's call passes the guard and is then refused by the use case, changing nothing. */
const NO_SUCH_BUILDING = "7001";
const NO_SUCH_FLOOR = "01900000-0000-7000-8000-00000000f100";
const BUILDING_ACTION_NAMES = ["addFloorAction", "renameFloorAction", "removeFloorAction", "confirmBuildingAction", "setContactAction"] as const;
const COVERAGE_ACTIONS = "src/app/staff/coverage/actions.ts";
const ALERT_AUDIENCE_ACTIONS = "src/app/staff/alerts/audience/actions.ts";
const ALERT_LOG_ACTIONS = "src/app/staff/alerts/log/actions.ts";
const ALERT_COMPOSER_ACTIONS = "src/app/staff/alerts/composer/actions.ts";
const ALERT_APPROVAL_ACTIONS = "src/app/staff/alerts/approval/actions.ts";
const ALERT_CORRECT_ACTIONS = "src/app/staff/alerts/correct/actions.ts";
/** The key of one press of Submit: what a browser makes with `crypto.randomUUID()`. */
const SUBMIT_KEY = "0f0e0d0c-0b0a-4908-8706-050403020100";
/** An alert thread and entry that do not exist: a Coordinator's or an Admin's call passes the guard and is refused by the use case. */
const NO_SUCH_ALERT = "01900000-0000-7000-8000-00000000a1e7";
const PROVIDER_ACTIONS = "src/app/staff/providers/actions.ts";
const DIRECTORY_ACTIONS = "src/app/staff/directory/actions.ts";
const TEXTS_ACTIONS = "src/app/staff/texts/actions.ts";
const ONCALL_ACTIONS = "src/app/staff/oncall/actions.ts";
const DRILL_ROSTER_ACTIONS = "src/app/staff/drills/roster/actions.ts";
const DRILL_START_ACTIONS = "src/app/staff/drills/start/actions.ts";

/** The provider the provider actions are aimed at (the DB test loads it). */
export const PROVIDER_ID = "M001";

export const STAFF_ENDPOINTS: StaffEndpoint[] = [
  // ---- pages ----
  { id: "page /staff", kind: "page", file: "src/app/staff/page.tsx", export: "default", route: "/staff", action: "hub.open", writes: "none", gate: "hub", expected: EVERYONE },
  { id: "page /staff/people", kind: "page", file: "src/app/staff/people/page.tsx", export: "default", route: "/staff/people", action: "accounts.manage", writes: "none", gate: "hub", expected: ADMIN_ONLY },
  { id: "page /staff/providers", kind: "page", file: "src/app/staff/providers/page.tsx", export: "default", route: "/staff/providers", action: "provider.manage", writes: "none", gate: "hub", expected: ADMIN_ONLY },
  { id: "page /staff/buildings", kind: "page", file: "src/app/staff/buildings/page.tsx", export: "default", route: "/staff/buildings", action: "buildings.manage", writes: "none", gate: "hub", expected: ADMIN_ONLY },
  { id: "page /staff/coverage", kind: "page", file: "src/app/staff/coverage/page.tsx", export: "default", route: "/staff/coverage", action: "coverage.view", writes: "none", gate: "hub", expected: COVERAGE_VIEWERS },
  // S06.09: the sending progress of an approved entry and the list of its texts that did not arrive: policy action `coverage.view` ("See counts and coverage"), read only.
  // The pages name no entry here, so a role let through gets the page's own "not found" and reads no counts.
  { id: "page /staff/alerts/sending", kind: "page", file: "src/app/staff/alerts/sending/page.tsx", export: "default", route: "/staff/alerts/sending", action: "coverage.view", writes: "none", gate: "hub", expected: COVERAGE_VIEWERS },
  { id: "page /staff/alerts/sending/texts", kind: "page", file: "src/app/staff/alerts/sending/texts/page.tsx", export: "default", route: "/staff/alerts/sending/texts", action: "coverage.view", writes: "none", gate: "hub", expected: COVERAGE_VIEWERS },
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
  // S04.05: "Log a disruption" (O-11), the acknowledgement composer (O-12) and the alert composer (O-02): policy action `alert.author_wide`.
  { id: "page /staff/alerts/log", kind: "page", file: "src/app/staff/alerts/log/page.tsx", export: "default", route: "/staff/alerts/log", action: "alert.author_wide", writes: "none", gate: "hub", expected: WIDE_AUTHORS },
  { id: "page /staff/alerts/ack", kind: "page", file: "src/app/staff/alerts/ack/page.tsx", export: "default", route: "/staff/alerts/ack", action: "alert.author_wide", writes: "none", gate: "hub", expected: WIDE_AUTHORS },
  { id: "page /staff/alerts/compose", kind: "page", file: "src/app/staff/alerts/compose/page.tsx", export: "default", route: "/staff/alerts/compose", action: "alert.author_wide", writes: "none", gate: "hub", expected: WIDE_AUTHORS },
  // S05.01: "Add an update" (O-14) and "Promote to full alert" (O-13), the update composers: policy action `alert.author_wide`, like the composers they are.
  { id: "page /staff/alerts/update", kind: "page", file: "src/app/staff/alerts/update/page.tsx", export: "default", route: "/staff/alerts/update", action: "alert.author_wide", writes: "none", gate: "hub", expected: WIDE_AUTHORS },
  { id: "page /staff/alerts/promote", kind: "page", file: "src/app/staff/alerts/promote/page.tsx", export: "default", route: "/staff/alerts/promote", action: "alert.author_wide", writes: "none", gate: "hub", expected: WIDE_AUTHORS },
  // S05.03: "Mark resolved" (O-16), the page of the final message: policy action `alert.author_wide`, like the other composers (an Ambassador's own screen for it is E08's).
  { id: "page /staff/alerts/resolve", kind: "page", file: "src/app/staff/alerts/resolve/page.tsx", export: "default", route: "/staff/alerts/resolve", action: "alert.author_wide", writes: "none", gate: "hub", expected: WIDE_AUTHORS },
  // S05.02: "Correct" and "Withdraw" (O-15): policy actions `alert.correct` and `alert.withdraw`, a Coordinator or an Admin. An Ambassador corrects or withdraws only their own
  // pending entries (E08): the entry these pages judge on is one nobody wrote in the call, so an Ambassador is refused on the rule alone; a Director is refused on their role.
  { id: "page /staff/alerts/correct", kind: "page", file: "src/app/staff/alerts/correct/page.tsx", export: "default", route: "/staff/alerts/correct", action: "alert.correct", writes: "none", gate: "hub", policyContext: NO_ENTRY, expected: WIDE_AUTHORS },
  { id: "page /staff/alerts/withdraw", kind: "page", file: "src/app/staff/alerts/withdraw/page.tsx", export: "default", route: "/staff/alerts/withdraw", action: "alert.withdraw", writes: "none", gate: "hub", policyContext: NO_ENTRY, expected: WIDE_AUTHORS },
  // S04.07: the approval view (O-05, O-07): policy action `alert.approve`, a Coordinator or an Admin who is not an editor of the entry (the guard reads who
  // edited it from the database). The page names no entry here, so a Coordinator or an Admin is let through to the page's own "not found".
  {
    id: "page /staff/alerts/approve",
    kind: "page",
    file: "src/app/staff/alerts/approve/page.tsx",
    export: "default",
    route: "/staff/alerts/approve",
    action: "alert.approve",
    writes: "none",
    gate: "hub",
    policyContext: NO_ENTRY,
    expected: WIDE_AUTHORS,
  },
  { id: "page /staff/directory", kind: "page", file: "src/app/staff/directory/page.tsx", export: "default", route: "/staff/directory", action: "guide.publish", writes: "none", gate: "hub", expected: ADMIN_ONLY },
  { id: "page /staff/texts", kind: "page", file: "src/app/staff/texts/page.tsx", export: "default", route: "/staff/texts", action: "sending.pause", writes: "none", gate: "hub", expected: ADMIN_ONLY },
  { id: "page /staff/oncall", kind: "page", file: "src/app/staff/oncall/page.tsx", export: "default", route: "/staff/oncall", action: "oncall.manage", writes: "none", gate: "hub", expected: ADMIN_ONLY },
  { id: "page /staff/drills", kind: "page", file: "src/app/staff/drills/page.tsx", export: "default", route: "/staff/drills", action: "drill.run", writes: "none", gate: "hub", expected: ADMIN_ONLY },
  { id: "page /staff/drills/roster", kind: "page", file: "src/app/staff/drills/roster/page.tsx", export: "default", route: "/staff/drills/roster", action: "drill.run", writes: "none", gate: "hub", expected: ADMIN_ONLY },
  { id: "page /staff/drills/start", kind: "page", file: "src/app/staff/drills/start/page.tsx", export: "default", route: "/staff/drills/start", action: "drill.run", writes: "none", gate: "hub", expected: ADMIN_ONLY },
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
  // S04.05: Submit, "Try translation again" and the entry's state (policy action `alert.author_wide`). The entry does not exist, so a
  // Coordinator's or an Admin's call passes the guard and is refused by the use case (or, for the state, by its lookup), changing nothing.
  {
    id: "POST /api/staff/alerts/entries/submit",
    kind: "route",
    file: "src/app/api/staff/alerts/entries/submit/route.ts",
    export: "POST",
    route: "/api/staff/alerts/entries/submit",
    action: "alert.author_wide",
    writes: "business",
    gate: "hub",
    body: { v: 1, alert_id: NO_SUCH_ALERT, entry_id: NO_SUCH_ALERT, key: SUBMIT_KEY },
    expected: WIDE_AUTHORS,
  },
  {
    id: "POST /api/staff/alerts/entries/retranslate",
    kind: "route",
    file: "src/app/api/staff/alerts/entries/retranslate/route.ts",
    export: "POST",
    route: "/api/staff/alerts/entries/retranslate",
    action: "alert.author_wide",
    writes: "business",
    gate: "hub",
    body: { v: 1, alert_id: NO_SUCH_ALERT, entry_id: NO_SUCH_ALERT, key: SUBMIT_KEY, seen_version: 1, seen_hash: "0".repeat(64) },
    expected: WIDE_AUTHORS,
  },
  {
    id: "GET /api/staff/alerts/entries/state",
    kind: "route",
    file: "src/app/api/staff/alerts/entries/state/route.ts",
    export: "GET",
    route: "/api/staff/alerts/entries/state",
    action: "alert.author_wide",
    writes: "none",
    gate: "hub",
    expected: WIDE_AUTHORS,
  },
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
  // S04.05: "Log a disruption" and the composers' Save draft and Pull back to edit (policy action `alert.author_wide`). "Log a disruption" is
  // sent with no type ticked and the composers' actions name a draft that does not exist, so a Coordinator's or an Admin's call passes the guard
  // and is refused by the form or the use case, changing nothing.
  {
    id: `action ${ALERT_LOG_ACTIONS}#logDisruptionAction`,
    kind: "action",
    file: ALERT_LOG_ACTIONS,
    export: "logDisruptionAction",
    route: "/staff/alerts/log",
    action: "alert.author_wide",
    writes: "business",
    gate: "hub",
    form: { kind: "ack" },
    forbiddenMessage: /^Only a Coordinator or an Admin can /,
    expected: WIDE_AUTHORS,
  },
  ...(["saveDraftAction", "pullBackAction"] as const).map(
    (name): StaffEndpoint => ({
      id: `action ${ALERT_COMPOSER_ACTIONS}#${name}`,
      kind: "action",
      file: ALERT_COMPOSER_ACTIONS,
      export: name,
      route: "/staff/alerts/compose",
      action: "alert.author_wide",
      writes: "business",
      gate: "hub",
      form: { alert: NO_SUCH_ALERT, entry: NO_SUCH_ALERT },
      forbiddenMessage: /^Only a Coordinator or an Admin can /,
      expected: WIDE_AUTHORS,
    }),
  ),
  // S05.01: "Save draft" on a new update (policy action `alert.author_wide`). The thread does not exist, so a Coordinator's or an Admin's call passes the guard and is
  // refused by the use case ("that alert draft was not found"), changing nothing. An Ambassador and a Director are refused on their role alone.
  {
    id: `action ${ALERT_COMPOSER_ACTIONS}#startUpdateAction`,
    kind: "action",
    file: ALERT_COMPOSER_ACTIONS,
    export: "startUpdateAction",
    route: "/staff/alerts/update",
    action: "alert.author_wide",
    writes: "business",
    gate: "hub",
    form: { alert: NO_SUCH_ALERT, entry: NO_SUCH_ALERT, from: "update", text: "Power is back on floors 1 to 4.", phase: "in_progress", "valid-mode": "resolved" },
    forbiddenMessage: /^Only a Coordinator or an Admin can /,
    expected: WIDE_AUTHORS,
  },
  // S05.03: "Save draft" on a new final message (policy action `alert.author_wide`). The thread does not exist, so a Coordinator's or an Admin's call passes the guard and is
  // refused by the use case, changing nothing. An Ambassador and a Director are refused on their role alone.
  {
    id: `action ${ALERT_COMPOSER_ACTIONS}#startFinalAction`,
    kind: "action",
    file: ALERT_COMPOSER_ACTIONS,
    export: "startFinalAction",
    route: "/staff/alerts/resolve",
    action: "alert.author_wide",
    writes: "business",
    gate: "hub",
    form: { alert: NO_SUCH_ALERT, entry: NO_SUCH_ALERT, from: "resolve", text: "Power is back on all floors." },
    forbiddenMessage: /^Only a Coordinator or an Admin can /,
    expected: WIDE_AUTHORS,
  },
  // S05.02: "Save draft" on a new correction or withdrawal (policy actions `alert.correct` and `alert.withdraw`, privileged: aal2). The thread does not exist, so a Coordinator's or an
  // Admin's call passes the guard and is refused by the use case, changing nothing. An Ambassador (direct requests are refused now; their own pending entries are E08's) and a Director
  // are refused on their role.
  ...(
    [
      ["startCorrectionAction", "/staff/alerts/correct", "alert.correct"],
      ["startWithdrawalAction", "/staff/alerts/withdraw", "alert.withdraw"],
    ] as const
  ).map(
    ([name, route, action]): StaffEndpoint => ({
      id: `action ${ALERT_CORRECT_ACTIONS}#${name}`,
      kind: "action",
      file: ALERT_CORRECT_ACTIONS,
      export: name,
      route,
      action,
      writes: "business",
      gate: "hub",
      form: { alert: NO_SUCH_ALERT, entry: NO_SUCH_ALERT, target: NO_SUCH_ALERT, from: action === "alert.correct" ? "correct" : "withdraw", text: "Power is out on floors 1 to 8.", phase: "problem", reason: "wrong_place", "valid-mode": "resolved" },
      forbiddenMessage: /^Only a Coordinator or an Admin can correct or withdraw an alert\./,
      policyContext: NO_ENTRY,
      auditedReason: { ambassador: "out_of_scope", ambassador_out_of_scope: "out_of_scope" },
      expected: WIDE_AUTHORS,
    }),
  ),
  // S04.07: Approve, Return to author and Discard on the approval view (policy action `alert.approve`, a privileged action: aal2, and never an editor of the
  // entry). The entry does not exist, so a Coordinator's or an Admin's call passes the guard and is refused by the form or the use case, changing nothing. An
  // Ambassador and a Director are refused on their role alone.
  ...(["approveAction", "returnAction", "discardAction"] as const).map(
    (name): StaffEndpoint => ({
      id: `action ${ALERT_APPROVAL_ACTIONS}#${name}`,
      kind: "action",
      file: ALERT_APPROVAL_ACTIONS,
      export: name,
      route: "/staff/alerts/approve",
      action: "alert.approve",
      writes: "business",
      gate: "hub",
      form: { alert: NO_SUCH_ALERT, entry: NO_SUCH_ALERT, version: "1", hash: "0".repeat(64), reviewed: '{"v":1,"total":0,"by_lang":{}}', note: "Add the floors." },
      forbiddenMessage: /^Only a Coordinator or an Admin who did not write or change this alert can approve it\./,
      policyContext: NO_ENTRY,
      expected: WIDE_AUTHORS,
    }),
  ),
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
  // S06.06: "Pause all texts" and "Resume texts" (policy action `sending.pause`, Admins at aal2). Called as an allowed Admin, the pause
  // really pauses texts and the resume ends it (test/db/permissions.db.test.ts clears the switch before each call); no text can go out
  // from here: the test wires no sender, and starting one after a resume is a no-op.
  {
    id: `action ${TEXTS_ACTIONS}#pauseTextsAction`,
    kind: "action",
    file: TEXTS_ACTIONS,
    export: "pauseTextsAction",
    route: "/staff/texts",
    action: "sending.pause",
    writes: "business",
    gate: "hub",
    form: { reason: "Wrong alert sent to a building" },
    expected: ADMIN_ONLY,
  },
  {
    id: `action ${TEXTS_ACTIONS}#resumeTextsAction`,
    kind: "action",
    file: TEXTS_ACTIONS,
    export: "resumeTextsAction",
    route: "/staff/texts",
    action: "sending.pause",
    writes: "business",
    gate: "hub",
    form: {},
    expected: ADMIN_ONLY,
  },
  // S06.07: "Add number" and "Remove" (policy action `oncall.manage`, Admins at aal2). Called as an allowed Admin,
  // the add really adds a (fictional) number to the roster (test/db/permissions.db.test.ts clears the roster before each call) and the remove
  // is refused because no such entry exists; nothing is sent.
  {
    id: `action ${ONCALL_ACTIONS}#addOncallAction`,
    kind: "action",
    file: ONCALL_ACTIONS,
    export: "addOncallAction",
    route: "/staff/oncall",
    action: "oncall.manage",
    writes: "business",
    gate: "hub",
    form: { label: "IT lead", number: "416-555-0123" },
    expected: ADMIN_ONLY,
  },
  {
    id: `action ${ONCALL_ACTIONS}#removeOncallAction`,
    kind: "action",
    file: ONCALL_ACTIONS,
    export: "removeOncallAction",
    route: "/staff/oncall",
    action: "oncall.manage",
    writes: "business",
    gate: "hub",
    form: { id: "01900000-0000-7000-8000-0000000000e9" },
    expected: ADMIN_ONLY,
  },
  // S06.05: "Add phone", "Save changes" and "Remove" of the drill roster, and "Start a drill" (policy action `drill.run`, Admins at aal2). Called as an allowed Admin,
  // the add really adds a (fictional) phone to the roster (test/db/permissions.db.test.ts clears the roster before each call), the edit and the remove are refused because
  // no such phone exists, and the start is refused by the form (no type ticked), so nothing is sent and no drill is made.
  {
    id: `action ${DRILL_ROSTER_ACTIONS}#addDrillPhoneAction`,
    kind: "action",
    file: DRILL_ROSTER_ACTIONS,
    export: "addDrillPhoneAction",
    route: "/staff/drills/roster",
    action: "drill.run",
    writes: "business",
    gate: "hub",
    form: { label: "Hub phone", number: "416-555-0123", lang: "en" },
    expected: ADMIN_ONLY,
  },
  {
    id: `action ${DRILL_ROSTER_ACTIONS}#editDrillPhoneAction`,
    kind: "action",
    file: DRILL_ROSTER_ACTIONS,
    export: "editDrillPhoneAction",
    route: "/staff/drills/roster",
    action: "drill.run",
    writes: "business",
    gate: "hub",
    form: { id: "01900000-0000-7000-8000-0000000000e9", label: "Hub phone", number: "", lang: "en" },
    expected: ADMIN_ONLY,
  },
  {
    id: `action ${DRILL_ROSTER_ACTIONS}#removeDrillPhoneAction`,
    kind: "action",
    file: DRILL_ROSTER_ACTIONS,
    export: "removeDrillPhoneAction",
    route: "/staff/drills/roster",
    action: "drill.run",
    writes: "business",
    gate: "hub",
    form: { id: "01900000-0000-7000-8000-0000000000e9" },
    expected: ADMIN_ONLY,
  },
  {
    id: `action ${DRILL_START_ACTIONS}#startDrillAction`,
    kind: "action",
    file: DRILL_START_ACTIONS,
    export: "startDrillAction",
    route: "/staff/drills/start",
    action: "drill.run",
    writes: "business",
    gate: "hub",
    form: { kind: "ack" },
    expected: ADMIN_ONLY,
  },
];

/** The endpoints anyone may call, without a session (S01.07): listed so the completeness check knows them. */
export const PUBLIC_ENDPOINTS: EndpointBase[] = [
  { id: "page /staff/sign-in", file: "src/app/staff/sign-in/page.tsx", export: "default", route: "/staff/sign-in" },
  { id: "POST /api/staff/sign-in", file: "src/app/api/staff/sign-in/route.ts", export: "POST", route: "/api/staff/sign-in" },
  { id: "POST /api/staff/sign-out", file: "src/app/api/staff/sign-out/route.ts", export: "POST", route: "/api/staff/sign-out" },
];
