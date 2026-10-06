// The answers of POST /api/subscription/view, /change and /delete (S07.06, AD-3, AD-13, AD-20), apart from the route files so a test can call
// them with a database and fakes of its own. Public: no session, no cookie, never cacheable, no referrer (next.config.ts says the same for
// every path under /api/subscription and every page under /{lang}/subscription; these answers carry the headers themselves too).
//
//  - every request body is read (at most SUBSCRIPTION_EDIT_MAX_BODY_CHARS) and checked by the contract: 400 `{error: {code, message_key}}`
//    for an unreadable one, and nothing is used;
//  - `view` answers the choices, or `{v, status: "expired"}` (HTTP 200) for a link that is unknown, used or run out;
//  - `change` answers `{v, status: "changed"}` or `expired`, or 400 `neighbourhood_missing` / `place_unknown` (nothing changed, the link
//    still usable); `delete` answers `{v, status: "deleted"}` or `expired`. A failure is 503 `edit_unavailable`.
// The token, the number and the body are never logged or echoed: a log line names the request and its outcome, or a safe classification.
import {
  EDIT_EXPIRED,
  SUBSCRIPTION_EDIT_ERROR_STATUS,
  SUBSCRIPTION_EDIT_MAX_BODY_CHARS,
  checkEditChangeRequest,
  checkEditTokenRequest,
  subscriptionEditErrorBody,
  type EditCheck,
  type SubscriptionEditErrorCode,
} from "@/contracts/subscriptionEdit";
import type { EditLink, SubscriptionsLog } from "@/modules/subscriptions";
import { classifyError } from "@/platform/safeError";

export interface SubscriptionRouteDeps {
  edit: () => EditLink;
  log: SubscriptionsLog;
  /** Runs after a change that queued its confirmation (the app starts the dispatcher, after the response). */
  afterChanged?: () => void;
}

/** The headers of every answer: never stored by a browser or a cache, no referrer sent from the page it serves. */
export const SUBSCRIPTION_HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Content-Type": "application/json" } as const;

const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: SUBSCRIPTION_HEADERS });
const refused = (code: SubscriptionEditErrorCode) => answer(subscriptionEditErrorBody(code), SUBSCRIPTION_EDIT_ERROR_STATUS[code]);

/** The request's body as the contract reads it, or the refusal of an unreadable one. */
async function read<T>(request: Request, check: (raw: unknown) => EditCheck<T>): Promise<EditCheck<T>> {
  try {
    const text = await request.text();
    if (text.length > SUBSCRIPTION_EDIT_MAX_BODY_CHARS) return { ok: false, code: "invalid_request" };
    return check(JSON.parse(text));
  } catch {
    return { ok: false, code: "invalid_request" };
  }
}

/** Runs one request's work; a failure is logged with its safe classification only and answered 503. */
async function guarded(deps: SubscriptionRouteDeps, action: string, work: () => Promise<Response>): Promise<Response> {
  try {
    return await work();
  } catch (error) {
    deps.log.error("subscription_edit.failed", { action, code: classifyError(error) });
    return refused("edit_unavailable");
  }
}

export async function subscriptionViewResponse(deps: SubscriptionRouteDeps, request: Request): Promise<Response> {
  const token = await read(request, checkEditTokenRequest);
  if (!token.ok) return refused(token.code);
  return guarded(deps, "view", async () => {
    const body = await deps.edit().view(token.value);
    deps.log.info("subscription_edit.view", { outcome: body.status });
    return answer(body);
  });
}

export async function subscriptionChangeResponse(deps: SubscriptionRouteDeps, request: Request): Promise<Response> {
  const change = await read(request, checkEditChangeRequest);
  if (!change.ok) return refused(change.code);
  return guarded(deps, "change", async () => {
    const outcome = await deps.edit().change(change.value);
    deps.log.info("subscription_edit.change", { outcome: outcome.kind === "refused" ? outcome.code : outcome.kind });
    if (outcome.kind === "refused") return refused(outcome.code);
    if (outcome.kind === "expired") return answer(EDIT_EXPIRED);
    deps.afterChanged?.();
    return answer({ v: 1, status: "changed" });
  });
}

export async function subscriptionDeleteResponse(deps: SubscriptionRouteDeps, request: Request): Promise<Response> {
  const token = await read(request, checkEditTokenRequest);
  if (!token.ok) return refused(token.code);
  return guarded(deps, "delete", async () => {
    const outcome = await deps.edit().delete(token.value);
    deps.log.info("subscription_edit.delete", { outcome: outcome.kind });
    return answer(outcome.kind === "expired" ? EDIT_EXPIRED : { v: 1, status: "deleted" });
  });
}

/** Any other method: 405, with the same headers. */
export function subscriptionMethodNotAllowed(): Response {
  return new Response(JSON.stringify({ error: { code: "method_not_allowed" } }), { status: 405, headers: { ...SUBSCRIPTION_HEADERS, Allow: "POST" } });
}
