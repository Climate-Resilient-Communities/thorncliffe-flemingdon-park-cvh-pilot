// Where the resident building page gets its building (AD-2: the app wires the places module to the database).
// Server only. The app's connection is cvh_app_login, which reads `building` and `neighbourhood` and nothing a
// resident should not see: places' readPublicBuilding selects only the facts the story lists.
//
// Locally only (the environment check refuses it on Vercel), CVH_FAKE_BUILDINGS_FILE swaps the database for
// sample buildings in a JSON file, for the resident page tests and their screenshots.
import { cache } from "react";
import { readBuildingsFixtureFile, readPublicBuilding, type PublicBuilding } from "@/modules/places";
import { getEnv } from "@/platform/config/env";
import { getDb } from "@/platform/db";

let fixtures: { file: string; buildings: Map<string, PublicBuilding> } | undefined;

/**
 * The building with this register number, or null. Called by the page and by its metadata in one request: the
 * answer is shared (`cache`), so a render asks the database once. The page itself is cached for a few minutes
 * (page.tsx), so the database is asked about one building at most once per language per revalidation.
 */
export const loadBuilding = cache(async (rsn: string): Promise<PublicBuilding | null> => {
  const file = getEnv().fakeBuildingsFile;
  if (file) {
    if (fixtures?.file !== file) fixtures = { file, buildings: readBuildingsFixtureFile(file) };
    return fixtures.buildings.get(rsn) ?? null;
  }
  return readPublicBuilding(getDb(), rsn);
});
