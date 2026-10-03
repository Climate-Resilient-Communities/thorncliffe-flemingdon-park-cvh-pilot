// Composition root of search for the app (AD-2): the embedding model for questions and the translation model of the
// translated-question leg (Cohere, only where a key is configured, which is production; the leg's models come from
// `search_question_route`, SEARCH_QUESTION_ROUTE, and the model it retries with when one is past its limit, per kind of
// question, from SEARCH_QUESTION_FALLBACK), the private store of the release files, the database, and the rate limiter. Server
// only. The route src/app/api/search/route.ts uses it; so does the search test-set runner's engine (`searchTestSetEngine`).
//
// directory may not import ops, so the app writes the ops event of a search that could not answer, from the reason and
// the duration the use case hands it; the same for a rate limiter that could not count, and for a search the route cut at
// its hard deadline. Writes still pending when the
// response is ready (spend_event, search_log, the ops events) finish after it, through `after()`; so does the count that
// warns ops when a translation model nears its monthly limit (SEARCH_TRANSLATE_MONTHLY_CALLS).
import "server-only";
import { after } from "next/server";
import { cohereQueryEmbedder, createSearch, warmCohere, type SearchService } from "@/modules/directory";
import { recordOpsEvent } from "@/modules/ops";
import { createRateLimiter, rateLimitKeyFromSecret, type RateLimiter } from "@/modules/subscriptions";
import { cohereTranslator, createQuestionTranslator, warmCohereTranslator, type QuestionRoute, type QuestionTranslator } from "@/modules/translation";
import { getEnv } from "@/platform/config/env";
import { getDb } from "@/platform/db";
import { directoryStorage } from "./directoryRelease";
import { recordSearchNote } from "./searchOps";
import { translateQuotaWatch } from "./translateQuota";

// Where a key is configured, the vendor's SDK is imported when this module loads, so the first search on an instance does
// not pay the import inside its 2.2 s. (The key is read from the process environment here; getEnv validates it on first use.)
if (process.env.COHERE_API_KEY?.trim()) {
  warmCohere().catch(() => undefined);
  warmCohereTranslator().catch(() => undefined);
}

let service: SearchService | undefined;
let limiter: RateLimiter | undefined;
let quotaWatch: ReturnType<typeof translateQuotaWatch> | undefined;

/**
 * Finishes `work` after the response is sent (`after()`); outside a request (a script, a test) it simply runs on. Given a
 * function rather than a promise, the work only starts after the response.
 */
export function deferAfterResponse(work: Promise<unknown> | (() => Promise<unknown>)): void {
  try {
    after(work);
  } catch {
    (typeof work === "function" ? work() : work).catch(() => undefined);
  }
}

function questionEmbedder() {
  const env = getEnv();
  return env.cohereApiKey ? cohereQueryEmbedder({ apiKey: env.cohereApiKey }) : null;
}

/** The translated-question leg's translator, where a key is configured (S03.05), with the fallback models it retries with (none: the routed model alone). */
function questionTranslator(fallback: QuestionRoute | null): QuestionTranslator | null {
  const env = getEnv();
  return env.cohereApiKey ? createQuestionTranslator({ translator: cohereTranslator({ apiKey: env.cohereApiKey }), route: env.search.questionRoute, fallback }) : null;
}

/**
 * The hook that warns ops when a translation model nears its monthly limit (SEARCH_TRANSLATE_MONTHLY_CALLS), one per instance so
 * that it warns once per model per month; undefined when no limit is configured. It counts after the response, never in a search.
 */
function translateQuota() {
  const limits = getEnv().search.translateMonthlyCalls;
  if (Object.keys(limits).length === 0) return undefined;
  quotaWatch ??= translateQuotaWatch({ db: getDb, limits, defer: deferAfterResponse });
  return quotaWatch;
}

/** The search use case. Without a Cohere key (every environment but production) every search answers `status: "unavailable"`. */
export function searchService(): SearchService {
  if (service) return service;
  service = createSearch({
    db: getDb,
    storage: directoryStorage,
    embedder: questionEmbedder(),
    translator: questionTranslator(getEnv().search.questionFallback),
    fallbackMinBudgetMs: getEnv().search.fallbackMinBudgetMs,
    defer: deferAfterResponse,
    onSpendWritten: translateQuota(),
    emergencyThreshold: getEnv().search.emergencyThreshold,
    onFailure: (note) => recordSearchNote(getDb(), note),
  });
  return service;
}

/**
 * The engine of the search test-set runner: the same use case, but its usage is counted as `test_set` and it writes no
 * `search_log` row (they are not residents' searches). `translatedLeg: false` runs it without the translated-question leg,
 * so a run with the leg on and one with it off show the leg's effect per language (S03.05). It never falls back to a second
 * model, so that S03.07's run measures the routed models and not whichever answered.
 */
export function searchTestSetEngine(options: { translatedLeg?: boolean } = {}): SearchService {
  return createSearch({
    db: getDb,
    storage: directoryStorage,
    embedder: questionEmbedder(),
    translator: options.translatedLeg === false ? null : questionTranslator(null),
    onSpendWritten: translateQuota(),
    emergencyThreshold: getEnv().search.emergencyThreshold,
    spendPurpose: "test_set",
    log: false,
  });
}

/** Writes the ops event of a rate limiter that could not count (the search then answered 503 `search_unavailable`). */
export async function recordLimiterFailure(ms: number): Promise<void> {
  await recordOpsEvent(getDb(), { kind: "search.unavailable", detail: { reason: "rate_limit_failed", ms } });
}

/** Writes the ops event of a search cut at the route's hard deadline (it answered 503 `search_unavailable`): a reason and a duration. */
export async function recordSearchDeadline(ms: number): Promise<void> {
  await recordOpsEvent(getDb(), { kind: "search.unavailable", detail: { reason: "deadline", ms } });
}

/** The per-client limiter, salted with a key derived from the Supabase secret key (a fixed local key where there is none). */
export function searchRateLimiter(): RateLimiter {
  if (limiter) return limiter;
  const secret = getEnv().supabaseSecretKey ?? "local-development";
  limiter = createRateLimiter({ db: getDb(), key: rateLimitKeyFromSecret(secret) });
  return limiter;
}
