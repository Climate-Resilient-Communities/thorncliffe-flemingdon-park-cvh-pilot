// The contacts of every pilot building, for the essential-numbers page (S02.10, FR-D7). A resident's chosen
// buildings live only on their phone (AD-3), so the server cannot be asked for "my buildings' contacts": it serves
// this one list, the same for every visitor, and the phone picks its own buildings out of it. Only what the page
// shows leaves the database: the register number, the address and the contact the Hub entered (the same contact
// the building page shows); nothing about floors, facts or who confirmed what.
import { isNull } from "drizzle-orm";
import type { Db } from "../../../platform/db";
import { building } from "../adapters/schema";
import { compareAddresses } from "../domain/street";
import { contactOf, type BuildingContact } from "./floors";

export interface BuildingWithContact {
  rsn: string;
  address: string;
  /** Null when the Hub has entered none: the page then says "We don't have a contact for your building yet". */
  contact: BuildingContact | null;
}

/**
 * Every building by address (street, then number), with its contact if the Hub has entered one. A building flagged "not in latest register" is still listed: its page
 * still opens. One merged into another by the buildings seed (UAT F-5) is not.
 */
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
    .where(isNull(building.mergedInto));
  return rows
    .sort((a, b) => compareAddresses(a.address, b.address) || a.rsn.localeCompare(b.rsn, "en", { numeric: true }))
    .map((row) => ({ rsn: row.rsn, address: row.address, contact: contactOf(row) }));
}
