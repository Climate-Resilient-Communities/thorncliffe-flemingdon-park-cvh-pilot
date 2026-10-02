// The one server-side guard of the staff surface (AD-4, S01.07): every `/staff` page, every
// `/api/staff` route handler and every staff server action is built with one of the wrappers
// below, and test/staff-guard.test.ts fails if a route file under src/app/staff or
// src/app/api/staff exports anything that is not.
//
// Each wrapper resolves the session (./session.ts) and applies the setup sequence before the
// route's own code runs: no session → sign-in (pages and actions) or 401 `unauthenticated` (route
// handlers); a session at
// another setup gate than the route's → that gate's page (pages) or 403 `setup_incomplete`
// (route handlers and actions). Fail closed: a route must name its access, and only the sign-in
// page and the sign-in and sign-out calls are public.
//
// The role policy (S01.12): every guarded page, route handler and server action names its policy
// action (`action`, one of identity's POLICY_ACTIONS). After the setup gate the guard asks
// `can(role, action, context)`; a refused call is a 403 `forbidden` with one `permission.denied`
// record, before the route's own code (a page shows its refusal view instead, unaudited). The
// context is the person's id and, only when the role's rule depends on it, their assignments
// (./scope.ts) and the facts the route gives about the call (`context`: the building, floor or
// entry it is on).
//
// requireAal2 (S01.10): then, when the action is one of identity's PRIVILEGED_ACTIONS, the guard
// refuses it with 403 `aal2_required` unless the session is `aal2` (the level the server read from
// the verified token and bound to the session, never anything the screen sent).
//
// Without a session a route handler answers 401. A server action has no status of its own: it
// sends the person to sign-in (Next's redirect) and audits the refusal with status 401.
import { redirect } from "next/navigation";
import { createElement, type ReactNode } from "react";
import { GATE_PAGES, SIGN_IN_PAGE, type SetupGate, type StaffApiError } from "@/contracts/staffAuth";
import {
  decidePolicy,
  isPrivilegedAction,
  meetsAssurance,
  needsPolicyContext,
  type PolicyAction,
  type PolicyContext,
  type PrivilegedAction,
} from "@/modules/identity";
import { identity, staffAuth } from "./identity";
import { assignmentsOf } from "./scope";
import { currentStaffSession, type StaffSession } from "./session";

/**
 * Who may use a route:
 *  - `public`: anyone (the sign-in page, sign-in and sign-out); the session is passed when there is one;
 *  - `any_gate`: any signed-in staff member, at whatever setup gate (`GET /api/staff/me`);
 *  - a gate: signed-in staff at exactly that gate (each gate's page and calls; `hub` is everything else);
 *  - a list of gates: signed-in staff at any of them (`POST /api/staff/factor/verify` takes the
 *    enrolment's code and a sign-in's code).
 */
export type RouteAccess = "public" | "any_gate" | SetupGate | readonly SetupGate[];

export interface GuardSpec {
  /** The route pattern (`/api/staff/password`), audited on refusals; never a value from the request. */
  route: string;
  access: RouteAccess;
  /** The policy action (S01.12) the role policy decides on. Every route but a public one names one. */
  action?: PolicyAction;
  /**
   * Set by the guard from `action`, never by a route: the privileged action this route handler or
   * server action performs (S01.10), which then runs only from an `aal2` session (requireAal2).
   * Pages never carry one: they show, and their actions act.
   */
  privileged?: PrivilegedAction;
}

/** What a guarded (non-public) route declares: its pattern, the gates it serves and its policy action. */
export interface StaffSpec {
  route: string;
  access: Exclude<RouteAccess, "public">;
  action: PolicyAction;
}

/** The facts about a call that the role policy may need: the building, floor or entry it is on (PolicyContext). */
export type PolicyFacts = Pick<PolicyContext, "target" | "entry" | "alertOpen">;

const GUARD = Symbol.for("cvh.staff.guard");

type Guarded = { [GUARD]?: GuardSpec };

function mark<F extends object>(fn: F, spec: { route: string; access: RouteAccess; action?: PolicyAction }, kind: "page" | "call"): F {
  const { route, access, action } = spec;
  const marked: GuardSpec = action === undefined ? { route, access } : { route, access, action };
  if (kind === "call" && action !== undefined && isPrivilegedAction(action)) marked.privileged = action;
  Object.defineProperty(fn, GUARD, { value: Object.freeze(marked), enumerable: false });
  return fn;
}

/** The guard spec of a page, route handler or action built by a wrapper here; undefined for anything else. */
export function guardSpecOf(fn: unknown): GuardSpec | undefined {
  return typeof fn === "function" ? (fn as Guarded)[GUARD] : undefined;
}

export type GuardDecision =
  | { kind: "allow"; session: StaffSession | null }
  | { kind: "unauthenticated" }
  | { kind: "outside_gate"; session: StaffSession }
  | { kind: "denied"; session: StaffSession; permission: PolicyAction; reason: "forbidden" | "out_of_scope" }
  | { kind: "aal_required"; session: StaffSession; permission: PrivilegedAction };

type Refusal = Exclude<GuardDecision, { kind: "allow" }>;

/** True when a session at `gate` may use a route with this access. */
function admits(access: Exclude<RouteAccess, "public">, gate: SetupGate): boolean {
  if (access === "any_gate") return true;
  return typeof access === "string" ? access === gate : access.includes(gate);
}

/**
 * requireAal2: the privileged action's assurance rule (identity's meetsAssurance) on the
 * session's server-side level. Null when the session may go ahead.
 */
export function requireAal2(session: StaffSession, privileged: PrivilegedAction | undefined): GuardDecision | null {
  if (privileged === undefined || meetsAssurance(session.aal, privileged)) return null;
  return { kind: "aal_required", session, permission: privileged };
}

/**
 * The guard's rule, without I/O: the session, then the setup gate, then the role policy (on the
 * given context, with the person's id as actor), then, for a privileged action, the authenticator
 * level. A guarded route without a policy action is refused (fail closed).
 */
export function decide(spec: Pick<GuardSpec, "access" | "action">, session: StaffSession | null, context: PolicyContext = {}): GuardDecision {
  if (spec.access === "public") return { kind: "allow", session };
  if (!session) return { kind: "unauthenticated" };
  if (!admits(spec.access, session.gate)) return { kind: "outside_gate", session };
  const action = spec.action;
  if (action === undefined) return { kind: "denied", session, permission: "hub.open", reason: "forbidden" };
  const verdict = decidePolicy(session.role, action, { ...context, actorId: session.staffId });
  if (verdict !== "allowed") return { kind: "denied", session, permission: action, reason: verdict };
  return requireAal2(session, isPrivilegedAction(action) ? action : undefined) ?? { kind: "allow", session };
}

/**
 * decide() with the context loaded only when the role's rule depends on it: the person's current
 * assignments (./scope.ts) and the facts the route gives about the call.
 */
async function judge(spec: StaffSpec, session: StaffSession | null, facts?: () => Promise<PolicyFacts>): Promise<GuardDecision> {
  const first = decide(spec, session);
  if (first.kind !== "denied" || first.reason !== "out_of_scope" || !needsPolicyContext(first.session.role, spec.action)) return first;
  const context: PolicyContext = { ...(facts ? await facts() : {}), assignments: await assignmentsOf(first.session) };
  return decide(spec, first.session, context);
}

/** Audits a refused staff request, once; a failure to audit never turns the refusal into a pass. */
async function auditRefusal(spec: StaffSpec, decision: Refusal): Promise<void> {
  try {
    if (decision.kind === "unauthenticated") await identity().refuseUnauthenticated(spec.action, spec.route);
    else if (decision.kind === "denied") await staffAuth().refuseByPolicy(decision.session.staffId, spec.route, decision.permission, decision.reason);
    else if (decision.kind === "aal_required") await staffAuth().refuseBelowAal2(decision.session.staffId, spec.route, decision.permission);
    else await staffAuth().refuseOutsideGate(decision.session.staffId, spec.route);
  } catch {
    // Not configured in this environment, or the audit failed (logged by the audit module).
  }
}

/** Why a signed-in call was refused, for a server action's own answer: `forbidden` covers out-of-scope calls too. */
export type ActionRefusal = "setup_incomplete" | "forbidden" | "aal2_required";

function refusalOf(decision: Exclude<Refusal, { kind: "unauthenticated" }>): ActionRefusal {
  if (decision.kind === "aal_required") return "aal2_required";
  return decision.kind === "denied" ? "forbidden" : "setup_incomplete";
}

/** The API answer of a refusal: 401 `unauthenticated`, or 403 `setup_incomplete`, `forbidden` or `aal2_required`. */
function refusalResponse(decision: Refusal): Response {
  if (decision.kind === "unauthenticated") return staffError(401, "unauthenticated");
  return staffError(403, refusalOf(decision));
}

const NO_STORE = { "Cache-Control": "no-store" };

/** A JSON answer of the staff API, never stored (AD-1). */
export function staffJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export function staffError(status: number, error: StaffApiError, message?: string): Response {
  return staffJson(message === undefined ? { error } : { error, message }, status);
}

// ---- Pages -------------------------------------------------------------------------------------

/** Wraps what a page shows to a role its policy refuses (a marker for tests; it renders its children). */
export function PolicyRefusal({ children }: { children: ReactNode }): ReactNode {
  return children;
}

/**
 * A staff page at `access` (never `public`; see publicStaffPage), for the roles its policy action
 * allows. Anyone else sees the page's `refused` view instead of its content, or, without one, is
 * sent to the Hub's home, which every role may open. A page with server actions gives `refused`:
 * a form posted without JavaScript renders its page after the action, and that render must not
 * redirect away from the action's own answer. Like the setup gates' redirects, a page's refusal is
 * not audited: a page shows; the calls it would make are refused and audited by their own guards.
 * A page is never privileged: its actions are (and are asked for aal2).
 */
export function staffPage<P>(
  spec: StaffSpec & { refused?: (session: StaffSession, props: P) => Promise<ReactNode> | ReactNode },
  render: (session: StaffSession, props: P) => Promise<ReactNode> | ReactNode,
) {
  const { refused } = spec;
  const page = async (props: P) => {
    const decision = await judge(spec, await currentStaffSession());
    if (decision.kind === "unauthenticated") redirect(SIGN_IN_PAGE);
    if (decision.kind === "outside_gate") redirect(GATE_PAGES[decision.session.gate]);
    if (decision.kind === "denied") {
      if (!refused) redirect(GATE_PAGES.hub);
      return createElement(PolicyRefusal, null, await refused(decision.session, props));
    }
    // A page's privileged action is not asked for aal2 here; every server action on it is.
    return render(decision.session as StaffSession, props);
  };
  return mark(page, spec, "page");
}

/** A page anyone may open (sign-in). It still receives the session, if there is one. */
export function publicStaffPage<P>(route: string, render: (session: StaffSession | null, props: P) => Promise<ReactNode> | ReactNode) {
  const page = async (props: P) => render(await currentStaffSession(), props);
  return mark(page, { route, access: "public" }, "page");
}

// ---- Route handlers ----------------------------------------------------------------------------

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Cross-site requests are refused before anything else: a state-changing call must come from this
 * site (Origin, when the browser sends it, matches the Host) and carry JSON, which a cross-site
 * form cannot send without the browser asking first (CSRF; the cookies are also SameSite=Lax).
 */
function refuseCrossSite(request: Request): Response | null {
  if (!UNSAFE_METHODS.has(request.method)) return null;
  const origin = request.headers.get("origin");
  if (origin !== null) {
    let sameHost = false;
    try {
      sameHost = new URL(origin).host === (request.headers.get("x-forwarded-host") ?? request.headers.get("host"));
    } catch {
      sameHost = false;
    }
    if (!sameHost) return staffError(403, "forbidden_origin");
  }
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(type)) return staffError(415, "unsupported_media_type");
  return null;
}

type Handler = (request: Request) => Promise<Response>;

/**
 * An `/api/staff` route handler at `access` (never `public`; see publicStaffRoute). `context`
 * gives the policy the facts of the call (read from a copy of the request), asked only when the
 * role's rule depends on them.
 */
export function staffRoute(
  spec: StaffSpec & { context?: (request: Request, session: StaffSession) => Promise<PolicyFacts> },
  handle: (request: Request, session: StaffSession) => Promise<Response>,
): Handler {
  const { context } = spec;
  const handler = async (request: Request) => {
    const crossSite = refuseCrossSite(request);
    if (crossSite) return crossSite;
    const session = await currentStaffSession();
    const decision = await judge(spec, session, context && session ? () => context(request.clone(), session) : undefined);
    if (decision.kind !== "allow") {
      await auditRefusal(spec, decision);
      return refusalResponse(decision);
    }
    return handle(request, decision.session as StaffSession);
  };
  return mark(handler, spec, "call");
}

/** An `/api/staff` route handler anyone may call (sign-in, sign-out). */
export function publicStaffRoute(route: string, handle: (request: Request) => Promise<Response>): Handler {
  const handler = async (request: Request) => refuseCrossSite(request) ?? handle(request);
  return mark(handler, { route, access: "public" }, "call");
}

/** Reads a JSON body with a contract schema; a body that does not match is a 400 `bad_request`. */
export async function readJson<T>(request: Request, schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, response: staffError(400, "bad_request") };
  }
  const parsed = schema.safeParse(body);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, response: staffError(400, "bad_request") };
}

// ---- Server actions ----------------------------------------------------------------------------

/**
 * A staff server action at `access`. Without a session the person is sent to the sign-in page
 * (Next's `redirect`, which works in a server action; the session ended: idle, 12 hours, or
 * revoked) and the refusal is audited with status 401; nothing of the action runs. `refused` turns
 * the other refusals, another setup gate, a role or scope the policy refuses, or a session below
 * `aal2` for a privileged action, into the action's own answer (for example a form state with the
 * message), given the action's arguments: a server action has no status of its own, so each is
 * the 403 of an action, answered before its own code. `context` gives the policy the facts of the
 * call, from the action's arguments, asked only when the role's rule depends on them.
 */
export function staffAction<A extends unknown[], R>(
  spec: StaffSpec & { context?: (session: StaffSession, ...args: A) => Promise<PolicyFacts> },
  act: (session: StaffSession, ...args: A) => Promise<R>,
  refused: (error: ActionRefusal, ...args: A) => R,
): (...args: A) => Promise<R> {
  const { context } = spec;
  const action = async (...args: A) => {
    const session = await currentStaffSession();
    const decision = await judge(spec, session, context && session ? () => context(session, ...args) : undefined);
    if (decision.kind !== "allow") {
      await auditRefusal(spec, decision);
      if (decision.kind === "unauthenticated") redirect(SIGN_IN_PAGE);
      return refused(refusalOf(decision), ...args);
    }
    return act(decision.session as StaffSession, ...args);
  };
  return mark(action, spec, "call");
}
