import type { BuildingList } from "@/contracts/buildingList";
import type { DeviceChoices } from "@/contracts/deviceChoices";

const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];

/**
 * Checks saved buildings and floors against the building list on the phone (S02.03). A building whose `rsn` is no
 * longer listed, and a floor id that no longer exists, are dropped and counted in `removed` for R-34 to say so;
 * nothing else changes. A floor of a building the resident has not chosen is dropped without a count (the resident
 * removed the building, not the floor). Returns the same object when nothing is dropped.
 *
 * An empty list is never trusted to mean "everything is gone": the pilot has 43 buildings, so a list with none is a
 * server that has not been loaded, and the choices are left as they are.
 */
export function reconcileChoices(choices: DeviceChoices, list: BuildingList): DeviceChoices {
  if (list.buildings.length === 0) return choices;
  const listed = new Map(list.buildings.map((building) => [building.rsn, building]));
  const floorOwner = new Map(list.buildings.flatMap((building) => building.floors.map((floor) => [floor.id, building.rsn] as const)));

  const savedBuildings = unique(choices.buildings ?? []);
  const buildings = savedBuildings.filter((rsn) => listed.has(rsn));
  const savedFloors = unique(choices.floors ?? []);
  const floors = savedFloors.filter((id) => floorOwner.has(id) && buildings.includes(floorOwner.get(id)!));

  const removedBuildings = savedBuildings.length - buildings.length;
  const removedFloors = savedFloors.filter((id) => !floorOwner.has(id)).length;
  const duplicates = (choices.buildings?.length ?? 0) !== savedBuildings.length || (choices.floors?.length ?? 0) !== savedFloors.length;
  if (removedBuildings === 0 && removedFloors === 0 && floors.length === savedFloors.length && !duplicates) return choices;

  const next: DeviceChoices = { ...choices, buildings, floors };
  if (removedBuildings > 0 || removedFloors > 0) {
    next.removed = {
      buildings: (choices.removed?.buildings ?? 0) + removedBuildings,
      floors: (choices.removed?.floors ?? 0) + removedFloors,
    };
  }
  return next;
}
