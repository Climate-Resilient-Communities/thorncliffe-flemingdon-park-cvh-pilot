// An ambassador's post, server side (S08.02, A-02): the request the page sends, turned into the alerting module's use cases, in order: make the draft (or find
// the one this post already made) with `postFromAmbassador`, then submit it exactly as E04 submits every entry (`AlertSubmitter.submit`, with the page's key),
// and answer with the submit's own body. Every refusal is a code; the page has the words. Server only.
import type { AmbassadorPostRequest } from "@/contracts/ambassadorPost";
import { SubmitResultSchema, type SubmitResult } from "@/contracts/alertSubmit";
import { UNTIL_RESOLVED_MS, draftFingerprint, type AlertLifecycle, type AlertSubmitter, type BuildingChoice } from "@/modules/alerting";
import type { StaffSession } from "../../session";
import { afterSubmit } from "../../alerts/afterWebChange";
import { normaliseText } from "../../alerts/composer/contentFromForm";
import { submitResultBody } from "../../alerts/submitBody";
import { parseTimeFields } from "../../alerts/timeField";

export interface PostDeps {
  alerting: () => Pick<AlertLifecycle, "postFromAmbassador">;
  submitter: () => Pick<AlertSubmitter, "submit" | "state">;
  now: () => Date;
  /** What follows a submit that committed (S08.03): the feed is expired when the post went on the web at once. Defaults to `afterSubmit`. */
  afterSubmit?: (report: Awaited<ReturnType<AlertSubmitter["submit"]>>) => void;
}

/** The floors the page chose, as the place picker's choice for the one building. */
export function placeOf(body: Pick<AmbassadorPostRequest, "rsn" | "floors">): BuildingChoice {
  const { rsn, floors } = body;
  if (floors.mode === "all") return { rsn, floors: null };
  if (floors.mode === "list") return { rsn, floors: { ids: [...floors.ids], ranges: [] } };
  return { rsn, floors: { ids: [], ranges: [{ from: floors.from, to: floors.to }] } };
}

/** The valid-until the page chose, from the server's clock for "until it is fixed"; or the code of a time that cannot be read. */
export function validUntilOf(valid: AmbassadorPostRequest["valid"], now: Date): { ok: true; validUntil: Date; mode: "at" | "resolved" } | { ok: false; code: "VALID_UNTIL_INVALID" | "VALID_UNTIL_SKIPPED" } {
  if (valid.mode === "resolved") return { ok: true, validUntil: new Date(now.getTime() + UNTIL_RESOLVED_MS), mode: "resolved" };
  const parsed = parseTimeFields({ date: valid.date, time: valid.time, fold: "" });
  if (parsed.ok) return { ok: true, validUntil: parsed.instant, mode: "at" };
  // A time the clocks skip, or repeat, on the night they change: the page asks for another time rather than which of the two is meant.
  return { ok: false, code: parsed.problem === "invalid" ? "VALID_UNTIL_INVALID" : "VALID_UNTIL_SKIPPED" };
}

const refused = (code: string): SubmitResult => SubmitResultSchema.parse({ v: 1, state: "refused", outcome: code, entry_state: null });

/**
 * Makes the post's draft and submits it. The same request again (the same ids and key: a lost answer, or a page that held the post until signal came back)
 * finds the draft or the pending entry it made and returns the first submit's result; a draft whose submit failed takes what is sent now and is submitted with
 * the new key the page made after that failure.
 */
export async function postAndSubmit(deps: PostDeps, session: Pick<StaffSession, "staffId" | "aal">, body: AmbassadorPostRequest): Promise<SubmitResult> {
  const now = deps.now();
  const valid = validUntilOf(body.valid, now);
  if (!valid.ok) return refused(valid.code);
  const actor = { staffId: session.staffId, aal: session.aal };
  const made = await deps.alerting().postFromAmbassador(actor, {
    into: body.into,
    alertId: body.alert_id,
    entryId: body.entry_id,
    place: placeOf(body),
    types: body.types,
    phase: body.phase,
    validUntil: valid.validUntil,
    validUntilMode: valid.mode,
    text: normaliseText(body.text),
  });
  if (!made.ok) return refused(made.error);
  const ref = { alertId: made.value.thread.id, entryId: made.value.entry.id };
  // The draft this request wrote is the draft that is submitted: someone else saving it in between is refused (DRAFT_CHANGED), nothing frozen.
  const draft = made.value.entry.status === "draft" ? draftFingerprint(made.value.entry.content) : undefined;
  const submitter = deps.submitter();
  const report = await submitter.submit(actor, ref, body.key, draft);
  (deps.afterSubmit ?? afterSubmit)(report);
  return submitResultBody(report, await submitter.state(ref), deps.now());
}
