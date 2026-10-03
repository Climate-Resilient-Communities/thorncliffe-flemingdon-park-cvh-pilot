import { englishText } from "@/i18n/text";
import type { MessagingPause, PauseReasonProblem } from "@/modules/messaging";
import type { StaffSession } from "../session";
import { handedOffLine, resumedLine, waitingLine } from "./view";

/**
 * What a press answers. Every text is already resolved from the catalog. `done` lists lines to read (the first says what happened);
 * `refused` is one message in the Hub's error style: nothing was changed.
 */
export type TextsAnswer = { status: "done"; lines: string[] } | { status: "refused"; message: string };

/**
 * What the Pause texts forms show: nothing yet, or the last answer of either form with the time (`at`, milliseconds) it was given, so
 * the page, which keeps both forms' states, shows the later one and never a stale answer of the other button.
 */
export type TextsState = { status: "idle" } | (TextsAnswer & { at: number });

export interface ControlDeps {
  pause: () => MessagingPause;
  /** The name of the staff member who paused (a pause somebody else set is named in "already paused"). */
  nameOf: (staffId: string) => Promise<string | null>;
  /** Starts a dispatcher run once a resume has committed (`kickDispatcher`): never inside the transaction, never throws. */
  startSending: () => Promise<void>;
  /** Operational error log (structured, no personal data): the error's name only. */
  logError: (event: string, fields: Record<string, string>) => void;
}

const t = (key: string, values?: Record<string, string | number>) => englishText(`staff.texts.${key}`, values);

const REASON_PROBLEMS: Record<PauseReasonProblem, string> = { missing: "errors.reasonMissing", too_long: "errors.reasonTooLong" };

const nameOfError = (error: unknown) => (error instanceof Error ? error.name : "NonError");

/**
 * "Pause all texts" for the Admin at aal2 the guard let through (the guard, ../guard.ts, has already refused everyone else): the reason
 * comes from the form, the actor from the session. A failure leaves texts as they were, and says so in as many words: an Admin who
 * pressed the button to stop a mistake must never believe it worked when it did not.
 */
export async function pauseFromForm(deps: ControlDeps, session: Pick<StaffSession, "staffId">, form: FormData): Promise<TextsAnswer> {
  try {
    const outcome = await deps.pause().pause({ actorStaffId: session.staffId, reason: form.get("reason") });
    switch (outcome.kind) {
      case "paused": {
        const handedOff = handedOffLine(outcome.handedOff);
        return { status: "done", lines: [t("done.paused"), waitingLine(outcome.waiting), ...(handedOff ? [handedOff] : [])] };
      }
      case "already_paused": {
        const name = await deps.nameOf(outcome.status.pausedBy).catch(() => null);
        return { status: "done", lines: [t("done.alreadyPaused", { name: name ?? t("paused.someone") })] };
      }
      case "refused":
        return { status: "refused", message: t(REASON_PROBLEMS[outcome.problem]) };
    }
  } catch (error) {
    deps.logError("messaging.pause_failed", { error: nameOfError(error) });
    return { status: "refused", message: t("errors.pauseFailed") };
  }
}

/**
 * "Resume texts" for the same Admin. Once the resume has committed a run of the dispatcher is started, so the texts that waited do not
 * wait for the next minute; if it cannot be started the resume still stands (pg_cron's next run sends them) and the failure is logged.
 */
export async function resumeFromForm(deps: ControlDeps, session: Pick<StaffSession, "staffId">): Promise<TextsAnswer> {
  try {
    const outcome = await deps.pause().resume({ actorStaffId: session.staffId });
    if (outcome.kind === "not_paused") return { status: "done", lines: [t("done.notPaused")] };
    await deps.startSending().catch((error: unknown) => deps.logError("messaging.resume_kick_failed", { error: nameOfError(error) }));
    return { status: "done", lines: [resumedLine(outcome.waiting)] };
  } catch (error) {
    deps.logError("messaging.resume_failed", { error: nameOfError(error) });
    return { status: "refused", message: t("errors.resumeFailed") };
  }
}
