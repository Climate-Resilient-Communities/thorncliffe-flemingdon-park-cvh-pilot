import { BuildingListSchema, type BuildingList } from "@/contracts/buildingList";

export const BUILDING_LIST_URL = "/api/buildings";

let pending: Promise<BuildingList | null> | undefined;

/**
 * The building list for this open page (S02.03): fetched once, with nothing about the resident in the request (no query,
 * no body, no credentials), so it is the same request every visitor makes. Resolves to null when it cannot be loaded or
 * is not a valid list; a failure is not remembered, so the next call tries again.
 */
export function loadBuildingList(fetcher: typeof fetch = fetch): Promise<BuildingList | null> {
  pending ??= (async () => {
    try {
      const response = await fetcher(BUILDING_LIST_URL, { credentials: "omit", headers: { Accept: "application/json" } });
      // The body is always read, so a refusal does not leave the request open.
      const text = await response.text();
      if (!response.ok) return null;
      const parsed = BuildingListSchema.safeParse(JSON.parse(text));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  })().then((list) => {
    if (list === null) pending = undefined;
    return list;
  });
  return pending;
}

/** Test seam: forget the list this page has loaded. */
export function resetBuildingList(): void {
  pending = undefined;
}
