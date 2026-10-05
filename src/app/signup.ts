// Composition root of the web sign-up (S07.02, AD-2): subscriptions' use case on the app's database, with places' readers of the
// neighbourhoods and floors, messaging's outbox for the confirmation text, the terms version the page shows, the per-client limiter and the
// price of a segment for the text's cost estimate. Server only. POST /api/signup is the one caller; S07.03's staff screen will be the second.
//
// After an accepted sign-up the dispatcher is started (`kickDispatcher`, after the response), so the confirmation goes out within seconds
// rather than at pg_cron's next minute; it is started for every accepted answer, whatever the number, so nothing about the number shows.
import "server-only";
import { createDeliveryQueue } from "@/modules/messaging";
import { floorsOfBuilding, neighbourhoodIds } from "@/modules/places";
import { createRateLimiter, createSignup, rateLimitKeyFromSecret, signupConsentVersion, subscriberLookup, termsPageView, type RateLimiter, type Signup } from "@/modules/subscriptions";
import { failClosedEnvironment, getEnv } from "@/platform/config/env";
import { getDb } from "@/platform/db";
import { kickDispatcher } from "./dispatch";

let service: Signup | undefined;
let limiter: RateLimiter | undefined;

/** The key of the per-client limiter's hashes (also the inbound router's once-a-day limit, S07.04). */
export function rateLimitKey(): string {
  return rateLimitKeyFromSecret(getEnv().supabaseSecretKey ?? "local-development");
}

/** The per-client limiter, salted with a key derived from the Supabase secret key (a fixed local key where there is none), as search's is. */
function signupRateLimiter(): RateLimiter {
  if (limiter) return limiter;
  limiter = createRateLimiter({ db: getDb(), key: rateLimitKey() });
  return limiter;
}

/** The terms version a sign-up records now (null: none may be taken; see signupConsentVersion). */
export function currentSignupConsentVersion(): string | null {
  return signupConsentVersion(termsPageView("en"), failClosedEnvironment());
}

/** The sign-up use case on the real database. */
export function signupService(): Signup {
  if (service) return service;
  const queue = createDeliveryQueue();
  service = createSignup({
    db: getDb(),
    places: {
      neighbourhoodIds: (executor) => neighbourhoodIds(executor),
      floorIdsOf: async (executor, rsn) => (await floorsOfBuilding(executor, rsn))?.map((floor) => floor.id) ?? null,
    },
    // S07.04: the subscriber table's lookup (one select, whatever the answer, so the three cases still do the same work).
    subscribers: subscriberLookup(),
    enqueue: (tx, input) => queue.enqueueTransactional(tx, input),
    consentVersion: currentSignupConsentVersion,
    limiter: signupRateLimiter,
    pricePerSegmentCents: () => getEnv().smsPricePerSegmentCents,
  });
  return service;
}

/** Starts the dispatcher after the response, so a new confirmation goes out at once (it never throws). */
export function startSending(): void {
  kickDispatcher();
}
