import type { ListingProvider } from "@/contracts/directory";
import { neighbourhoodsOf, type NeighbourhoodId } from "./neighbourhood";

// The directory's filters (R-27 as the pilot has it): category, neighbourhood and "Helps in an emergency". Within one
// filter the chosen values are alternatives (food or housing); between filters they all have to hold. Everything here
// runs on the phone, over the listing file it downloaded.

export type FilterState = {
  /** Category ids of the listing. */
  categories: readonly string[];
  neighbourhoods: readonly NeighbourhoodId[];
  /** True: only providers with an emergency role. */
  emergency: boolean;
};

export const NO_FILTERS: FilterState = { categories: [], neighbourhoods: [], emergency: false };

export type FilterKey = { kind: "category"; id: string } | { kind: "neighbourhood"; id: NeighbourhoodId } | { kind: "emergency" };

/** A stable string for a filter, for keys, test ids and the "from your choices" marks. */
export const filterKeyId = (key: FilterKey): string => (key.kind === "emergency" ? "emergency" : `${key.kind}:${key.id}`);

export function isActive(state: FilterState, key: FilterKey): boolean {
  switch (key.kind) {
    case "category":
      return state.categories.includes(key.id);
    case "neighbourhood":
      return state.neighbourhoods.includes(key.id);
    case "emergency":
      return state.emergency;
  }
}

/** The filters that are on, in a fixed order: topics, then neighbourhoods, then "Helps in an emergency". */
export function activeKeys(state: FilterState): FilterKey[] {
  return [
    ...state.categories.map((id): FilterKey => ({ kind: "category", id })),
    ...state.neighbourhoods.map((id): FilterKey => ({ kind: "neighbourhood", id })),
    ...(state.emergency ? [{ kind: "emergency" } as const] : []),
  ];
}

export function setFilter(state: FilterState, key: FilterKey, on: boolean): FilterState {
  switch (key.kind) {
    case "category":
      return { ...state, categories: on ? [...new Set([...state.categories, key.id])] : state.categories.filter((id) => id !== key.id) };
    case "neighbourhood":
      return { ...state, neighbourhoods: on ? [...new Set([...state.neighbourhoods, key.id])] : state.neighbourhoods.filter((id) => id !== key.id) };
    case "emergency":
      return { ...state, emergency: on };
  }
}

export const removeFilter = (state: FilterState, key: FilterKey): FilterState => setFilter(state, key, false);

/** The providers that pass every filter that is on. A new array; the input is not changed. */
export function filterProviders(providers: readonly ListingProvider[], state: FilterState): ListingProvider[] {
  return providers.filter((provider) => {
    if (state.categories.length > 0 && !provider.category_ids.some((id) => state.categories.includes(id))) return false;
    if (state.neighbourhoods.length > 0 && !neighbourhoodsOf(provider).some((id) => state.neighbourhoods.includes(id))) return false;
    if (state.emergency && provider.emergency_role === null) return false;
    return true;
  });
}

/** Each provider once (the first with an id wins), by name in the order of the language, then by id. */
export function listProviders(providers: readonly ListingProvider[], locale: string): ListingProvider[] {
  const seen = new Set<string>();
  const once = providers.filter((provider) => (seen.has(provider.id) ? false : (seen.add(provider.id), true)));
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  return once.sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.id, b.id));
}
