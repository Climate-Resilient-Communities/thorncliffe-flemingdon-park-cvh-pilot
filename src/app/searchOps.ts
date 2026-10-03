// The ops event of what a search tells the app (AD-23). directory may not import ops, so the app turns the note the use
// case hands it into an ops event here: a reason, a duration and, for a translation model, its id; never the question.
import type { SearchFailureNote } from "@/modules/directory";
import { recordOpsEvent } from "@/modules/ops";
import type { Db } from "@/platform/db";

/** Writes the ops event of a search that could not answer (`search.unavailable`), or of a vendor call that failed while the other leg answered (`search.leg_failed`). */
export async function recordSearchNote(db: Db, note: SearchFailureNote): Promise<void> {
  const subject = note.releaseV === null ? {} : { subjectType: "directory_release", subjectId: String(note.releaseV) };
  // A vendor call that failed while the other leg answered is its own event: the search itself did not fail.
  // The model id (a vendor name, not personal data) says which translation model hit its limit or rescued the question.
  if (note.answered) await recordOpsEvent(db, { kind: "search.leg_failed", ...subject, detail: { reason: note.reason, ms: note.ms, ...(note.model === undefined ? {} : { model: note.model }) } });
  else await recordOpsEvent(db, { kind: "search.unavailable", ...subject, detail: { reason: note.reason, ms: note.ms } });
}
