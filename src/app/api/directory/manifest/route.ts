import { getDb } from "@/platform/db";
import { directoryStorage } from "../../../directoryRelease";
import { manifestResponse } from "../serve";

// The manifest is read from the database on every request and never cached (AD-1, AD-11).
export const dynamic = "force-dynamic";

export function GET() {
  return manifestResponse({ db: getDb, storage: directoryStorage });
}
