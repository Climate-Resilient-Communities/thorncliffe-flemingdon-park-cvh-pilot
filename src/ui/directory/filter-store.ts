import { NO_FILTERS, type FilterState } from "./filters";
import { isNeighbourhoodId } from "./neighbourhood-names";

// The filters a resident applied, kept for the visit (S02.06): opening a provider and going back brings the directory
// back with the same filters. They are kept in sessionStorage, which lasts for the tab and is gone when it closes, and
// never in the address (a query string would put them in the history, in a shared link and in the server's logs, AD-3).
// Nothing here is sent anywhere.

/** The sessionStorage key. Not under `cvh.directory.`: that prefix is the kept listings in localStorage. */
export const FILTERS_KEY = "cvh.directory-filters";

/** The part of Storage this uses, so a test can pass a plain object. */
export type FilterStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The tab's own storage, or null when it is blocked. */
export function tabStorage(): FilterStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item !== "") : []);

/** The filters kept for this visit, or none when nothing is kept, it cannot be read or it is not in shape. */
export function readFilters(storage: FilterStorage | null): FilterState {
  if (!storage) return NO_FILTERS;
  try {
    const raw = storage.getItem(FILTERS_KEY);
    if (!raw) return NO_FILTERS;
    const value = JSON.parse(raw) as { v?: unknown; categories?: unknown; neighbourhoods?: unknown; emergency?: unknown } | null;
    if (!value || value.v !== 1) return NO_FILTERS;
    return {
      categories: [...new Set(strings(value.categories))],
      neighbourhoods: [...new Set(strings(value.neighbourhoods).filter(isNeighbourhoodId))],
      emergency: value.emergency === true,
    };
  } catch {
    return NO_FILTERS;
  }
}

/** Keeps the filters for this visit; no filters keeps nothing. A full or blocked store only means they are not kept. */
export function saveFilters(storage: FilterStorage | null, state: FilterState): void {
  if (!storage) return;
  try {
    if (state.categories.length === 0 && state.neighbourhoods.length === 0 && !state.emergency) storage.removeItem(FILTERS_KEY);
    else storage.setItem(FILTERS_KEY, JSON.stringify({ v: 1, categories: state.categories, neighbourhoods: state.neighbourhoods, emergency: state.emergency }));
  } catch {
    // The filters just do not survive the next page.
  }
}

/** The filters without the topics the release no longer has (a kept filter outlives a release that dropped its topic). */
export function withoutUnknownTopics(state: FilterState, topicIds: readonly string[]): FilterState {
  const known = state.categories.filter((id) => topicIds.includes(id));
  return known.length === state.categories.length ? state : { ...state, categories: known };
}
