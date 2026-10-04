import { AMBASSADOR_FOLLOW_ROUTE, AmbassadorFollowRequestSchema } from "@/contracts/ambassadorFollow";
import { alerting, alertSubmitter } from "@/app/staff/alerts";
import { followAndSubmit, followBuildings } from "@/app/staff/ambassador/status/followRequest";
import { readJson, staffJson, staffRoute } from "@/app/staff/guard";

export const dynamic = "force-dynamic";
/** The submit translates into every language and freezes the entry: the function lives 60 s, like the Hub's submit (test/submitBudget.test.ts). */
export const maxDuration = 60;

/**
 * `POST /api/staff/ambassador/follow` (S08.04, A-03): an ambassador corrects or withdraws their own pending post, or writes the final message of an alert about
 * their building ("Mark resolved"), made and submitted in one request with the page's ids and idempotency key. The policy action is `alert.author` on the
 * buildings the entry or alert is about, read from the database (`followBuildings`): an Ambassador only for buildings they are assigned to now
 * (`assigned_building`; a Director never). The use case then judges the rest under the thread's lock: that the entry is the person's own and pending
 * (`own_pending_entry`) for a correction or withdrawal, and E05's rules. Nothing is replaced or closed here: that is a second person's approval. Only an
 * Ambassador follows up here; the answer is the submit's body (src/contracts/alertSubmit.ts), never stored (no-store).
 */
export const POST = staffRoute(
  {
    route: AMBASSADOR_FOLLOW_ROUTE,
    access: "hub",
    action: "alert.author",
    context: async (request) => ({ targets: await followBuildings(alerting(), AmbassadorFollowRequestSchema.parse(await request.json())) }),
  },
  async (request, session) => {
    const body = await readJson(request, AmbassadorFollowRequestSchema);
    if (!body.ok) return body.response;
    return staffJson(await followAndSubmit({ alerting, submitter: alertSubmitter, now: () => new Date() }, session, body.value));
  },
);
