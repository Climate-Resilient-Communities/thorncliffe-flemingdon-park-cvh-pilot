// The page data of "Correct" and "Withdraw" (O-15, S05.02): the start (the entries that can be corrected or withdrawn, and, once one is chosen, the form for it),
// or, with an entry named, the composer of the draft it made. Nothing is made until the form is saved. Server only.
import { updateStart, validTargets } from "@/modules/alerting";
import { uuidv7 } from "@/platform/ids";
import { alerting } from "../../alerts";
import { buildings } from "../../places";
import { loadComposer, type ComposerQuery } from "../composer/loadComposer";
import { closedUpdate, missingComposer, replaceStartScreen, unpublishedUpdate, type ComposerScreen, type MissingComposer } from "../composer/view";

export interface ReplaceQuery extends ComposerQuery {
  /** The entry chosen to be corrected or withdrawn. */
  target?: string | string[];
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * `?alert=<id>`: the entries residents can read that can be corrected or withdrawn (a valid target), newest first, each a link that chooses it;
 * `?alert=<id>&target=<id>`: the form for that entry; `?alert=<id>&entry=<id>`: the composer of the draft the form made (`loadComposer` sends an entry to
 * the page it belongs to). A thread that is closed (nothing more can be added: no form), or that has nothing residents can read yet, gets its own message.
 */
export async function loadReplace(mode: "correct" | "withdraw", query: ReplaceQuery, now: Date = new Date()): Promise<ComposerScreen | MissingComposer> {
  if (first(query.entry) !== undefined) return loadComposer(mode, query, now);
  const alertId = first(query.alert);
  if (alertId === undefined) return missingComposer();
  const summary = await alerting().threadSummary(alertId);
  if (summary === null) return missingComposer();
  if (summary.thread.status !== "open") return closedUpdate();
  if (summary.covering === null) return unpublishedUpdate();
  const targets = validTargets(summary.entries);
  const chosen = first(query.target);
  const target = targets.find((entry) => entry.id === chosen) ?? null;
  return replaceStartScreen({
    mode,
    alertId,
    // The id of the entry the first Save makes is minted here: a second press, or a browser that sends the request again, makes the one draft.
    entryId: uuidv7(),
    thread: summary,
    targets,
    target,
    start: mode === "correct" ? updateStart(summary.covering, now) : null,
    plans: await buildings().listFloorPlans(),
  });
}
