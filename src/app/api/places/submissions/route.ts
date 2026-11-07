import { placeSubmissionRouteDeps } from "../../../placeSubmissions";
import { submitResponse } from "./handler";

// A resident's place suggestion (PRD §6.3, R-19, R-22): answered per request, never cached, no cookie, nothing about the person (AD-3).
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return submitResponse(placeSubmissionRouteDeps, request);
}

export function GET() {
  return Response.json({ error: { code: "method_not_allowed" } }, { status: 405, headers: { "Cache-Control": "no-store", Allow: "POST" } });
}
