// Composition root of the web sign-up (S07.02, AD-2): subscriptions' use case on the app's database, with places' readers of the
// neighbourhoods and floors, messaging's outbox for the confirmation text, the terms version the page shows, the per-client limiter and the
// price of a segment for the text's cost estimate. Server only. POST /api/signup is one caller; S07.03's staff screen (/staff/text-signup) is
// the second, through `assist`, with the audit trail wired here.
//
// After an accepted sign-up the dispatcher is started (`kickDispatcher`, after the response), so the confirmation goes out within seconds
// rather than at pg_cron's next minute; it is started for every accepted answer, whatever the number, so nothing about the number shows.
import "server-only";
import * as audit from "@/modules/audit";
import { createDeliveryQueue } from "@/modules/messaging";
import { createResidentBuildings, floorsOfBuilding, neighbourhoodIds, type ResidentBuilding } from "@/modules/places";
import { createRateLimiter, createSignup, noSubscribersYet, rateLimitKeyFromSecret, signupConsentVersion, termsPageView, type RateLimiter, type Signup } from "@/modules/subscriptions";
import { failClosedEnvironment, getEnv } from "@/platform/config/env";
import { getDb } from "@/platform/db";
import { kickDispatcher } from "./dispatch";

let service: Signup | undefined;
let limiter: RateLimiter | undefined;

/** The per-client limiter, salted with a key derived from the Supabase secret key (a fixed local key where there is none), as search's is. */
function signupRateLimiter(): RateLimiter {
  if (limiter) return limiter;
  const secret = getEnv().supabaseSecretKey ?? "local-development";
  limiter = createRateLimiter({ db: getDb(), key: rateLimitKeyFromSecret(secret) });
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
    // S07.04 creates the subscriber table and replaces this with its lookup.
    subscribers: noSubscribersYet,
    enqueue: (tx, input) => queue.enqueueTransactional(tx, input),
    consentVersion: currentSignupConsentVersion,
    limiter: signupRateLimiter,
    audit: { record: (tx, event) => audit.record(tx, event), recordRefusal: (db, event) => audit.recordRefusal(db, event) },
    pricePerSegmentCents: () => getEnv().smsPricePerSegmentCents,
  });
  return service;
}

/** The buildings with their neighbourhood and floors, for the staff sign-up form's optional building and floor (S07.03). */
export function signupBuildingList(): Promise<ResidentBuilding[]> {
  return createResidentBuildings({ db: getDb() }).list();
}

/** Starts the dispatcher after the response, so a new confirmation goes out at once (it never throws). */
export function startSending(): void {
  kickDispatcher();
}
