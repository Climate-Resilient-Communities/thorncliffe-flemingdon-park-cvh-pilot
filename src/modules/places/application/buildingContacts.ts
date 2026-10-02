// The contacts of every pilot building, for the essential-numbers page (S02.10, FR-D7). A resident's chosen
// buildings live only on their phone (AD-3), so the server cannot be asked for "my buildings' contacts": it serves
// this one list, the same for every visitor, and the phone picks its own buildings out of it. Only what the page
// shows leaves the database: the register number, the address and the contact the Hub entered (the same contact
// the building page shows); nothing about floors, facts or who confirmed what.
import { asc } from "drizzle-orm";
import type { Db } from "../../../platform/db";
import { building } from "../adapters/schema";
import { contactOf, type BuildingContact } from "./floors";

export interface BuildingWithContact {
  rsn: string;
  address: string;
  /** Null when the Hub has entered none: the page then says "We don't have a contact for your building yet". */
  contact: BuildingContact | null;
}

/** Every building by address, with its contact if the Hub has entered one. A building flagged "not in latest register" is still listed: its page still opens. */
export async function listBuildingContacts(db: Db): Promise<BuildingWithContact[]> {
  const rows = await db
    .select({
      rsn: building.rsn,
      address: building.address,
      contactRole: building.contactRole,
      contactPhone: building.contactPhone,
      contactUpdatedAt: building.contactUpdatedAt,
    })
    .from(building)
    .orderBy(asc(building.address), asc(building.rsn));
  return rows.map((row) => ({ rsn: row.rsn, address: row.address, contact: contactOf(row) }));
}
