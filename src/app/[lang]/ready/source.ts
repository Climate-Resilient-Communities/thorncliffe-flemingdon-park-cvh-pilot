// Where the Be ready pages get the guides, the essential numbers and the buildings' contacts (AD-2: the app wires the
// directory and places modules to the database). Server only. The app's connection is cvh_app_login, which may only
// select from `guide`, `essential_number` and `building`.
//
// Locally only (the environment check refuses it on Vercel), CVH_FAKE_GUIDES_FILE and CVH_FAKE_BUILDINGS_FILE swap the
// database for sample rows in JSON files, for the resident page tests and their screenshots.
import { unstable_cache } from "next/cache";
import { cache } from "react";
import { readResidentContent, readResidentContentFixtureFile, type ResidentContent } from "@/modules/directory";
import { listBuildingContacts, readBuildingsFixtureFile, type BuildingWithContact } from "@/modules/places";
import { getEnv } from "@/platform/config/env";
import { getDb } from "@/platform/db";
import { BUILDING_CONTACTS_TAG } from "../../buildingCache";
import { GUIDE_CONTENT_TAG, GUIDE_REVALIDATE_SECONDS } from "../../guideCache";

/** A building's contact as the data cache keeps it: JSON, so its date is an ISO string. */
export interface StoredBuildingContact {
  rsn: string;
  address: string;
  contact: { role: string; phone: string; updatedAt: string } | null;
}

export const storeContacts = (list: BuildingWithContact[]): StoredBuildingContact[] =>
  list.map(({ rsn, address, contact }) => ({
    rsn,
    address,
    contact: contact && { role: contact.role, phone: contact.phone, updatedAt: contact.updatedAt.toISOString() },
  }));

/** What the pages get when the database cannot be read: nothing, which each page shows as its own "could not be loaded" state. */
const NO_CONTENT: ResidentContent = { guides: [], numbers: [] };

/**
 * One line of operational log (spine: Logging) for a failed read, with no personal data: which read and the kind of
 * error, never the error's message (a database message can carry the query) and never anything about the visitor.
 */
function logReadFailed(source: "guides" | "building_contacts", error: unknown): void {
  console.log(JSON.stringify({ level: "error", evt: "resident.content_read_failed", module: "app", source, error: error instanceof Error ? error.constructor.name : "unknown" }));
}

let guidesFixture: { file: string; content: ResidentContent } | undefined;
let buildingsFixture: { file: string; list: StoredBuildingContact[] } | undefined;

const readContentCached = unstable_cache(() => readResidentContent(getDb()), ["resident-guide-content"], {
  revalidate: GUIDE_REVALIDATE_SECONDS,
  tags: [GUIDE_CONTENT_TAG],
});

const readContactsCached = unstable_cache(async () => storeContacts(await listBuildingContacts(getDb())), ["resident-building-contacts"], {
  revalidate: GUIDE_REVALIDATE_SECONDS,
  tags: [BUILDING_CONTACTS_TAG],
});

/**
 * The guides and essential numbers the seed loaded: one database read kept in Next's data cache for 5 minutes, shared by
 * every visitor and every language. The seed is a command run by IT, so nothing drops the entry: a reloaded guide shows
 * within the 5 minutes (and the shared cache in front of the app may hold the page for 1 minute more).
 * Called by a page and by its metadata in one request: the answer is shared (`cache`), so a render asks once.
 *
 * A failed read is caught here, outside `unstable_cache`, so the empty answer is never written to the data cache: the
 * next visitor reads the database again. The pages get no guides and no numbers and say so; the 911 block is on them
 * whatever happens.
 */
export const loadResidentContent = cache(async (): Promise<ResidentContent> => {
  try {
    const file = getEnv().fakeGuidesFile;
    if (file) {
      if (guidesFixture?.file !== file) guidesFixture = { file, content: readResidentContentFixtureFile(file) };
      return guidesFixture.content;
    }
    return await readContentCached();
  } catch (error) {
    logReadFailed("guides", error);
    return NO_CONTENT;
  }
});

/**
 * Every pilot building with the contact the Hub entered, if any: the same list for every visitor, so the server never
 * learns which buildings a resident chose (AD-3). Kept in the data cache for 5 minutes and dropped when the Hub saves a contact.
 * A failed read is caught outside the cache like the guides' one (an empty list is never kept): the page then has no building to show.
 */
export const loadBuildingContacts = cache(async (): Promise<StoredBuildingContact[]> => {
  try {
    const file = getEnv().fakeBuildingsFile;
    if (file) {
      if (buildingsFixture?.file !== file) {
        const list = [...readBuildingsFixtureFile(file).values()]
          .sort((a, b) => a.address.localeCompare(b.address) || a.rsn.localeCompare(b.rsn))
          .map(({ rsn, address, contact }) => ({ rsn, address, contact }));
        buildingsFixture = { file, list: storeContacts(list) };
      }
      return buildingsFixture.list;
    }
    return await readContactsCached();
  } catch (error) {
    logReadFailed("building_contacts", error);
    return [];
  }
});
