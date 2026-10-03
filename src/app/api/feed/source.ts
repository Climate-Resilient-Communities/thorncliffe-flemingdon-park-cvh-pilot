// Where the feed route gets its FeedV1 (AD-2: the app wires the alerting module to the database). Server only.
//
// The launch gate (RESIDENT_ALERTS_ENABLED, S04.08) is passed to the alerting module here: with it off the feed lists no thread, whatever
// has been approved, so production shows residents no alert until E05 is released.
//
// Locally only (the environment check refuses them on Vercel): CVH_FAKE_BUILDINGS_FILE swaps the database for the sample buildings of
// the resident page tests (the feed then lists those buildings and the two neighbourhoods, at version 0, all at status none), and
// CVH_FAKE_FEED_FILE swaps the database's alerts for the threads in a JSON file (and says the feed version), so a page test can show
// an alert with no database.
import { createFeed, readFeedFixtureFile, type FeedPlaces } from "@/modules/alerting";
import { readBuildingsFixtureFile } from "@/modules/places";
import { getEnv } from "@/platform/config/env";
import { getDb } from "@/platform/db";
import type { FeedV1 } from "@/contracts/feed";
import type { LangCode } from "@/contracts/lang";

const NEIGHBOURHOOD_IDS: Record<string, string> = { "Thorncliffe Park": "TP", "Flemingdon Park": "FP" };

function fixturePlaces(file: string): FeedPlaces {
  const buildings = [...readBuildingsFixtureFile(file).values()];
  return {
    buildings: buildings.map(({ rsn }) => rsn),
    neighbourhoods: Object.values(NEIGHBOURHOOD_IDS),
  };
}

/** The feed for one language, read now. The data cache in front of it is src/app/feedCache.ts. */
export async function readFeed(lang: LangCode): Promise<FeedV1> {
  const { fakeBuildingsFile, fakeFeedFile, residentAlertsEnabled: alertsEnabled } = getEnv();
  const alerts = fakeFeedFile ? readFeedFixtureFile(fakeFeedFile) : undefined;
  if (fakeBuildingsFile) {
    return createFeed({ places: async () => fixturePlaces(fakeBuildingsFile), version: async () => alerts?.version() ?? 0, alerts: alerts?.alerts, alertsEnabled, now: () => alerts?.now() ?? new Date() }).read(lang);
  }
  // Without the buildings fake the database answers; a feed fake still replaces the alerts (and, with no database, nothing else).
  return createFeed({ db: getDb(), alerts: alerts?.alerts, version: alerts ? async () => alerts.version() : undefined, alertsEnabled, now: () => alerts?.now() ?? new Date() }).read(lang);
}
