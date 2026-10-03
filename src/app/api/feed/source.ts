// Where the feed route gets its FeedV1 (AD-2: the app wires the alerting module to the database). Server only.
//
// Locally only (the environment check refuses it on Vercel), CVH_FAKE_BUILDINGS_FILE swaps the database for the sample
// buildings of the resident page tests: the feed then lists those buildings and the two neighbourhoods, at version 0,
// all at status none, which is also what the real feed answers before the web publish (S04.08) exists.
import { createFeed, type FeedPlaces } from "@/modules/alerting";
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

/** The feed for one language, read now. The route keeps it in the data cache (route.ts). */
export async function readFeed(lang: LangCode): Promise<FeedV1> {
  const file = getEnv().fakeBuildingsFile;
  const feed = createFeed(file ? { places: async () => fixturePlaces(file), version: async () => 0 } : { db: getDb() });
  return feed.read(lang);
}
