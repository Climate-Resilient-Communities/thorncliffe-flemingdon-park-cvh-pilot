import { clientAddress } from "@/app/clientAddress";
import { deferAfterResponse, recordLimiterFailure, searchRateLimiter, searchService } from "../../search";
import { searchResponse } from "./handler";

// A question is personal: the answer is built for each request and never cached (AD-3).
export const dynamic = "force-dynamic";
// The search has 2.5 s; this leaves room for a cold start.
export const maxDuration = 10;

export function POST(request: Request) {
  return searchResponse(
    { search: searchService, limiter: searchRateLimiter, client: clientAddress, onLimiterFailure: recordLimiterFailure, defer: deferAfterResponse },
    request,
  );
}
