// Starting a correction or a withdrawal (O-15, S05.02): what the start forms send, as the use cases take them, and what the person is told. The use cases
// (`alerting.correctEntry`, `alerting.withdrawEntry`) judge everything that matters: the thread is open, the role (a Coordinator or an Admin; an Ambassador's own
// pending entries are E08's), the entry named is a valid target, the reason is one of the catalog's, the phase, the text and the valid-until. This reads the form.
// The draft it makes goes through the composer, submit and approval exactly like any entry.
import { isWithdrawalReason, withdrawalText, type AlertLifecycle, type Phase, type WithdrawalReason } from "@/modules/alerting";
import { englishText } from "@/i18n/text";
import type { StaffSession } from "../../session";
import { composeRefusalMessage, composerFromForm, composerLocation, type ComposeState } from "./editDraft";
import { normaliseText, phaseFromForm, validUntilFromForm } from "./contentFromForm";

export interface StartReplaceDeps {
  alerting: () => Pick<AlertLifecycle, "correctEntry" | "withdrawEntry">;
  now: () => Date;
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

/** The standard words of a withdrawal for a reason of the catalog (`staff.correct.reasonText.<reason>`), in English: the entry is translated like any other. */
const catalogWords = (reason: Exclude<WithdrawalReason, "other">) => englishText(`staff.correct.reasonText.${reason}`);

/**
 * "Save draft" on a new correction: the corrected words, where things stand (required, as for an update: the form carries it only when the person chose, and
 * the use case refuses anything else) and the valid-until, for the entry named by `target` of the thread named by `alert`, with the id the page made for the
 * new entry in `entry`. A saved correction goes on to the composer of the new draft; a refusal stays on the form with its reason.
 */
export async function startCorrectionFromForm(deps: StartReplaceDeps, session: Pick<StaffSession, "staffId" | "aal">, form: FormData): Promise<ComposeState> {
  const valid = validUntilFromForm(form, deps.now());
  if (!valid.ok) return valid.problem.kind === "ask" ? { status: "ask", ...valid.problem } : { status: "refused", message: valid.problem.message };
  const alertId = text(form, "alert");
  const entryId = text(form, "entry");
  const result = await deps.alerting().correctEntry(
    { staffId: session.staffId, aal: session.aal },
    { alertId, targetId: text(form, "target") },
    {
      entryId,
      text: normaliseText(text(form, "text")),
      phase: phaseFromForm(form) ?? ("" as Phase),
      validUntil: valid.validUntil,
      validUntilMode: valid.mode,
    },
  );
  if (!result.ok) return { status: "refused", message: composeRefusalMessage(result.error) };
  return { status: "started", location: composerLocation("correction", { alertId, entryId: result.value.entry.id }, { saved: "1" }, composerFromForm(form) ?? "correct") };
}

/**
 * "Save draft" on a new withdrawal: the reason chosen from the catalog (none, or one that is not in it, is refused by the use case) and the words for
 * residents: the catalog's own words for the reason, with the Hub's added after them, or for "other" the Hub's words alone.
 */
export async function startWithdrawalFromForm(deps: StartReplaceDeps, session: Pick<StaffSession, "staffId" | "aal">, form: FormData): Promise<ComposeState> {
  const alertId = text(form, "alert");
  const entryId = text(form, "entry");
  const reason = text(form, "reason");
  const words = isWithdrawalReason(reason) ? withdrawalText(reason, normaliseText(text(form, "text")), catalogWords) : normaliseText(text(form, "text"));
  const result = await deps.alerting().withdrawEntry({ staffId: session.staffId, aal: session.aal }, { alertId, targetId: text(form, "target") }, { entryId, reason, text: words });
  if (!result.ok) return { status: "refused", message: composeRefusalMessage(result.error) };
  return { status: "started", location: composerLocation("withdrawal", { alertId, entryId: result.value.entry.id }, { saved: "1" }, composerFromForm(form) ?? "withdraw") };
}

