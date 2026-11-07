// "From residents, to add or apply" on the Providers page (PRD §6.3, D9/E4): the suggestions a Coordinator or an Admin accepted (O-09) and no
// Admin has yet put into the catalogue. Accepting writes no provider row (AD-11: a listing's text changes only through the catalogue scripts,
// and the seed would mark a provider missing from providers.json "not in catalogue"), so the Admin adds the place or applies the correction in
// data/catalogue, loads it with the provider seed, then marks the suggestion done here. Pure, but for the read in `loadFromResidents`.
import { englishText } from "@/i18n/text";
import { applySubmission, listSubmissionsToApply, type ApplyError, type SubmissionRecord } from "@/modules/directory";
import { addressesOfBuildings } from "@/modules/places";
import type { Db } from "@/platform/db";
import { formatTorontoDate } from "@/platform/clock";
import { changeRows, correctionLine, reviewHref, typeLabel, whereRow, type AnswerRow } from "../moderation/view";
import type { StaffSession } from "../session";

const t = (key: string, values?: Record<string, string>) => englishText(`staff.moderation.toApply.${key}`, values);

export interface FromResidentView {
  id: string;
  name: string;
  /** "New place · Community offer" or "Correction of M014". */
  kind: string;
  gloss: string;
  rows: AnswerRow[];
  accepted: string;
  reviewHref: string;
  doneLabel: string;
}

export function fromResidentView(submission: SubmissionRecord, buildings: ReadonlyMap<string, string>): FromResidentView {
  const correction = submission.kind === "correct";
  return {
    id: submission.id,
    name: submission.name,
    kind: correction ? t("correct", { id: submission.providerId ?? "" }) : `${t("add")} · ${typeLabel(submission)}`,
    gloss: correction && submission.changes ? correctionLine(submission.changes) : (submission.what ?? ""),
    rows: correction ? changeRows(submission.changes ?? {}) : [whereRow(submission.location, buildings)],
    accepted: submission.decidedAt ? englishText("staff.moderation.decidedOn", { decision: englishText("O08.accepted"), date: formatTorontoDate(submission.decidedAt) }) : englishText("O08.accepted"),
    reviewHref: reviewHref(submission.id),
    doneLabel: t("doneOf", { name: submission.name }),
  };
}

/** The list, or null when it could not be read (the page then leaves the section out rather than fail the providers list). */
export async function loadFromResidents(db: Db): Promise<FromResidentView[] | null> {
  try {
    const submissions = await listSubmissionsToApply(db);
    const rsns = submissions.flatMap((s) => (s.location?.kind === "building" ? [s.location.rsn] : []));
    const buildings = await addressesOfBuildings(db, rsns);
    return submissions.map((submission) => fromResidentView(submission, buildings));
  } catch (error) {
    console.error(`providers.from_residents_unreadable error=${error instanceof Error ? error.constructor.name : "unknown"}`);
    return null;
  }
}

export type ApplyState = { status: "idle" } | { status: "done"; id: string; message: string } | { status: "refused"; id: string; message: string };

const ERROR_KEYS: Record<ApplyError, string> = { not_found: "errors.not_found", not_accepted: "errors.not_accepted", already_applied: "errors.already_applied" };

/** "Mark as done": the suggestion's id (a hidden field). The use case decides and audits. */
export async function applyFromForm(deps: { db: () => Db }, session: Pick<StaffSession, "staffId">, form: FormData): Promise<ApplyState> {
  const value = form.get("id");
  const id = typeof value === "string" ? value.trim() : "";
  const result = await applySubmission(deps.db(), session.staffId, id);
  if (!result.ok) return { status: "refused", id, message: t(ERROR_KEYS[result.error]) };
  return { status: "done", id, message: t("doneLine", { name: result.name }) };
}
