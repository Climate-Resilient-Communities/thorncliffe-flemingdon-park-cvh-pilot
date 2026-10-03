// `POST /api/twilio/status?ref={callback_ref}` (S06.04): Twilio's status callbacks, the only source of a text's delivery status. Public (Twilio
// cannot sign in), so everything rests on the signature: `X-Twilio-Signature` is checked against the URL built from PUBLIC_BASE_URL and
// the form body before any other work; a wrong one answers 403 and does nothing (counted in ops_event, S06.07 alerts above 5 in 10
// minutes). The route sets no cookie and its answers are never cached, and it never logs the request: not its number, its text, its
// signature or its reference. The answers hold no detail: a code at most.
import { appStatusCallbacks } from "@/app/statusCallback";
import { stdoutMessagingLog } from "@/modules/messaging";
import { readBodyWithin } from "./body";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  try {
    const body = await readBodyWithin(request);
    if (body === null) return Response.json({ error: { code: "payload_too_large" } }, { status: 413, headers: NO_STORE });
    const result = await appStatusCallbacks().handle({
      signature: request.headers.get("x-twilio-signature"),
      search: new URL(request.url).search,
      body,
    });
    switch (result.kind) {
      case "not_configured":
        return Response.json({ error: { code: "webhooks_not_configured" } }, { status: 503, headers: NO_STORE });
      case "rejected":
        return Response.json({ error: { code: "invalid_signature" } }, { status: 403, headers: NO_STORE });
      default:
        // Applied, or changed nothing for a reason that is ours to count: either way Twilio has been heard, and a retry would change nothing.
        return Response.json({ ok: true }, { headers: NO_STORE });
    }
  } catch (error) {
    // The callback was not applied (its transaction rolled back). Twilio does not retry a 5xx unless the URL it was given says so: the
    // dispatcher's StatusCallback carries `#rc=3&rp=ct,5xx` (STATUS_CALLBACK_CONNECTION_OVERRIDES), so it tries up to three more times
    // within its 15 seconds; a database that stays down longer leaves the text to the sweep (`unknown`). Only the error's name is logged.
    stdoutMessagingLog.error("callback.failed", { error: error instanceof Error ? error.name : "NonError" });
    return Response.json({ error: { code: "callback_failed" } }, { status: 500, headers: NO_STORE });
  }
}

export function GET() {
  return Response.json({ error: { code: "method_not_allowed" } }, { status: 405, headers: { ...NO_STORE, Allow: "POST" } });
}
