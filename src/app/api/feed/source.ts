// Where the feed route gets its FeedV1 (AD-2: the app wires the alerting module to the database). Server only.
//
// The launch gate (RESIDENT_ALERTS_ENABLED, S04.08) is passed to the alerting module here: with it off the feed lists no thread, whatever
// has been approved, so production shows residents no alert until E05 is released.
//
// Locally only (the environment check refuses them on Vercel): CVH_FAKE_BUILDINGS_FILE swaps the database for the sample buildings of
// the resident page tests (the feed then lists those buildings and the two neighbourhoods, at version 0, all at status none), and
// CVH_FAKE_FEED_FILE swaps the database's alerts for the threads in a JSON file (and says the feed version), so a page test can show
// an alert with no database.
import { createArchive, createFeed, createResidentAlerts, readFeedFixtureFile, type FeedPlaces } from "@/modules/alerting";
import { readBuildingsFixtureFile } from "@/modules/places";
import { getEnv } from "@/platform/config/env";
import { getDb } from "@/platform/db";
import type { ArchiveV1, FeedThread, FeedV1 } from "@/contracts/feed";
import type { LangCode } from "@/contracts/lang";

const NEIGHBOURHOOD_IDS: Record<string, string> = { "Thorncliffe Park": "TP", "Flemingdon Park": "FP" };

function fixturePlaces(file: string): FeedPlaces {
  const buildings = [...readBuildingsFixtureFile(file).values()];
  return {
    buildings: buildings.map(({ rsn }) => rsn),
    neighbourhoods: Object.values(NEIGHBOURHOOD_IDS),
    neighbourhoodOf: Object.fromEntries(buildings.flatMap(({ rsn, neighbourhoodName }) => (NEIGHBOURHOOD_IDS[neighbourhoodName] ? [[rsn, NEIGHBOURHOOD_IDS[neighbourhoodName]]] : []))),
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

/** The slugs of the threads that closed, read now (the gate in front of `readClosedAlert`; cached in src/app/feedCache.ts). */
export async function readClosedSlugs(): Promise<string[]> {
  const { fakeBuildingsFile, fakeFeedFile } = getEnv();
  if (fakeFeedFile) return (await readFeedFixtureFile(fakeFeedFile).alerts.readClosedSlugs?.()) ?? [];
  if (fakeBuildingsFile) return [];
  return (await createResidentAlerts(getDb()).readClosedSlugs?.()) ?? [];
}

/**
 * The closed thread with this slug, read now (S05.03): R-07 opens a thread that closed from its address, with how it closed, its final message and every earlier entry.
 * It is read from the resident views, as the feed is, and is never in the feed (the feed lists open threads only); the cache in front of the feed does not hold it. A feed
 * fake file answers for it from its closed threads; a buildings fake (no database) has none.
 */
export async function readClosedAlert(lang: LangCode, slug: string): Promise<{ thread: FeedThread; serverNow: Date } | null> {
  const { fakeBuildingsFile, fakeFeedFile } = getEnv();
  if (fakeFeedFile) {
    const fixture = readFeedFixtureFile(fakeFeedFile);
    const thread = (await fixture.alerts.readClosed?.(lang, slug)) ?? null;
    return thread ? { thread, serverNow: fixture.now() ?? new Date() } : null;
  }
  if (fakeBuildingsFile) return null;
  const thread = (await createResidentAlerts(getDb()).readClosed?.(lang, slug)) ?? null;
  return thread ? { thread, serverNow: new Date() } : null;
}

/**
 * One page of the archive for one language, read now (S05.07): the closed threads from the resident views (a drill never appears), or from a feed fake file's closed threads. With
 * the launch gate off, or a buildings fake and no feed file (no database), it lists none, as the feed does. The cache in front of it is src/app/feedCache.ts.
 */
export async function readArchive(lang: LangCode, page: number): Promise<ArchiveV1> {
  const { fakeBuildingsFile, fakeFeedFile, residentAlertsEnabled: alertsEnabled } = getEnv();
  const fixture = fakeFeedFile ? readFeedFixtureFile(fakeFeedFile) : undefined;
  const now = () => fixture?.now() ?? new Date();
  if (fakeBuildingsFile && !fixture) return createArchive({ alertsEnabled, now }).read(lang, page);
  return createArchive({ db: fixture ? undefined : getDb(), alerts: fixture?.alerts, alertsEnabled, now }).read(lang, page);
}
