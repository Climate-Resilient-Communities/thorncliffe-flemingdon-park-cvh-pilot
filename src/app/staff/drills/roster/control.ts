import { englishText } from "@/i18n/text";
import type { DrillRoster, DrillRosterRefusal } from "@/modules/subscriptions";
import type { StaffSession } from "../../session";
import { addedLine, editedLine, removedLine, skippedLine } from "./view";

/**
 * What a press answers. Every text is already resolved from the catalog and none holds a number: a refusal is a code turned into words, and the lines after a
 * change name the label the Admin gave and the size of the roster. `refused` is one message in the Hub's error style: nothing was changed.
 */
export type RosterAnswer = { status: "done"; lines: string[] } | { status: "refused"; message: string };

/** What the forms show: nothing yet, or the last answer of any form with the time it was given, so the later one is shown. */
export type RosterState = { status: "idle" } | (RosterAnswer & { at: number });

export interface ControlDeps {
  roster: () => DrillRoster;
  /** Operational error log (structured, no personal data): the error's name only. */
  logError: (event: string, fields: Record<string, string>) => void;
}

const t = (key: string) => englishText(`staff.drillRoster.${key}`);
const nameOfError = (error: unknown) => (error instanceof Error ? error.name : "NonError");
const refusalMessage = (problem: DrillRosterRefusal) => t(`errors.${problem}`);

/**
 * "Add phone" for the Admin at aal2 the guard let through: the label, the number and the language come from the form, the actor from the session. The number is
 * read once, here, and handed to the use case; it is not echoed back, not logged and not in any error. A failure changes nothing and says so.
 */
export async function addFromForm(deps: ControlDeps, session: Pick<StaffSession, "staffId">, form: FormData): Promise<RosterAnswer> {
  try {
    const outcome = await deps.roster().add({ actorStaffId: session.staffId, label: form.get("label"), number: form.get("number"), lang: form.get("lang") });
    if (outcome.kind === "refused") return { status: "refused", message: refusalMessage(outcome.problem) };
    return { status: "done", lines: [addedLine(outcome.label, outcome.size)] };
  } catch (error) {
    deps.logError("drill_roster.add_failed", { error: nameOfError(error) });
    return { status: "refused", message: t("errors.failed") };
  }
}

/** "Save changes" for one member (their id is in the form): the label and language change, and the number when one is given; the change is audited, together. */
export async function editFromForm(deps: ControlDeps, session: Pick<StaffSession, "staffId">, form: FormData): Promise<RosterAnswer> {
  try {
    const outcome = await deps.roster().edit({ actorStaffId: session.staffId, id: form.get("id"), label: form.get("label"), number: form.get("number"), lang: form.get("lang") });
    if (outcome.kind === "refused") return { status: "refused", message: refusalMessage(outcome.problem) };
    return { status: "done", lines: [editedLine(outcome.label)] };
  } catch (error) {
    deps.logError("drill_roster.edit_failed", { error: nameOfError(error) });
    return { status: "refused", message: t("errors.failed") };
  }
}

/** "Remove" for one member (their id is in the form): their waiting texts are cancelled, the row is deleted and the change audited, together. */
export async function removeFromForm(deps: ControlDeps, session: Pick<StaffSession, "staffId">, form: FormData): Promise<RosterAnswer> {
  try {
    const outcome = await deps.roster().remove({ actorStaffId: session.staffId, id: form.get("id") });
    if (outcome.kind === "refused") return { status: "refused", message: refusalMessage(outcome.problem) };
    const skipped = skippedLine(outcome.skippedTexts);
    return { status: "done", lines: [removedLine(outcome.label, outcome.size), ...(skipped ? [skipped] : [])] };
  } catch (error) {
    deps.logError("drill_roster.remove_failed", { error: nameOfError(error) });
    return { status: "refused", message: t("errors.failed") };
  }
}
