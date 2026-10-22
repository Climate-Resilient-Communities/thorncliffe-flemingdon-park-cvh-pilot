import type { ListingProvider, ListingText, NeighbourhoodId } from "@/contracts/directory";

// The directory's filters (R-27 as the pilot has it): category, subcategory (the directory's and the map's "What kind
// of place?"), neighbourhood and "Helps in an emergency". Within one filter the chosen values are alternatives (food or
// housing); between filters they all have to hold. Everything here runs on the phone, over the listing file it
// downloaded. A provider's neighbourhoods are the ones the release file lists for it.

export type FilterState = {
  /** Category ids of the listing. */
  categories: readonly string[];
  /** Subcategories, by the English each stands for (subcategoryId): the release gives a subcategory no id of its own. */
  subcategories: readonly string[];
  neighbourhoods: readonly NeighbourhoodId[];
  /** True: only providers with an emergency role. */
  emergency: boolean;
};

export const NO_FILTERS: FilterState = { categories: [], subcategories: [], neighbourhoods: [], emergency: false };

export type FilterKey = { kind: "category"; id: string } | { kind: "subcategory"; id: string } | { kind: "neighbourhood"; id: NeighbourhoodId } | { kind: "emergency" };

/** What names a subcategory across languages and releases: the English it stands for, compared without case (as the listing's chips do). */
export const subcategoryId = (text: ListingText): string => text.original.body.trim().toLocaleLowerCase("en");

/** One subcategory of a release, for a filter option or an applied filter's words: its id and the words of the page language. */
export type ListingSubcategory = { id: string; name: ListingText };

/**
 * Each subcategory of `providers` once, by name in the order of the language. With `categories` on, only those of a
 * provider in one of them, so the choices narrow to the chosen topics; `keep` names applied subcategories that stay
 * listed even then, so a choice already made can always be seen and taken back.
 */
export function listingSubcategories(providers: readonly ListingProvider[], locale: string, categories: readonly string[] = [], keep: readonly string[] = []): ListingSubcategory[] {
  const found = new Map<string, ListingText>();
  for (const provider of providers) {
    const inChosen = categories.length === 0 || provider.category_ids.some((id) => categories.includes(id));
    for (const sub of provider.subcategories) {
      const id = subcategoryId(sub);
      if (id === "" || found.has(id)) continue;
      if (inChosen || keep.includes(id)) found.set(id, sub);
    }
  }
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  return [...found.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => collator.compare(a.name.body, b.name.body) || collator.compare(a.id, b.id));
}

/** A stable string for a filter, for keys, test ids and the "from your choices" marks. */
export const filterKeyId = (key: FilterKey): string => (key.kind === "emergency" ? "emergency" : `${key.kind}:${key.id}`);

export function isActive(state: FilterState, key: FilterKey): boolean {
  switch (key.kind) {
    case "category":
      return state.categories.includes(key.id);
    case "subcategory":
      return state.subcategories.includes(key.id);
    case "neighbourhood":
      return state.neighbourhoods.includes(key.id);
    case "emergency":
      return state.emergency;
  }
}

/** The filters that are on, in a fixed order: topics, then subcategories, then neighbourhoods, then "Helps in an emergency". */
export function activeKeys(state: FilterState): FilterKey[] {
  return [
    ...state.categories.map((id): FilterKey => ({ kind: "category", id })),
    ...state.subcategories.map((id): FilterKey => ({ kind: "subcategory", id })),
    ...state.neighbourhoods.map((id): FilterKey => ({ kind: "neighbourhood", id })),
    ...(state.emergency ? [{ kind: "emergency" } as const] : []),
  ];
}

export function setFilter(state: FilterState, key: FilterKey, on: boolean): FilterState {
  switch (key.kind) {
    case "category":
      return { ...state, categories: on ? [...new Set([...state.categories, key.id])] : state.categories.filter((id) => id !== key.id) };
    case "subcategory":
      return { ...state, subcategories: on ? [...new Set([...state.subcategories, key.id])] : state.subcategories.filter((id) => id !== key.id) };
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
    if (state.subcategories.length > 0 && !provider.subcategories.some((sub) => state.subcategories.includes(subcategoryId(sub)))) return false;
    if (state.neighbourhoods.length > 0 && !provider.neighbourhood_ids.some((id) => state.neighbourhoods.includes(id))) return false;
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
