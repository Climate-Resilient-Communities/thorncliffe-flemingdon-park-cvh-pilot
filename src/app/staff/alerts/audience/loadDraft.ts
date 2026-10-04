import type { Audience } from "@/contracts/audience";
import type { BuildingFloorPlan } from "@/modules/places";
import { alerting } from "../../alerts";
import { buildings } from "../../places";
import { exerciseWords, type ExerciseWords } from "../../ExerciseMarker";
import { isComposerFrom, type ComposerFrom } from "../pages";
import type { DraftRef } from "./editAudience";

export interface AudienceQuery {
  alert?: string | string[];
  entry?: string | string[];
  done?: string | string[];
  /** The composer the pages were opened from (S04.05): `ack` or `compose`. */
  from?: string | string[];
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * The draft a page is about, from `?alert=<id>&entry=<id>`: its ref, audience and status, the buildings to choose from, and the exercise marker when the thread is a
 * drill (S06.05: every screen of a drill carries it); null when there is no such entry.
 */
export async function loadDraft(
  query: AudienceQuery,
): Promise<{ ref: DraftRef; audience: Audience; status: string; plans: BuildingFloorPlan[]; from: ComposerFrom | null; exercise: ExerciseWords | null } | null> {
  const alertId = first(query.alert);
  const entryId = first(query.entry);
  if (alertId === undefined || entryId === undefined) return null;
  const ref = { alertId, entryId };
  const entry = await alerting().getEntry(ref);
  if (!entry) return null;
  const from = first(query.from);
  const thread = await alerting().getThread(alertId);
  return {
    ref,
    audience: entry.content.audience,
    status: entry.status,
    plans: await buildings().listFloorPlans(),
    from: isComposerFrom(from) ? from : null,
    exercise: thread?.isDrill ? exerciseWords() : null,
  };
}
