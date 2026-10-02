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
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { GATE_PAGES, SIGN_IN_PAGE, type SetupGate, type StaffApiError } from "@/contracts/staffAuth";
import { identity, staffAuth } from "./identity";
import { currentStaffSession, type StaffSession } from "./session";

/**
 * Who may use a route:
 *  - `public`: anyone (the sign-in page, sign-in and sign-out); the session is passed when there is one;
 *  - `any_gate`: any signed-in staff member, at whatever setup gate (`GET /api/staff/me`);
 *  - a gate: signed-in staff at exactly that gate (each gate's page and calls; `hub` is everything else).
 */
export type RouteAccess = "public" | "any_gate" | SetupGate;

export interface GuardSpec {
  /** The route pattern (`/api/staff/password`), audited on refusals; never a value from the request. */
  route: string;
  access: RouteAccess;
}

const GUARD = Symbol.for("cvh.staff.guard");

type Guarded = { [GUARD]?: GuardSpec };

function mark<F extends object>(fn: F, spec: GuardSpec): F {
  Object.defineProperty(fn, GUARD, { value: Object.freeze({ ...spec }), enumerable: false });
  return fn;
}

/** The guard spec of a page, route handler or action built by a wrapper here; undefined for anything else. */
export function guardSpecOf(fn: unknown): GuardSpec | undefined {
  return typeof fn === "function" ? (fn as Guarded)[GUARD] : undefined;
}

export type GuardDecision =
  | { kind: "allow"; session: StaffSession | null }
  | { kind: "unauthenticated" }
  | { kind: "outside_gate"; session: StaffSession };

/** The guard's rule, without I/O. */
export function decide(access: RouteAccess, session: StaffSession | null): GuardDecision {
  if (access === "public") return { kind: "allow", session };
  if (!session) return { kind: "unauthenticated" };
  if (access === "any_gate" || access === session.gate) return { kind: "allow", session };
  return { kind: "outside_gate", session };
}

/** Audits a refused staff request; a failure to audit never turns the refusal into a pass. */
async function auditRefusal(spec: GuardSpec, decision: Exclude<GuardDecision, { kind: "allow" }>): Promise<void> {
  try {
    if (decision.kind === "unauthenticated") await identity().refuseUnauthenticated("staff.request", spec.route);
    else await staffAuth().refuseOutsideGate(decision.session.staffId, spec.route);
  } catch {
    // Not configured in this environment, or the audit failed (logged by the audit module).
  }
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

/** A staff page at `access` (never `public`; see publicStaffPage). */
export function staffPage<P>(spec: GuardSpec & { access: Exclude<RouteAccess, "public"> }, render: (session: StaffSession, props: P) => Promise<ReactNode> | ReactNode) {
  const page = async (props: P) => {
    const decision = decide(spec.access, await currentStaffSession());
    if (decision.kind === "unauthenticated") redirect(SIGN_IN_PAGE);
    if (decision.kind === "outside_gate") redirect(GATE_PAGES[decision.session.gate]);
    return render(decision.session as StaffSession, props);
  };
  return mark(page, spec);
}

/** A page anyone may open (sign-in). It still receives the session, if there is one. */
export function publicStaffPage<P>(route: string, render: (session: StaffSession | null, props: P) => Promise<ReactNode> | ReactNode) {
  const page = async (props: P) => render(await currentStaffSession(), props);
  return mark(page, { route, access: "public" });
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

/** An `/api/staff` route handler at `access` (never `public`; see publicStaffRoute). */
export function staffRoute(spec: GuardSpec & { access: Exclude<RouteAccess, "public"> }, handle: (request: Request, session: StaffSession) => Promise<Response>): Handler {
  const handler = async (request: Request) => {
    const crossSite = refuseCrossSite(request);
    if (crossSite) return crossSite;
    const decision = decide(spec.access, await currentStaffSession());
    if (decision.kind !== "allow") {
      await auditRefusal(spec, decision);
      return decision.kind === "unauthenticated" ? staffError(401, "unauthenticated") : staffError(403, "setup_incomplete");
    }
    return handle(request, decision.session as StaffSession);
  };
  return mark(handler, spec);
}

/** An `/api/staff` route handler anyone may call (sign-in, sign-out). */
export function publicStaffRoute(route: string, handle: (request: Request) => Promise<Response>): Handler {
  const handler = async (request: Request) => refuseCrossSite(request) ?? handle(request);
  return mark(handler, { route, access: "public" });
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
 * revoked); nothing of the action runs. `refused` turns the other refusal, another setup gate,
 * into the action's own answer (for example a form state with the message), given the action's
 * arguments.
 */
export function staffAction<A extends unknown[], R>(
  spec: GuardSpec & { access: Exclude<RouteAccess, "public"> },
  act: (session: StaffSession, ...args: A) => Promise<R>,
  refused: (error: "setup_incomplete", ...args: A) => R,
): (...args: A) => Promise<R> {
  const action = async (...args: A) => {
    const decision = decide(spec.access, await currentStaffSession());
    if (decision.kind !== "allow") {
      await auditRefusal(spec, decision);
      if (decision.kind === "unauthenticated") redirect(SIGN_IN_PAGE);
      return refused("setup_incomplete", ...args);
    }
    return act(decision.session as StaffSession, ...args);
  };
  return mark(action, spec);
}
