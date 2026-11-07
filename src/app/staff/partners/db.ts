// Composition root of the partners module for the staff surface (AD-2): the app's database connection (cvh_app_login). A seam of its own,
// like ../directory.ts, so the tests that call the partner space's pages and actions directly can hand them a database.
import { getDb, type Db } from "@/platform/db";

/** The database the partner space's pages read and its actions write. */
export function partnersDb(): Db {
  return getDb();
}
