// The composer's page data (S04.05): the entry's authoritative state, the buildings, and the English text message of the saved draft as a
// submit will render it. Server only.
import { redirect } from "next/navigation";
import { isNineOneOneFirst } from "@/modules/messaging";
import { alerting } from "../../alerts";
import { previewEntrySms } from "../../freezeEntry";
import { buildings } from "../../places";
import { composerLocation } from "./editDraft";
import { composerScreen, missingComposer, type ComposerMode, type ComposerScreen, type MissingComposer } from "./view";

export interface ComposerQuery {
  alert?: string | string[];
  entry?: string | string[];
  saved?: string | string[];
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * The composer for the entry `?alert=<id>&entry=<id>` names, or the screen for an entry that is not there. An acknowledgement belongs
 * to the acknowledgement composer and a full alert to the alert composer: the other page sends the person to the right one.
 */
export async function loadComposer(mode: ComposerMode, query: ComposerQuery, now: Date = new Date()): Promise<ComposerScreen | MissingComposer> {
  const alertId = first(query.alert);
  const entryId = first(query.entry);
  if (alertId === undefined || entryId === undefined) return missingComposer();
  const ref = { alertId, entryId };
  const state = await alerting().entryState(ref);
  if (!state) return missingComposer();
  const rightMode: ComposerMode = state.entry.kind === "ack" ? "ack" : "alert";
  if (rightMode !== mode) redirect(composerLocation(state.entry.kind, ref));
  const { entry, thread } = state;
  const preview =
    entry.status === "draft"
      ? {
          sms: previewEntrySms(entry.content, { kind: entry.kind, isDrill: thread.isDrill, slug: thread.slug, verified: true, attribution: { role: "hub" } }),
          nineOneOneFirst: isNineOneOneFirst(entry.content.types),
        }
      : null;
  return composerScreen({ mode, state, plans: await buildings().listFloorPlans(), preview, saved: first(query.saved) === "1", now });
}
