// Where the resident building page gets its building (AD-2: the app wires the places module to the database).
// Server only. The app's connection is cvh_app_login, which reads `building` and `neighbourhood` and nothing a
// resident should not see: places' readPublicBuilding selects only the facts the story lists.
//
// Locally only (the environment check refuses it on Vercel), CVH_FAKE_BUILDINGS_FILE swaps the database for
// sample buildings in a JSON file, for the resident page tests and their screenshots.
import { unstable_cache } from "next/cache";
import { cache } from "react";
import { readBuildingsFixtureFile, readPublicBuilding, type PublicBuilding } from "@/modules/places";
import { getEnv } from "@/platform/config/env";
import { getDb } from "@/platform/db";
import { BUILDING_REVALIDATE_SECONDS, buildingTag } from "../../../buildingCache";

let fixtures: { file: string; buildings: Map<string, PublicBuilding> } | undefined;

/** A building as the data cache keeps it: JSON, so its dates are ISO strings. */
export type Stored = Omit<PublicBuilding, "factsUpdatedAt" | "contact"> & {
  factsUpdatedAt: string;
  contact: (Omit<NonNullable<PublicBuilding["contact"]>, "updatedAt"> & { updatedAt: string }) | null;
};

export const store = (building: PublicBuilding | null): Stored | null =>
  building && {
    ...building,
    factsUpdatedAt: building.factsUpdatedAt.toISOString(),
    contact: building.contact && { ...building.contact, updatedAt: building.contact.updatedAt.toISOString() },
  };

export const restore = (stored: Stored | null): PublicBuilding | null =>
  stored && {
    ...stored,
    factsUpdatedAt: new Date(stored.factsUpdatedAt),
    contact: stored.contact && { ...stored.contact, updatedAt: new Date(stored.contact.updatedAt) },
  };

class NoSuchBuilding extends Error {}
const RSN = /^[0-9]{1,9}$/;

/**
 * One building's database read, kept in Next's data cache for a few minutes (NFR-N7: cheap and cacheable), shared by
 * every visitor and every language, and dropped at once when the Hub saves the building's contact (buildingTag).
 */
const readCached = (rsn: string) =>
  unstable_cache(
    async () => {
      const found = await readPublicBuilding(getDb(), rsn);
      // A building that is not there is never cached: asking for numbers at random must not fill the cache.
      if (!found) throw new NoSuchBuilding();
      return store(found);
    },
    ["public-building", rsn],
    { revalidate: BUILDING_REVALIDATE_SECONDS, tags: [buildingTag(rsn)] },
  )();

/**
 * The building with this register number, or null. Called by the page and by its metadata in one request: the
 * answer is shared (`cache`), so a render asks once.
 */
export const loadBuilding = cache(async (rsn: string): Promise<PublicBuilding | null> => {
  const file = getEnv().fakeBuildingsFile;
  if (file) {
    if (fixtures?.file !== file) fixtures = { file, buildings: readBuildingsFixtureFile(file) };
    return fixtures.buildings.get(rsn) ?? null;
  }
  if (!RSN.test(rsn)) return null;
  try {
    return restore(await readCached(rsn));
  } catch (error) {
    if (error instanceof NoSuchBuilding) return null;
    throw error;
  }
});
