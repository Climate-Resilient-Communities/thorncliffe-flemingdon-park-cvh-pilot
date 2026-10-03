// Starting an update to a running alert (S05.01, "Add an update" O-14 and "Promote to full alert" O-13): what the start form sends, as the use case takes it,
// and what the person is told. The use case (`alerting.addUpdate`) judges everything that matters (the thread is open and has something residents can read,
// the author may write for its audience, the phase is one of the two, the valid-until, the text); this reads the form. The draft it makes goes through the
// composer, submit and approval exactly like any entry.
import type { Phase } from "@/modules/alerting";
import type { AlertLifecycle } from "@/modules/alerting";
import type { StaffSession } from "../../session";
import { composeRefusalMessage, composerFromForm, composerLocation, type ComposeState } from "./editDraft";
import { normaliseText, phaseFromForm, validUntilFromForm } from "./contentFromForm";

export interface StartDeps {
  alerting: () => Pick<AlertLifecycle, "addUpdate">;
  now: () => Date;
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

/**
 * "Save draft" on a new update: the text, where things stand (required: the form carries it only when the person chose, and the use case refuses
 * anything else), and the valid-until, for the thread named by `alert`, with the id the page made for the new entry in `entry`. A saved update goes on to the
 * composer of the new draft; a refusal stays on the form with its reason.
 */
export async function startUpdateFromForm(deps: StartDeps, session: Pick<StaffSession, "staffId" | "aal">, form: FormData): Promise<ComposeState> {
  const valid = validUntilFromForm(form, deps.now());
  if (!valid.ok) return valid.problem.kind === "ask" ? { status: "ask", ...valid.problem } : { status: "refused", message: valid.problem.message };
  const alertId = text(form, "alert");
  const entryId = text(form, "entry");
  const from = composerFromForm(form);
  const result = await deps.alerting().addUpdate(
    { staffId: session.staffId, aal: session.aal },
    { alertId },
    {
      entryId,
      text: normaliseText(text(form, "text")),
      // No phase chosen is not a default: it goes on as nothing and is refused as PHASE_INVALID, "Choose where things stand."
      phase: phaseFromForm(form) ?? ("" as Phase),
      validUntil: valid.validUntil,
      validUntilMode: valid.mode,
    },
  );
  if (!result.ok) return { status: "refused", message: composeRefusalMessage(result.error) };
  return { status: "started", location: composerLocation("update", { alertId, entryId: result.value.entry.id }, { saved: "1" }, from === "promote" ? "promote" : "update") };
}
