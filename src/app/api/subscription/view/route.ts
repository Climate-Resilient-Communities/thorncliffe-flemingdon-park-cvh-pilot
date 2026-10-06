// `POST /api/subscription/view` (S07.06): the choices the edit page shows, for a token in the body (never in the URL). Reads only: nothing is
// used, so a link-preview fetch of the page, which never calls this, and a page opened twice both leave the link as it was. See ../handler.ts.
import { stdoutSubscriptionsLog } from "@/modules/subscriptions";
import { editLink } from "../../../subscriptionEdit";
import { subscriptionMethodNotAllowed, subscriptionViewResponse } from "../handler";

export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return subscriptionViewResponse({ edit: editLink, log: stdoutSubscriptionsLog }, request);
}

export const GET = subscriptionMethodNotAllowed;
