import { unstable_cache } from "next/cache";
import { OpenSpacesSchema, RESIDENT_SPACES_TAG } from "@/contracts/openSpaces";
import { residentSpaces } from "@/modules/partners";
import { getDb } from "@/platform/db";

// The spaces open for residents right now (the partner space, 2026-11-07; the map's "Open as a space now" and the listing's status): public,
// the same for every visitor, no cookie (AD-3), like GET /api/buildings. The phone matches it against the directory's places, so the server
// never learns which place a resident looks at. The route answers every request, but the database is read through the Next data cache: at
// most once a minute, whatever the query string or the number of requests (a space fills in minutes, so the cache is short), and again at
// once after a Hub change of a space (the change's action revalidates RESIDENT_SPACES_TAG).
export const dynamic = "force-dynamic";

const PUBLIC_CACHE = "public, max-age=30, s-maxage=60, stale-while-revalidate=120";

// A failure is thrown out of the cached function, so it is never cached.
const readSpaces = unstable_cache(
  async () => {
    const spaces = await residentSpaces(getDb());
    return {
      generated_at: new Date().toISOString(),
      spaces: spaces.map((space) => ({ provider_id: space.providerId, status: space.status, purpose: space.purpose, updated_at: space.confirmedAt.toISOString() })),
    };
  },
  [RESIDENT_SPACES_TAG],
  { revalidate: 60, tags: [RESIDENT_SPACES_TAG] },
);

export async function GET() {
  try {
    const { generated_at, spaces } = await readSpaces();
    return Response.json(OpenSpacesSchema.parse({ v: 1, generated_at, spaces }), { headers: { "Cache-Control": PUBLIC_CACHE } });
  } catch {
    // Expected failure as a value: the map shows its places without a space status, as it does with no signal.
    return Response.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
