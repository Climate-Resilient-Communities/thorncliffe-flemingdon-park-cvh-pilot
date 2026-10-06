import { englishText } from "@/i18n/text";
import type { OncallRefusal, OncallRoster } from "@/modules/ops";
import type { StaffSession } from "../session";
import { addedLine, onDutyDoneLine, removedLine, skippedLine } from "./view";

/**
 * What a press answers. Every text is already resolved from the catalog and none holds a number: a refusal is a code turned into words, and
 * the lines after a change name the label the Admin gave and the size of the list. `refused` is one message in the Hub's error style: nothing
 * was changed.
 */
export type OncallAnswer = { status: "done"; lines: string[] } | { status: "refused"; message: string };

/** What the forms show: nothing yet, or the last answer of either form with the time it was given, so the later one is shown. */
export type OncallState = { status: "idle" } | (OncallAnswer & { at: number });

export interface ControlDeps {
  roster: () => OncallRoster;
  /** Operational error log (structured, no personal data): the error's name only. */
  logError: (event: string, fields: Record<string, string>) => void;
}

const t = (key: string) => englishText(`staff.oncall.${key}`);
const nameOfError = (error: unknown) => (error instanceof Error ? error.name : "NonError");

const refusalMessage = (problem: OncallRefusal) => t(`errors.${problem}`);

/**
 * "Add number" for the Admin at aal2 the guard let through: the label and number come from the form, the actor from the session. The number is
 * read once, here, and handed to the use case; it is not echoed back, not logged and not in any error. A failure changes nothing and says so.
 */
export async function addFromForm(deps: ControlDeps, session: Pick<StaffSession, "staffId">, form: FormData): Promise<OncallAnswer> {
  try {
    const outcome = await deps.roster().add({ actorStaffId: session.staffId, label: form.get("label"), number: form.get("number") });
    if (outcome.kind === "refused") return { status: "refused", message: refusalMessage(outcome.problem) };
    return { status: "done", lines: [addedLine(outcome.label, outcome.size)] };
  } catch (error) {
    deps.logError("oncall.add_failed", { error: nameOfError(error) });
    return { status: "refused", message: t("errors.failed") };
  }
}

/** "Remove" for one entry (its id is in the form): the entry's waiting texts are cancelled, the row is deleted and the change audited, together. */
export async function removeFromForm(deps: ControlDeps, session: Pick<StaffSession, "staffId">, form: FormData): Promise<OncallAnswer> {
  try {
    const outcome = await deps.roster().remove({ actorStaffId: session.staffId, id: form.get("id") });
    if (outcome.kind === "refused") return { status: "refused", message: refusalMessage(outcome.problem) };
    const skipped = skippedLine(outcome.skippedTexts);
    return { status: "done", lines: [removedLine(outcome.label, outcome.size), ...(skipped ? [skipped] : [])] };
  } catch (error) {
    deps.logError("oncall.remove_failed", { error: nameOfError(error) });
    return { status: "refused", message: t("errors.failed") };
  }
}

/**
 * "Set on duty" (S08.08): the roster entry and the Admin account come from the form, the actor from the session. The use case checks, under the roster's
 * lock, that the account is an active Admin with an authenticator, and audits the change without the number.
 */
export async function setOnDutyFromForm(deps: ControlDeps, session: Pick<StaffSession, "staffId">, form: FormData): Promise<OncallAnswer> {
  try {
    const outcome = await deps.roster().setOnDuty({ actorStaffId: session.staffId, id: form.get("id"), staffId: form.get("staff_id") });
    if (outcome.kind === "refused") return { status: "refused", message: refusalMessage(outcome.problem) };
    return { status: "done", lines: [onDutyDoneLine("set", outcome.label)] };
  } catch (error) {
    deps.logError("oncall.on_duty_failed", { error: nameOfError(error) });
    return { status: "refused", message: t("errors.failed") };
  }
}

/** "Nobody on duty" (S08.08): the on-duty entry goes back to being an on-call number; escalations then go to every number. */
export async function clearOnDutyFromForm(deps: ControlDeps, session: Pick<StaffSession, "staffId">): Promise<OncallAnswer> {
  try {
    const outcome = await deps.roster().clearOnDuty({ actorStaffId: session.staffId });
    if (outcome.kind === "refused") return { status: "refused", message: refusalMessage(outcome.problem) };
    return { status: "done", lines: [onDutyDoneLine("cleared", outcome.label)] };
  } catch (error) {
    deps.logError("oncall.on_duty_failed", { error: nameOfError(error) });
    return { status: "refused", message: t("errors.failed") };
  }
}
