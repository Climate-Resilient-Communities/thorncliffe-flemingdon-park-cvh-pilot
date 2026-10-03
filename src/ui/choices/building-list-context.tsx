"use client";

import { createContext, useContext } from "react";
import type { BuildingListState } from "./use-choices";

// The building list the first-run gate loaded (one request for the whole visit). A screen inside the gate reads it from
// here instead of asking again, so a visit makes one request for the list, not one per component.
export const BuildingListContext = createContext<BuildingListState | null>(null);

/** The gate's building list, or null outside a gate (the caller then loads its own with `useBuildingList`). */
export function useGateBuildingList(): BuildingListState | null {
  return useContext(BuildingListContext);
}
