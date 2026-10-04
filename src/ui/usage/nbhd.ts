import type { BuildingList } from "@/contracts/buildingList";
import type { NeighbourhoodId } from "@/contracts/directory";
import { NeighbourhoodIdSchema } from "@/contracts/directory";

// The neighbourhood a usage event may carry (S02.15). It is never read from the resident's choices except for an install,
// and then only as one neighbourhood out of the two, never a building: when every chosen building is in the same one.

/** The neighbourhood all of these buildings are in, or undefined when there are none, one is unknown, or they are in both. */
export function installNeighbourhood(chosenBuildings: readonly string[] | undefined, list: BuildingList | null): NeighbourhoodId | undefined {
  if (!chosenBuildings || chosenBuildings.length === 0 || list === null) return undefined;
  const found = new Set<string>();
  for (const rsn of chosenBuildings) {
    const building = list.buildings.find((b) => b.rsn === rsn);
    // A building the list no longer has cannot be placed, so the install is not placed either.
    if (!building) return undefined;
    found.add(building.neighbourhoodId);
  }
  if (found.size !== 1) return undefined;
  const parsed = NeighbourhoodIdSchema.safeParse([...found][0]);
  return parsed.success ? parsed.data : undefined;
}

/** A neighbourhood filter that names exactly one neighbourhood is that neighbourhood; none, or both, is none. */
export function singleNeighbourhood(ids: readonly NeighbourhoodId[]): NeighbourhoodId | undefined {
  const distinct = [...new Set(ids)];
  return distinct.length === 1 ? distinct[0] : undefined;
}
