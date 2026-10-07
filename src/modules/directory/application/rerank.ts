// The budget of the direct route's reranker (interim tuning of 2026-10-07, arm R2): its time inside a search, and its calls in a
// month. Cohere limits each model of a key to about 1,000 calls a calendar month (paid keys too), so the use case counts its own
// rerank calls (spend_event rows of kind `rerank`, whoever made them) and stops calling the model at SEARCH_RERANK_MONTHLY_CALLS
// (default 900, under the vendor's cap with room for the calls other instances make between two counts). Past it, or on any
// failure, the question is ranked as before the reranker (the direct route's floor and gap). Nothing here holds a question.

/** The kind a rerank call is counted under in spend_event (one row per call; the vendor bills rerank in calls, not tokens). */
export const RERANK_SPEND_KIND = "rerank";
/** SEARCH_RERANK_MONTHLY_CALLS: the rerank calls a calendar month (America/Toronto) may use before the use case stops calling the model. */
export const DEFAULT_RERANK_MONTHLY_CALLS = 900;
/**
 * The longest one rerank call may take. The experiment measured p50 0.16 s, p90 0.61 s, p99 1.25 s from a laptop; the call also
 * never runs past the leg's deadline (2.2 s after the request started), so the answer still beats the route's 2.5 s.
 */
export const RERANK_TIMEOUT_MS = 1200;
/** The least time left before the leg's deadline for a rerank call to be made at all: a call that cannot answer would only be billed. */
export const RERANK_MIN_BUDGET_MS = 300;
/** How long a count of the month's calls is trusted before the next search that may rerank counts again (its own calls are added meanwhile). */
export const RERANK_COUNT_TTL_MS = 30_000;
/** After the vendor answered 429 (a monthly cap and a per-minute limit look the same), the model is not called again for this long. */
export const RERANK_LIMITED_BACKOFF_MS = 5 * 60_000;

/**
 * What the reranker did for a search: `not_needed` (the question is English, took the translated leg, or no reranker is
 * configured), `used`, `failed` (the vendor failed or answered nothing usable), `timed_out`, `quota` (the month's calls reached
 * SEARCH_RERANK_MONTHLY_CALLS, or could not be counted), `limited` (the vendor answered 429 a moment ago), `no_time` (too little of
 * the leg's budget was left to call it). Every outcome but `used` ranks the question by the direct route's floor and gap.
 */
export type RerankOutcome = "not_needed" | "used" | "failed" | "timed_out" | "quota" | "limited" | "no_time";

/** Whether a rerank call may be made now: `ok`, `quota` (at the month's limit), `limited` (backing off a 429), `unknown` (the month's calls could not be counted). */
export type RerankAllowance = "ok" | "quota" | "limited" | "unknown";

export interface RerankQuota {
  /** Starts a count of the month's calls when the one held is older than RERANK_COUNT_TTL_MS (or there is none); returns at once. */
  refresh(): void;
  /** Whether a call may be made: waits up to `waitMs` for a count still running. */
  check(waitMs: number): Promise<RerankAllowance>;
  /** A call was made (it may have been billed): counted here until the next count reads its row. */
  used(): void;
  /** The vendor answered 429: no call until RERANK_LIMITED_BACKOFF_MS has passed. */
  limited(): void;
}

export interface RerankQuotaDeps {
  /** The rerank calls of the calendar month that `now` falls in (spend_event, every purpose: the vendor's cap is the key's). */
  count: (now: Date) => Promise<number>;
  limit: number;
  /** A monotonic clock in milliseconds. */
  clock: () => number;
  ttlMs?: number;
  backoffMs?: number;
}

/**
 * The monthly gate, one per search service (instance). The count is a database read: it is started at the start of a search that
 * may rerank, beside the embedding, so it costs that search no time; the searches of the next RERANK_COUNT_TTL_MS reuse it and add
 * their own calls. A count that fails leaves the last good one in use; with none, no call is made (`unknown`).
 */
export function createRerankQuota(deps: RerankQuotaDeps): RerankQuota {
  const ttlMs = deps.ttlMs ?? RERANK_COUNT_TTL_MS;
  const backoffMs = deps.backoffMs ?? RERANK_LIMITED_BACKOFF_MS;
  let known: { calls: number; at: number } | null = null;
  let running: Promise<void> | null = null;
  // Calls made since the count in `known` started.
  let since = 0;
  let limitedUntil = -Infinity;

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

  return {
    refresh() {
      if (running !== null || (known !== null && deps.clock() - known.at < ttlMs)) return;
      const at = deps.clock();
      const before = since;
      const count = Promise.resolve()
        .then(() => deps.count(new Date()))
        .then(
          (calls) => {
            known = { calls, at };
            // The calls made while it ran may not be in it: they stay counted here.
            since -= before;
          },
          () => undefined,
        )
        .finally(() => {
          running = null;
        });
      running = count;
    },
    async check(waitMs) {
      if (deps.clock() < limitedUntil) return "limited";
      if (running !== null) await Promise.race([running, sleep(waitMs)]);
      if (known === null) return "unknown";
      return known.calls + since >= deps.limit ? "quota" : "ok";
    },
    used() {
      since += 1;
    },
    limited() {
      limitedUntil = deps.clock() + backoffMs;
    },
  };
}
