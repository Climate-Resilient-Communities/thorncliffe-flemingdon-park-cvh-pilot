// POST /api/search/closest (resident testing, session 2, #3): the closest matches for a question that /api/search answered with
// "no clear match" and without the 911 block. The page asks only then; the use case (search.ts `closest`) also refuses a question
// that describes an emergency. The body is the search's own ({q, lang, v?}, checked by the same contract); the answer is
// `{v: 1, release_v, results: [{provider_id}]}` with at most three ids of the current release, or none. The question is never
// stored, logged or echoed (AD-3).
//
// It has its own limit per client (30 in 10 minutes, like search) and a hard deadline of CLOSEST_DEADLINE_MS: the model reads
// every provider's line, which takes longer than a search, so it is a request of its own and never slows the search's answer.
import { SEARCH_ERROR_STATUS, parseSearchRequest, searchErrorBody, type SearchErrorCode } from "@/contracts/search";
import { SearchFailure, type SearchService } from "@/modules/directory";
import { SEARCH_RATE_LIMIT, type RateLimiter, type RateLimitRule } from "@/modules/subscriptions";
import { classifyError } from "@/platform/safeError";

export const CLOSEST_RATE_LIMIT: RateLimitRule = { ...SEARCH_RATE_LIMIT, scope: "search_closest" };
/** The whole request, body to answer; the model's own call is cut sooner (CLOSEST_TIMEOUT_MS). */
export const CLOSEST_DEADLINE_MS = 8000;
const MAX_BODY_CHARS = 4096;
const NO_STORE = { "Cache-Control": "no-store" } as const;

export interface ClosestRouteDeps {
  search: () => SearchService;
  limiter: () => RateLimiter;
  /** The client's address, from the platform's headers; hashed by the limiter and never stored. */
  client: (headers: Headers) => string;
  deadlineMs?: number;
}

function failure(code: SearchErrorCode, headers: Record<string, string> = {}): Response {
  return Response.json(searchErrorBody(code), { status: SEARCH_ERROR_STATUS[code], headers: { ...NO_STORE, ...headers } });
}

export async function closestResponse(deps: ClosestRouteDeps, request: Request): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<Response>((resolve) => {
    timer = setTimeout(() => resolve(failure("search_unavailable")), deps.deadlineMs ?? CLOSEST_DEADLINE_MS);
  });
  try {
    return await Promise.race([answer(deps, request), expired]);
  } catch (error) {
    console.error(`search.closest_failed code=${classifyError(error)}`);
    return failure("search_unavailable");
  } finally {
    clearTimeout(timer);
  }
}

async function answer(deps: ClosestRouteDeps, request: Request): Promise<Response> {
  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_CHARS) return failure("invalid_request");
    raw = JSON.parse(text);
  } catch {
    return failure("invalid_request");
  }
  const parsed = parseSearchRequest(raw);
  if (!parsed.ok) return failure(parsed.code);
  try {
    const counted = await deps.limiter().check(CLOSEST_RATE_LIMIT, deps.client(request.headers));
    if (!counted.allowed) return failure("rate_limited", { "Retry-After": String(counted.retryAfterSeconds ?? Math.ceil(CLOSEST_RATE_LIMIT.windowMs / 1000)) });
  } catch (error) {
    console.error(`search.closest_rate_limit_failed code=${classifyError(error)}`);
    return failure("search_unavailable");
  }
  const service = deps.search();
  if (!service.closest) return failure("search_unavailable");
  try {
    const body = await service.closest({ q: parsed.value.q, lang: parsed.value.lang });
    return Response.json(body, { headers: NO_STORE });
  } catch (error) {
    if (!(error instanceof SearchFailure)) console.error(`search.closest_failed code=${classifyError(error)}`);
    return failure("search_unavailable");
  }
}
