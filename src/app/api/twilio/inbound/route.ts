// `POST /api/twilio/inbound` (S07.04): the texts residents send to the CVH's number, as the Messaging Service forwards them. Public (Twilio
// cannot sign in), so everything rests on the signature, checked before any other work (a wrong one answers 403, does nothing, and is counted
// in ops_event toward the same alert as the status callbacks'). A message is handled once (a Twilio retry of the same MessageSid answers 200
// and changes nothing). Every reply the app sends goes through the outbox, never in this response: the answer is an empty TwiML document, so
// Twilio itself sends nothing more (its own STOP, START and HELP replies are its Advanced Opt-Out's). The route sets no cookie, its answers are
// never cached, and it never logs the request: not its number, its text or its signature.
import { appInboundWebhook, startSending } from "@/app/inbound";
import { stdoutMessagingLog } from "@/modules/messaging";
import { readBodyWithin } from "../status/body";

export const dynamic = "force-dynamic";
// The dispatcher started after a reply was queued runs in this function's time (S06.02's kick), as for the sign-up.
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

const twiml = () => new Response(EMPTY_TWIML, { status: 200, headers: { ...NO_STORE, "Content-Type": "text/xml; charset=utf-8" } });

export async function POST(request: Request) {
  try {
    const body = await readBodyWithin(request);
    if (body === null) return Response.json({ error: { code: "payload_too_large" } }, { status: 413, headers: NO_STORE });
    const result = await appInboundWebhook().handle({
      signature: request.headers.get("x-twilio-signature"),
      search: new URL(request.url).search,
      body,
    });
    switch (result.kind) {
      case "not_configured":
        return Response.json({ error: { code: "webhooks_not_configured" } }, { status: 503, headers: NO_STORE });
      case "rejected":
        return Response.json({ error: { code: "invalid_signature" } }, { status: 403, headers: NO_STORE });
      case "handled":
        if (result.replied) startSending();
        return twiml();
      default:
        return twiml();
    }
  } catch (error) {
    // Nothing was applied (the transaction rolled back, the message is not marked seen), so a retry by Twilio is handled afresh. Only the
    // error's name is logged.
    stdoutMessagingLog.error("inbound.failed", { error: error instanceof Error ? error.name : "NonError" });
    return Response.json({ error: { code: "inbound_failed" } }, { status: 500, headers: NO_STORE });
  }
}

export function GET() {
  return Response.json({ error: { code: "method_not_allowed" } }, { status: 405, headers: { ...NO_STORE, Allow: "POST" } });
}
