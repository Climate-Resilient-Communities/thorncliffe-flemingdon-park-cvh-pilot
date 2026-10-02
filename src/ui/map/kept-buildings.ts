import { z } from "zod";
import type { BuildingList } from "@/contracts/buildingList";

// The buildings' pins as the phone last saw them (S02.07): the building list is the same for every visitor, so the map
// keeps the part of it it draws (number, address, neighbourhood, place) and still shows the buildings without signal.
// Nothing about the resident is in it.

export const KEPT_BUILDINGS_KEY = "cvh.map.buildings";

const KeptSchema = z.object({
  v: z.literal(1),
  buildings: z.array(z.object({ rsn: z.string(), address: z.string(), neighbourhood: z.string(), lat: z.number(), lng: z.number() })),
});

export type KeptBuilding = z.infer<typeof KeptSchema>["buildings"][number];
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export function readKeptBuildings(storage: Storage | null): KeptBuilding[] | null {
  if (!storage) return null;
  try {
    const parsed = KeptSchema.safeParse(JSON.parse(storage.getItem(KEPT_BUILDINGS_KEY) ?? "null"));
    return parsed.success ? parsed.data.buildings : null;
  } catch {
    return null;
  }
}

/** The pins of a freshly loaded list, kept for next time; returns them. */
export function keepBuildings(storage: Storage | null, list: BuildingList): KeptBuilding[] {
  const buildings: KeptBuilding[] = [];
  for (const b of list.buildings) {
    if (b.lat !== undefined && b.lng !== undefined) buildings.push({ rsn: b.rsn, address: b.address, neighbourhood: b.neighbourhood, lat: b.lat, lng: b.lng });
  }
  try {
    storage?.setItem(KEPT_BUILDINGS_KEY, JSON.stringify({ v: 1, buildings }));
  } catch {
    // A full or blocked store: the buildings show now, just not without signal later.
  }
  return buildings;
}
