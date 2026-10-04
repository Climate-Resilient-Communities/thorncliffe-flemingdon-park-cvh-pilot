import { AMBASSADOR_POST_ROUTE, AmbassadorPostRequestSchema } from "@/contracts/ambassadorPost";
import { alerting, alertSubmitter } from "@/app/staff/alerts";
import { postAndSubmit } from "@/app/staff/ambassador/post/postRequest";
import { readJson, staffError, staffJson, staffRoute } from "@/app/staff/guard";

export const dynamic = "force-dynamic";
/** The submit translates into every language and freezes the entry: the function lives 60 s, like the Hub's submit (test/submitBudget.test.ts). */
export const maxDuration = 60;

/**
 * `POST /api/staff/ambassador/posts` (S08.02, A-02): an ambassador's post, made and submitted in one request with the page's ids and idempotency key, so a
 * post sent again (a lost answer, or one the page held until signal came back) makes one entry and one pending version. The policy action is `alert.author`,
 * judged on the building the request names: an Ambassador only for a building they are assigned to now (`assigned_building`; a Director never). The use case
 * judges everything again under the thread's lock, and again at approval, against the person's current assignments, and posts only for an Ambassador (the Hub
 * writes on its own screens). The answer is the submit's body (src/contracts/alertSubmit.ts); never stored (no-store).
 */
export const POST = staffRoute(
  {
    route: AMBASSADOR_POST_ROUTE,
    access: "hub",
    action: "alert.author",
    context: async (request) => {
      const body = AmbassadorPostRequestSchema.parse(await request.json());
      return { targets: [body.rsn] };
    },
  },
  async (request, session, facts) => {
    const body = await readJson(request, AmbassadorPostRequestSchema);
    if (!body.ok) return body.response;
    // The building is the one the policy judged.
    const rsn = facts.targets?.[0];
    if (rsn === undefined) return staffError(400, "bad_request");
    return staffJson(await postAndSubmit({ alerting, submitter: alertSubmitter, now: () => new Date() }, session, { ...body.value, rsn }));
  },
);
