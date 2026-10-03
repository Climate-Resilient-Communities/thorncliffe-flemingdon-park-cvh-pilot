// Starting the final message of "Mark resolved" (O-16, S05.03): what the start form sends, as the use case takes it, and what the person is told. The use case
// (`alerting.startFinal`) judges everything that matters (the thread is open and has something residents can read, the author may write for its audience, the
// words); this reads the form. The draft it makes goes through the composer, submit and a second person's approval like any entry, and approving it closes the alert.
import type { AlertLifecycle } from "@/modules/alerting";
import type { StaffSession } from "../../session";
import { composeRefusalMessage, composerLocation, type ComposeState } from "./editDraft";
import { normaliseText } from "./contentFromForm";

export interface StartFinalDeps {
  alerting: () => Pick<AlertLifecycle, "startFinal">;
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

/**
 * "Save draft" on a new final: the words of the final entry, for the thread named by `alert`, with the id the page made for the new entry in `entry`. A saved
 * final goes on to the composer of the new draft; a refusal stays on the form with its reason.
 */
export async function startFinalFromForm(deps: StartFinalDeps, session: Pick<StaffSession, "staffId" | "aal">, form: FormData): Promise<ComposeState> {
  const alertId = text(form, "alert");
  const entryId = text(form, "entry");
  const result = await deps.alerting().startFinal({ staffId: session.staffId, aal: session.aal }, { alertId }, { entryId, text: normaliseText(text(form, "text")) });
  if (!result.ok) return { status: "refused", message: composeRefusalMessage(result.error) };
  return { status: "started", location: composerLocation("final", { alertId, entryId: result.value.entry.id }, { saved: "1" }, "resolve") };
}
