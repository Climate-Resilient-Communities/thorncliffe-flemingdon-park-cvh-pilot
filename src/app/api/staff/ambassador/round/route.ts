import { ROUND_ROUTE, RoundRequestSchema } from "@/contracts/checkinRound";
import { readJson, staffJson, staffRoute } from "@/app/staff/guard";
import { roundReads } from "@/app/staff/ambassador/round/load";

export const dynamic = "force-dynamic";

/**
 * `POST /api/staff/ambassador/round` (S08.07, A-04): "My round" as the person may see it now, read with a POST and answered no-store (AD-1: the page keeps it
 * in its memory only; the service worker never answers or keeps a POST or anything under /api/staff). Every staff member may ask (`hub.open`); what each gets
 * is the role policy's, floor by floor, on their current assignments (src/app/staff/ambassador/round/compose.ts): a request on a floor an Ambassador covers
 * (`checkins.view_open`), or any for an Admin, is its `round_ref`, number, floor and method; any other floor of an Ambassador's buildings, and every floor for
 * a Coordinator or a Director (`coverage.view`), is counts only; nothing else. Never a name, a reason or a row id.
 */
export const POST = staffRoute({ route: ROUND_ROUTE, access: "hub", action: "hub.open" }, async (request, session) => {
  const body = await readJson(request, RoundRequestSchema);
  if (!body.ok) return body.response;
  return staffJson(await roundReads().load(session));
});
