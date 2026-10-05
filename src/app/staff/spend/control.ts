import { englishText } from "@/i18n/text";
import type { SpendCapService } from "@/modules/spend";
import type { StaffSession } from "../session";
import { capDoneLine } from "./view";

/** What a press answers, already in words: `done` lists lines to read; `refused` is one message in the Hub's error style (nothing was changed). */
export type CapAnswer = { status: "done"; lines: string[] } | { status: "refused"; message: string };

/** What the cap form shows: nothing yet, or the last answer with the time it was given. */
export type CapState = { status: "idle" } | (CapAnswer & { at: number });

export interface ControlDeps {
  cap: () => SpendCapService;
  /** Operational error log (structured, no personal data): the error's name only. */
  logError: (event: string, fields: Record<string, string>) => void;
}

const t = (key: string) => englishText(`staff.spend.${key}`);
const nameOfError = (error: unknown) => (error instanceof Error ? error.name : "NonError");

/**
 * "Save cap" for the Admin at aal2 the guard let through (the guard, ../guard.ts, has already refused everyone else): the amount comes from the form, the
 * actor from the session. A failure changes nothing and says so in as many words.
 */
export async function setCapFromForm(deps: ControlDeps, session: Pick<StaffSession, "staffId">, form: FormData): Promise<CapAnswer> {
  try {
    const outcome = await deps.cap().set({ actorStaffId: session.staffId, amount: form.get("cap") });
    if (outcome.kind === "refused") return { status: "refused", message: t(`errors.${outcome.problem}`) };
    return { status: "done", lines: [capDoneLine(outcome.capCents, outcome.previousCents)] };
  } catch (error) {
    deps.logError("spend.cap_set_failed", { error: nameOfError(error) });
    return { status: "refused", message: t("errors.failed") };
  }
}
