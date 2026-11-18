import { clientAddress } from "@/app/clientAddress";
import { signupService, startSending } from "../../signup";
import { checkHuman, readHumanCheckConfig } from "@/platform/humanCheck";
import { signupResponse } from "./handler";

// A sign-up carries a phone number and places (AD-3's exception): answered per request, never cached, no cookie.
export const dynamic = "force-dynamic";
// The kick of the dispatcher runs after the response, inside this function's time (S06.02's note: a caller of kickDispatcher exports 60).
export const maxDuration = 60;

export function POST(request: Request) {
  const humanCheck = (token: string | undefined) => checkHuman(readHumanCheckConfig(), token);
  return signupResponse({ signup: signupService, client: clientAddress, afterAccepted: startSending, humanCheck }, request);
}

export function GET() {
  return Response.json({ error: { code: "method_not_allowed" } }, { status: 405, headers: { "Cache-Control": "no-store", Allow: "POST" } });
}
