// `/api/jobs/messaging-config` (S06.02): the daily check that Smart Encoding is off on the Twilio Messaging Service (defence in depth:
// every request already sets `SmartEncoded=false`). pg_cron calls it daily with the job secret; the procedures call it again after every
// recorded change to the service. When the setting is on it records `messaging.smart_encoding_on` in ops_event, which the health job
// turns into the on-call alert (S06.07). Outside production there is no Twilio account and nothing is read.
import { runMessagingServiceCheck, SenderNotConfigured } from "@/app/dispatch";
import { getEnv } from "@/platform/config/env";
import { checkJobSecret } from "../jobAuth";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const denied = checkJobSecret(request, getEnv());
  if (denied) return denied;
  try {
    return Response.json(await runMessagingServiceCheck(), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SenderNotConfigured) {
      return Response.json({ error: { code: "sender_not_configured" } }, { status: 503, headers: NO_STORE });
    }
    console.log(JSON.stringify({ level: "error", evt: "messaging_config.check_failed", module: "messaging", error: error instanceof Error ? error.name : "NonError" }));
    return Response.json({ error: { code: "check_failed" } }, { status: 500, headers: NO_STORE });
  }
}

export function GET() {
  return Response.json({ error: { code: "method_not_allowed" } }, { status: 405, headers: { ...NO_STORE, Allow: "POST" } });
}
