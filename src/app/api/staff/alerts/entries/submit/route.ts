import { SubmitRequestSchema } from "@/contracts/alertSubmit";
import { alertSubmitter } from "@/app/staff/alerts";
import { readJson, staffJson, staffRoute } from "@/app/staff/guard";
import { afterSubmit } from "@/app/staff/alerts/afterWebChange";
import { submitResultBody } from "@/app/staff/alerts/submitBody";

export const dynamic = "force-dynamic";
/**
 * One press of Submit translates into every language (at most the longest route deadline, 30 s, plus 5 s), renders and freezes the
 * entry: the function lives 60 s (test/submitBudget.test.ts keeps the budget, and the age after which a running attempt is taken
 * to be abandoned, in order with this).
 */
export const maxDuration = 60;

/**
 * `POST /api/staff/alerts/entries/submit` (S04.05): submits a draft with the browser's idempotency key for this press. The same key
 * returns the first attempt's result and never makes a second pending version. Not tied to the request's connection: when the
 * browser's connection drops the work goes on, and the browser fetches the entry's state (`GET .../state`). The policy action is
 * `alert.author_wide` like the audience pickers' (an Ambassador's own screens are E08's); the use case then judges the rest under the
 * thread's lock: that the person is an editor of the draft, may author what it holds, and that the draft can be submitted at all.
 */
export const POST = staffRoute({ route: "/api/staff/alerts/entries/submit", access: "hub", action: "alert.author_wide" }, async (request, session) => {
  const body = await readJson(request, SubmitRequestSchema);
  if (!body.ok) return body.response;
  const ref = { alertId: body.value.alert_id, entryId: body.value.entry_id };
  const submitter = alertSubmitter();
  const report = await submitter.submit({ staffId: session.staffId, aal: session.aal }, ref, body.value.key, body.value.draft);
  // A D-1 post is on the web from this commit (S08.03): the feed is read again at once.
  afterSubmit(report);
  return staffJson(submitResultBody(report, await submitter.state(ref), new Date()));
});
