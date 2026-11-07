// O-09 "Accept" and O-10 "Send the reason and decline" as the server actions run them, apart from the guard so a test can call them with a fake
// use case: the form's fields read (the suggestion's id, the reason, the note), the directory module's use case called with the acting staff
// member, and its answer turned into the words the page shows. The guard (actions.ts) has already decided the person may (`moderation.review`).
import { DECLINE_NOTE_MAX_CHARS, DECLINE_REASONS, type DeclineReason } from "@/contracts/placeSubmission";
import { englishText } from "@/i18n/text";
import type { ReviewResult } from "@/modules/directory";
import type { StaffSession } from "../../session";

export type DecideState = { status: "idle" } | { status: "done"; message: string } | { status: "refused"; message: string };

export interface DecideDeps {
  accept: (staffId: string, id: string) => Promise<ReviewResult>;
  decline: (staffId: string, id: string, reason: DeclineReason, note: string | null) => Promise<ReviewResult>;
}

const t = (key: string, values?: Record<string, string | number>) => englishText(`staff.moderation.${key}`, values);

const field = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

const isReason = (value: string): value is DeclineReason => (DECLINE_REASONS as readonly string[]).includes(value);

function refusedBy(result: Extract<ReviewResult, { ok: false }>): DecideState {
  return { status: "refused", message: t(`errors.${result.error}`) };
}

async function guarded(run: () => Promise<DecideState>): Promise<DecideState> {
  try {
    return await run();
  } catch (error) {
    console.error(`moderation.decide_failed error=${error instanceof Error ? error.constructor.name : "unknown"}`);
    return { status: "refused", message: t("errors.failed") };
  }
}

export function acceptFromForm(deps: DecideDeps, session: Pick<StaffSession, "staffId">, form: FormData): Promise<DecideState> {
  return guarded(async () => {
    const result = await deps.accept(session.staffId, field(form, "id"));
    if (!result.ok) return refusedBy(result);
    return { status: "done", message: t(`acceptedLine.${result.kind}`, { name: result.name }) };
  });
}

export function declineFromForm(deps: DecideDeps, session: Pick<StaffSession, "staffId">, form: FormData): Promise<DecideState> {
  const reason = field(form, "reason");
  if (!isReason(reason)) return Promise.resolve({ status: "refused", message: t("errors.reason") });
  // The note is for the Hub's own record; a longer one is cut, as the field's own limit would have.
  const note = field(form, "note").slice(0, DECLINE_NOTE_MAX_CHARS) || null;
  return guarded(async () => {
    const result = await deps.decline(session.staffId, field(form, "id"), reason, note);
    if (!result.ok) return refusedBy(result);
    return { status: "done", message: t("declinedLine", { name: result.name, reason: englishText(`O10.labels.${reason}`) }) };
  });
}
