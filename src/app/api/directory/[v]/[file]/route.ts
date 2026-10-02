import { getDb } from "@/platform/db";
import { directoryStorage } from "../../../../directoryRelease";
import { listingResponse } from "../../serve";

// `/api/directory/{v}/{lang}.json`: {v} is the release number and the file is `<lang>.json`. The release is
// looked up per request (it must be complete); the answer itself is immutable, so it is cached for a year.
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ v: string; file: string }> }) {
  const { v, file } = await context.params;
  return listingResponse({ db: getDb, storage: directoryStorage }, v, file);
}
