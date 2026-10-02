import { BuildingListSchema, type BuildingList, type ListedBuilding } from "@/contracts/buildingList";

export const BUILDING_LIST_URL = "/api/buildings";

/** How long this open page keeps the list it loaded: a page left open does not prune with an old list. */
export const BUILDING_LIST_MAX_AGE_MS = 5 * 60 * 1000;

type Loaded = { at: number; list: Promise<BuildingList | null> };
let pending: Loaded | undefined;

/**
 * The building list for this open page (S02.03): fetched once, with nothing about the resident in the request (no query,
 * no body, no credentials), so it is the same request every visitor makes. The page keeps it for about 5 minutes, then
 * asks again. The browser's own copy is revalidated (`no-cache`), so what the phone prunes with is what the server read
 * lately, and its `generated_at` says when. Resolves to null when it cannot be loaded or is not a valid list; a failure
 * is not remembered, so the next call tries again.
 */
export function loadBuildingList(fetcher: typeof fetch = fetch, now: () => number = Date.now): Promise<BuildingList | null> {
  if (pending && now() - pending.at >= BUILDING_LIST_MAX_AGE_MS) pending = undefined;
  if (pending) return pending.list;
  const entry: Loaded = {
    at: now(),
    list: (async () => {
      try {
        const response = await fetcher(BUILDING_LIST_URL, { credentials: "omit", cache: "no-cache", headers: { Accept: "application/json" } });
        // The body is always read, so a refusal does not leave the request open.
        const text = await response.text();
        if (!response.ok) return null;
        const parsed = BuildingListSchema.safeParse(JSON.parse(text));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    })().then((list) => {
      if (list === null && pending === entry) pending = undefined;
      return list;
    }),
  };
  pending = entry;
  return entry.list;
}

/** Test seam: forget the list this page has loaded. */
export function resetBuildingList(): void {
  pending = undefined;
}

const collator = new Intl.Collator(undefined, { numeric: true });

/**
 * The buildings as R-35 lists them: by neighbourhood, then by address, with numbers compared as numbers ("4 Milepost"
 * before "10 Overlea"), in the order of the phone's own language. A new array; the list is not changed.
 */
export function sortBuildings(buildings: readonly ListedBuilding[]): ListedBuilding[] {
  return [...buildings].sort((a, b) => collator.compare(a.neighbourhood, b.neighbourhood) || collator.compare(a.address, b.address) || collator.compare(a.rsn, b.rsn));
}
