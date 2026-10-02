// Composition root of the directory module for the staff surface (AD-2): the app's database
// connection (cvh_app_login). Server only. A seam of its own, like ./identity.ts, so the tests that
// call the staff pages and actions directly can hand them a database.
import { getDb } from "@/platform/db";
import type { Db } from "@/platform/db";

/** The database the providers screen reads and its actions write. */
export function directoryDb(): Db {
  return getDb();
}
