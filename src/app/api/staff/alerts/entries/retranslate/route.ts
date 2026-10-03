import { RetranslateRequestSchema } from "@/contracts/alertSubmit";
import { alertSubmitter } from "@/app/staff/alerts";
import { readJson, staffJson, staffRoute } from "@/app/staff/guard";
import { submitResultBody } from "@/app/staff/alerts/submitBody";

export const dynamic = "force-dynamic";
/** The same function limit as a submit: "Try translation again" is a submit of the entry returned to draft. */
export const maxDuration = 60;

/**
 * `POST /api/staff/alerts/entries/retranslate` (S04.05, S04.03): "Try translation again" on a pending entry. In one short transaction
 * the entry returns to draft and the person becomes an editor (so they can no longer approve it); then it is translated again, what
 * already passed coming from the cache, and re-submitted as the next version with a new hash. The same idempotency key rules as a submit.
 */
export const POST = staffRoute({ route: "/api/staff/alerts/entries/retranslate", access: "hub", action: "alert.author_wide" }, async (request, session) => {
  const body = await readJson(request, RetranslateRequestSchema);
  if (!body.ok) return body.response;
  const ref = { alertId: body.value.alert_id, entryId: body.value.entry_id };
  const submitter = alertSubmitter();
  const report = await submitter.retranslate({ staffId: session.staffId, aal: session.aal }, ref, body.value.key, { version: body.value.seen_version, contentHash: body.value.seen_hash });
  return staffJson(submitResultBody(report, await submitter.state(ref), new Date()));
});
