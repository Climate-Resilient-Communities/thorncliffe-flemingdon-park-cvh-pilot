// The answers of POST /api/places/submissions and GET /api/places/submissions/{ref} (PRD §6.3, D9/E4; R-19, R-21, R-22, R-23), apart from
// the route files so a test can call them with fakes. Public: no session, no cookie, never cacheable.
//
// POST:
//  1. the body is read (at most PLACE_SUBMISSION_MAX_BODY_CHARS) and checked by the contract: 400 `invalid_request`, nothing stored;
//  2. the client is counted (5 an hour, a keyed hash of its address, AD-22): 429 `rate_limited` with a Retry-After, nothing stored;
//  3. a body whose honeypot is filled in is answered 202 like any other, with a code that is stored nowhere: the script learns nothing;
//  4. otherwise the suggestion is stored and answered 202 `{v, status: "received", ref}`.
// GET: the code is read in its one written form (404 for anything that cannot be a code), the client counted (30 an hour), and the stored
// suggestion's state answered 200, or 404 `not_found`.
// A limiter or database that fails answers 503 `submissions_unavailable`, logged with a safe classification only (never the body or a code).
import {
  PLACE_SUBMISSION_CONTRACT_VERSION,
  PLACE_SUBMISSION_ERROR_STATUS,
  PLACE_SUBMISSION_MAX_BODY_CHARS,
  checkPlaceSubmission,
  normaliseRef,
  placeSubmissionErrorBody,
  type PlaceSubmissionErrorCode,
  type PlaceSubmissionReceived,
  type PlaceSubmissionRequest,
  type PlaceSubmissionStatus,
} from "@/contracts/placeSubmission";
import type { RateLimiter, RateLimitRule } from "@/modules/subscriptions";
import { classifyError } from "@/platform/safeError";

export interface PlaceSubmissionRouteDeps {
  submit: (request: PlaceSubmissionRequest) => Promise<{ ref: string }>;
  status: (ref: string) => Promise<PlaceSubmissionStatus | null>;
  /** A code for a honeypot's answer, shaped like a real one and stored nowhere. */
  unstoredRef: () => string;
  limiter: () => RateLimiter;
  /** The client's address, from the platform's headers; hashed by the limiter and never stored. */
  client: (headers: Headers) => string;
  rules: { submit: RateLimitRule; status: RateLimitRule };
}

const HEADERS = { "Cache-Control": "no-store", "Content-Type": "application/json" } as const;

function refused(code: PlaceSubmissionErrorCode, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(placeSubmissionErrorBody(code)), { status: PLACE_SUBMISSION_ERROR_STATUS[code], headers: { ...HEADERS, ...headers } });
}

/** Counts the client against `rule`: null when it may go on, else the refusal to answer. */
async function limited(deps: PlaceSubmissionRouteDeps, rule: RateLimitRule, request: Request, event: string): Promise<Response | null> {
  try {
    const verdict = await deps.limiter().check(rule, deps.client(request.headers));
    if (verdict.allowed) return null;
    return refused("rate_limited", { "Retry-After": String(verdict.retryAfterSeconds ?? 60) });
  } catch (error) {
    console.error(`${event}.limiter_failed code=${classifyError(error)}`);
    return refused("submissions_unavailable");
  }
}

export async function submitResponse(deps: PlaceSubmissionRouteDeps, request: Request): Promise<Response> {
  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > PLACE_SUBMISSION_MAX_BODY_CHARS) return refused("invalid_request");
    raw = JSON.parse(text);
  } catch {
    return refused("invalid_request");
  }
  const checked = checkPlaceSubmission(raw);
  if (!checked.ok) return refused(checked.code);
  const stop = await limited(deps, deps.rules.submit, request, "place_submission");
  if (stop) return stop;

  let ref: string;
  try {
    ref = checked.honeypot ? deps.unstoredRef() : (await deps.submit(checked.value)).ref;
  } catch (error) {
    console.error(`place_submission.failed code=${classifyError(error)}`);
    return refused("submissions_unavailable");
  }
  const body: PlaceSubmissionReceived = { v: PLACE_SUBMISSION_CONTRACT_VERSION, status: "received", ref };
  return new Response(JSON.stringify(body), { status: 202, headers: HEADERS });
}

export async function statusResponse(deps: PlaceSubmissionRouteDeps, request: Request, code: string): Promise<Response> {
  const ref = normaliseRef(code);
  if (!ref) return refused("not_found");
  const stop = await limited(deps, deps.rules.status, request, "place_status");
  if (stop) return stop;
  try {
    const status = await deps.status(ref);
    if (!status) return refused("not_found");
    return new Response(JSON.stringify(status), { status: 200, headers: HEADERS });
  } catch (error) {
    console.error(`place_status.failed code=${classifyError(error)}`);
    return refused("submissions_unavailable");
  }
}
