import type { Audience } from "@/contracts/audience";
import type { BuildingFloorPlan } from "@/modules/places";
import { alerting } from "../../alerts";
import { buildings } from "../../places";
import type { DraftRef } from "./editAudience";

export interface AudienceQuery {
  alert?: string | string[];
  entry?: string | string[];
  done?: string | string[];
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The draft a page is about, from `?alert=<id>&entry=<id>`: its ref, audience and status, and the buildings to choose from; null when there is no such entry. */
export async function loadDraft(query: AudienceQuery): Promise<{ ref: DraftRef; audience: Audience; status: string; plans: BuildingFloorPlan[] } | null> {
  const alertId = first(query.alert);
  const entryId = first(query.entry);
  if (alertId === undefined || entryId === undefined) return null;
  const ref = { alertId, entryId };
  const entry = await alerting().getEntry(ref);
  if (!entry) return null;
  return { ref, audience: entry.content.audience, status: entry.status, plans: await buildings().listFloorPlans() };
}
