// `POST /api/subscription/delete` (S07.06): "Delete my subscription", with the token: the link is used and E07's one deletion (STOP's) runs in
// the same transaction. Nothing is texted: the page alone confirms it. See ../handler.ts.
import { stdoutSubscriptionsLog } from "@/modules/subscriptions";
import { editLink } from "../../../subscriptionEdit";
import { subscriptionDeleteResponse, subscriptionMethodNotAllowed } from "../handler";

export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return subscriptionDeleteResponse({ edit: editLink, log: stdoutSubscriptionsLog }, request);
}

export const GET = subscriptionMethodNotAllowed;
