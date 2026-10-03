// The composer's page data (S04.05): the entry's authoritative state, the buildings, and the English text message of the saved draft as a
// submit will render it. Server only.
import { redirect } from "next/navigation";
import { isNineOneOneFirst } from "@/modules/messaging";
import { alerting } from "../../alerts";
import { previewEntrySms } from "../../freezeEntry";
import { buildings } from "../../places";
import { composerOf } from "../pages";
import { composerLocation } from "./editDraft";
import { composerScreen, isFollowUpMode, isReplacingMode, isResolveMode, missingComposer, modeOfFrom, type ComposerMode, type ComposerScreen, type MissingComposer } from "./view";

export interface ComposerQuery {
  alert?: string | string[];
  entry?: string | string[];
  saved?: string | string[];
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * The composer for the entry `?alert=<id>&entry=<id>` names, or the screen for an entry that is not there. An acknowledgement belongs
 * to the acknowledgement composer, the thread's first full alert to the alert composer, and an update that follows other entries to the update
 * composer ("Promote to full alert" while every earlier entry is an acknowledgement, "Add an update" after that, S05.01): the other page sends the
 * person to the right one, keeping the notice that a draft was saved.
 */
export async function loadComposer(mode: ComposerMode, query: ComposerQuery, now: Date = new Date()): Promise<ComposerScreen | MissingComposer> {
  const alertId = first(query.alert);
  const entryId = first(query.entry);
  if (alertId === undefined || entryId === undefined) return missingComposer();
  const ref = { alertId, entryId };
  const state = await alerting().entryState(ref);
  if (!state) return missingComposer();
  const rightFrom = composerOf(state.entry.kind, state.priorKinds);
  if (modeOfFrom(rightFrom) !== mode) redirect(composerLocation(state.entry.kind, ref, first(query.saved) === "1" ? { saved: "1" } : {}, rightFrom));
  const { entry, thread } = state;
  const preview =
    entry.status === "draft"
      ? {
          sms: previewEntrySms(entry.content, { kind: entry.kind, isDrill: thread.isDrill, slug: thread.slug, verified: true, attribution: { role: "hub" } }),
          nineOneOneFirst: isNineOneOneFirst(entry.content.types),
        }
      : null;
  // An update shows the running alert it adds to, and what it changes about who the alert is for; a correction or a withdrawal also shows the entry it is about.
  const summary = isFollowUpMode(mode) || isReplacingMode(mode) || isResolveMode(mode) ? await alerting().threadSummary(alertId) : null;
  const replaced = isReplacingMode(mode) && entry.supersedesId ? await alerting().getEntry({ alertId, entryId: entry.supersedesId }) : null;
  const target = replaced ? { kind: replaced.kind, publishedAt: replaced.webPublishedAt, text: replaced.content.text } : null;
  return composerScreen({ mode, state, plans: await buildings().listFloorPlans(), preview, saved: first(query.saved) === "1", now, thread: summary, target });
}
