// The update composers' page data (S05.01): the start of an update to a running alert (nothing is made until it is saved), or, with an entry named, the
// composer of that draft. Server only.
import { redirect } from "next/navigation";
import { updateStart } from "@/modules/alerting";
import { uuidv7 } from "@/platform/ids";
import { alerting } from "../../alerts";
import { buildings } from "../../places";
import { loadComposer, type ComposerQuery } from "../composer/loadComposer";
import { closedUpdate, missingComposer, startScreen, unpublishedUpdate, type ComposerScreen, type MissingComposer } from "../composer/view";
import { composerPage } from "../pages";

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * "Add an update" (O-14, `update`) and "Promote to full alert" (O-13, `promote`): with `?alert=<id>` the start of an update to that thread; with
 * `?alert=<id>&entry=<id>` the composer of the draft that was made from it (`loadComposer`, which sends an entry to the right one of the two).
 *
 * A thread that is closed (nothing more can be added: no form is offered, "This alert is already closed"), or that has nothing residents can read
 * yet, gets its own message. Otherwise the start is the page that fits the thread: "Promote to full alert" while every entry residents can read is an
 * acknowledgement (this update is the first), "Add an update" after that; the other page sends the person on, so a link made for one never shows the
 * other's words.
 */
export async function loadUpdate(flavor: "update" | "promote", query: ComposerQuery, now: Date = new Date()): Promise<ComposerScreen | MissingComposer> {
  if (first(query.entry) !== undefined) return loadComposer(flavor, query, now);
  const alertId = first(query.alert);
  if (alertId === undefined) return missingComposer();
  const summary = await alerting().threadSummary(alertId);
  if (summary === null) return missingComposer();
  if (summary.thread.status !== "open") return closedUpdate();
  if (summary.covering === null) return unpublishedUpdate();
  const right = summary.ackOnly ? "promote" : "update";
  if (right !== flavor) redirect(`${composerPage(right)}?${new URLSearchParams({ alert: alertId }).toString()}`);
  // The id of the entry the first Save makes is minted here: a second press, or a browser that sends the request again, makes the one draft.
  return startScreen({ mode: flavor, alertId, entryId: uuidv7(), thread: summary, start: updateStart(summary.covering, now), plans: await buildings().listFloorPlans() });
}
