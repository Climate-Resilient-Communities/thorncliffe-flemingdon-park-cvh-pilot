// The answer of POST /api/signup (S07.02, AD-3, AD-20, AD-22), apart from the route file so a test can call it with a database and fakes of
// its own. Public: no session, no cookie, never cacheable.
//
//  1. the body is read (at most SIGNUP_MAX_BODY_CHARS) and checked by the contract: 400 `{error: {code, message_key}}` with the first
//     reason (a number that is not Canadian, no neighbourhood, the terms or the age statement not agreed), and nothing is stored;
//  2. the use case (subscriptions' createSignup) checks the terms version (409 `terms_changed`; 503 `signup_unavailable` while no terms may
//     be signed up to) and the places (400), counts the client (429 `rate_limited` with a Retry-After, nothing stored), then writes;
//  3. every accepted sign-up answers HTTP 202 with the same bytes, `{"v":1,"status":"accepted"}`, and the same headers, whether the number
//     is new, already pending or already subscribed. S08.05: with a check-in request, `checkin` says whether its floor is covered
//     (`requested`) or not (`uncovered`), the same for all three.
// Nothing here logs, echoes or stores the number; a failure is logged with a safe classification only.
import { SIGNUP_ACCEPTED, SIGNUP_ERROR_STATUS, SIGNUP_MAX_BODY_CHARS, checkSignupRequest, signupErrorBody, type SignupErrorCode } from "@/contracts/signup";
import type { Signup } from "@/modules/subscriptions";
import { classifyError } from "@/platform/safeError";

export interface SignupRouteDeps {
  signup: () => Signup;
  /** The client's address, from the platform's headers; it is hashed by the limiter and never stored. */
  client: (headers: Headers) => string;
  /** Runs after an accepted answer (the app starts the dispatcher, after the response). */
  afterAccepted?: () => void;
}

const HEADERS = { "Cache-Control": "no-store", "Content-Type": "application/json" } as const;

/** The one body of every accepted sign-up, as bytes: built once, so the three cases cannot differ by a key's order or a space. */
export const ACCEPTED_BODY = JSON.stringify(SIGNUP_ACCEPTED);

function refused(code: SignupErrorCode, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(signupErrorBody(code)), { status: SIGNUP_ERROR_STATUS[code], headers: { ...HEADERS, ...headers } });
}

export async function signupResponse(deps: SignupRouteDeps, request: Request): Promise<Response> {
  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > SIGNUP_MAX_BODY_CHARS) return refused("invalid_request");
    raw = JSON.parse(text);
  } catch {
    return refused("invalid_request");
  }
  const checked = checkSignupRequest(raw);
  if (!checked.ok) return refused(checked.code);

  let outcome;
  try {
    outcome = await deps.signup().request(checked.value, deps.client(request.headers));
  } catch (error) {
    // One line for the platform's function logs: the safe classification only (never the number or the body).
    console.error(`signup.failed code=${classifyError(error)}`);
    return refused("signup_unavailable");
  }
  if (outcome.kind === "rate_limited") return refused("rate_limited", { "Retry-After": String(outcome.retryAfterSeconds) });
  if (outcome.kind === "refused") return refused(outcome.code);
  deps.afterAccepted?.();
  // S08.05: a sign-up with a check-in request also says whether its floor is covered; that depends on the floor alone, so the three cases
  // (a new, a pending and a subscribed number) still answer the same bytes.
  if (outcome.checkin !== undefined) return new Response(JSON.stringify({ ...SIGNUP_ACCEPTED, checkin: outcome.checkin }), { status: 202, headers: HEADERS });
  return new Response(ACCEPTED_BODY, { status: 202, headers: HEADERS });
}
