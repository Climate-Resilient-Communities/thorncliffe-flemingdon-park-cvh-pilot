// The day the pilot's resident data was deleted (S09.08), as the terms page (S07.01) states it: the Toronto day the end-of-pilot purge completed, read from
// subscriptions' record of it through Next's data cache. Server only. The purge job's route (`/api/jobs/end-of-pilot-purge`) expires PILOT_END_TAG when the
// purge completes, so the page states the day at once; without that the reading is kept for an hour.
import "server-only";
import { unstable_cache } from "next/cache";
import { residentDataDeletedOn } from "@/modules/subscriptions";
import { getEnv } from "@/platform/config/env";
import { getDb } from "@/platform/db";

/** The tag of the cached reading of the purge's completion. */
export const PILOT_END_TAG = "pilot-end";

/** How long the reading is kept when nothing expires it. */
const PILOT_END_MAX_AGE_SECONDS = 3600;

/**
 * The Toronto day the pilot's resident data was deleted (`YYYY-MM-DD`), or null: before the purge has completed, and when it cannot be read (the page is
 * then the terms without that line; a failure is never cached). Keyed by the deployment's address, as the feed is, so an answer made against another database
 * (a preview, the page tests' servers) is never served here. CVH_FAKE_RESIDENT_DATA_DELETED_ON (local development only) stands in for the database in the
 * resident page tests.
 */
export async function residentDataDeletedOnCached(): Promise<string | null> {
  const env = getEnv();
  if (env.fakeResidentDataDeletedOn) return env.fakeResidentDataDeletedOn;
  try {
    return await unstable_cache(() => residentDataDeletedOn(getDb()), ["pilot-end", env.publicBaseUrl], { revalidate: PILOT_END_MAX_AGE_SECONDS, tags: [PILOT_END_TAG] })();
  } catch {
    return null;
  }
}
