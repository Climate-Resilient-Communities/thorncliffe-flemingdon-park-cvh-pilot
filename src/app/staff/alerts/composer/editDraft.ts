// Saving the composer's draft and pulling a submitted entry back to a draft (O-12, O-02, S04.05): what the forms send, as the use cases
// take it, and what the person is told. The use cases judge everything that matters (who may change the entry, the text limit, the
// valid-until in the future and at most 7 days ahead, the audience): this reads the form and turns refusals into words.
import { ALERT_TEXT_MAX, type AlertLifecycle, type AlertRefusal } from "@/modules/alerting";
import { englishText } from "@/i18n/text";
import type { StaffSession } from "../../session";
import { draftRefOf, type DraftRef } from "../audience/editAudience";
import { ACK_PAGE, COMPOSE_PAGE } from "../pages";
import { contentFromForm } from "./contentFromForm";

/** What a composer form shows after a submission. A draft saved from the Save button reloads the page (`location`); one saved by a submit does not. */
export type ComposeState =
  | { status: "idle" }
  | { status: "refused"; message: string }
  /** The valid-until is in the repeated hour of the clock change: the person says before or after. */
  | { status: "ask"; question: string; before: string; after: string }
  | { status: "saved"; location: string }
  | { status: "pulled_back"; location: string };

export interface EditDeps {
  alerting: () => Pick<AlertLifecycle, "getEntry" | "saveDraft" | "returnEntry">;
  now: () => Date;
}

const t = (key: string, values?: Record<string, string | number>) => englishText(`staff.compose.${key}`, values);

/** The message for a refusal of a use case: the composer's own wording where it has one, "That could not be done" otherwise. */
export function composeRefusalMessage(error: AlertRefusal | string): string {
  const key = `errors.${error}`;
  try {
    return t(key, { max: ALERT_TEXT_MAX });
  } catch {
    return t("errors.invalid");
  }
}

const refused = (error: AlertRefusal | string): ComposeState => ({ status: "refused", message: composeRefusalMessage(error) });

/** The page an entry is composed on: the acknowledgement composer for an `ack`, the alert composer for an `update`. */
export const composerLocation = (kind: string, ref: DraftRef, extra: Record<string, string> = {}): string =>
  `${kind === "ack" ? ACK_PAGE : COMPOSE_PAGE}?${new URLSearchParams({ alert: ref.alertId, entry: ref.entryId, ...extra }).toString()}`;

/**
 * Saves the draft the form describes. A form from the Save button goes back to the composer (so the preview is made again from what was
 * saved); one sent as the first half of a submit (`then=submit`) stays where it is, and the submit follows. The person who saves a
 * change becomes an editor (the entry's trigger), so they can no longer approve it.
 */
export async function saveDraftFromForm(deps: EditDeps, session: Pick<StaffSession, "staffId" | "aal">, form: FormData): Promise<ComposeState> {
  const ref = draftRefOf(form);
  const entry = await deps.alerting().getEntry(ref);
  if (!entry) return refused("ENTRY_NOT_FOUND");
  const read = contentFromForm(form, entry.content, deps.now());
  if (!read.ok) return read.problem.kind === "ask" ? { status: "ask", ...read.problem } : { status: "refused", message: read.problem.message };
  const result = await deps.alerting().saveDraft({ staffId: session.staffId, aal: session.aal }, ref, read.content);
  if (!result.ok) return refused(result.error);
  return { status: "saved", location: composerLocation(entry.kind, ref, form.get("then") === "submit" ? {} : { saved: "1" }) };
}

/** "Pull back to edit": returns a submitted entry to a draft, so the person can change it. It needs a new submit. */
export async function pullBackFromForm(deps: EditDeps, session: Pick<StaffSession, "staffId" | "aal">, form: FormData): Promise<ComposeState> {
  const ref = draftRefOf(form);
  const result = await deps.alerting().returnEntry({ staffId: session.staffId, aal: session.aal }, ref, "edit");
  if (!result.ok) return refused(result.error);
  return { status: "pulled_back", location: composerLocation(result.value.kind, ref) };
}
