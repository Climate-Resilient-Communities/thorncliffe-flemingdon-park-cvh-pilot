// The answer of POST /api/search (S03.04, AD-3, AD-11, AD-20, AD-22), apart from the route file so a test can call it with a
// database, a fake embedder and a store of its own. Public: no session and no cookie, and no response is cacheable, because a
// question is personal.
//
//  1. the body is checked (400 `{error:{code, message_key}}`, no model called);
//  2. the client (a keyed hash of its address, kept 24 hours) is counted: more than 30 questions in 10 minutes is 429
//     `rate_limited`, no model called. The count is its own short transaction, finished before the model is called;
//  3. the search runs (src/modules/directory/application/search.ts): SearchV1, or 503 `search_unavailable`.
// Nothing here keeps, logs or echoes the question.
import { SEARCH_ERROR_STATUS, parseSearchRequest, searchErrorBody, type SearchErrorCode } from "@/contracts/search";
import { SearchV1Schema } from "@/contracts/searchTestSet";
import { SearchFailure, type SearchService } from "@/modules/directory";
import { SEARCH_RATE_LIMIT, type RateLimiter } from "@/modules/subscriptions";

export interface SearchRouteDeps {
  search: () => SearchService;
  limiter: () => RateLimiter;
  /** The client's address, from the platform's headers; it is hashed by the limiter and never stored. */
  client: (headers: Headers) => string;
}

/** A question is at most 200 characters; a body far above that is not one. */
const MAX_BODY_CHARS = 4096;

const NO_STORE = { "Cache-Control": "no-store" } as const;

function failure(code: SearchErrorCode): Response {
  return Response.json(searchErrorBody(code), { status: SEARCH_ERROR_STATUS[code], headers: NO_STORE });
}

export async function searchResponse(deps: SearchRouteDeps, request: Request): Promise<Response> {
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
    const { allowed } = await deps.limiter().check(SEARCH_RATE_LIMIT, deps.client(request.headers));
    if (!allowed) return failure("rate_limited");
  } catch {
    // The count cannot be kept, so the model is not called.
    return failure("search_unavailable");
  }

  try {
    const body = SearchV1Schema.parse(await deps.search().search(parsed.value));
    return Response.json(body, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SearchFailure && error.code !== "search_unavailable") return failure(error.code);
    return failure("search_unavailable");
  }
}
