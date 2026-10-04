// An ambassador's follow-up, server side (S08.04, A-03): the request the page sends, turned into the alerting module's use cases, in order: make the draft with
// `correctEntry`, `withdrawEntry` or `startFinal` (or find the one this request already made), then submit it exactly as E04 submits every entry
// (`AlertSubmitter.submit`, with the page's key), and answer with the submit's own body. Nothing here replaces an entry or closes a thread: that is the Hub's
// approval, by a second person. The use cases judge everything under the thread's lock: the role policy (an Ambassador corrects or withdraws only their own
// pending post, `alert.correct` and `alert.withdraw`; they write a final only for an alert about the building they are assigned to, `alert.author`), the target
// (E05's rules), the thread being open and the words. Every refusal is a code; the page has the words. Server only.
import { SubmitResultSchema, type SubmitResult } from "@/contracts/alertSubmit";
import type { AmbassadorFollowRequest } from "@/contracts/ambassadorFollow";
import { englishText } from "@/i18n/text";
import { audienceBuildings, draftFingerprint, isWithdrawalReason, withdrawalText, type AlertLifecycle, type AlertSubmitter, type EntryView, type WithdrawalReason } from "@/modules/alerting";
import type { StaffSession } from "../../session";
import { afterSubmit } from "../../alerts/afterWebChange";
import { normaliseText } from "../../alerts/composer/contentFromForm";
import { submitResultBody } from "../../alerts/submitBody";
import { validUntilOf } from "../post/postRequest";

export interface FollowDeps {
  alerting: () => Pick<AlertLifecycle, "correctEntry" | "withdrawEntry" | "startFinal">;
  submitter: () => Pick<AlertSubmitter, "submit" | "state">;
  now: () => Date;
  /** What follows a submit that committed (S08.03): the feed is expired when the entry went on the web at once. Defaults to `afterSubmit`. */
  afterSubmit?: (report: Awaited<ReturnType<AlertSubmitter["submit"]>>) => void;
}

/**
 * The buildings a follow-up is about, read from the database and never from the request (the route's policy facts, `alert.author`): those of the entry it corrects
 * or withdraws, or of what covers the thread it resolves. An audience that is not for buildings, or an entry or thread that is not there, names none, so an
 * Ambassador is refused out of scope.
 */
export async function followBuildings(alerting: Pick<AlertLifecycle, "getEntry" | "threadSummary">, body: AmbassadorFollowRequest): Promise<string[]> {
  if (body.action === "resolve") {
    const summary = await alerting.threadSummary(body.alert_id);
    return summary?.covering ? (audienceBuildings(summary.covering.audience) ?? []) : [];
  }
  const entry = await alerting.getEntry({ alertId: body.alert_id, entryId: body.target });
  return entry ? (audienceBuildings(entry.content.audience) ?? []) : [];
}

const refused = (code: string): SubmitResult => SubmitResultSchema.parse({ v: 1, state: "refused", outcome: code, entry_state: null });

/** The standard words of a withdrawal for a reason of the catalog (`staff.correct.reasonText.<reason>`), in English: the entry is translated like any other. */
const catalogWords = (reason: Exclude<WithdrawalReason, "other">) => englishText(`staff.correct.reasonText.${reason}`);

/** Makes the follow-up's draft by the use case the request names. */
async function makeDraft(deps: FollowDeps, session: Pick<StaffSession, "staffId" | "aal">, body: AmbassadorFollowRequest, now: Date) {
  const actor = { staffId: session.staffId, aal: session.aal };
  const lifecycle = deps.alerting();
  if (body.action === "correct") {
    const valid = validUntilOf(body.valid, now);
    if (!valid.ok) return { ok: false as const, error: valid.code };
    return lifecycle.correctEntry(actor, { alertId: body.alert_id, targetId: body.target }, { entryId: body.entry_id, text: normaliseText(body.text), phase: body.phase, validUntil: valid.validUntil, validUntilMode: valid.mode });
  }
  if (body.action === "withdraw") {
    const words = isWithdrawalReason(body.reason) ? withdrawalText(body.reason, normaliseText(body.text), catalogWords) : normaliseText(body.text);
    return lifecycle.withdrawEntry(actor, { alertId: body.alert_id, targetId: body.target }, { entryId: body.entry_id, reason: body.reason, text: words });
  }
  return lifecycle.startFinal(actor, { alertId: body.alert_id }, { entryId: body.entry_id, text: normaliseText(body.text) });
}

/**
 * Makes the follow-up's draft and submits it. The same request again (the same ids and key: a lost answer, or a page that held it until signal came back) finds
 * the draft or the pending entry it made and returns the first submit's result. Only an Ambassador follows up here (the Hub corrects, withdraws and resolves on
 * its own screens): anyone else is refused `NOT_ALLOWED`, changing nothing.
 */
export async function followAndSubmit(deps: FollowDeps, session: Pick<StaffSession, "staffId" | "aal" | "role">, body: AmbassadorFollowRequest): Promise<SubmitResult> {
  if (session.role !== "ambassador") return refused("NOT_ALLOWED");
  const made = await makeDraft(deps, session, body, deps.now());
  if (!made.ok) return refused(made.error);
  const entry: EntryView = made.value.entry;
  const ref = { alertId: made.value.thread.id, entryId: entry.id };
  // The draft this request wrote is the draft that is submitted: someone else saving it in between is refused (DRAFT_CHANGED), nothing frozen.
  const draft = entry.status === "draft" ? draftFingerprint(entry.content) : undefined;
  const submitter = deps.submitter();
  const report = await submitter.submit({ staffId: session.staffId, aal: session.aal }, ref, body.key, draft);
  (deps.afterSubmit ?? afterSubmit)(report);
  return submitResultBody(report, await submitter.state(ref), deps.now());
}
