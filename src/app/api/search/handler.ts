// The answer of POST /api/search (S03.04, AD-3, AD-11, AD-20, AD-22), apart from the route file so a test can call it with a
// database, a fake embedder and a store of its own. Public: no session and no cookie, and no response is cacheable, because a
// question is personal.
//
// The 2.5 s budget counts from the first line of searchResponse: the time is taken there and handed to the search.
//
//  1. the body is checked (400 `{error:{code, message_key}}`, no model called);
//  2. the client (a keyed hash of its address, kept 24 hours) is counted: more than 30 questions in 10 minutes is 429
//     `rate_limited` with a `Retry-After`, no model called. The count is its own short transaction with a deadline of its own
//     (and this handler stops waiting for it after `limiterBudgetMs`): a count that cannot be made is 503 `search_unavailable`,
//     and the app is told so that it can write an ops event;
//  3. the search runs (src/modules/directory/application/search.ts): SearchV1, or 503 `search_unavailable`.
// Nothing here keeps, logs or echoes the question.
import { SEARCH_ERROR_STATUS, parseSearchRequest, searchErrorBody, type SearchErrorCode } from "@/contracts/search";
import { SearchV1Schema } from "@/contracts/searchTestSet";
import { classifyError } from "@/platform/safeError";
import { SearchFailure, type SearchService } from "@/modules/directory";
import { SEARCH_RATE_LIMIT, type RateLimiter } from "@/modules/subscriptions";

export interface SearchRouteDeps {
  search: () => SearchService;
  limiter: () => RateLimiter;
  /** The client's address, from the platform's headers; it is hashed by the limiter and never stored. */
  client: (headers: Headers) => string;
  /**
   * Told, after the response, that the count could not be kept (the app writes the ops event; the handler may not import ops),
   * with a safe classification of why (see classifyLimiterError): never the error's message, the address or the question.
   */
  onLimiterFailure?: (ms: number, error: string) => Promise<void>;
  /** Runs work still pending after the response (`after()` in the app). Without it such work simply runs on. */
  defer?: (work: Promise<unknown>) => void;
  /** Test seams. The clock must be the search service's clock (both default to `performance.now`). */
  clock?: () => number;
  limiterBudgetMs?: number;
}

/** The limiter gets at most this long, counted from the start of the request; the model leg has the rest of the 2.2 s. */
export const DEFAULT_LIMITER_BUDGET_MS = 1000;

/** A question is at most 200 characters; a body far above that is not one. */
const MAX_BODY_CHARS = 4096;

const NO_STORE = { "Cache-Control": "no-store" } as const;

function failure(code: SearchErrorCode, headers: Record<string, string> = {}): Response {
  return Response.json(searchErrorBody(code), { status: SEARCH_ERROR_STATUS[code], headers: { ...NO_STORE, ...headers } });
}

/** The handler's own budget for the limiter ran out (the limiter had not answered). */
class LimiterTimedOut extends Error {
  override name = "LimiterTimedOut";
}

/**
 * A classification of a limiter failure that is safe to store and log: `timed_out` when the handler's budget expired, else the
 * Postgres SQLSTATE (five characters), else the error's class name (letters only, at most 40), else `unknown`. Never a message.
 */
export function classifyLimiterError(error: unknown): string {
  if (error instanceof LimiterTimedOut) return "timed_out";
  return classifyError(error);
}

/** The result of `work`, or a rejection when it has not settled after `ms`. */
async function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new LimiterTimedOut("limiter_timed_out")), Math.max(0, ms));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function searchResponse(deps: SearchRouteDeps, request: Request): Promise<Response> {
  const clock = deps.clock ?? (() => performance.now());
  const started = clock();
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
    const counted = await within(
      Promise.resolve().then(() => deps.limiter().check(SEARCH_RATE_LIMIT, deps.client(request.headers))),
      started + (deps.limiterBudgetMs ?? DEFAULT_LIMITER_BUDGET_MS) - clock(),
    );
    if (!counted.allowed) return failure("rate_limited", { "Retry-After": String(counted.retryAfterSeconds ?? Math.ceil(SEARCH_RATE_LIMIT.windowMs / 1000)) });
  } catch (error) {
    // The count cannot be kept, so the model is not called.
    const ms = Math.round(clock() - started);
    const why = classifyLimiterError(error);
    // One line for the platform's function logs: the safe fields only.
    console.error(`search.rate_limit_failed code=${why} ms=${ms}`);
    if (deps.onLimiterFailure) {
      const note = Promise.resolve()
        .then(() => deps.onLimiterFailure!(ms, why))
        .catch(() => undefined);
      deps.defer?.(note);
    }
    return failure("search_unavailable");
  }

  try {
    const body = SearchV1Schema.parse(await deps.search().search(parsed.value, started));
    return Response.json(body, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SearchFailure && error.code !== "search_unavailable") return failure(error.code);
    return failure("search_unavailable");
  }
}
