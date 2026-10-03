import { SearchErrorSchema } from "@/contracts/search";
import { SearchV1Schema, type SearchV1 } from "@/contracts/searchTestSet";
import { FALLBACK_HEADER, type Fetcher } from "../directory/load-directory";

// The one place a resident's question leaves the phone (S03.06, FR-D2-Q, AD-3, AD-20): a POST to /api/search, the question
// in the body and nowhere else. It is not in the address, a header, storage or a log; this file reads it into one request
// and keeps nothing, and no code under src/ui/search writes to storage, to the history or to the console
// (search-privacy.test.ts reads the sources to hold that). The answer is checked against SearchV1 before anything of it is
// used, and every way a search can fail is one named outcome the screen has a state for: never a raw error.

export const SEARCH_URL = "/api/search";
/** The server answers within 2.5 s; a phone on a bad connection gets a little longer before it counts as having no signal. */
export const SEARCH_TIMEOUT_MS = 8000;
/** A Retry-After longer than this is not believed: a resident is not told to wait more than an hour. */
const MAX_RETRY_SECONDS = 3600;
/** With no usable Retry-After, "a few minutes". */
const DEFAULT_RETRY_SECONDS = 300;

export type SearchOutcome =
  /** An answer in the shape of SearchV1: `ok`, `no_clear_match` or `unavailable`. */
  | { kind: "answer"; answer: SearchV1 }
  /** 429: too many questions from this phone's address. Not before `retryAfterSeconds` from now. */
  | { kind: "busy"; retryAfterSeconds: number }
  /** 503 `search_unavailable`, or any answer that is not one this screen understands (it is never shown). */
  | { kind: "failed" }
  /** The request did not reach the server or no answer came in time: no signal. */
  | { kind: "offline" };

export type AskRequest = { q: string; lang: string; v?: number };

/** Seconds from a Retry-After header written as a whole number of seconds; null for anything else (a date, text). */
export function retryAfterSeconds(header: string | null): number | null {
  if (header === null || !/^\s*\d{1,7}\s*$/.test(header)) return null;
  return Math.min(Number(header), MAX_RETRY_SECONDS);
}

/**
 * Asks the server. Resolves, never rejects. `signal` lets the screen cancel a question that is no longer wanted (a new one,
 * leaving the page); a cancelled request resolves as `offline` and the screen ignores it.
 */
export async function askSearch(request: AskRequest, deps: { fetcher?: Fetcher; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<SearchOutcome> {
  const fetcher = deps.fetcher ?? fetch;
  try {
    const timeout = AbortSignal.timeout(deps.timeoutMs ?? SEARCH_TIMEOUT_MS);
    const signal = deps.signal ? AbortSignal.any([deps.signal, timeout]) : timeout;
    const response = await fetcher(SEARCH_URL, {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ q: request.q, lang: request.lang, ...(request.v === undefined ? {} : { v: request.v }) }),
      signal,
    });
    const text = await response.text();
    // A response a service worker made up because the network was down is not the server's answer.
    if (response.headers.get(FALLBACK_HEADER) !== null) return { kind: "offline" };
    if (response.status === 429) return { kind: "busy", retryAfterSeconds: retryAfterSeconds(response.headers.get("Retry-After")) ?? DEFAULT_RETRY_SECONDS };
    // Any other refusal is only told apart from an answer; nothing of its body is shown.
    if (!response.ok) return { kind: "failed" };
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return { kind: "failed" };
    }
    if (SearchErrorSchema.safeParse(body).success) return { kind: "failed" };
    const answer = SearchV1Schema.safeParse(body);
    return answer.success ? { kind: "answer", answer: answer.data } : { kind: "failed" };
  } catch {
    return { kind: "offline" };
  }
}
