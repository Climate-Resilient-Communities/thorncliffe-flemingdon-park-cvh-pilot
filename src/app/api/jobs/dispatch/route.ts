// `/api/jobs/dispatch` (S06.02): the dispatcher, called every minute by pg_cron with the environment's job secret (and right after an
// approval commits, through kickDispatcher). A run takes the sender lease or exits without claiming. The answer is counts and a
// status, never a number, a body or a recipient.
import { runDispatchJob, SenderNotConfigured } from "@/app/dispatch";
import { getEnv } from "@/platform/config/env";
import { checkJobSecret } from "../jobAuth";

export const dynamic = "force-dynamic";
/** The run plans its sends to end 10 seconds before this (RUN_LIMIT_MS, RUN_MARGIN_MS). */
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const denied = checkJobSecret(request, getEnv());
  if (denied) return denied;
  try {
    return Response.json(await runDispatchJob(), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SenderNotConfigured) {
      console.log(JSON.stringify({ level: "error", evt: "dispatch.sender_not_configured", module: "messaging", rule: error.rule }));
      return Response.json({ error: { code: "sender_not_configured" } }, { status: 503, headers: NO_STORE });
    }
    console.log(JSON.stringify({ level: "error", evt: "dispatch.run_failed", module: "messaging", error: error instanceof Error ? error.name : "NonError" }));
    return Response.json({ error: { code: "dispatch_failed" } }, { status: 500, headers: NO_STORE });
  }
}

export function GET() {
  return Response.json({ error: { code: "method_not_allowed" } }, { status: 405, headers: { ...NO_STORE, Allow: "POST" } });
}
