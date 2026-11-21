import { clientAddress } from "@/app/clientAddress";
import { searchRateLimiter, searchService } from "../../../search";
import { closestResponse } from "./handler";

// A question is personal: the answer is built for each request and never cached (AD-3).
export const dynamic = "force-dynamic";
// The handler answers within 8 s; this leaves room for a cold start.
export const maxDuration = 15;

export function POST(request: Request) {
  return closestResponse({ search: searchService, limiter: searchRateLimiter, client: clientAddress }, request);
}
