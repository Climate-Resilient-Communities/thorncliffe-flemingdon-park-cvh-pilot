// `GET /api/health/heartbeat` (S09.01, E09 "Heartbeat"): 200 with an empty body while the health job completed less than 3 minutes ago and Twilio
// sign-in is not failing; else 503 whose plain-text body is one short code naming the cause (`health_job_stale`, `provider_auth` or
// `database_unreachable`, src/app/heartbeat.ts), so the outside check's email can say which subsystem is failing. It is public (the outside check
// calls it with no secret), so it says nothing else: no number, no error text, no id, `Cache-Control: no-store`, no cookie (the proxy does not run
// on /api). `HEAD` answers the same status and headers with no body, for monitors that use it. One answer is reused for 10 s
// (HEARTBEAT_CACHE_MS), so calling it fast costs no database reads.
import { cachedHeartbeatStatus, type HeartbeatAnswer } from "@/app/heartbeat";

export const dynamic = "force-dynamic";

function headersOf(answer: HeartbeatAnswer): Record<string, string> {
  return answer.status === 200 ? { "Cache-Control": "no-store" } : { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" };
}

export async function GET() {
  const answer = await cachedHeartbeatStatus();
  return new Response(answer.status === 200 ? null : answer.cause, { status: answer.status, headers: headersOf(answer) });
}

export async function HEAD() {
  const answer = await cachedHeartbeatStatus();
  return new Response(null, { status: answer.status, headers: headersOf(answer) });
}
