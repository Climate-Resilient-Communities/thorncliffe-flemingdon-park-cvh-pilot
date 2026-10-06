import { englishText } from "@/i18n/text";
import type { EscalationHandling } from "@/modules/checkins";
import type { StaffSession } from "../../session";

/**
 * What "Mark handled" answers (S08.08). Every text is resolved from the catalog: a refusal is a code turned into words, and the line after a handling says
 * whether the resident's number is still kept. Neither holds the note or a number.
 */
export type HandleAnswer = { status: "done"; line: string } | { status: "refused"; message: string };

/** What the form shows: nothing yet, or the last answer. */
export type HandleState = { status: "idle" } | (HandleAnswer & { at: number });

export interface HandleDeps {
  handling: () => EscalationHandling;
  /** Operational error log (structured, no personal data): the error's name only. */
  logError: (event: string, fields: Record<string, string>) => void;
}

const t = (key: string) => englishText(`staff.rounds.escalation.${key}`);

/**
 * "Mark handled" for the Admin at aal2 the guard let through: the escalation's id and the note come from the form, the actor from the session. The note is
 * handed to the use case and is never logged or echoed in an error. A failure changes nothing and says so.
 */
export async function handleFromForm(deps: HandleDeps, session: Pick<StaffSession, "staffId">, form: FormData): Promise<HandleAnswer> {
  try {
    const outcome = await deps.handling().handle({ actorStaffId: session.staffId, escalationId: form.get("id"), note: form.get("note") });
    if (outcome.kind === "refused") return { status: "refused", message: t(`errors.${outcome.problem}`) };
    return { status: "done", line: outcome.rowClosed ? t("doneClosed") : t("done") };
  } catch (error) {
    deps.logError("escalation.handle_failed", { error: error instanceof Error ? error.name : "NonError" });
    return { status: "refused", message: t("errors.failed") };
  }
}
