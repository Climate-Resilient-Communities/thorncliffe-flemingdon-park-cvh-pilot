import { BuildingListSchema } from "@/contracts/buildingList";
import { createResidentBuildings } from "@/modules/places";
import { getDb } from "@/platform/db";

// The pilot buildings and their floors for the resident app (S02.03): public, the same for every visitor, no cookie
// (AD-3). The phone keeps the list and does its choosing and checking against it, so the server never learns which
// buildings or floors a resident chose. Read from the database when asked, then shared by caches for a few minutes.
export const dynamic = "force-dynamic";

const PUBLIC_CACHE = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";

export async function GET() {
  try {
    const buildings = await createResidentBuildings({ db: getDb() }).list();
    return Response.json(BuildingListSchema.parse({ v: 1, buildings }), { headers: { "Cache-Control": PUBLIC_CACHE } });
  } catch {
    // Expected failure as a value: the phone keeps what it has and says the list could not be loaded.
    return Response.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
