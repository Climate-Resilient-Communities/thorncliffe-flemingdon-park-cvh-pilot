// Composition root of search for the app (AD-2): the embedding model for questions (Cohere, only where a key is
// configured, which is production), the private store of the release files, the database, and the rate limiter. Server
// only. The route src/app/api/search/route.ts uses it; so will the search test-set runner's engine module.
//
// directory may not import ops, so the app writes the ops event of a search that could not answer, from the reason and
// the duration the use case hands it.
import "server-only";
import { cohereQueryEmbedder, createSearch, type SearchService } from "@/modules/directory";
import { recordOpsEvent } from "@/modules/ops";
import { createRateLimiter, rateLimitKeyFromSecret, type RateLimiter } from "@/modules/subscriptions";
import { getEnv } from "@/platform/config/env";
import { getDb } from "@/platform/db";
import { directoryStorage } from "./directoryRelease";

let service: SearchService | undefined;
let limiter: RateLimiter | undefined;

/** The search use case. Without a Cohere key (every environment but production) every search answers `status: "unavailable"`. */
export function searchService(): SearchService {
  if (service) return service;
  const env = getEnv();
  service = createSearch({
    db: getDb,
    storage: directoryStorage,
    embedder: env.cohereApiKey ? cohereQueryEmbedder({ apiKey: env.cohereApiKey }) : null,
    onFailure: async ({ reason, releaseV, ms }) => {
      await recordOpsEvent(getDb(), {
        kind: "search.unavailable",
        ...(releaseV === null ? {} : { subjectType: "directory_release", subjectId: String(releaseV) }),
        detail: { reason, ms },
      });
    },
  });
  return service;
}

/** The per-client limiter, salted with a key derived from the Supabase secret key (a fixed local key where there is none). */
export function searchRateLimiter(): RateLimiter {
  if (limiter) return limiter;
  const secret = getEnv().supabaseSecretKey ?? "local-development";
  limiter = createRateLimiter({ db: getDb(), key: rateLimitKeyFromSecret(secret) });
  return limiter;
}
