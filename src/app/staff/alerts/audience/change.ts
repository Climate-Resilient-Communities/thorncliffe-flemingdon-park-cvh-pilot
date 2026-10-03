// What an update changes about who an alert is for, in words (S05.01): "Now also for: ..." and "No longer for: ...". The difference itself is the contract's
// (`audienceChange`, pure, beside the matcher); the words are the audience catalog's, the same ones that say who an alert is for (`asideOf`), so a place is
// named the same way in the sentence and in the change. The approver reads it on the approval view, and the author on the composer while they write the update.
import { audienceChange, type AudienceChange, type AudienceDelta } from "@/contracts/audienceChange";
import type { Audience } from "@/contracts/audience";
import type { BuildingFloorPlan } from "@/modules/places";
import { catalogText, floorLabels, groupName, joinWords, type Text } from "./view";

/** The two lines of a change; null for a side with nothing in it. */
export interface ChangeView {
  alsoFor: string | null;
  noLongerFor: string | null;
}

/** The neighbourhood of a building by the buildings the screen knows (`plans`), for the difference between a neighbourhood and buildings. */
export const neighbourhoodOfPlans =
  (plans: readonly BuildingFloorPlan[]) =>
  (rsn: string): string | null =>
    plans.find((plan) => plan.rsn === rsn)?.neighbourhoodId ?? null;

const neighbourhoodName = (id: string, plans: readonly BuildingFloorPlan[]) => plans.find((plan) => plan.neighbourhoodId === id)?.neighbourhoodName ?? id;

/** One side of the change as a list of places and groups: "Thorncliffe Park, 4 Milepost Pl (floors 3, 4) and Seniors". */
function listOf(delta: AudienceDelta, plans: readonly BuildingFloorPlan[], t: Text): string | null {
  const pieces: string[] = [
    ...delta.places.neighbourhoodIds.map((id) => neighbourhoodName(id, plans)),
    ...delta.places.restOfNeighbourhoodIds.map((id) => t("changeRestOf", { place: neighbourhoodName(id, plans) })),
    ...delta.places.buildings.map((chosen) => {
      const plan = plans.find((candidate) => candidate.rsn === chosen.rsn);
      const address = plan?.address ?? chosen.rsn;
      if (chosen.floors === null) return t("wholeOf", { address });
      return t("floorsOf", { address, labels: plan ? floorLabels(plan, chosen.floors).join(", ") : chosen.floors.length });
    }),
    ...delta.groups.groups.map((group) => groupName(group, t)),
    ...(delta.groups.outsideGroups ? [t("changeOutsideGroups")] : []),
  ];
  return pieces.length === 0 ? null : joinWords(pieces);
}

/** The change as the two lines the screens show. */
export function changeLines(change: AudienceChange, plans: readonly BuildingFloorPlan[], t: Text = catalogText): ChangeView {
  const also = listOf(change.alsoFor, plans, t);
  const noLonger = listOf(change.noLongerFor, plans, t);
  return { alsoFor: also === null ? null : t("changeAlso", { list: also }), noLongerFor: noLonger === null ? null : t("changeNoLonger", { list: noLonger }) };
}

/** What the update's audience changes against the thread's now, in words. */
export function changeView(previous: Audience, next: Audience, plans: readonly BuildingFloorPlan[], t: Text = catalogText): ChangeView {
  return changeLines(audienceChange(previous, next, neighbourhoodOfPlans(plans)), plans, t);
}
