// `POST /api/subscription/change` (S07.06): every choice as the edit page shows it, with the token; the link is used in the same transaction
// as the change, and the confirmation text is queued. One of the resident requests that carry places and groups (AD-3's exception). See
// ../handler.ts.
import { stdoutSubscriptionsLog } from "@/modules/subscriptions";
import { kickDispatcher } from "../../../dispatch";
import { editLink } from "../../../subscriptionEdit";
import { subscriptionChangeResponse, subscriptionMethodNotAllowed } from "../handler";

export const dynamic = "force-dynamic";
// The dispatcher started after the confirmation was queued runs in this function's time (S06.02's kick), as for the sign-up.
export const maxDuration = 60;

export function POST(request: Request) {
  return subscriptionChangeResponse({ edit: editLink, log: stdoutSubscriptionsLog, afterChanged: () => kickDispatcher() }, request);
}

export const GET = subscriptionMethodNotAllowed;
