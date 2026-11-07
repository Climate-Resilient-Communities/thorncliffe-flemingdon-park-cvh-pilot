import { placeSubmissionRouteDeps } from "../../../../placeSubmissions";
import { statusResponse } from "../handler";

// What the Hub decided about a suggestion, read by its reference code (R-23): per request, never cached, no cookie.
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ ref: string }> }) {
  const { ref } = await context.params;
  return statusResponse(placeSubmissionRouteDeps, request, ref);
}
