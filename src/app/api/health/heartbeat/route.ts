// `GET /api/health/heartbeat` (S09.01, E09 "Heartbeat"): 200 only if the health job completed less than 3 minutes ago, else 503. It is public (the
// outside check calls it with no secret), so it says nothing else: an empty body, `Cache-Control: no-store`, no cookie (the proxy does not run
// on /api). `HEAD` answers the same, for monitors that use it. One answer is reused for 10 s (HEARTBEAT_CACHE_MS), so calling it fast
// costs no database reads.
import { cachedHeartbeatStatus } from "@/app/heartbeat";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store" };

export async function GET() {
  return new Response(null, { status: await cachedHeartbeatStatus(), headers: HEADERS });
}

export async function HEAD() {
  return new Response(null, { status: await cachedHeartbeatStatus(), headers: HEADERS });
}
