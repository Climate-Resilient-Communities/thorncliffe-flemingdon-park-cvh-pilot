import { unstable_cache } from "next/cache";
import { BuildingListSchema, RESIDENT_BUILDINGS_TAG } from "@/contracts/buildingList";
import { createResidentBuildings } from "@/modules/places";
import { getDb } from "@/platform/db";

// The pilot buildings and their floors for the resident app (S02.03): public, the same for every visitor, no cookie
// (AD-3). The phone keeps the list and does its choosing and checking against it, so the server never learns which
// buildings or floors a resident chose. The route answers every request (no CDN is relied on), but the database is
// read through the Next data cache: at most once in 5 minutes, whatever the query string or the number of requests, and
// again at once after a staff change to a building or floor (those actions revalidate RESIDENT_BUILDINGS_TAG).
export const dynamic = "force-dynamic";

const PUBLIC_CACHE = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";

// A failure is thrown out of the cached function, so it is never cached. `generated_at` is part of what is cached: it is
// when the database was read, which the phone compares with its last write before it prunes anything.
const readList = unstable_cache(
  async () => ({ generated_at: new Date().toISOString(), buildings: await createResidentBuildings({ db: getDb() }).list() }),
  [RESIDENT_BUILDINGS_TAG],
  { revalidate: 300, tags: [RESIDENT_BUILDINGS_TAG] },
);

export async function GET() {
  try {
    const { generated_at, buildings } = await readList();
    return Response.json(BuildingListSchema.parse({ v: 1, generated_at, buildings }), { headers: { "Cache-Control": PUBLIC_CACHE } });
  } catch {
    // Expected failure as a value: the phone keeps what it has and says the list could not be loaded.
    return Response.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
