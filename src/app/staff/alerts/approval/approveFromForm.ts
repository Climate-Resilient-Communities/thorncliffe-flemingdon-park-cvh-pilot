// Approving, returning and discarding from the approval view (O-05, O-07; S04.07): what the forms send, as the use cases take it, and what the
// person is told. The use cases judge everything that matters (the role and aal2, that the person never edited the entry, that the author may still
// author it, that the version and hash are the ones shown, that the valid-until is ahead, and that the people the text reaches are the people the
// approver reviewed): this reads the form, runs the use case, does what must follow a commit, and turns refusals into words.
import { decodeCounts, RETURN_NOTE_MAX, type RecipientCounts } from "@/contracts/alertApproval";
import { englishText } from "@/i18n/text";
import type { AlertLifecycle, AlertRefusal, ApprovalOutcome, EntryView } from "@/modules/alerting";
import type { StaffSession } from "../../session";
import { draftRefOf } from "../audience/editAudience";
import { approveHref } from "../pages";
import { countChangedView, type CountChangedView } from "./view";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** What an approval form shows after a submission. A success goes back to the page (`location`), which shows what became of the entry. */
export type ApprovalState =
  | { status: "idle" }
  | { status: "refused"; message: string }
  /** The recipient snapshot counted other people than the approver reviewed: nothing was approved; they confirm the new number first. */
  | { status: "count_changed"; view: CountChangedView }
  | { status: "done"; location: string };

export interface ApprovalDeps {
  alerting: () => Pick<AlertLifecycle, "approveEntry" | "returnEntry" | "discardEntry" | "review" | "refuseInvalidForm">;
  /** What must follow an approval that committed: the feed's tag is revalidated and the dispatcher kicked (S06.02). Never called for a refusal or a rollback. */
  afterApproval: (outcome: ApprovalOutcome) => Promise<void>;
  /** What must follow the discard of an entry residents already read (S08.03): a system withdrawal took its place, so the feed's tag is revalidated. Never called for a refusal or a rollback. */
  afterDiscard?: (entry: EntryView) => void;
  /** Cents CAD per segment (SMS_PRICE_PER_SEGMENT_CENTS). */
  pricePerSegmentCents: () => number;
}

const t = (key: string, values?: Record<string, string | number>) => englishText(`staff.approve.${key}`, values);

/** The message for a refusal of a use case: the view's own wording where it has one, "That could not be done" otherwise. */
export function approvalRefusalMessage(error: AlertRefusal | string): string {
  try {
    return t(`errors.${error}`, { max: RETURN_NOTE_MAX });
  } catch {
    return t("errors.invalid");
  }
}

const refused = (error: AlertRefusal | string): ApprovalState => ({ status: "refused", message: approvalRefusalMessage(error) });

const text = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

/** A form that does not carry what was shown: no use case runs, the refusal is recorded with its reason (INVALID_FORM), and the person is told to reload. */
async function invalidForm(deps: ApprovalDeps, session: Pick<StaffSession, "staffId" | "aal">, form: "approve" | "return" | "discard", ref: { alertId: string; entryId: string }): Promise<ApprovalState> {
  await deps.alerting().refuseInvalidForm({ staffId: session.staffId, aal: session.aal }, form, ref);
  return { status: "refused", message: t("errors.invalid") };
}

/** The version and hash the form carries (what the approver was shown): null for anything that is not one. */
function shownOf(form: FormData): { version: number; contentHash: string } | null {
  const version = text(form, "version");
  const hash = text(form, "hash");
  if (!/^[0-9]{1,9}$/.test(version) || !/^[0-9a-f]{64}$/.test(hash)) return null;
  return { version: Number(version), contentHash: hash };
}

/**
 * Approve. The form names the entry, the version and hash the approver was shown and the number of people they reviewed (a hidden field the
 * view wrote). If the snapshot taken inside the transaction counts anyone else, nothing is approved and the answer is the new number per language
 * and its cost, for the approver to confirm; pressing Approve again then names that number.
 */
export async function approveFromForm(deps: ApprovalDeps, session: Pick<StaffSession, "staffId" | "aal">, form: FormData): Promise<ApprovalState> {
  const ref = draftRefOf(form);
  const shown = shownOf(form);
  const reviewed = decodeCounts(text(form, "reviewed"));
  if (!shown || !reviewed) return invalidForm(deps, session, "approve", ref);
  // The entry the "Now also for" line was read against (S05.01): absent for an entry that was shown none, otherwise an id and nothing else.
  const covering = form.get("covering");
  if (covering !== null && (typeof covering !== "string" || !UUID.test(covering))) return invalidForm(deps, session, "approve", ref);
  const result = await deps.alerting().approveEntry({ staffId: session.staffId, aal: session.aal }, ref, { ...shown, recipients: reviewed, ...(covering === null ? {} : { covering }) });
  if (result.ok) {
    // After the commit, and never able to turn an approval that is done into a failure: the effects are the feed's tag and the dispatcher (S06.02's kick).
    await deps.afterApproval(result.value);
    return { status: "done", location: approveHref(ref) };
  }
  if (result.error === "RECIPIENT_COUNT_CHANGED" && result.detail) return countChanged(deps, ref, result.detail.recipients, reviewed);
  return refused(result.error);
}

async function countChanged(deps: ApprovalDeps, ref: { alertId: string; entryId: string }, snapshot: RecipientCounts, reviewed: RecipientCounts): Promise<ApprovalState> {
  const review = await deps.alerting().review(ref);
  if (!review) return refused("ENTRY_NOT_FOUND");
  return { status: "count_changed", view: countChangedView({ review, snapshot, reviewed, pricePerSegmentCents: deps.pricePerSegmentCents() }) };
}

/** "Return to author" with a note: the entry goes back to a draft with its text, the note is the author's to read, and the return is audited. */
export async function returnFromForm(deps: ApprovalDeps, session: Pick<StaffSession, "staffId" | "aal">, form: FormData): Promise<ApprovalState> {
  const ref = draftRefOf(form);
  const shown = shownOf(form);
  if (!shown) return invalidForm(deps, session, "return", ref);
  const result = await deps.alerting().returnEntry({ staffId: session.staffId, aal: session.aal }, ref, "return", { shown, note: text(form, "note") });
  return result.ok ? { status: "done", location: approveHref(ref) } : refused(result.error);
}

/** "Discard": the entry is never published, and the discard is audited. */
export async function discardFromForm(deps: ApprovalDeps, session: Pick<StaffSession, "staffId" | "aal">, form: FormData): Promise<ApprovalState> {
  const ref = draftRefOf(form);
  const shown = shownOf(form);
  if (!shown) return invalidForm(deps, session, "discard", ref);
  const result = await deps.alerting().discardEntry({ staffId: session.staffId, aal: session.aal }, ref, { shown });
  // An entry residents already read (a D-1 post) was superseded by a system withdrawal, not discarded: the web changed, so the feed is read again at once.
  if (result.ok && result.value.status === "superseded") deps.afterDiscard?.(result.value);
  return result.ok ? { status: "done", location: approveHref(ref) } : refused(result.error);
}
