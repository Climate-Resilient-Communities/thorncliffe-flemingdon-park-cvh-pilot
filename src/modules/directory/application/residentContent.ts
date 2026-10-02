// The guides and essential numbers as the seed loaded them (S02.09), read for the resident pages (S02.10).
// Two small selects of public content, the same for every visitor; the pages keep the answer in Next's data cache.
// Only what the pages show is selected: the owner and the English review stay in the database (they are the Hub's
// own record; residents see that the Hub reviewed the text and the day it was last updated).
import { asc } from "drizzle-orm";
import type { Db } from "@/platform/db";
import { essentialNumber, guide } from "../adapters/schema";
import type { GuideRecord, NumberRecord } from "../domain/residentContent";

export interface ResidentContent {
  guides: GuideRecord[];
  numbers: NumberRecord[];
}

export async function readResidentContent(db: Db): Promise<ResidentContent> {
  const guides = await db
    .select({ id: guide.id, readMins: guide.readMins, lastUpdated: guide.lastUpdated, texts: guide.texts })
    .from(guide)
    .orderBy(asc(guide.id));
  const numbers = await db
    .select({
      id: essentialNumber.id,
      sortOrder: essentialNumber.sortOrder,
      number: essentialNumber.number,
      emergency: essentialNumber.emergency,
      lastUpdated: essentialNumber.lastUpdated,
      lastChecked: essentialNumber.lastChecked,
      texts: essentialNumber.texts,
    })
    .from(essentialNumber)
    .orderBy(asc(essentialNumber.sortOrder));
  return { guides, numbers };
}
