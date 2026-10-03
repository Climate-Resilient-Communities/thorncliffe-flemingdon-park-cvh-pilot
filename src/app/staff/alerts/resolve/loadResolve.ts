// The page data of "Mark resolved" (O-16, S05.03): the start of a final message (nothing is made until it is saved), or, with an entry named, the composer of that
// draft. Server only.
import { updateStart } from "@/modules/alerting";
import { uuidv7 } from "@/platform/ids";
import { alerting } from "../../alerts";
import { buildings } from "../../places";
import { loadComposer, type ComposerQuery } from "../composer/loadComposer";
import { closedUpdate, missingComposer, startScreen, unpublishedUpdate, type ComposerScreen, type MissingComposer } from "../composer/view";

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * `?alert=<id>`: the start of the final message of that thread; `?alert=<id>&entry=<id>`: the composer of the draft that was made from it (`loadComposer`, which sends an
 * entry to the right page). A thread that is closed (it cannot be resolved again: no form is offered, "This alert is already closed"), or that has nothing residents can read
 * yet, gets its own message.
 */
export async function loadResolve(query: ComposerQuery, now: Date = new Date()): Promise<ComposerScreen | MissingComposer> {
  if (first(query.entry) !== undefined) return loadComposer("resolve", query, now);
  const alertId = first(query.alert);
  if (alertId === undefined) return missingComposer();
  const summary = await alerting().threadSummary(alertId);
  if (summary === null) return missingComposer();
  if (summary.thread.status !== "open") return closedUpdate();
  if (summary.covering === null) return unpublishedUpdate();
  // The id of the entry the first Save makes is minted here: a second press, or a browser that sends the request again, makes the one draft.
  return startScreen({ mode: "resolve", alertId, entryId: uuidv7(), thread: summary, start: updateStart(summary.covering, now), plans: await buildings().listFloorPlans() });
}
