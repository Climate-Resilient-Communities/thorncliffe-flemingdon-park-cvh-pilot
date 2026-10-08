// The Providers page's filter tabs and search (S02.04): which rows a query of the page shows, and the count each tab carries. A plain
// query (?filter=confirm&q=food), so the tabs are links and the search is a GET form: both work without scripts.

/** "All", "To confirm" (in the catalogue, no last-confirmed date yet) and "Hidden" (in the catalogue, not published). */
export const PROVIDER_FILTERS = ["all", "confirm", "hidden"] as const;
export type ProviderFilter = (typeof PROVIDER_FILTERS)[number];

/** What a filter needs of a row. */
export interface FilterableProvider {
  id: string;
  name: string;
  published: boolean;
  inCatalogue: boolean;
  lastConfirmed: string | null;
}

export interface ProviderQuery {
  filter: ProviderFilter;
  /** The search as typed, trimmed; "" for none. */
  q: string;
}

/** The longest search kept: a provider's name is shorter, and a longer query only makes the page's links long. */
const MAX_QUERY = 100;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The page's query, read safely: an unknown filter is "all", and the search is trimmed and cut to a sane length. */
export function readProviderQuery(query: { filter?: string | string[]; q?: string | string[] }): ProviderQuery {
  const filter = first(query.filter);
  return {
    filter: (PROVIDER_FILTERS as readonly string[]).includes(filter ?? "") ? (filter as ProviderFilter) : "all",
    q: (first(query.q) ?? "").trim().slice(0, MAX_QUERY),
  };
}

/** Lower case, without accents and with single spaces, so "Cafe" finds "Café" and "m001" finds "M001". */
const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-CA")
    .replace(/\s+/g, " ")
    .trim();

/** True when the search is empty or found in the provider's name or code. */
export function matchesSearch(row: Pick<FilterableProvider, "id" | "name">, q: string): boolean {
  const needle = fold(q);
  return needle === "" || fold(row.name).includes(needle) || fold(row.id).includes(needle);
}

/** True when the row belongs under the tab. A provider that left the catalogue is only under "All". */
export function inFilter(row: FilterableProvider, filter: ProviderFilter): boolean {
  if (filter === "confirm") return row.inCatalogue && row.lastConfirmed === null;
  if (filter === "hidden") return row.inCatalogue && !row.published;
  return true;
}

/** Each tab's count, over the rows the search finds. */
export function providerCounts(rows: readonly FilterableProvider[], q: string): Record<ProviderFilter, number> {
  const found = rows.filter((row) => matchesSearch(row, q));
  return {
    all: found.length,
    confirm: found.filter((row) => inFilter(row, "confirm")).length,
    hidden: found.filter((row) => inFilter(row, "hidden")).length,
  };
}

/** The rows the query shows, in their order. */
export function filterProviders<T extends FilterableProvider>(rows: readonly T[], query: ProviderQuery): T[] {
  return rows.filter((row) => inFilter(row, query.filter) && matchesSearch(row, query.q));
}

/** The page's address for a query, without its defaults: /staff/providers, /staff/providers?filter=hidden&q=food. */
export function providersHref(query: ProviderQuery, route = "/staff/providers"): string {
  const params = new URLSearchParams();
  if (query.filter !== "all") params.set("filter", query.filter);
  if (query.q !== "") params.set("q", query.q);
  const search = params.toString();
  return search === "" ? route : `${route}?${search}`;
}
