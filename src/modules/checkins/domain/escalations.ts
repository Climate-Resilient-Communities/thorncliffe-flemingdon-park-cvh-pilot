// The rules of an escalation after it is made (S08.08, AD-12; E08 definitions "Escalation", "Closed stub", "Round tally"). Pure: no I/O, no clock (the
// database judges the times: a row is kept for KEPT_ROW_HOURS after the close, by the purge job).

/** How long a row kept for the Hub's follow-up keeps its subscriber after the close: then the purge job makes it a stub (E08 "Closed stub"). */
export const KEPT_ROW_HOURS = 24;
/** The longest note an Admin writes when they mark an escalation handled, in characters (the table's check says the same). */
export const HANDLED_NOTE_MAX_CHARS = 300;

/** An escalation's status: the mark that made it. */
export type EscalationStatus = "not_reached" | "needs_help";

/**
 * What a close does with a row (E08 "Closed stub", AD-12): it is tallied (its latest mark, else `unmarked`), and a `not_reached` or `needs_help` row whose
 * escalation the Hub has not handled yet keeps its subscriber for the follow-up; every other row (`pending`, `done`, or one the Hub has handled already)
 * becomes a closed stub at once. The database's statement (escalationStore.closeThreadRows) is this rule; a test compares them.
 */
export function keptAtClose(row: { status: string; openEscalation: boolean }): boolean {
  return (row.status === "not_reached" || row.status === "needs_help") && row.openEscalation;
}

/** A row's outcome when its round closes: its latest mark, or `unmarked` (E08 "Round tally"). */
export function outcomeAtClose(status: string): string {
  return status === "pending" ? "unmarked" : status;
}

/** Why a handling is refused (a code; the screen turns it into words). */
export type HandleRefusal = "note_missing" | "note_too_long" | "not_found" | "already_handled" | "not_admin";

/**
 * The note as stored: one line (a control character or a line break becomes a space, runs of spaces become one), trimmed; refused when empty or over the
 * limit. What the Hub did, in the Admin's words: the form asks for no name, number or health detail of the resident.
 */
export function parseHandledNote(input: unknown): { ok: true; note: string } | { ok: false; problem: "note_missing" | "note_too_long" } {
  if (typeof input !== "string") return { ok: false, problem: "note_missing" };
  const note = input.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
  if (note === "") return { ok: false, problem: "note_missing" };
  if ([...note].length > HANDLED_NOTE_MAX_CHARS) return { ok: false, problem: "note_too_long" };
  return { ok: true, note };
}

/**
 * Whether an Admin opening the escalation sees the resident's number, floor and method (E08 "Escalation"): only while the row the escalation is about
 * still names its subscriber (live in its round, or kept after the close), and never for a late mark's escalation, which carries the stub's building and
 * floor and the ambassador only (S08.07's decision: the Hub calls the ambassador).
 */
export function residentShown(escalation: { late: boolean }, row: { linked: boolean }): boolean {
  return !escalation.late && row.linked;
}
