// The answer of POST /api/search (S03.04, AD-3, AD-11, AD-20, AD-22), apart from the route file so a test can call it with a
// database, a fake embedder and a store of its own. Public: no session and no cookie, and no response is cacheable, because a
// question is personal.
//
// The 2.5 s budget counts from the first line of searchResponse: the time is taken there and handed to the search. It is
// also a hard deadline of the handler's own, over everything after that line: whatever is still pending then (a body still
// arriving, a wait no stage bounded, an instance that stalled and is catching up), the answer is 503 `search_unavailable`
// at that moment, and the app is told after the response so that it can write an ops event (`search.unavailable`, reason
// `deadline`, no question). What was pending is left to run unwatched: its result is ignored, and the writes it still makes
// go to `defer` like any other.
//
//  1. the body is checked (400 `{error:{code, message_key}}`, no model called);
//  2. the client (a keyed hash of its address, kept 24 hours) is counted: more than 30 questions in 10 minutes is 429
//     `rate_limited` with a `Retry-After`, no model called. The count is its own short transaction with a deadline of its own
//     (and this handler stops waiting for it after `limiterBudgetMs`): a count that cannot be made is 503 `search_unavailable`,
//     and the app is told so that it can write an ops event;
//  3. the search runs (src/modules/directory/application/search.ts): SearchV1, or 503 `search_unavailable`.
// Nothing here keeps, logs or echoes the question.
//
// Every answer carries a `Server-Timing` header: phase names and milliseconds only (src/platform/serverTiming.ts), so that a
// slow request says where it spent its time: `boot` (first request of an instance only), `limiter`, `snapshot` (`desc=cold`
// when the release's data came from the store, `desc=cache` when a cold instance took it from the shared data cache), `embed`, `translate`, `rank`, `total`. Phases overlap (the limiter and the
// snapshot run together on a cold instance), so they do not add up to `total`.
import { SEARCH_ERROR_STATUS, parseSearchRequest, searchErrorBody, type SearchErrorCode } from "@/contracts/search";
import { SearchV1Schema } from "@/contracts/searchTestSet";
import { DEFAULT_TOTAL_BUDGET_MS, SearchFailure, type SearchService } from "@/modules/directory";
import { SEARCH_RATE_LIMIT, type RateLimiter } from "@/modules/subscriptions";
import { classifyError } from "@/platform/safeError";
import { createTimings, type PhaseTimings } from "@/platform/serverTiming";

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
  /**
   * Told, after the response, that the request was cut at the hard deadline, with how long it had run and its classification:
   * `timed_out` and the stage that was still pending (`timed_out:body`, `timed_out:limiter`, `timed_out:search`). The app writes
   * the ops event.
   */
  onDeadline?: (ms: number, error: string) => Promise<void>;
  /** Runs work still pending after the response (`after()` in the app). Without it such work simply runs on. */
  defer?: (work: Promise<unknown>) => void;
  /** Test seams. The clock must be the search service's clock (both default to `performance.now`). */
  clock?: () => number;
  limiterBudgetMs?: number;
  /** For the first request an instance serves: how long the instance had been loaded before it (reported as `boot`); null for the others. */
  boot?: () => number | null;
  /** The hard deadline, counted from the start of the request; default the search's whole budget (2.5 s). */
  deadlineMs?: number;
}

/** The limiter gets at most this long, counted from the start of the request; the model leg has the rest of the 2.2 s. */
export const DEFAULT_LIMITER_BUDGET_MS = 1000;

/** A question is at most 200 characters; a body far above that is not one. */
const MAX_BODY_CHARS = 4096;

const NO_STORE = { "Cache-Control": "no-store" } as const;

function failure(code: SearchErrorCode, headers: Record<string, string> = {}): Response {
  return Response.json(searchErrorBody(code), { status: SEARCH_ERROR_STATUS[code], headers: { ...NO_STORE, ...headers } });
}

/** Where an answer is: the stage still pending when the hard deadline cuts it. */
type Stage = "body" | "limiter" | "search";

/** What the hard deadline is classified as: a timeout, with the stage that was pending (`timed_out:limiter`). */
function classifyDeadline(stage: Stage): string {
  return `timed_out:${stage}`;
}

/** The handler's own budget for the limiter ran out (the limiter had not answered). */
class LimiterTimedOut extends Error {
  override name = "LimiterTimedOut";
}

/**
 * A classification of a limiter failure that is safe to store and log: `timed_out` when the handler's budget expired, else the
 * Postgres SQLSTATE (five characters), else a connection error's constant code (`CONNECT_TIMEOUT`), else the error's class name
 * (letters only, at most 40), else `unknown` (see classifyError). Never a message.
 */
export function classifyLimiterError(error: unknown): string {
  if (error instanceof LimiterTimedOut) return "timed_out";
  return classifyError(error);
}

/** Something the handler did not expect failed (an answer that is not SearchV1, a bug): one line, the safe classification only. */
function logUnexpected(error: unknown, ms: number): void {
  console.error(`search.failed reason=unexpected code=${classifyError(error)} ms=${ms}`);
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

/** Runs `report` after the response (through `defer`, or simply on); it never fails or delays the request. */
function tell(deps: SearchRouteDeps, report: () => Promise<void>): void {
  const note = Promise.resolve().then(report).catch(() => undefined);
  deps.defer?.(note);
}

export async function searchResponse(deps: SearchRouteDeps, request: Request): Promise<Response> {
  const clock = deps.clock ?? (() => performance.now());
  const started = clock();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<"deadline">((resolve) => {
    timer = setTimeout(() => resolve("deadline"), Math.max(0, started + (deps.deadlineMs ?? DEFAULT_TOTAL_BUDGET_MS) - clock()));
  });
  const progress: { stage: Stage } = { stage: "body" };
  const timings = createTimings();
  const boot = deps.boot?.();
  if (typeof boot === "number") timings.record("boot", boot);
  const timed = (response: Response): Response => {
    timings.record("total", clock() - started);
    const header = timings.header();
    if (header) response.headers.set("Server-Timing", header);
    return response;
  };
  const answering = answer(deps, request, clock, started, progress, timings);
  // Cut at the deadline, it may still reject later: that is not unhandled.
  answering.catch(() => undefined);
  try {
    const outcome = await Promise.race([answering, expired]);
    if (outcome !== "deadline") return timed(outcome);
  } catch (error) {
    logUnexpected(error, Math.round(clock() - started));
    return timed(failure("search_unavailable"));
  } finally {
    clearTimeout(timer);
  }
  const ms = Math.round(clock() - started);
  const why = classifyDeadline(progress.stage);
  // One line for the platform's function logs: the safe fields only.
  console.error(`search.failed reason=deadline code=${why} ms=${ms}`);
  if (deps.onDeadline) tell(deps, () => deps.onDeadline!(ms, why));
  return timed(failure("search_unavailable"));
}

/** The answer itself: the body, the count, the search. Each stage has a limit of its own; the hard deadline is over all of them. */
async function answer(deps: SearchRouteDeps, request: Request, clock: () => number, started: number, progress: { stage: Stage }, timings: PhaseTimings): Promise<Response> {
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

  progress.stage = "limiter";
  // A cold instance has the release's data to load as well: it starts now, beside the count (loading calls no model, so a count
  // that refuses still means no model is called), and the search below joins it. A warm instance has nothing to start.
  try {
    deps.search().warm?.(started);
  } catch {
    // A warm-up never changes an answer (the search below meets the same failure itself).
  }
  const limiterStart = clock();
  try {
    const counted = await within(
      Promise.resolve().then(() => deps.limiter().check(SEARCH_RATE_LIMIT, deps.client(request.headers))),
      started + (deps.limiterBudgetMs ?? DEFAULT_LIMITER_BUDGET_MS) - clock(),
    );
    timings.record("limiter", clock() - limiterStart);
    if (!counted.allowed) return failure("rate_limited", { "Retry-After": String(counted.retryAfterSeconds ?? Math.ceil(SEARCH_RATE_LIMIT.windowMs / 1000)) });
  } catch (error) {
    timings.record("limiter", clock() - limiterStart);
    // The count cannot be kept, so the model is not called.
    const ms = Math.round(clock() - started);
    const why = classifyLimiterError(error);
    // One line for the platform's function logs: the safe fields only.
    console.error(`search.rate_limit_failed code=${why} ms=${ms}`);
    if (deps.onLimiterFailure) {
      tell(deps, () => deps.onLimiterFailure!(ms, why));
    }
    return failure("search_unavailable");
  }

  progress.stage = "search";
  try {
    const body = SearchV1Schema.parse(await deps.search().search(parsed.value, started, timings));
    return Response.json(body, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SearchFailure && error.code !== "search_unavailable") return failure(error.code);
    // A `search_unavailable` of the search was told by the search itself (an ops event and one line); anything else is unexpected.
    if (!(error instanceof SearchFailure)) logUnexpected(error, Math.round(clock() - started));
    return failure("search_unavailable");
  }
}
