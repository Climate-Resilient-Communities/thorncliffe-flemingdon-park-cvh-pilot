// Composition root of the residents' place suggestions (PRD §6.3, D9/E4, AD-2): the directory module's use cases on the app's database, and
// subscriptions' per-client limiter (the one search and sign-up use, AD-22) with scopes of their own. Server only. POST
// /api/places/submissions and GET /api/places/submissions/{ref} are the callers (their route files may export only route fields, so their
// dependencies are built here); the Hub's pages call the directory module directly.
import "server-only";
import { readSubmissionStatus, submitPlace, unstoredRef } from "@/modules/directory";
import { createRateLimiter, type RateLimiter, type RateLimitRule } from "@/modules/subscriptions";
import { getDb } from "@/platform/db";
import type { PlaceSubmissionRouteDeps } from "./api/places/submissions/handler";
import { clientAddress } from "./clientAddress";
import { rateLimitKey } from "./signup";

/**
 * Sending: at most 5 suggestions an hour from one connection. A neighbour adds a place or two; a script filling the queue is stopped long before the Hub's
 * week of reading is (O-08's budget). A Hub desk where several people send from one connection can wait an hour.
 */
export const PLACE_SUBMISSION_RATE_LIMIT: RateLimitRule = { scope: "place_submission", limit: 5, windowMs: 60 * 60_000 };
/** Reading by reference code: 30 an hour, enough to look again and again, too few to try codes (30^8 of them). */
export const PLACE_STATUS_RATE_LIMIT: RateLimitRule = { scope: "place_status", limit: 30, windowMs: 60 * 60_000 };

let limiter: RateLimiter | undefined;

/** The per-client limiter, salted like sign-up's (the key derived from the Supabase secret key). */
export function placeSubmissionLimiter(): RateLimiter {
  if (limiter) return limiter;
  limiter = createRateLimiter({ db: getDb(), key: rateLimitKey() });
  return limiter;
}

/** What the two routes run with on the real database. */
export const placeSubmissionRouteDeps: PlaceSubmissionRouteDeps = {
  submit: (request) => submitPlace(getDb(), request),
  status: (ref) => readSubmissionStatus(getDb(), ref),
  unstoredRef: () => unstoredRef(),
  limiter: placeSubmissionLimiter,
  client: clientAddress,
  rules: { submit: PLACE_SUBMISSION_RATE_LIMIT, status: PLACE_STATUS_RATE_LIMIT },
};
