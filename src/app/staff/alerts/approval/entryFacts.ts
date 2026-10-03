// The facts the role policy needs about an entry for the approval view and its actions (S04.07, AD-4, AD-5): who wrote or changed it. They are read
// from the database through the use cases' own reader, never taken from the request: `alert.approve` is for a Coordinator or an Admin who is not an
// editor of the entry (`not_editor`), and a request can claim anything.
import type { AlertLifecycle } from "@/modules/alerting";
import type { PolicyFacts } from "../../guard";

/**
 * The account no entry has: the stand-in editor-free entry of a request that names no entry or one that is not there. Nobody is excluded from what
 * does not exist, so the guard lets a Coordinator or an Admin through and the page, or the use case under its lock, says "not found" and changes
 * nothing. A Director and an Ambassador are refused on their role alone, whatever the entry.
 */
const NO_ONE = "00000000-0000-0000-0000-000000000000";

export async function approvalFacts(alerting: Pick<AlertLifecycle, "getEntry">, ref: { alertId: string; entryId: string }): Promise<PolicyFacts> {
  const entry = await alerting.getEntry(ref);
  if (!entry) return { entry: { authorId: NO_ONE, editorIds: [], status: "pending_approval" } };
  return { entry: { authorId: entry.authorId, editorIds: entry.editorIds, status: entry.status } };
}
